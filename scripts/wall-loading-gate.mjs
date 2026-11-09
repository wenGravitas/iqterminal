import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const specs={'walls-30h-spot-5m':{market:'spot',step:300000},'walls-30h-perp-15m':{market:'perpetual',step:900000}};
/** Five comparable ready-server/cold-client wall observations. Independent
 * source/paint counts and native slots are required; a completion flag alone
 * cannot certify a view. Source gaps remain part of the exact reference. */
export function wallLoadingGate(samples){
 const first=samples[0],spec=specs[first?.case];
 if(!spec||samples.length!==5||new Set(samples.map(r=>r.run)).size!==5||samples.some(r=>!Number.isInteger(r.run)||r.run<1||r.run>5))throw Error('Expected five distinct runs of one wall scenario');
 const identity=r=>JSON.stringify([r.case,r.build,r.route,r.rendering,r.requested,r.wallCoverageVerification?.reference]);
 if(samples.some(r=>identity(r)!==identity(first)))throw Error('Mixed wall scenario/build/route/reference/window');
 const rows=[...samples].sort((a,b)=>a.run-b.run).map(r=>{
  const failures=[],last=r.last,wall=last?.wall,d=wall?.render,a=wall?.status?.archive,reference=r.wallCoverageVerification?.reference,{from,to}=r.requested??{},step=spec.step;
  if(!Number.isSafeInteger(from)||from%step||to-from!==30*3600000||!Number.isSafeInteger(last?.nativeCandles?.closedBoundary)||to>last.nativeCandles.closedBoundary)failures.push('incorrect or non-past30h range');
  if(!/^[a-f0-9]{40}$/.test(r.build??'')||!r.environmentVerification?.valid||r.environmentVerification.fixture!==false||r.environmentVerification.actual?.build!==r.build||r.environmentVerification.actual?.dataMode!=='staging'||r.environmentVerification.actual?.historyTiles!==true||!r.appVisibilityGuard||!r.emptyBrowserCache||r.exception||r.cpuProfile||r.fitWalls||r.extendedCoverageObservation||r.keepCurrent)failures.push('unverified environment or supplemental observation');
  if(last?.config?.venue!=='binance'||last.config.market!==spec.market||last.config.interval!==(step===300000?'5m':'15m')||last.config.type!=='candle'||last.visibility!=='visible'||!Number.isFinite(last.viewport?.from)||!Number.isFinite(last.viewport?.to)||Math.abs(last.viewport.from*1000-from)>=1||Math.abs(last.viewport.to*1000-to)>=1)failures.push('wrong chart configuration/visible range');
  const revisionRequests=(r.requests??[]).filter(q=>q.url.includes('/walls/projection-batch')&&q.status===200);
  if(!reference||!/^[a-f0-9]{64}$/.test(reference.sourceToken??'')||reference.from!==from||reference.to!==to||reference.sourceFrom!==from-step||reference.sourceTo!==to+step||!revisionRequests.length||revisionRequests.some(q=>q.headers?.['x-iq-source-revision']!==reference.sourceToken)||r.wallCoverageVerification?.valid!==true)failures.push('unverified exact canonical source revision');
  if(!a||a.requestComplete!==true||a.exact!==true||!['complete','partial'].includes(a.state)||a.from!==reference?.sourceFrom||a.to!==reference?.sourceTo||a.loadedThrough<a.to||!Array.isArray(a.gaps)||a.gaps.length!==reference?.gaps||a.market!==spec.market||a.aggregation!=='native'||a.requestedTopN!==8||a.requestedBandPercent!==10)failures.push('incomplete or altered archive coverage/profile');
  if(!d?.mounted||!Number.isSafeInteger(d.visibleHistorical)||d.visibleHistorical<=0||!Number.isSafeInteger(d.draws)||d.draws<=0||d.archiveSegments!==reference?.segments||d.segments!==reference?.segments||d.archiveValueRuns!==reference?.valueRuns||d.pendingProjectionSegments!==0||d.pendingReferenceSegments!==0||!Number.isInteger(d.inputRevision)||d.inputRevision<0||d.inputRevision!==d.paintedRevision||d.valueHistoryLimited||d.episodeHistoryLimited)failures.push('incomplete latest exact wall paint');
  const native=new Set(last?.nativeCandles?.visibleClosed??[]);let missingNative=0;for(let at=from;at<to;at+=step)if(!native.has(at))missingNative++;
  if(missingNative||r.nativeCoverage?.valid!==true)failures.push('incomplete validated native price slots');
  if(typeof r.completeMs!=='number'||!Number.isFinite(r.completeMs)||r.completeMs<0||!Number.isFinite(r.deadlineMs)||r.deadlineMs<=0||r.completeMs>r.deadlineMs||r.deadlineMs>12000||!Number.isFinite(last?.now)||r.completeMs>last.now||r.paintMarks?.completeAt!==r.completeMs||r.paintMarks?.firstHistoryAt!==r.firstHistoryMs||r.timingBasis!=='navigation-relative-painted-content-observation-v4-scenario-stop')failures.push('no timely observed complete paint');
  return {run:r.run,firstUsefulHistoryMs:r.firstHistoryMs,completeMs:r.completeMs,segments:d?.archiveSegments,valueRuns:d?.archiveValueRuns,nativeSlots:(to-from)/step-missingNative,failures,coverageValid:failures.length===0};
 });
 const good=rows.every(r=>r.coverageValid),times=rows.map(r=>r.completeMs).sort((a,b)=>a-b),firstTimes=rows.map(r=>r.firstUsefulHistoryMs);
 const medianMs=good?times[2]:null,maximumMs=good?times[4]:null;
 return {case:first.case,build:first.build,route:first.route,rendering:first.rendering,requested:first.requested,samples:rows,medianMs,maximumMs,targets:{medianMs:5000,maximumMs:10000,firstHistoryMs:3000},pass:good&&medianMs<=5000&&maximumMs<=10000,firstHistoryPass:good&&firstTimes.every(t=>typeof t==='number'&&Number.isFinite(t)&&t>=0&&t<=3000),scope:'Exact available wall paint with independently validated native slots; native-body paint time, current/warm/concurrency/heap and foreground acceptance remain separate.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: wall-loading-gate samples.jsonl summary.json');const result=wallLoadingGate(readFileSync(input,'utf8').trim().split('\n').map(JSON.parse));writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({pass:result.pass,firstHistoryPass:result.firstHistoryPass,medianMs:result.medianMs,maximumMs:result.maximumMs,samples:result.samples}));if(!result.pass||!result.firstHistoryPass)process.exitCode=1;}
