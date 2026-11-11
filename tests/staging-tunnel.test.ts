import {test,expect} from 'vitest';
import {spawn,spawnSync} from 'node:child_process';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';

for(const ports of [{history:18780,current:18781,upstream:18780},{history:18880,current:18881,upstream:18880}])test(`historical SSH retry preserves the healthy live transport on ${ports.history}/${ports.current}`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-tunnel-test-')),state=join(root,'state');
 const fake=`#!/usr/bin/env bash
set -eu
port=''
for arg in "$@"; do case "$arg" in 127.0.0.1:${ports.history}:*) port=${ports.history};; 127.0.0.1:${ports.current}:*) port=${ports.current};; esac; done
[ -n "$port" ]
count=0
[ ! -f "$IQ_TUNNEL_TEST_STATE-$port" ] || count=$(cat "$IQ_TUNNEL_TEST_STATE-$port")
count=$((count+1))
printf '%s' "$count" > "$IQ_TUNNEL_TEST_STATE-$port"
printf '%s %s %s\\n' "$port" "$count" "$$" >> "$IQ_TUNNEL_TEST_STATE-pids"
printf '%s\\n' "$*" >> "$IQ_TUNNEL_TEST_STATE-args"
if [ "$port" = ${ports.history} ] && [ "$count" = 1 ]; then exit 7; fi
exec sleep 60
`;
 await writeFile(join(root,'ssh'),fake,{mode:0o755});
 const child=spawn('bash',[resolve('scripts/staging-tunnel.sh')],{env:{...process.env,PATH:root+':'+process.env.PATH,IQ_TUNNEL_TEST_STATE:state,IQ_STAGING_HISTORY_PORT:String(ports.history),IQ_STAGING_CURRENT_PORT:String(ports.current),IQ_STAGING_UPSTREAM_PORT:String(ports.upstream)},stdio:'ignore'});
 const live=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
 let pids:string[][]=[];
 try{
  const until=Date.now()+4000;
  while(Date.now()<until){try{pids=(await readFile(state+'-pids','utf8')).trim().split('\n').map(x=>x.split(' '));}catch{}
   if(pids.some(p=>p[0]===String(ports.history)&&p[1]==='2')&&pids.some(p=>p[0]===String(ports.current)))break;
   await new Promise(r=>setTimeout(r,25));
  }
  expect(pids.filter(p=>p[0]===String(ports.history)).length).toBeGreaterThanOrEqual(2);
  const current=pids.filter(p=>p[0]===String(ports.current));expect(current).toHaveLength(1);expect(live(Number(current[0][2]))).toBe(true);
  for(const line of (await readFile(state+'-args','utf8')).trim().split('\n')){expect(line).toContain('-o IPQoS=none');expect(line).toContain('-o Compression=no');expect(line).toMatch(new RegExp('127\\.0\\.0\\.1:(?:'+ports.history+'|'+ports.current+'):127\\.0\\.0\\.1:'+ports.upstream));}
 }finally{
  child.kill('SIGTERM');await new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>resolve());});
  const survivors=pids.filter(p=>live(Number(p[2])));for(const p of survivors)process.kill(Number(p[2]),'SIGTERM');expect(survivors).toEqual([]);await rm(root,{recursive:true,force:true});
 }
},10000);

test('private tunnel ports reject malformed, privileged, overflowing and identical bindings before SSH',()=>{
 for(const value of ['bad','0','22','65536','018880','18880; false']){
  const result=spawnSync('bash',['scripts/staging-tunnel.sh'],{env:{...process.env,IQ_STAGING_HISTORY_PORT:value},encoding:'utf8'});expect(result.status).toBe(2);expect(result.stderr).toContain('Invalid private staging tunnel port');
 }
 const same=spawnSync('bash',['scripts/staging-tunnel.sh'],{env:{...process.env,IQ_STAGING_HISTORY_PORT:'18880',IQ_STAGING_CURRENT_PORT:'18880'},encoding:'utf8'});expect(same.status).toBe(2);expect(same.stderr).toContain('must differ');
});
