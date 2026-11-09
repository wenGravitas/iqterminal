import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const specifications={'walls-30h-spot-5m':{market:'spot',interval:'5m',step:300000,slots:360},'walls-30h-perp-15m':{market:'perpetual',interval:'15m',step:900000,slots:120}};
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const stats=values=>values.every(finite)?{medianMs:[...values].sort((a,b)=>a-b)[2],maximumMs:Math.max(...values)}:{medianMs:null,maximumMs:null};
/** Five identical pinned real-chart observations. Missing completion is never
 * omitted from a median. Long observation deadlines do not widen gate targets. */
export function wallLoadingGate(samples,reference){
 const first=samples[0],spec=specifications[first?.case];
 if(!spec||samples.length!==5||new Set(samples.map(s=>s.run)).size!==5||samples.some(s=>!Number.isInteger(s.run)||s.run<1||s.run>5))throw Error('Expected five distinct runs of one supported wall scenario');
 if(!reference||!Number.isSafeInteger(reference.from)||reference.to-reference.from!==30*3600000||!Number.isSafeInteger(reference.sourceFrom)||!Number.isSafeInteger(reference.sourceTo)||reference.sourceFrom>reference.from||reference.sourceTo<reference.to||!Number.isSafeInteger(reference.segments)||reference.segments<1||!Number.isSafeInteger(reference.valueRuns)||reference.valueRuns<1||!Number.isSafeInteger(reference.gaps)||reference.gaps<0||!/^[a-f0-9]{64}$/.test(reference.sourceToken??''))throw Error('Expected independently pinned exact wall reference');
 const identity=s=>JSON.stringify([s.case,s.build,s.route,s.rendering,s.requested]);
 if(samples.some(s=>identity(s)!==identity(first)))throw Error('Mixed case/build/route/rendering/requested window');
 const rows=[...samples].sort((a,b)=>a.run-b.run).map(s=>{
  const failures=[],last=s.last??{},r=last.wall?.render??{},a=last.wall?.status?.archive??{},c=last.config??{},v=last.viewport,n=s.nativeCoverage??{},p=r.paintedViewport;
  const settings=c.indicators?.find(i=>i.definitionId==='native.order-walls')?.settings;
  if(s.requested?.from!==reference.from||s.requested?.to!==reference.to||reference.from%spec.step||reference.to>last.nativeCandles?.closedBoundary)failures.push('incorrect or non-past requested window');
  if(!/^[a-f0-9]{40}$/.test(s.build??'')||s.environmentVerification?.valid!==true||s.environmentVerification.fixture!==false||s.environmentVerification.actual?.build!==s.build||s.environmentVerification.actual?.dataMode!=='staging'||s.environmentVerification.actual?.historyTiles!==true||!s.appVisibilityGuard||!s.emptyBrowserCache||s.exception||s.errors?.length)failures.push('unverified environment or failed observation');
  if(c.venue!=='binance'||c.market!==spec.market||c.interval!==spec.interval||c.type!=='candle'||settings?.mode!=='top-levels'||settings.topLevels!==8||settings.searchRangePercent!==10||settings.aggregation!=='native'||settings.showHistory!==true)failures.push('incorrect default profile');
  if(last.visibility!=='visible'||!v||Math.abs(v.from*1000-reference.from)>=1||Math.abs(v.to*1000-reference.to)>=1||!p||Math.abs(p.fromMs-reference.from)>=1||Math.abs(p.toMs-reference.to)>=1)failures.push('requested viewport not painted');
  const presentationValid=failures.length===0;
  if(!r.mounted||r.visibleHistorical<=0||r.archiveSegments!==reference.segments||r.segments!==reference.segments||r.archiveValueRuns!==reference.valueRuns||r.pendingProjectionSegments!==0||r.pendingReferenceSegments!==0||!Number.isInteger(r.inputRevision)||r.inputRevision!==r.paintedRevision||r.valueHistoryLimited||r.episodeHistoryLimited)failures.push('incomplete exact wall paint');
  if(!Number.isSafeInteger(r.draws)||r.draws<=0||!['complete','partial'].includes(a.state))failures.push('unpainted or unavailable archive');
  const responses=(s.requests??[]).filter(q=>q.url.includes('/walls/projection-batch')&&q.status===200);
  if(!responses.length||responses.some(q=>q.headers?.['x-iq-source-revision']!==reference.sourceToken))failures.push('response revision differs from independent source reference');
  if(!a.requestComplete||!a.exact||a.from!==reference.sourceFrom||a.to!==reference.sourceTo||a.loadedThrough<reference.to||a.gaps?.length!==reference.gaps||a.requestedTopN!==8||a.requestedBandPercent!==10||a.aggregation!=='native'||a.market!==spec.market||!s.wallCoverageVerification?.valid||!s.wallCoverageVerification.sourceVerified||s.wallCoverageVerification.reference?.sourceToken!==reference.sourceToken)failures.push('incomplete validated source coverage');
  if(!n.valid||n.capacityLimited||n.from!==reference.from||n.to!==reference.to||n.requestedSlots!==spec.slots||n.loadedSlots!==spec.slots||n.missing?.length)failures.push('incomplete native candle slots');
  const native=new Set(last.nativeCandles?.visibleClosed??[]);for(let at=reference.from;at<reference.to;at+=spec.step)if(!native.has(at)){failures.push('missing raw native candle slot');break;}
  if(!finite(s.firstHistoryMs)||s.firstHistoryMs>s.completeMs||!finite(s.completeMs)||!finite(last.now)||s.completeMs>s.deadlineMs||s.completeMs>last.now||s.paintMarks?.completeAt!==s.completeMs||s.timingBasis!=='navigation-relative-painted-content-observation-v4-scenario-stop')failures.push('no observed complete paint');
  const firstUsefulValid=presentationValid&&finite(s.firstHistoryMs)&&s.firstHistoryMs<=s.deadlineMs&&s.paintMarks?.firstHistoryAt===s.firstHistoryMs&&r.visibleHistorical>0;
  return {run:s.run,firstUsefulHistoryMs:s.firstHistoryMs,firstUsefulValid,completeMs:s.completeMs,segments:r.archiveSegments,valueRuns:r.archiveValueRuns,nativeSlots:n.loadedSlots,requestedNativeSlots:spec.slots,coverageValid:failures.length===0,failures};
 });
 const complete=stats(rows.map(s=>s.coverageValid?s.completeMs:null)),useful=stats(rows.map(s=>s.firstUsefulValid?s.firstUsefulHistoryMs:null));
 return {case:first.case,build:first.build,route:first.route,rendering:first.rendering,requested:first.requested,reference,samples:rows,firstUseful:{...useful,targetMaximumMs:3000,pass:useful.maximumMs!==null&&useful.maximumMs<=3000},complete:{...complete,targetMedianMs:5000,targetMaximumMs:10000,pass:complete.medianMs!==null&&complete.medianMs<=5000&&complete.maximumMs<=10000},scope:'Five pinned empty-browser-cache/already-prepared real-chart samples. No p95, finite-subset medians, current/warm/cold-build or foreground acceptance. Supplemental observation time does not widen latency targets.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/wall-loading-gate.mjs samples.jsonl summary.json');
 const samples=readFileSync(input,'utf8').trim().split('\n').map(line=>JSON.parse(line)),refs=JSON.parse(readFileSync(new URL('./pi-wall-reference.json',import.meta.url),'utf8'));
 const result=wallLoadingGate(samples,refs.cases[samples[0]?.case]);writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({case:result.case,firstUseful:result.firstUseful,complete:result.complete}));if(!result.complete.pass||!result.firstUseful.pass)process.exitCode=1;
}
