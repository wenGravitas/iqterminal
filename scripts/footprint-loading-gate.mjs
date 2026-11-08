import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const cases={
 'footprint-24h-1h':{step:3600000,hours:24,slots:24},
 'footprint-4h-5m':{step:300000,hours:4,slots:48},
};
/** Evaluate one pinned five-run loading cohort. Completion flags alone cannot
 * certify coverage. This does not certify current, warm, wall or cold-build gates. */
export function footprintLoadingGate(samples){
 const first=samples[0],spec=cases[first?.case];
 if(!spec||samples.length!==5)throw Error('Expected five samples of one supported footprint scenario');
 if(new Set(samples.map(r=>r.run)).size!==5||samples.some(r=>!Number.isInteger(r.run)||r.run<1||r.run>5))throw Error('Expected distinct run numbers 1 through 5');
 const identity=r=>JSON.stringify([r.case,r.build,r.route,r.rendering,r.requested]);
 if(samples.some(r=>identity(r)!==identity(first)))throw Error('Mixed scenario/build/route/rendering/requested windows');
 const rows=[...samples].sort((a,b)=>a.run-b.run).map(r=>{
  const failures=[],{from,to}=r.requested??{},fp=r.last?.footprint,h=fp?.status?.history,v=r.last?.viewport;
  if(!Number.isSafeInteger(from)||from%spec.step||to-from!==spec.hours*3600000||!Number.isSafeInteger(r.last?.nativeCandles?.closedBoundary)||to>r.last.nativeCandles.closedBoundary)failures.push('incorrect or non-past requested range');
  if(!/^[a-f0-9]{40}$/.test(r.build??'')||!r.environmentVerification?.valid||r.environmentVerification.fixture!==false||r.environmentVerification.actual?.build!==r.build||r.environmentVerification.actual?.dataMode!=='staging'||r.environmentVerification.actual?.historyTiles!==true||!r.appVisibilityGuard||!r.emptyBrowserCache||r.exception)failures.push('unverified environment or failed observation');
  if(r.last?.config?.venue!=='binance'||r.last.config.market!=='perpetual'||r.last.config.type!=='footprint'||r.last.config.rowPrice!==25||r.last.config.interval!==(spec.step===3600000?'1h':'5m'))failures.push('incorrect chart configuration');
  if(r.last?.visibility!=='visible'||!v||Math.abs(v.from*1000-from)>=1||Math.abs(v.to*1000-to)>=1)failures.push('requested viewport not visible');
  const painted=new Set((fp?.paint?.times??[]).map(t=>t*1000)),slots=new Map();
  for(const range of h?.ranges??[])for(const slot of range.progress?.slots??[])slots.set(slot.from,slot);
  const missing=[],unvalidated=[];
  for(let i=0;i<spec.slots;i++){
   const at=from+i*spec.step,s=slots.get(at),valid=s?.validated===true&&s.to===at+spec.step&&['ready','empty'].includes(s.state);
   if(!valid)unvalidated.push(at);
   if(!painted.has(at)&&!(valid&&s.state==='empty'))missing.push(at);
  }
  if(!fp?.surface||slots.size&&[...slots.values()].some(s=>s.state==='ready')&&!(fp?.paint?.cells>0))failures.push('no mounted painted footprint content');
  if(!h?.validated||h.capacityLimited||missing.length||unvalidated.length||fp?.status?.rowSize!==25)failures.push('incomplete validated painted coverage or changed row size');
  const complete=r.completeMs;
  if(typeof complete!=='number'||!Number.isFinite(complete)||complete<0||complete>r.deadlineMs||r.deadlineMs>12000||typeof fp?.paint?.at!=='number'||fp.paint.at>r.last.now||complete>r.last.now||r.paintMarks?.completeAt!==complete||r.timingBasis!=='navigation-relative-painted-content-observation-v4-scenario-stop')failures.push('no observed completed paint within deadline');
  return {run:r.run,firstUsefulHistoryMs:r.firstHistoryMs,completeMs:complete,requestedSlots:spec.slots,paintedSlots:spec.slots-missing.length,validatedSlots:spec.slots-unvalidated.length,missing,unvalidated,failures,coverageValid:failures.length===0};
 });
 const complete=rows.every(r=>r.coverageValid),times=rows.map(r=>r.completeMs).sort((a,b)=>a-b);
 const medianMs=complete?times[2]:null,maximumMs=complete?times[4]:null;
 return {case:first.case,build:first.build,route:first.route,rendering:first.rendering,requested:first.requested,samples:rows,medianMs,maximumMs,
  targets:{medianMs:5000,maximumMs:10000},pass:complete&&medianMs<=5000&&maximumMs<=10000,
  scope:'Complete available footprint loading only; all five samples retained. No finite-subset median, p95, current/warm/wall/cold-build or foreground acceptance.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/footprint-loading-gate.mjs samples.jsonl summary.json');
 const result=footprintLoadingGate(readFileSync(input,'utf8').trim().split('\n').map(line=>JSON.parse(line)));
 writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({pass:result.pass,medianMs:result.medianMs,maximumMs:result.maximumMs,samples:result.samples.map(r=>({run:r.run,completeMs:r.completeMs,coverageValid:r.coverageValid}))}));if(!result.pass)process.exitCode=1;
}
