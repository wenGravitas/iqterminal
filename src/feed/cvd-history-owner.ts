/** Worker-lifetime observations. Chart cancellation releases demand, not data. */
import type {CvdSource} from './cvd';
import {CvdContributionLedger,CvdLedgerFailure} from './cvd-contribution-ledger';
import {readNativeExactCvdResponse} from './cvd-exact-native';
import {HistoryResponseFailure} from './history-json';
import {historyScheduler,type HistoryScheduler} from './history-scheduler';
import {RecordedMinuteSessionClient} from './recorded-minute-session';
import {minuteHistoryRequest,type MinuteHistoryRequest} from './recorded-minute-history';

export interface CvdHistoryRead {source:CvdSource;kind:'native'|'archive'|'restore';from:number;to:number}
export type CvdHistoryReason='disabled'|'capacity'|'invalid'|'basis'|'conflict'|'restore'|'mutable'|'unavailable'|'cancelled'|'rejoin-unavailable';
export class CvdHistoryFailure extends Error {constructor(readonly reason:CvdHistoryReason){super('CVD historical observation unavailable');}}
export interface CvdHistoryReceipt {source:CvdSource;from:number;to:number;version:number;changed:boolean;sum:ReturnType<CvdContributionLedger['sum']>;financialAccepted:false;currentReconciled:false}
export type CvdHistoryCommand={type:'cvd-history-read';id:string;request:CvdHistoryRead}|{type:'cvd-history-cancel';id:string};
export type CvdHistoryEvent={type:'cvd-history-result';ids:string[];receipt?:CvdHistoryReceipt;reason?:CvdHistoryReason};
interface Waiter {resolve:(v:CvdHistoryReceipt)=>void;reject:(e:unknown)=>void;signal:AbortSignal;cancel:()=>void}
interface Job {key:string;request:CvdHistoryRead;waiters:Set<Waiter>;abort:AbortController}
const SOURCES=['binance:spot','binance:perpetual','bybit:perpetual'],DAY=86400000;
export const CVD_HISTORY_OWNER_LIMITS=Object.freeze({queued:4,consumers:24,requestMs:12000});
let ownerSequence=0;
function checked(value:CvdHistoryRead){
 if(!value||!SOURCES.includes(value.source)||!['native','archive','restore'].includes(value.kind))throw new CvdHistoryFailure('invalid');
 const [venue,market]=value.source.split(':') as [MinuteHistoryRequest['venue'],MinuteHistoryRequest['market']];
 try{minuteHistoryRequest({dataset:'cvd',venue,market,from:value.from,to:value.to});}catch{throw new CvdHistoryFailure('invalid');}
 return {source:value.source,kind:value.kind,from:value.from,to:value.to};
}
function reason(error:unknown):CvdHistoryReason {
 if(error instanceof CvdHistoryFailure||error instanceof CvdLedgerFailure)return error.reason;
 if(error instanceof HistoryResponseFailure)return error.reason==='disabled'?'disabled':error.reason==='invalid'?'invalid':'unavailable';
 return 'unavailable';
}
export class CvdHistoryOwner {
 private readonly identity=++ownerSequence;
 private readonly ledgers=new Map<CvdSource,CvdContributionLedger>();
 private readonly states=new Map<CvdSource,CvdHistoryReason|'ready'>();
 private readonly jobs=new Map<string,Job>();private active?:Job;private consumers=0;private dead=false;
 private readonly commands=new Map<string,AbortController>();
 private readonly session:RecordedMinuteSessionClient;
 private draining?:Promise<void>;
 readonly metrics={reads:0,coalesced:0,admitted:0,failed:0,cancelled:0};
 constructor(private readonly enabled=false,private readonly request:typeof fetch=(...args)=>fetch(...args),private readonly scheduler:HistoryScheduler=historyScheduler,clock:()=>number=()=>performance.now()){
  this.session=new RecordedMinuteSessionClient(enabled,request,clock);
 }
 read(value:CvdHistoryRead,signal:AbortSignal):Promise<CvdHistoryReceipt>{
  if(!this.enabled||this.dead)return Promise.reject(new CvdHistoryFailure('disabled'));
  if(signal.aborted)return Promise.reject(new CvdHistoryFailure('cancelled'));
  let r:CvdHistoryRead;try{r=checked(value);}catch(error){return Promise.reject(error);}
  const key=JSON.stringify(r);let job=this.jobs.get(key);
  // A draining abandoned read cannot be replaced/coalesced until its body ends.
  if(job?.abort.signal.aborted)return Promise.reject(new CvdHistoryFailure('capacity'));
  if(this.consumers>=CVD_HISTORY_OWNER_LIMITS.consumers||!job&&this.jobs.size-(this.active?1:0)>=CVD_HISTORY_OWNER_LIMITS.queued)return Promise.reject(new CvdHistoryFailure('capacity'));
  if(!job){job={key,request:r,waiters:new Set(),abort:new AbortController()};this.jobs.set(key,job);}else this.metrics.coalesced++;
  const work=job;this.consumers++;this.metrics.reads++;
  const promise=new Promise<CvdHistoryReceipt>((resolve,reject)=>{
   const waiter:Waiter={resolve,reject,signal,cancel:()=>{
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
  let actual:Promise<CvdHistoryReceipt>|undefined;
  const signal=AbortSignal.any([job.abort.signal,AbortSignal.timeout(CVD_HISTORY_OWNER_LIMITS.requestMs)]);
  this.draining=(async()=>{
   let accepted:CvdHistoryReceipt|undefined,failure:CvdHistoryFailure|undefined;
   try{
    accepted=await this.scheduler.read(`cvd-owner:${this.identity}:${job.key}`,'cvd',signal,s=>{
     actual=Promise.resolve().then(()=>{s.throwIfAborted();return this.acquire(job.request,s);});return actual;
    },job.request.kind==='native'?0:2);
    this.metrics.admitted++;
   }catch(error){this.metrics.failed++;failure=new CvdHistoryFailure(signal.aborted?'cancelled':reason(error));if(!signal.aborted)this.states.set(job.request.source,failure.reason);}
   finally{
    await actual?.catch(()=>{});
    this.jobs.delete(job.key);this.active=undefined;
    for(const w of job.waiters){w.signal.removeEventListener('abort',w.cancel);this.consumers--;if(failure)w.reject(failure);else w.resolve(structuredClone(accepted!));}
    job.waiters.clear();this.pump();
   }
  })();
 }
 private async acquire(r:CvdHistoryRead,signal:AbortSignal):Promise<CvdHistoryReceipt>{
  let ledger=this.ledgers.get(r.source);let result:{changed:boolean;version:number};
  if(r.kind==='native'){
   const [venue,market]=r.source.split(':');
   const response=await this.request('/market-data/v2/cvd?'+new URLSearchParams({venue:venue!,market:market!,from:String(r.from),to:String(r.to)}),{signal,cache:'no-store',credentials:'same-origin',redirect:'error'});
   const {payload}=await readNativeExactCvdResponse(response,r.source,signal);signal.throwIfAborted();
   if(payload.from!==r.from||payload.to!==r.to)throw new CvdHistoryFailure('invalid');
   if(ledger?.diagnostics().incarnation&&ledger.diagnostics().incarnation!==payload.incarnation)throw new CvdHistoryFailure('rejoin-unavailable');
   const candidate=ledger??new CvdContributionLedger(r.source,`worker-cvd:${this.identity}:${r.source}`);
   result=candidate.applyNative(payload);ledger=candidate;this.ledgers.set(r.source,ledger);
  }else{
   if(!ledger)throw new CvdHistoryFailure('basis');
   if(r.kind==='archive'){
    if(r.to>ledger.diagnostics().cutover!)throw new CvdHistoryFailure('basis');
    // Accepted warm contributions are immutable observations, not a promise of
    // current-source reconciliation. Complete cached windows need no new lease.
    const sum=ledger.sum(r.from,r.to);
    if(sum.complete)return {source:r.source,from:r.from,to:r.to,version:ledger.diagnostics().version,changed:false,sum,financialAccepted:false,currentReconciled:false};
   }
   const [venue,market]=r.source.split(':') as [MinuteHistoryRequest['venue'],MinuteHistoryRequest['market']];
   const page:MinuteHistoryRequest={dataset:'cvd',venue,market,from:r.from,to:r.to};
   const current=this.session.diagnostics().session,scope=current?.certificate.scope;
   if(!scope||current!.expired||current!.invalid||current!.pages>=32||current!.bytes>=32*1024**2||scope.venue!==venue||scope.market!==market||scope.from>r.from||scope.to<r.to){
    await this.session.close();signal.throwIfAborted();
    const from=Math.floor(r.from/(31*DAY))*31*DAY,to=from+31*DAY;
    await this.session.open({...page,from:r.to<=to?from:r.from,to:r.to<=to?to:r.to},signal);
   }
   const payload=await this.session.read(page,signal);signal.throwIfAborted();
   result=r.kind==='restore'?ledger.restoreArchive(payload):ledger.applyArchive(payload);
  }
  this.states.set(r.source,'ready');return {source:r.source,from:r.from,to:r.to,...result,sum:ledger.sum(r.from,r.to),financialAccepted:false,currentReconciled:false};
 }
 /** Cache-only access never acquires a lease or changes accepted observations. */
 sum(source:CvdSource,from:number,to:number){return this.ledgers.get(source)?.sum(from,to);}
 series(source:CvdSource,anchor:number,from:number,to:number,stepMs=60000){return this.ledgers.get(source)?.series(anchor,from,to,stepMs);}
 evict(source:CvdSource,day:number){return this.ledgers.get(source)?.evict(day);}
 command(command:CvdHistoryCommand,emit:(event:CvdHistoryEvent)=>void){
  if(command.type==='cvd-history-cancel'){this.commands.get(command.id)?.abort();this.commands.delete(command.id);return;}
  if(typeof command.id!=='string'||!command.id||command.id.length>160)return;
  if(this.commands.has(command.id)||this.commands.size>=CVD_HISTORY_OWNER_LIMITS.consumers){emit({type:'cvd-history-result',ids:[command.id],reason:'capacity'});return;}
  const controller=new AbortController();this.commands.set(command.id,controller);
  void this.read(command.request,controller.signal).then(receipt=>{if(!controller.signal.aborted)emit({type:'cvd-history-result',ids:[command.id],receipt});},error=>{if(!controller.signal.aborted)emit({type:'cvd-history-result',ids:[command.id],reason:reason(error)});}).finally(()=>{if(this.commands.get(command.id)===controller)this.commands.delete(command.id);});
 }
 diagnostics(){return {enabled:this.enabled,disposed:this.dead,active:!!this.active,queued:this.jobs.size-(this.active?1:0),consumers:this.consumers,states:Object.fromEntries(this.states),sources:[...this.ledgers].map(([source,ledger])=>ledger.diagnostics()),session:this.session.diagnostics(),...this.metrics};}
 async dispose(){this.dead=true;for(const c of this.commands.values())c.abort();this.commands.clear();for(const j of this.jobs.values())j.abort.abort();for(const j of this.jobs.values())if(j!==this.active){for(const w of j.waiters){w.signal.removeEventListener('abort',w.cancel);w.reject(new CvdHistoryFailure('cancelled'));this.consumers--;}this.jobs.delete(j.key);}await this.draining;await this.session.dispose();}
}
