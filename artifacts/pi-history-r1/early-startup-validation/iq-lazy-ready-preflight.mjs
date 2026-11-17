import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const end=JSON.parse(readFileSync('artifacts/pi-history-r1/windows.json')).end,base='http://127.0.0.1:4181';
const rows=[];
for(const [interval,step,hours] of [['5m',300000,4],['1h',3600000,24]])for(let to=end;to>end-hours*3600000;to-=4*3600000){
 const from=Math.max(end-hours*3600000,to-4*3600000),url=`${base}/market-data/v2/history/footprints?from=${from}&to=${to}&interval=${interval}&rowPrice=25`,start=performance.now();
 const response=await fetch(url,{signal:AbortSignal.timeout(15000)}),text=await response.text(),body=JSON.parse(text),expected=Array.from({length:(to-from)/step},(_,i)=>from+i*step);
 const ready=response.ok&&body.state==='ready'&&expected.every(at=>body.tiles?.some(t=>t.from===at&&t.revision>0));
 rows.push({interval,step,from,to,url,status:response.status,requestMs:performance.now()-start,decodedBytes:Buffer.byteLength(text),headers:Object.fromEntries(response.headers),ready,body});
 writeFileSync('/tmp/iq-lazy-ready-preflight.json',JSON.stringify({kind:'server-readiness-not-a-loading-gate',end,rows},null,2)+'\n');
 console.log(JSON.stringify({interval,from,to,state:body.state,ready,slots:body.tiles?.length,jobs:body.jobs?.map(j=>({id:j.id,failed:j.failed,error:j.error}))}));
 if(!ready)process.exit(1);
}
