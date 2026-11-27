/** Finite newest-first acquisition. Accepted data is owned by the worker, not
 * this turn, its cursor or the caller's viewport lifetime. */
import {CvdLedgerFailure} from './cvd-contribution-ledger';
import {cvdProjectionRequest,type CvdProjectionRequest,type CvdExactProjection} from './cvd-projection-cache';
import type {CvdHistoryOwner,CvdHistoryReason} from './cvd-history-owner';
export interface CvdWindowRequest {projection:CvdProjectionRequest;seed?:{from:number;to:number};before?:number}
export interface CvdWindowResult {version:1;request:CvdProjectionRequest;state:'available'|'loading'|'partial'|'unavailable';projection?:CvdExactProjection;nextBefore?:number;restoringDay?:number;operations:number;scanned:number;failures:Array<{reason:CvdHistoryReason;from:number;to:number;day?:number}>;financialAccepted:false;currentReconciled:false}
export class CvdWindowFailure extends Error {constructor(readonly reason:CvdHistoryReason){super('CVD viewport acquisition unavailable');}}
export const CVD_WINDOW_LIMITS=Object.freeze({operations:4,scanned:512,turnMs:15000,activeTurns:4});
const H=3600000,D=86400000,M=60000;
function failure(error:unknown):CvdHistoryReason {
 if(error instanceof CvdLedgerFailure||error instanceof CvdWindowFailure)return error.reason;
 const r=(error as {reason?:unknown})?.reason;
 return ['disabled','capacity','invalid','basis','conflict','restore','mutable','unavailable','cancelled','rejoin-unavailable','expired-native-basis'].includes(String(r))?r as CvdHistoryReason:'unavailable';
}
export async function acquireCvdWindow(owner:CvdHistoryOwner,value:CvdWindowRequest,signal:AbortSignal):Promise<CvdWindowResult>{
 const r=cvdProjectionRequest(value.projection);let before=value.before??r.to;
 if(!Number.isSafeInteger(before)||before%M||before<r.anchor||before>r.to)throw new CvdWindowFailure('invalid');
 let operations=0,scanned=0,projection:CvdExactProjection|undefined,pendingRestore:number|undefined;
 const failures:CvdWindowResult['failures']=[],restorePages=new Set<string>();
 const fail=(error:unknown,from:number,to:number,day?:number)=>{if(signal.aborted)throw new CvdWindowFailure('cancelled');failures.push({reason:failure(error),from,to,...(day!==undefined?{day}:{})});};
 const project=()=>{try{projection=owner.project(r);pendingRestore=projection.stale?projection.requiresRestore:undefined;if(projection.stale&&pendingRestore===undefined){fail(new CvdWindowFailure(projection.failure??'restore'),r.from,r.to);return false;}return true;}catch(error){if(error instanceof CvdLedgerFailure&&error.reason==='restore'&&error.day!==undefined){pendingRestore=error.day;return true;}fail(error,r.from,r.to);return false;}};
 const complete=()=>!!projection&&!projection.stale&&projection.points.every(p=>!p.partial);
 const result=():CvdWindowResult=>({version:1,request:r,state:complete()?'available':failures.length?(projection?.points.some(p=>p.available)?'partial':'unavailable'):before>r.anchor?'loading':'partial',...(projection?{projection}:{}),...(!complete()&&before>r.anchor?{nextBefore:before}:{}),...(pendingRestore!==undefined?{restoringDay:pendingRestore}:{}),operations,scanned,failures,financialAccepted:false,currentReconciled:false});
 signal.throwIfAborted();
 if(!owner.basis(r.source)){
  if(!value.seed)throw new CvdWindowFailure('basis');
  try{operations++;await owner.read({source:r.source,kind:'native',from:value.seed.from,to:value.seed.to},signal);}catch(error){fail(error,value.seed.from,value.seed.to);return result();}
 }
 if(!project()||complete())return result();
 while(operations<CVD_WINDOW_LIMITS.operations&&scanned<CVD_WINDOW_LIMITS.scanned&&(before>r.anchor||pendingRestore!==undefined)){
  signal.throwIfAborted();
  if(pendingRestore!==undefined){
   const day=pendingRestore;let page:{from:number;to:number};
   try{page=owner.nextRestorePage(r.source,day)??{from:day,to:day+M};}catch(error){fail(error,day,day+D,day);break;}
   const key=`${day}:${page.from}:${page.to}`;if(restorePages.has(key)){fail(new CvdWindowFailure('restore'),page.from,page.to,day);break;}restorePages.add(key);
   try{operations++;const restored=await owner.restorePage({source:r.source,day,...page},signal);if(restored.complete){pendingRestore=undefined;if(!project()||complete())break;}}
   catch(error){fail(error,page.from,page.to,day);break;}
   continue;
  }
  scanned++;const to=before,basis=owner.basis(r.source)!;let from=Math.max(r.anchor,Math.floor((to-1)/H)*H);
  if(from<basis.cutover&&to>basis.cutover)from=basis.cutover;
  try{if(owner.known(r.source,from,to)?.complete){before=from;continue;}}
  catch(error){if(error instanceof CvdLedgerFailure&&error.reason==='restore'){pendingRestore=error.day;continue;}fail(error,from,to);break;}
  const kind=from>=basis.cutover?'native':'archive';
  if(kind==='native'&&from<basis.retainedFrom){fail(new CvdWindowFailure('expired-native-basis'),from,to);break;}
  try{
   operations++;const receipt=await owner.read({source:r.source,kind,from,to},signal);before=from;
   if(!receipt.sum.complete)fail(new CvdWindowFailure('unavailable'),from,to);
   if(!project())break;
   if(projection&&!projection.stale){const day=Math.floor(from/D)*D;try{if(owner.sum(r.source,day,day+D)?.complete)owner.evict(r.source,day);}catch(error){if(!(error instanceof CvdLedgerFailure&&error.reason==='mutable')){fail(error,day,day+D);break;}}}
   if(complete())break;
  }catch(error){fail(error,from,to);break;}
 }
 return result();
}
