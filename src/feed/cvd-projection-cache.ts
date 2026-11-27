/** Exact display inputs outlive both network requests and minute-cell residency. */
import {cvdAnchorAt,type CvdSource} from './cvd';
import {CvdContributionLedger,CvdLedgerFailure,CVD_LEDGER_LIMITS} from './cvd-contribution-ledger';
import {cvdAdd} from './cvd-exact-decimal';
export interface CvdProjectionRequest {source:CvdSource;anchor:number;from:number;to:number;stepMs:number;reset?:'daily'|'weekly'}
export interface CvdExactPoint {time:number;base:string;quote:string;partial:boolean;available:boolean;observed:boolean;period?:number;reset?:boolean}
export interface CvdExactProjection {version:1;semantics:'exact-observed-cvd-projection';request:CvdProjectionRequest;basisId:string;ledgerVersion:number;points:CvdExactPoint[];stale:boolean;failure?:'restore'|'capacity';requiresRestore?:number;financialAccepted:false;currentReconciled:false}
type Sum=ReturnType<CvdContributionLedger['sum']>;
interface Entry {value:CvdExactProjection;prefix:Sum;intervals:Sum[];bytes:number}
interface Cut {index:number;from:number;to:number;before:Sum}
interface Capture {entry:Entry;cuts:Cut[];failed?:number;failure?:'restore'|'capacity';invalid:boolean;beforeVersion:number}
export const CVD_PROJECTION_LIMITS=Object.freeze({entries:24,points:65536,bytes:16*1024**2,responseBytes:4*1024**2,captureBytes:4*1024**2});
const minus=(s:string)=>s==='0'?'0':s.startsWith('-')?s.slice(1):'-'+s;
function replace(sum:Sum,before:Sum,after:Sum):Sum {
 const coveredMinutes=sum.coveredMinutes+after.coveredMinutes-before.coveredMinutes;
 return {...sum,base:cvdAdd(sum.base,cvdAdd(after.base,minus(before.base))),quote:cvdAdd(sum.quote,cvdAdd(after.quote,minus(before.quote))),knownMinutes:sum.knownMinutes+after.knownMinutes-before.knownMinutes,coveredMinutes,observedMinutes:sum.observedMinutes+after.observedMinutes-before.observedMinutes,complete:coveredMinutes===sum.requestedMinutes};
}
function combine(a:Sum,b:Sum):Sum {
 const requestedMinutes=a.requestedMinutes+b.requestedMinutes,coveredMinutes=a.coveredMinutes+b.coveredMinutes;
 return {base:cvdAdd(a.base,b.base),quote:cvdAdd(a.quote,b.quote),knownMinutes:a.knownMinutes+b.knownMinutes,coveredMinutes,observedMinutes:a.observedMinutes+b.observedMinutes,requestedMinutes,complete:coveredMinutes===requestedMinutes,financialAccepted:false};
}
const empty=():Sum=>({base:'0',quote:'0',knownMinutes:0,coveredMinutes:0,observedMinutes:0,requestedMinutes:0,complete:true,financialAccepted:false});
export function cvdProjectionRequest(r:CvdProjectionRequest):CvdProjectionRequest {
 if(!r||!['binance:spot','binance:perpetual','bybit:perpetual'].includes(r.source)||![r.anchor,r.from,r.to,r.stepMs].every(n=>Number.isSafeInteger(n)&&n>=0&&n%60000===0)||r.stepMs<60000||r.anchor>=r.from+r.stepMs||r.from>=r.to||r.to-r.anchor>CVD_LEDGER_LIMITS.days*86400000||r.from%r.stepMs||r.to%r.stepMs||(r.to-r.from)/r.stepMs>CVD_LEDGER_LIMITS.points)throw new CvdLedgerFailure('capacity');
 if(r.reset!==undefined&&(!['daily','weekly'].includes(r.reset)||86400000%r.stepMs||r.anchor!==cvdAnchorAt(r.from,{anchor:r.reset,origin:0,custom:0})))throw new CvdLedgerFailure('capacity');
 return {source:r.source,anchor:r.anchor,from:r.from,to:r.to,stepMs:r.stepMs,...(r.reset?{reset:r.reset}:{})};
}
const periodAt=(r:CvdProjectionRequest,time:number)=>r.reset?cvdAnchorAt(time,{anchor:r.reset,origin:0,custom:0}):r.anchor;
function points(r:CvdProjectionRequest,prefix:Sum,intervals:Sum[],previous:CvdExactPoint[]=[],start=0):CvdExactPoint[]{
 const result=previous.slice(0,start),last=result.at(-1);
 let base=last?.base??prefix.base,quote=last?.quote??prefix.quote,complete=last?!last.partial:prefix.complete;
 for(let i=start;i<intervals.length;i++){const s=intervals[i]!,open=r.from+i*r.stepMs,period=periodAt(r,open);if(i>0&&period!==periodAt(r,open-r.stepMs)){base=quote='0';complete=true;}base=cvdAdd(base,s.base);quote=cvdAdd(quote,s.quote);complete=complete&&s.complete;result.push({time:open+r.stepMs,base,quote,partial:!complete,available:s.knownMinutes>0,observed:s.observedMinutes>0,...(r.reset?{period,reset:open===period}:{})});}return result;
}
const size=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
export class CvdProjectionCache {
 private entries=new Map<string,Entry>();private bytes=0;private count=0;
 readonly metrics={hits:0,builds:0,updates:0,pointsUpdated:0,evictions:0,stale:0};
 constructor(private ledger:(source:CvdSource)=>CvdContributionLedger|undefined,private limits:Partial<Record<keyof typeof CVD_PROJECTION_LIMITS,number>>={}){
  for(const [key,value]of Object.entries(limits))if(!Number.isSafeInteger(value)||value!<1||value!>CVD_PROJECTION_LIMITS[key as keyof typeof CVD_PROJECTION_LIMITS])throw new CvdLedgerFailure('capacity');
  this.limits={...limits};
 }
 private limit(k:keyof typeof CVD_PROJECTION_LIMITS){return this.limits[k]??CVD_PROJECTION_LIMITS[k];}
 private cachedInterval(source:CvdSource,from:number,to:number):Sum|undefined {
  // A coarser zoom may combine finer accepted intervals. A finer zoom never
  // infers minute detail from a coarser total.
  for(const entry of this.entries.values()){
   const r=entry.value.request;if(entry.value.stale||r.source!==source||r.from>from||r.to<to)continue;
   const clipped=r.anchor>r.from&&from===r.anchor;
   if(clipped?(to-r.from)%r.stepMs:((from-r.from)%r.stepMs||(to-from)%r.stepMs||from<r.anchor))continue;
   let sum=empty();for(let i=clipped?0:(from-r.from)/r.stepMs;i<(to-r.from)/r.stepMs;i++)sum=combine(sum,entry.intervals[i]!);return sum;
  }
 }
 private cachedPrefix(r:CvdProjectionRequest):Sum|undefined {
  if(r.anchor>=r.from)return empty();
  const resident=this.cachedInterval(r.source,r.anchor,r.from);if(resident)return resident;
  for(const entry of this.entries.values()){
   const old=entry.value.request;if(entry.value.stale||old.source!==r.source||old.anchor!==r.anchor||old.from>r.from||old.to<r.from||(r.from-old.from)%old.stepMs)continue;
   let sum=entry.prefix;for(let i=0;i<(r.from-old.from)/old.stepMs;i++)sum=combine(sum,entry.intervals[i]!);return sum;
  }
 }
 private build(r:CvdProjectionRequest,ledger:CvdContributionLedger):Entry {
  const prefix=this.cachedPrefix(r)??ledger.sum(r.anchor,r.from),intervals:Sum[]=[];
  for(let t=r.from;t<r.to;t+=r.stepMs){const from=Math.max(t,r.anchor);intervals.push(this.cachedInterval(r.source,from,t+r.stepMs)??ledger.sum(from,t+r.stepMs));}
  const value:CvdExactProjection={version:1,semantics:'exact-observed-cvd-projection',request:r,basisId:ledger.basisId,ledgerVersion:ledger.dataVersion,points:points(r,prefix,intervals),stale:false,financialAccepted:false,currentReconciled:false};
  if(size(value)+128>this.limit('responseBytes'))throw new CvdLedgerFailure('capacity');
  return {value,prefix,intervals,bytes:size({value,prefix,intervals})+512};
 }
 private install(key:string,entry:Entry){
  const old=this.entries.get(key),pointCount=entry.intervals.length;
  if(entry.bytes>this.limit('bytes')||pointCount>this.limit('points'))throw new CvdLedgerFailure('capacity');
  if(old){this.entries.delete(key);this.bytes-=old.bytes;this.count-=old.intervals.length;}
  while(this.entries.size>=this.limit('entries')||this.bytes+entry.bytes>this.limit('bytes')||this.count+pointCount>this.limit('points')){
   const oldest=this.entries.entries().next().value!;this.entries.delete(oldest[0]);this.bytes-=oldest[1].bytes;this.count-=oldest[1].intervals.length;this.metrics.evictions++;
  }
  this.entries.set(key,entry);this.bytes+=entry.bytes;this.count+=pointCount;
 }
 project(value:CvdProjectionRequest):CvdExactProjection {
  const r=cvdProjectionRequest(value),key=JSON.stringify(r),ledger=this.ledger(r.source);if(!ledger)throw new CvdLedgerFailure('basis');
  let entry=this.entries.get(key);
  if(entry&&!entry.value.stale){this.entries.delete(key);this.entries.set(key,entry);this.metrics.hits++;return structuredClone(entry.value);}
  try{const built=this.build(r,ledger);this.install(key,built);entry=built;this.metrics.builds++;}
  catch(error){
   if(!entry||!(error instanceof CvdLedgerFailure)||!['restore','capacity'].includes(error.reason))throw error;
   entry.value={...entry.value,stale:true,failure:error.reason as 'restore'|'capacity',...(error.day!==undefined?{requiresRestore:error.day}:{})};
  }
  return structuredClone(entry!.value);
 }
 /** Capture before admission, synchronously commit only after a successful ledger
  * transaction. Failure must never discard a previously delivered projection. */
 capture(source:CvdSource,from:number,to:number):Capture[]{
  const ledger=this.ledger(source);if(!ledger)return [];let bytes=0;const captures:Capture[]=[];
  for(const entry of this.entries.values()){
   const r=entry.value.request;if(r.source!==source||r.anchor>=to||r.to<=from)continue;
   const capture:Capture={entry,cuts:[],invalid:entry.value.stale,beforeVersion:ledger.dataVersion};captures.push(capture);
   if(capture.invalid)continue;
   const cut=(index:number,start:number,end:number)=>{const lo=Math.max(start,from),hi=Math.min(end,to);if(lo>=hi)return;
    const before=lo===start&&hi===end?(index===-1?entry.prefix:entry.intervals[index]!):ledger.sum(lo,hi),part={index,from:lo,to:hi,before};bytes+=size(part);if(bytes>this.limit('captureBytes'))throw new CvdLedgerFailure('capacity');capture.cuts.push(part);
   };
   try{
    cut(-1,r.anchor,Math.max(r.anchor,r.from));
    const start=Math.max(0,Math.floor((from-r.from)/r.stepMs)),end=Math.min(entry.intervals.length,Math.ceil((to-r.from)/r.stepMs));
    for(let i=start;i<end;i++)cut(i,Math.max(r.anchor,r.from+i*r.stepMs),r.from+(i+1)*r.stepMs);
   }catch(error){capture.cuts=[];capture.invalid=true;capture.failure='capacity';if(error instanceof CvdLedgerFailure&&error.reason==='restore'){capture.failed=error.day;capture.failure='restore';}}
  }
  return captures;
 }
 commit(captures:Capture[]){
  for(const c of captures){
   const old=c.entry,key=JSON.stringify(old.value.request);if(this.entries.get(key)!==old)continue;
   const ledger=this.ledger(old.value.request.source)!;
   const version=ledger.dataVersion;if(c.beforeVersion===version)continue;
   try{
    if(c.invalid||version!==c.beforeVersion+1)throw new CvdLedgerFailure(c.failure??'restore',c.failed);
    let prefix=old.prefix;const intervals=old.intervals.slice();
    for(const cut of c.cuts){const after=ledger.sum(cut.from,cut.to);if(cut.index===-1)prefix=replace(prefix,cut.before,after);else intervals[cut.index]=replace(intervals[cut.index]!,cut.before,after);}
    const start=c.cuts.reduce((first,cut)=>Math.min(first,Math.max(0,cut.index)),intervals.length);
    const value={...old.value,ledgerVersion:ledger.dataVersion,points:points(old.value.request,prefix,intervals,old.value.points,start),stale:false};
    delete value.requiresRestore;
    delete value.failure;
    if(size(value)+128>this.limit('responseBytes'))throw new CvdLedgerFailure('capacity');
    const entry={value,prefix,intervals,bytes:size({value,prefix,intervals})+512};this.install(key,entry);this.metrics.updates++;this.metrics.pointsUpdated+=intervals.length-start;
   }catch(error){old.value={...old.value,stale:true,failure:error instanceof CvdLedgerFailure&&error.reason==='restore'?'restore':'capacity',...(error instanceof CvdLedgerFailure&&error.day!==undefined?{requiresRestore:error.day}:{})};this.metrics.stale++;}
  }
 }
 diagnostics(){return {entries:this.entries.size,points:this.count,bytes:this.bytes,...this.metrics};}
}
