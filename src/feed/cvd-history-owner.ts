/** Worker-lifetime observations. Chart cancellation releases demand, not data. */
import type {CvdSource} from './cvd';
import {CvdContributionLedger,CvdLedgerFailure} from './cvd-contribution-ledger';
import {readNativeExactCvdResponse} from './cvd-exact-native';
import {HistoryResponseFailure} from './history-json';
import {historyScheduler,type HistoryScheduler} from './history-scheduler';
import {RecordedMinuteSessionClient} from './recorded-minute-session';
import {minuteHistoryRequest,type MinuteHistoryRequest} from './recorded-minute-history';
import {CvdProjectionCache,type CvdProjectionRequest,type CvdExactProjection} from './cvd-projection-cache';
import {acquireCvdWindow,CvdWindowFailure,CVD_WINDOW_LIMITS,type CvdWindowRequest,type CvdWindowResult} from './cvd-history-window';

export interface CvdHistoryRead {source:CvdSource;kind:'native'|'archive'|'restore';from:number;to:number}
export type CvdHistoryReason='disabled'|'capacity'|'invalid'|'basis'|'conflict'|'restore'|'mutable'|'unavailable'|'cancelled'|'rejoin-unavailable'|'expired-native-basis';
export class CvdHistoryFailure extends Error {constructor(readonly reason:CvdHistoryReason){super('CVD historical observation unavailable');}}
export interface CvdHistoryReceipt {source:CvdSource;from:number;to:number;version:number;changed:boolean;sum:ReturnType<CvdContributionLedger['sum']>;native?:{from:number;to:number;status:'live'|'stale'|'awaiting';asOf:number};financialAccepted:false;currentReconciled:false}
export interface CvdRestorePage {source:CvdSource;day:number;from:number;to:number}
export interface CvdRestoreReceipt {source:CvdSource;day:number;pages:number;missingRecords:number;complete:boolean;version:number;financialAccepted:false;currentReconciled:false}
export type CvdHistoryCommand={type:'cvd-history-read';id:string;request:CvdHistoryRead}|{type:'cvd-history-window';id:string;request:CvdWindowRequest}|{type:'cvd-history-restore';id:string;request:CvdRestorePage}|{type:'cvd-history-project';id:string;request:CvdProjectionRequest}|{type:'cvd-history-cancel';id:string};
export type CvdHistoryEvent={type:'cvd-history-result';ids:string[];receipt?:CvdHistoryReceipt;window?:CvdWindowResult;restoration?:CvdRestoreReceipt;projection?:CvdExactProjection;reason?:CvdHistoryReason};
interface Waiter {resolve:(v:unknown)=>void;reject:(e:unknown)=>void;signal:AbortSignal;cancel:()=>void}
interface Job {key:string;request:{source:CvdSource;kind:string};waiters:Set<Waiter>;abort:AbortController;run:(signal:AbortSignal)=>Promise<unknown>}
const SOURCES=['binance:spot','binance:perpetual','bybit:perpetual'],DAY=86400000;
export const CVD_HISTORY_OWNER_LIMITS=Object.freeze({queued:4,consumers:24,requestMs:12000});
export const CVD_RESTORE_STAGE_LIMITS=Object.freeze({stages:4,idleMs:60000,lifetimeMs:600000});
let ownerSequence=0;
function checked(value:CvdHistoryRead){
 if(!value||!SOURCES.includes(value.source)||!['native','archive','restore'].includes(value.kind))throw new CvdHistoryFailure('invalid');
 const [venue,market]=value.source.split(':') as [MinuteHistoryRequest['venue'],MinuteHistoryRequest['market']];
 try{minuteHistoryRequest({dataset:'cvd',venue,market,from:value.from,to:value.to});}catch{throw new CvdHistoryFailure('invalid');}
 return {source:value.source,kind:value.kind,from:value.from,to:value.to};
}
function reason(error:unknown):CvdHistoryReason {
 if(error instanceof CvdHistoryFailure||error instanceof CvdLedgerFailure||error instanceof CvdWindowFailure)return error.reason;
 if(error instanceof HistoryResponseFailure)return error.reason==='disabled'?'disabled':error.reason==='invalid'?'invalid':'unavailable';
 return 'unavailable';
}
export class CvdHistoryOwner {
 private readonly identity=++ownerSequence;
 private readonly ledgers=new Map<CvdSource,CvdContributionLedger>();
 private readonly retainedFrom=new Map<CvdSource,number>();
 private readonly nativeStatus=new Map<CvdSource,{status:'live'|'stale'|'awaiting';asOf:number}>();
 private readonly nativeFailures=new Map<CvdSource,CvdHistoryReason>();
 private readonly lifetime=new AbortController();private windowTurns=0;
 private readonly projections=new CvdProjectionCache(source=>this.ledgers.get(source));
 private readonly states=new Map<CvdSource,CvdHistoryReason|'ready'>();
 private readonly jobs=new Map<string,Job>();private active?:Job;private consumers=0;private dead=false;
 private readonly commands=new Map<string,AbortController>();
 private readonly restorations=new Map<string,{source:CvdSource;stage:ReturnType<CvdContributionLedger['beginArchiveRestore']>;deadline:number;expires:number;timer:ReturnType<typeof setTimeout>}>();
 private readonly session:RecordedMinuteSessionClient;
 private draining?:Promise<void>;private activeSignal?:AbortSignal;
 readonly metrics={reads:0,coalesced:0,admitted:0,failed:0,cancelled:0};
 constructor(private readonly enabled=false,private readonly request:typeof fetch=(...args)=>fetch(...args),private readonly scheduler:HistoryScheduler=historyScheduler,private readonly clock:()=>number=()=>performance.now()){
  this.session=new RecordedMinuteSessionClient(enabled,request,clock);
 }
 read(value:CvdHistoryRead,signal:AbortSignal):Promise<CvdHistoryReceipt>{
  if(!this.enabled||this.dead)return Promise.reject(new CvdHistoryFailure('disabled'));
  if(signal.aborted)return Promise.reject(new CvdHistoryFailure('cancelled'));
  let r:CvdHistoryRead;try{r=checked(value);}catch(error){return Promise.reject(error);}
  return this.admit(r,signal,s=>this.acquire(r,s));
 }
 private admit<T>(r:{source:CvdSource;kind:string},signal:AbortSignal,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const key=JSON.stringify(r);let job=this.jobs.get(key);
  // A draining abandoned read cannot be replaced/coalesced until its body ends.
  if(job?.abort.signal.aborted)return Promise.reject(new CvdHistoryFailure('capacity'));
  if(this.consumers>=CVD_HISTORY_OWNER_LIMITS.consumers||!job&&this.jobs.size-(this.active?1:0)>=CVD_HISTORY_OWNER_LIMITS.queued)return Promise.reject(new CvdHistoryFailure('capacity'));
  if(!job){job={key,request:r,waiters:new Set(),abort:new AbortController(),run};this.jobs.set(key,job);}else this.metrics.coalesced++;
  const work=job;this.consumers++;this.metrics.reads++;
  const promise=new Promise<T>((resolve,reject)=>{
   const waiter:Waiter={resolve:value=>resolve(value as T),reject,signal,cancel:()=>{
    if(!work.waiters.delete(waiter))return;this.consumers--;signal.removeEventListener('abort',waiter.cancel);this.metrics.cancelled++;reject(new CvdHistoryFailure('cancelled'));
    if(!work.waiters.size){work.abort.abort();if(this.active!==work)this.jobs.delete(key);}
   }};work.waiters.add(waiter);signal.addEventListener('abort',waiter.cancel,{once:true});
  });this.pump();return promise;
 }
 private pump(){
  if(this.active||this.dead)return;const job=this.jobs.values().next().value as Job|undefined;if(!job)return;
  this.active=job;
  // The scheduler rejects a cancelled consumer before transport drain. Retain
  // this owner's slot until the actual callback (including body cancel) settles.
  let actual:Promise<unknown>|undefined;
  const signal=AbortSignal.any([job.abort.signal,AbortSignal.timeout(CVD_HISTORY_OWNER_LIMITS.requestMs)]);
  this.activeSignal=signal;
  this.draining=(async()=>{
   let accepted:unknown,failure:CvdHistoryFailure|undefined;
   try{
    accepted=await this.scheduler.read(`cvd-owner:${this.identity}:${job.key}`,'cvd',signal,s=>{
     actual=Promise.resolve().then(()=>{s.throwIfAborted();return job.run(s);});return actual;
    },job.request.kind==='native'?0:2);
    this.metrics.admitted++;
   }catch(error){this.metrics.failed++;failure=new CvdHistoryFailure(signal.aborted?'cancelled':reason(error));if(!signal.aborted){this.states.set(job.request.source,failure.reason);if(job.request.kind==='native')this.nativeFailures.set(job.request.source,failure.reason);}}
   finally{
    await actual?.catch(()=>{});
    this.jobs.delete(job.key);this.active=undefined;this.activeSignal=undefined;
    for(const w of job.waiters){w.signal.removeEventListener('abort',w.cancel);this.consumers--;if(failure)w.reject(failure);else w.resolve(structuredClone(accepted!));}
    job.waiters.clear();this.pump();
   }
  })();
 }
 private async acquire(r:CvdHistoryRead,signal:AbortSignal):Promise<CvdHistoryReceipt>{
  let ledger=this.ledgers.get(r.source);let result:{changed:boolean;version:number},native:CvdHistoryReceipt['native'];
  if(r.kind==='native'){
   const [venue,market]=r.source.split(':');
   const response=await this.request('/market-data/v2/cvd?'+new URLSearchParams({venue:venue!,market:market!,from:String(r.from),to:String(r.to)}),{signal,cache:'no-store',credentials:'same-origin',redirect:'error'});
   const {payload}=await readNativeExactCvdResponse(response,r.source,signal);signal.throwIfAborted();
   native={from:payload.from,to:payload.to,status:payload.status,asOf:payload.asOf};
   if(payload.from!==r.from||payload.to!==r.to)throw new CvdHistoryFailure('invalid');
   if(ledger?.diagnostics().incarnation&&ledger.diagnostics().incarnation!==payload.incarnation)throw new CvdHistoryFailure('rejoin-unavailable');
   const candidate=ledger??new CvdContributionLedger(r.source,`worker-cvd:${this.identity}:${r.source}`);
   const captured=this.projections.capture(r.source,r.from,r.to);
   result=candidate.applyNative(payload);ledger=candidate;this.ledgers.set(r.source,ledger);this.nativeFailures.delete(r.source);this.retainedFrom.set(r.source,Math.max(this.retainedFrom.get(r.source)??0,payload.retainedFrom));if(payload.asOf>=(this.nativeStatus.get(r.source)?.asOf??0))this.nativeStatus.set(r.source,{status:payload.status,asOf:payload.asOf});this.projections.commit(captured);
  }else{
   if(!ledger)throw new CvdHistoryFailure('basis');
   if(r.kind==='archive'){
    if(r.to>ledger.diagnostics().cutover!)throw new CvdHistoryFailure('basis');
    // Accepted warm contributions are immutable observations, not a promise of
    // current-source reconciliation. Complete cached windows need no new lease.
    const sum=ledger.sum(r.from,r.to);
    if(sum.complete)return {source:r.source,from:r.from,to:r.to,version:ledger.diagnostics().version,changed:false,sum,financialAccepted:false,currentReconciled:false};
   }
   const payload=await this.archivePage(r,signal);
   const captured=r.kind==='restore'?[]:this.projections.capture(r.source,r.from,r.to);
   result=r.kind==='restore'?ledger.restoreArchive(payload):ledger.applyArchive(payload);this.projections.commit(captured);
  }
  this.states.set(r.source,'ready');return {source:r.source,from:r.from,to:r.to,...result,sum:ledger.sum(r.from,r.to),...(native?{native}:{}),financialAccepted:false,currentReconciled:false};
 }
 private async archivePage(r:CvdHistoryRead,signal:AbortSignal){
   const [venue,market]=r.source.split(':') as [MinuteHistoryRequest['venue'],MinuteHistoryRequest['market']];
   const page:MinuteHistoryRequest={dataset:'cvd',venue,market,from:r.from,to:r.to};
   const current=this.session.diagnostics().session,scope=current?.certificate.scope;
   if(!scope||current!.expired||current!.invalid||current!.pages>=32||current!.bytes>=32*1024**2||scope.venue!==venue||scope.market!==market||scope.from>r.from||scope.to<r.to){
    await this.session.close();signal.throwIfAborted();
    const from=Math.floor(r.from/(31*DAY))*31*DAY,to=from+31*DAY;
    await this.session.open({...page,from:r.to<=to?from:r.from,to:r.to<=to?to:r.to},signal);
   }
   const payload=await this.session.read(page,signal);signal.throwIfAborted();return payload;
 }
 private pruneRestores(){for(const [key,r]of this.restorations)if(this.clock()>=r.deadline){clearTimeout(r.timer);this.restorations.delete(key);}}
 private restoreStage(source:CvdSource,day:number){
  this.pruneRestores();
  const key=`${source}:${day}`,known=this.restorations.get(key);if(known)return known;
  if(this.restorations.size>=CVD_RESTORE_STAGE_LIMITS.stages)throw new CvdHistoryFailure('capacity');
  const ledger=this.ledgers.get(source);if(!ledger)throw new CvdHistoryFailure('basis');
  const stage=ledger.beginArchiveRestore(day),deadline=this.clock()+CVD_RESTORE_STAGE_LIMITS.idleMs,expires=this.clock()+CVD_RESTORE_STAGE_LIMITS.lifetimeMs,timer=setTimeout(()=>{if(this.restorations.get(key)===entry&&entry.deadline===deadline)this.restorations.delete(key);},CVD_RESTORE_STAGE_LIMITS.idleMs),entry={source,stage,deadline,expires,timer};this.restorations.set(key,entry);return entry;
 }
 nextRestorePage(source:CvdSource,day:number){if(!this.enabled||this.dead)throw new CvdHistoryFailure('disabled');return this.restoreStage(source,day).stage.next();}
 restorePage(value:CvdRestorePage,signal:AbortSignal):Promise<CvdRestoreReceipt>{
  if(!this.enabled||this.dead)return Promise.reject(new CvdHistoryFailure('disabled'));
  if(signal.aborted)return Promise.reject(new CvdHistoryFailure('cancelled'));
  let r:CvdHistoryRead;try{r=checked({...value,kind:'restore'});if(!Number.isSafeInteger(value.day)||value.day<0||value.day%DAY||r.from<value.day||r.to>value.day+DAY||r.to-r.from>3600000)throw new CvdHistoryFailure('invalid');}catch(error){return Promise.reject(error);}
  const day=value.day,meta={...r,kind:'restore-page',day};
  return this.admit(meta,signal,async s=>{
   const entry=this.restoreStage(r.source,day),key=`${r.source}:${day}`,ledger=this.ledgers.get(r.source)!;
   if(entry.stage.next()){
    const payload=await this.archivePage(r,s);s.throwIfAborted();
    this.pruneRestores();if(this.restorations.get(key)!==entry)throw new CvdHistoryFailure('unavailable');
    try{const missing=entry.stage.diagnostics().missingRecords,progress=entry.stage.append(payload);if(progress.missingRecords>0&&progress.missingRecords<missing){clearTimeout(entry.timer);const deadline=Math.min(this.clock()+CVD_RESTORE_STAGE_LIMITS.idleMs,entry.expires);entry.deadline=deadline;entry.timer=setTimeout(()=>{if(this.restorations.get(key)===entry&&entry.deadline===deadline)this.restorations.delete(key);},Math.max(0,deadline-this.clock()));}}catch(error){clearTimeout(entry.timer);this.restorations.delete(key);throw error;}
   }
   const complete=!entry.stage.next(),diagnostics=entry.stage.diagnostics();
   if(complete){try{entry.stage.finish();}catch(error){if(!(error instanceof CvdLedgerFailure&&error.reason==='capacity')){clearTimeout(entry.timer);this.restorations.delete(key);}throw error;}clearTimeout(entry.timer);this.restorations.delete(key);}
   return {source:r.source,day,pages:diagnostics.pages,missingRecords:diagnostics.missingRecords,complete,version:ledger.diagnostics().version,financialAccepted:false,currentReconciled:false};
  });
 }
 /** Cache-only access never acquires a lease or changes accepted observations. */
 activity(){return {active:!!this.active,cancelling:this.activeSignal?.aborted??false,queued:this.jobs.size-(this.active?1:0),receivedBytes:this.session.stats.receivedBytes};}
 basis(source:CvdSource){const ledger=this.ledgers.get(source);return ledger?{cutover:ledger.nativeCutover!,retainedFrom:this.retainedFrom.get(source)!}:undefined;}
 sourceState(source:CvdSource){const native=this.nativeStatus.get(source),failure=this.nativeFailures.get(source);return {status:failure?'stale' as const:native?.status??'awaiting' as const,asOf:native?.asOf??0,reason:failure,version:this.ledgers.get(source)?.dataVersion??0};}
 known(source:CvdSource,from:number,to:number){return this.ledgers.get(source)?.coverage(from,to);}
 sum(source:CvdSource,from:number,to:number){return this.ledgers.get(source)?.sum(from,to);}
 series(source:CvdSource,anchor:number,from:number,to:number,stepMs=60000){return this.ledgers.get(source)?.series(anchor,from,to,stepMs);}
 project(request:CvdProjectionRequest){if(!this.enabled||this.dead)throw new CvdHistoryFailure('disabled');return this.projections.project(request);}
 evict(source:CvdSource,day:number){return this.ledgers.get(source)?.evict(day);}
 async window(request:CvdWindowRequest,caller:AbortSignal):Promise<CvdWindowResult>{
  if(!this.enabled||this.dead)throw new CvdHistoryFailure('disabled');
  if(caller.aborted)throw new CvdHistoryFailure('cancelled');
  if(this.windowTurns>=CVD_WINDOW_LIMITS.activeTurns)throw new CvdHistoryFailure('capacity');
  const signal=AbortSignal.any([caller,this.lifetime.signal,AbortSignal.timeout(CVD_WINDOW_LIMITS.turnMs)]);this.windowTurns++;
  try{return await acquireCvdWindow(this,request,signal);}catch(error){if(signal.aborted)throw new CvdHistoryFailure('cancelled');throw error;}finally{this.windowTurns--;}
 }
 command(command:CvdHistoryCommand,emit:(event:CvdHistoryEvent)=>void){
  if(command.type==='cvd-history-cancel'){this.commands.get(command.id)?.abort();this.commands.delete(command.id);return;}
  if(typeof command.id!=='string'||!command.id||command.id.length>160)return;
  if(this.commands.has(command.id)||this.commands.size>=CVD_HISTORY_OWNER_LIMITS.consumers){emit({type:'cvd-history-result',ids:[command.id],reason:'capacity'});return;}
  if(command.type==='cvd-history-project'){
   try{emit({type:'cvd-history-result',ids:[command.id],projection:this.project(command.request)});}catch(error){emit({type:'cvd-history-result',ids:[command.id],reason:reason(error)});}return;
  }
  const controller=new AbortController();this.commands.set(command.id,controller);
  const work=command.type==='cvd-history-window'?this.window(command.request,controller.signal).then(window=>({window})):command.type==='cvd-history-restore'?this.restorePage(command.request,controller.signal).then(restoration=>({restoration})):this.read(command.request,controller.signal).then(receipt=>({receipt}));
  void work.then(result=>{if(!controller.signal.aborted)emit({type:'cvd-history-result',ids:[command.id],...result});},error=>{if(!controller.signal.aborted)emit({type:'cvd-history-result',ids:[command.id],reason:reason(error)});}).finally(()=>{if(this.commands.get(command.id)===controller)this.commands.delete(command.id);});
 }
 diagnostics(){this.pruneRestores();return {enabled:this.enabled,disposed:this.dead,active:!!this.active,queued:this.jobs.size-(this.active?1:0),consumers:this.consumers,windowTurns:this.windowTurns,states:Object.fromEntries(this.states),sources:[...this.ledgers].map(([source,ledger])=>ledger.diagnostics()),projections:this.projections.diagnostics(),restorations:[...this.restorations.values()].map(r=>({source:r.source,...r.stage.diagnostics()})),session:this.session.diagnostics(),...this.metrics};}
 async dispose(){this.dead=true;this.lifetime.abort();for(const c of this.commands.values())c.abort();this.commands.clear();for(const r of this.restorations.values())clearTimeout(r.timer);this.restorations.clear();for(const j of this.jobs.values())j.abort.abort();for(const j of this.jobs.values())if(j!==this.active){for(const w of j.waiters){w.signal.removeEventListener('abort',w.cancel);w.reject(new CvdHistoryFailure('cancelled'));this.consumers--;}this.jobs.delete(j.key);}await this.draining;await this.session.dispose();}
}
