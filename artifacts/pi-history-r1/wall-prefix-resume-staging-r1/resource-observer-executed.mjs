/** Bounded read-only same-server resource window around a client cohort.
 * Its monotonic durations are never subtracted from client timestamps. */
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
if(process.env.IQ_SERVING_RESOURCES_OBSERVE!=='1')throw Error('Explicit serving-resource observation required');
const [label,secondsText='180']=process.argv.slice(2),seconds=Number(secondsText),run=promisify(execFile);
if(!/^[a-zA-Z0-9._-]{1,100}$/.test(label??'')||!Number.isInteger(seconds)||seconds<5||seconds>300)throw Error('Bounded label and5..300second duration required');
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});const start=performance.now();
console.log(JSON.stringify({kind:'start',pid:process.pid,label,seconds,at:new Date().toISOString(),scope:'Read-only serving observer started before isolated materialization proof. Actual process boundaries determine coverage; no cross-host phase subtraction or current execution-confirmation claim.'}));
while(!stopping&&performance.now()-start<seconds*1000){
 const began=performance.now();
 try{
  const [cpu,memory,vmstat,load,pressure,containers,response]=await Promise.all([readFile('/proc/stat','utf8'),readFile('/proc/meminfo','utf8'),readFile('/proc/vmstat','utf8'),readFile('/proc/loadavg','utf8'),readFile('/proc/pressure/cpu','utf8'),run('docker',['stats','--no-stream','--format','{{json .}}','iqterminal-history-api','iqterminal-server','iqterminal-spot-server','iqterminal-history-materializer','iqterminal-spot-history-materializer','iqterminal-footprint-materializer','iqterminal-spot-footprint-materializer','iqterminal-sql-admission'],{timeout:5000,maxBuffer:65536}),fetch('http://127.0.0.1:18780/v2/history/health',{signal:AbortSignal.timeout(5000)})]);
  if(!response.ok)throw Error('Serving health HTTP '+response.status);const health=await response.json();
  console.log(JSON.stringify({kind:'sample',label,at:new Date().toISOString(),elapsedMs:performance.now()-start,sampleMs:performance.now()-began,cpu:cpu.split('\n').filter(line=>/^cpu\b/.test(line)),memory,vmstat:vmstat.split('\n').filter(line=>/^(pswpin|pswpout|pgmajfault|pgfault) /.test(line)),load:load.trim(),pressure:pressure.trim(),containers:containers.stdout.trim().split('\n').map(JSON.parse),health}));
 }catch(error){console.log(JSON.stringify({kind:'sample-error',label,elapsedMs:performance.now()-start,error:String(error)}));}
 for(let i=0;i<10&&!stopping&&performance.now()-began<5000;i++)await new Promise(resolve=>setTimeout(resolve,Math.min(500,5000-(performance.now()-began))));
}
console.log(JSON.stringify({kind:'end',label,elapsedMs:performance.now()-start,stopping}));
