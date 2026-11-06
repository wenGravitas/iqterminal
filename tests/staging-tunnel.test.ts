import {test,expect} from 'vitest';
import {spawn} from 'node:child_process';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';

test('a failed historical SSH tunnel retries independently without replacing the healthy live transport',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-tunnel-test-')),state=join(root,'state');
 const fake=`#!/usr/bin/env bash
set -eu
port=''
for arg in "$@"; do case "$arg" in 127.0.0.1:18780:*) port=18780;; 127.0.0.1:18781:*) port=18781;; esac; done
[ -n "$port" ]
count=0
[ ! -f "$IQ_TUNNEL_TEST_STATE-$port" ] || count=$(cat "$IQ_TUNNEL_TEST_STATE-$port")
count=$((count+1))
printf '%s' "$count" > "$IQ_TUNNEL_TEST_STATE-$port"
printf '%s %s %s\\n' "$port" "$count" "$$" >> "$IQ_TUNNEL_TEST_STATE-pids"
if [ "$port" = 18780 ] && [ "$count" = 1 ]; then exit 7; fi
exec sleep 60
`;
 await writeFile(join(root,'ssh'),fake,{mode:0o755});
 const child=spawn('bash',[resolve('scripts/staging-tunnel.sh')],{env:{...process.env,PATH:root+':'+process.env.PATH,IQ_TUNNEL_TEST_STATE:state},stdio:'ignore'});
 const live=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
 let pids:string[][]=[];
 try{
  const until=Date.now()+4000;
  while(Date.now()<until){try{pids=(await readFile(state+'-pids','utf8')).trim().split('\n').map(x=>x.split(' '));}catch{}
   if(pids.some(p=>p[0]==='18780'&&p[1]==='2')&&pids.some(p=>p[0]==='18781'))break;
   await new Promise(r=>setTimeout(r,25));
  }
  expect(pids.filter(p=>p[0]==='18780').length).toBeGreaterThanOrEqual(2);
  const current=pids.filter(p=>p[0]==='18781');expect(current).toHaveLength(1);expect(live(Number(current[0][2]))).toBe(true);
 }finally{
  child.kill('SIGTERM');await new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>resolve());});
  const survivors=pids.filter(p=>live(Number(p[2])));
  for(const p of survivors)process.kill(Number(p[2]),'SIGTERM');
  expect(survivors).toEqual([]);
  await rm(root,{recursive:true,force:true});
 }
},10000);
