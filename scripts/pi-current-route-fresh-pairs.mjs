/** Five fresh independent current-health route pairs. Read-only, no exchange connection. */
import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import net from 'node:net';

if(process.env.IQ_CURRENT_ROUTE_FRESH_PAIRS!=='1')throw Error('Explicit staging read-only current health route pairs opt-in required');
const label=process.env.IQ_ROUTE_LABEL;assert.match(label??'',/^[a-zA-Z0-9_-]{1,70}$/);const output='artifacts/pi-history-r1/route-'+label;mkdirSync(output,{recursive:false});writeFileSync(output+'/executed.mjs',readFileSync(new URL(import.meta.url)));
const port=18881;
function tcpSnapshot(){return execFileSync('ss',['-tinp'],{encoding:'utf8'}).split('\n').flatMap((line,i,lines)=>line.includes('100.124.223.41:22')?[line,lines[i+1]]:[]);}
async function connect(){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(500);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>{s.destroy();resolve(false);});s.once('timeout',()=>{s.destroy();resolve(false);});});}
assert.equal(await connect(),false,'Temporary probe port is already owned; refusing to reuse it');
let child,exitCode,exitSignal;const samples=[],transports=[];let error;
async function stopTemporary(){
if(child&&exitCode===undefined&&exitSignal===undefined){child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
}
async function measure(route,atPort,run,qos){
 const at=performance.now(),id='current-route-'+label+'-'+route;
 const row={route,run,qos,port:atPort,viewId:id,startedAt:new Date().toISOString(),tcpBefore:tcpSnapshot()};
 try{
  const r=await fetch('http://127.0.0.1:'+atPort+'/v2/history/health',{headers:{'accept-encoding':'gzip','x-iq-view-id':id,'connection':'close'},signal:AbortSignal.timeout(12000)});row.headersMs=performance.now()-at;row.status=r.status;row.headers=Object.fromEntries(r.headers);const body=await r.json();row.receivedMs=performance.now()-at;assert.equal(r.status,200);assert.equal(body.build,'e122f9d8d3995d5b6b907a1519cd6b2f639fa751');row.build=body.build;row.admission=body.metrics;row.materializer=body.materializer?.metrics;row.sqlAdmission=body.sqlAdmission;
 }catch(e){row.error=String(e);}finally{row.elapsedInclusiveMs=performance.now()-at;row.tcpAfter=tcpSnapshot();samples.push(row);writeFileSync(output+'/samples.json',JSON.stringify(samples,null,2));}
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

 if(samples.some(s=>s.error))process.exitCode=1;

}catch(e){error=String(e);process.exitCode=1;}finally{
 await stopTemporary();
 const cleanup={temporarySshPid:child?.pid,exitCode:child?.exitCode,exitSignal:child?.signalCode,portStillListening:await connect()};assert.equal(cleanup.portStillListening,false);writeFileSync(output+'/result.json',JSON.stringify({error,samples:samples.length,cleanup,scope:'Five alternating fresh TCP route pairs for small current health reads; both QoS variants use new independent SSH per sample. Exact deployed API identity checked. Request phases use client monotonic time. No historical workload or live subscriber is added. This diagnoses route/header wait and is not chart paint, historical load, live-confirmation continuity or concurrency acceptance. No persistent SSH settings changed. All failed samples retained; timestamps are client-local.'},null,2));console.log(JSON.stringify({error,cleanup,samples:samples.map(s=>({route:s.route,headersMs:s.headersMs,receivedMs:s.receivedMs,bytes:s.receivedDecodedBytes,canonicalExact:s.canonicalExact,error:s.error}))}));}
