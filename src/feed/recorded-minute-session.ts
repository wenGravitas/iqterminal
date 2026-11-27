/** One worker-owned transport session; resident chart inputs belong elsewhere. */
import {readHistoryJson,HistoryResponseFailure} from './history-json';
import {historyRecord as record,historyHash as hash} from './history-archive-metadata';
import {minuteHistoryRequest,type MinuteHistoryRequest} from './recorded-minute-history';
import {MINUTE_SESSION_LIMITS as LIMIT,minuteSessionScope,validateMinuteLease,validateLeasedMinutePayload,type MinuteLeaseCertificate} from './recorded-minute-lease';
const CONTROL='/market-data/v2/history/recorded-minute-leases',PAGE='/market-data/v2/history/recorded-minutes',HEADER='X-IQ-Minute-Lease';
interface Session {token:string;certificate:MinuteLeaseCertificate;deadline:number;pages:number;bytes:number;invalid:boolean}
export class MinuteSessionFailure extends Error {constructor(readonly reason:'capacity'|'expired'|'invalid'){super('Historical minute session unavailable');}}
export class RecordedMinuteSessionClient {
 private session?:Session;private pendingToken?:string;private active?:{controller:AbortController;work:Promise<unknown>};private closing?:Promise<{released:boolean}>;private dead=false;private opening=false;
 readonly stats={requests:0,failures:0,receivedBytes:0};
 constructor(private readonly enabled=false,private readonly request:typeof fetch=(...args)=>fetch(...args),private readonly clock:()=>number=()=>performance.now()){}
 private operation<T>(caller:AbortSignal|undefined,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(this.active||this.closing)return Promise.reject(new MinuteSessionFailure('capacity'));
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(LIMIT.requestMs),...(caller?[caller]:[])]);
  const work=Promise.resolve().then(async()=>{signal.throwIfAborted();const value=await run(signal);signal.throwIfAborted();return value;});this.active={controller,work};
  return work.catch(error=>{this.stats.failures++;throw error;}).finally(()=>{if(this.active?.work===work)this.active=undefined;});
 }
 private async response(url:string,init:RequestInit){this.stats.requests++;try{return await this.request(url,{cache:'no-store',credentials:'same-origin',redirect:'error',...init});}catch{throw new HistoryResponseFailure('network',true);}}
 open(value:MinuteHistoryRequest,caller?:AbortSignal):Promise<MinuteLeaseCertificate|undefined>{
  if(!this.enabled||this.dead)return Promise.resolve(undefined);if(this.session||this.pendingToken||this.active||this.closing||this.opening)return Promise.reject(new MinuteSessionFailure('capacity'));
  const scope=minuteSessionScope(value),started=this.clock();this.opening=true;
  return this.operation(caller,async signal=>{
   const response=await this.response(CONTROL+'?'+new URLSearchParams(Object.entries(scope).map(([k,v])=>[k,String(v)])),{method:'POST',headers:{'X-IQ-Minute-Lease-Protocol':'1'},signal});
   const {payload,bytes}=await readHistoryJson(response,signal,LIMIT.controlBytes,value=>{
    if(!record(value)||!hash(value.token))throw new MinuteSessionFailure('invalid');this.pendingToken=value.token;
    if(value.version!==1||Object.keys(value).sort().join(',')!=='lease,token,version')throw new MinuteSessionFailure('invalid');return {token:value.token,certificate:validateMinuteLease(value.lease,scope)};
   });this.stats.receivedBytes+=bytes;
   const deadline=started+payload.certificate.expiresAtMs-payload.certificate.acquiredAtMs;
   this.session={...payload,deadline,pages:0,bytes:0,invalid:false};this.pendingToken=undefined;
   if(this.clock()>=deadline)throw new MinuteSessionFailure('expired');return structuredClone(payload.certificate);
  }).catch(async error=>{await this.close();throw error;}).finally(()=>{this.opening=false;});
 }
 read(value:MinuteHistoryRequest,caller?:AbortSignal){
  if(!this.enabled||this.dead)return Promise.resolve(undefined);if(this.opening)return Promise.reject(new MinuteSessionFailure('capacity'));const session=this.session;
  if(!session||this.clock()>=session.deadline)return Promise.reject(new MinuteSessionFailure('expired'));
  if(session.invalid)return Promise.reject(new MinuteSessionFailure('invalid'));
  if(session.pages>=LIMIT.pages||session.bytes>=LIMIT.responseBytes)return Promise.reject(new MinuteSessionFailure('capacity'));
  const request=minuteHistoryRequest(value),scope=session.certificate.scope;
  if(request.dataset!==scope.dataset||request.venue!==scope.venue||request.market!==scope.market||request.from<scope.from||request.to>scope.to)return Promise.reject(new MinuteSessionFailure('invalid'));
  return this.operation(caller,async signal=>{
   if(this.clock()>=session.deadline)throw new MinuteSessionFailure('expired');session.pages++;const response=await this.response(PAGE+'?'+new URLSearchParams(Object.entries(request).map(([k,v])=>[k,String(v)])),{headers:{[HEADER]:session.token},signal});
   try{const {payload,bytes}=await readHistoryJson(response,signal,Math.min(4*1024**2,LIMIT.responseBytes-session.bytes),value=>validateLeasedMinutePayload(value,request,session.certificate));session.bytes+=bytes;this.stats.receivedBytes+=bytes;if(this.clock()>=session.deadline)throw new MinuteSessionFailure('expired');return payload;}
   catch(error){if(error instanceof HistoryResponseFailure&&error.reason==='invalid')session.invalid=true;throw error;}
  });
 }
 close():Promise<{released:boolean}>{
  if(this.closing)return this.closing;
  const work=(async()=>{
   this.active?.controller.abort();await this.active?.work.catch(()=>{});
   const token=this.session?.token??this.pendingToken;this.session=undefined;this.pendingToken=undefined;if(!token)return {released:false};
   const signal=AbortSignal.timeout(LIMIT.requestMs);
   try{const response=await this.response(CONTROL,{method:'DELETE',headers:{[HEADER]:token,'X-IQ-Minute-Lease-Protocol':'1'},signal});const {payload,bytes}=await readHistoryJson(response,signal,LIMIT.controlBytes,value=>{if(!record(value)||value.version!==1||typeof value.released!=='boolean'||Object.keys(value).sort().join(',')!=='released,version')throw new MinuteSessionFailure('invalid');return {released:value.released};});this.stats.receivedBytes+=bytes;return payload;}
   catch{this.stats.failures++;return {released:false};}
  })();this.closing=work;return work.finally(()=>{if(this.closing===work)this.closing=undefined;});
 }
 diagnostics(){return {enabled:this.enabled,disposed:this.dead,active:!!this.active,opening:this.opening,closing:!!this.closing,session:this.session?{certificate:structuredClone(this.session.certificate),pages:this.session.pages,bytes:this.session.bytes,invalid:this.session.invalid,expired:this.clock()>=this.session.deadline}:undefined,...this.stats};}
 dispose(){this.dead=true;return this.close();}
}
