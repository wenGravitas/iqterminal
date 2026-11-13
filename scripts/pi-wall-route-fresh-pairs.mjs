/** Bounded read-only transport diagnostic. One immutable prepared batch, five fresh pairs; no
 * chart/loading/current-confirmation acceptance or exchange connection. */
import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import net from 'node:net';
import {decodeWallPointTransport,WALL_POINT_TRANSPORT} from '../src/shared/order-wall-point-transport.ts';
if(process.env.IQ_WALL_ROUTE_FRESH_PAIRS!=='1')throw Error('Explicit staging read-only fresh route pairs opt-in required');
const label=process.env.IQ_ROUTE_LABEL;assert.match(label??'',/^[a-zA-Z0-9_-]{1,70}$/);const output='artifacts/pi-history-r1/route-'+label;mkdirSync(output,{recursive:false});writeFileSync(output+'/executed.mjs',readFileSync(new URL(import.meta.url)));
const manifest=JSON.parse(readFileSync('artifacts/pi-history-r1/wall-presentation-cache-r1/input-spot/manifest.json','utf8')),hash=b=>createHash('sha256').update(b).digest('hex'),port=18880;
assert.equal(manifest.key,'efa5629adec8fcb0e7ffc93297bd273d178fae996fad4bae79b30862872863b0');
function tcpSnapshot(){return execFileSync('ss',['-tinp'],{encoding:'utf8'}).split('\n').flatMap((line,i,lines)=>line.includes('100.124.223.41:22')?[line,lines[i+1]]:[]);}
async function connect(){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(500);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>{s.destroy();resolve(false);});s.once('timeout',()=>{s.destroy();resolve(false);});});}
assert.equal(await connect(),false,'Temporary probe port is already owned; refusing to reuse it');
let child,exitCode,exitSignal;const samples=[],transports=[];let error;
async function stopTemporary(){
if(child&&exitCode===undefined&&exitSignal===undefined){child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
}
async function measure(route,atPort,run,qos){
 const at=performance.now(),id='wall-route-'+label+'-'+route,controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('45s diagnostic observation expired; not a latency pass')),45000);let bytes=0;
 const row={route,run,qos,port:atPort,viewId:id,startedAt:new Date().toISOString(),tcpBefore:tcpSnapshot()};
 try{
  const url='http://127.0.0.1:'+atPort+'/v2/history/walls/projection-batch?'+new URLSearchParams({market:'spot',key:manifest.key,start:'0',version:'2'}),r=await fetch(url,{headers:{'accept-encoding':'br','x-iq-view-id':id,'connection':'close'},signal:controller.signal});row.headersMs=performance.now()-at;row.status=r.status;row.headers=Object.fromEntries(r.headers);assert.equal(r.status,200);assert.equal(r.headers.get('x-iq-wall-transport'),WALL_POINT_TRANSPORT);assert.equal(r.headers.get('x-iq-source-revision'),manifest.sourceToken);assert.equal(r.headers.get('x-iq-db-queries'),'0');
  const chunks=[];for await(const b of r.body){bytes+=b.length;assert.ok(bytes<=8*1024*1024);chunks.push(b);}row.receivedMs=performance.now()-at;clearTimeout(timer);
  const body=Buffer.concat(chunks,bytes),lines=body.toString().split('\n');assert.equal(lines.pop(),'');const count=Number(r.headers.get('x-iq-wall-next')),sizes=JSON.parse(r.headers.get('x-iq-wall-part-bytes'));assert.equal(Number(r.headers.get('x-iq-wall-start')),0);assert.equal(lines.length,count);assert.equal(bytes,Number(r.headers.get('x-iq-decoded-bytes')));assert.equal(sizes.length,count);
  const validationAt=performance.now();for(let i=0;i<count;i++){const raw=Buffer.from(lines[i]),p=manifest.parts[i];assert.equal(raw.length,sizes[i]);const decoded=await decodeWallPointTransport(JSON.parse(lines[i]),undefined,{bytes:raw.length,max:p.bytes}),canonical=decoded.changed?Buffer.from(JSON.stringify(decoded.value)):raw;assert.equal(canonical.length,p.bytes);assert.equal(hash(canonical),p.hash);}
  row.validationMs=performance.now()-validationAt;row.parts=count;row.transportSha256=hash(body);row.canonicalExact=true;
 }catch(e){row.error=String(e);}finally{clearTimeout(timer);row.elapsedInclusiveMs=performance.now()-at;row.receivedDecodedBytes=bytes;row.tcpAfter=tcpSnapshot();samples.push(row);writeFileSync(output+'/samples.json',JSON.stringify(samples,null,2));}
 return row;
}
try{
 const health=await fetch('http://127.0.0.1:18781/v2/history/health',{signal:AbortSignal.timeout(10000)});assert.equal(health.status,200);const body=await health.json();assert.equal(body.build,'e122f9d8d3995d5b6b907a1519cd6b2f639fa751');writeFileSync(output+'/health-before.json',JSON.stringify(body,null,2));
 const effective=execFileSync('ssh',['-G','staging'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\n').find(line=>line.startsWith('ipqos '));assert.equal(effective,'ipqos lowdelay throughput','Record and review changed SSH defaults before comparing');
 for(let run=1;run<=5;run++)for(const qos of run%2?['default','none']:['none','default']){
  assert.equal(await connect(),false);exitCode=undefined;exitSignal=undefined;
  const args=['-N','-T','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','ControlMaster=no','-o','ControlPath=none','-o','Compression=no',...(qos==='none'?['-o','IPQoS=none']:[]),'-L',`127.0.0.1:${port}:127.0.0.1:18780`,'staging'];
  child=spawn('ssh',args,{stdio:['ignore','ignore','pipe']});const diagnostics=[];child.stderr.on('data',b=>diagnostics.push(b.toString()));child.once('exit',(code,signal)=>{exitCode=code;exitSignal=signal;});const started=performance.now();while(!await connect()){assert.equal(exitCode,undefined,'Temporary SSH exited before listening: '+diagnostics.join(''));if(performance.now()-started>20000)throw Error('Temporary SSH did not establish within20s');await new Promise(r=>setTimeout(r,100));}
  const row=await measure('fresh-'+qos+'-'+run,port,run,qos);await stopTemporary();transports.push({run,qos,pid:child.pid,args,exitCode:child.exitCode,exitSignal:child.signalCode,portStillListening:await connect()});assert.equal(transports.at(-1).portStillListening,false);writeFileSync(output+'/transports.json',JSON.stringify(transports,null,2));console.log(JSON.stringify({run,qos,receivedMs:row.receivedMs,headersMs:row.headersMs,canonicalExact:row.canonicalExact,error:row.error}));
 }
 const completed=samples.filter(s=>s.canonicalExact);if(completed.length)assert.ok(completed.every(s=>s.transportSha256===completed[0].transportSha256));
 if(samples.some(s=>s.error))process.exitCode=1;

}catch(e){error=String(e);process.exitCode=1;}finally{
 await stopTemporary();
 const cleanup={temporarySshPid:child?.pid,exitCode:child?.exitCode,exitSignal:child?.signalCode,portStillListening:await connect()};assert.equal(cleanup.portStillListening,false);writeFileSync(output+'/result.json',JSON.stringify({error,samples:samples.length,cleanup,scope:'Five alternating fresh TCP route pairs; both QoS variants use new independent SSH per sample. Canonical part hashes independently checked; request phases use client monotonic time. HTTP compressed body length excludes SSH/Tailscale overhead. Validation overlaps inclusive elapsed; not additive. This is one batch, not30h chart loading acceptance, live-confirmation continuity or production change. No persistent SSH settings changed. All failed samples retained; timestamps are client-local.'},null,2));console.log(JSON.stringify({error,cleanup,samples:samples.map(s=>({route:s.route,headersMs:s.headersMs,receivedMs:s.receivedMs,bytes:s.receivedDecodedBytes,canonicalExact:s.canonicalExact,error:s.error}))}));}
