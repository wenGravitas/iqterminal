/** Optional chart adapter. The shared owner retains accepted inputs after the
 * last panel leaves; frames and acquisition turns have separate lifetimes. */
import {compatibleCvdSources,cvdAnchorAt,type CvdRequest,type CvdSource,type CvdSeries,type CvdEvent} from './cvd';
import {CvdHistoryOwner,CVD_HISTORY_OWNER_LIMITS,type CvdHistoryReceipt} from './cvd-history-owner';
import type {CvdProjectionRequest} from './cvd-projection-cache';
const M=60000,D=86400000;
export interface CvdViewport {from:number;to:number;stepMs:number}
export const CVD_TIERED_LIMITS=Object.freeze({clients:8,points:5000,frameBytes:32*1024**2,turns:4096,archiveBytes:512*1024**2,loadMs:30*60000,currentWindowMs:120000,repairSpacingMs:5000,repairSweepPauseMs:60000});
interface Task {query:CvdProjectionRequest;before:number;turns:number;started:number;bytes:number;done:boolean;retries:number;retryAt:number;restoringDay?:number}
interface Repair {before:number;next:number;failures:number;blocked:boolean;reason?:string;last?:{from:number;to:number;at:number}}
interface Client {id:string;request:CvdRequest;generation:number;viewport?:CvdViewport;tasks:Map<CvdSource,Task>;frames:Map<CvdSource,{series:CvdSeries;bytes:number;key:string}>;pending:Map<CvdSource,CvdSeries>;inFlight?:number}
const reason=(error:unknown)=>String((error as {reason?:unknown})?.reason??'unavailable');
const fatal=(r:string)=>['disabled','invalid','conflict','rejoin-unavailable','expired-native-basis'].includes(r);
export class TieredCvdService {
 private clients=new Map<string,Client>();private timer?:ReturnType<typeof setInterval>;private generation=0;private batch=0;private bytes=0;private online=true;private dead=false;
 private polls=new Map<CvdSource,{next:number;blocked:boolean;failure?:string}>();private current=new Map<CvdSource,NonNullable<CvdHistoryReceipt['native']>>();
 private lastPoll?:CvdSource;private lastBackground='';
 private repairs=new Map<CvdSource,Repair>();private repair?:{source:CvdSource;abort:AbortController};private repairNext=0;private lastRepair?:CvdSource;
 private poll?:{source:CvdSource;abort:AbortController};private background?:{client:Client;source:CvdSource;task:Task;abort:AbortController};
 readonly metrics={polls:0,turns:0,frames:0,repairs:0,failures:0};
 constructor(private owner:CvdHistoryOwner,private emit:(event:CvdEvent)=>void,private now=Date.now,private clock=()=>performance.now()){}
 subscribe(id:string,value:CvdRequest){
  if(this.dead)return;this.unsubscribe(id);if(this.clients.size>=CVD_TIERED_LIMITS.clients)return;
  const sources=compatibleCvdSources(value.sources);
  if(!['daily','weekly','continuous','custom'].includes(value.anchor)||![value.origin,value.custom].every(t=>Number.isSafeInteger(t)&&t>=0))return;
  this.clients.set(id,{id,request:{sources,anchor:value.anchor,origin:value.origin,custom:value.custom},generation:++this.generation,tasks:new Map(),frames:new Map(),pending:new Map()});
  if(!this.timer)this.timer=setInterval(()=>this.tick(),250);
 }
 viewport(id:string,value:CvdViewport){
  const c=this.clients.get(id);if(!c)return;
  if(!value||![value.from,value.to,value.stepMs].every(t=>Number.isSafeInteger(t)&&t>=0&&t%M===0)||value.stepMs<M||D%value.stepMs||value.from>=value.to||value.from%value.stepMs||value.to%value.stepMs||(value.to-value.from)/value.stepMs>CVD_TIERED_LIMITS.points||value.to-value.from>3660*D){for(const source of c.request.sources)this.retain(c,source,c.frames.has(source)?'stale':'unavailable','History window unavailable.');this.flush();return;}
  if(JSON.stringify(c.viewport)===JSON.stringify(value))return;
  if(this.background?.client===c)this.background.abort.abort();
  c.viewport={from:value.from,to:value.to,stepMs:value.stepMs};
  for(const source of c.request.sources){
   const anchor=cvdAnchorAt(value.from,c.request),from=Math.max(value.from,Math.floor(anchor/value.stepMs)*value.stepMs);
   if(from>=value.to){c.tasks.delete(source);this.retain(c,source,'awaiting','The anchor is after this history window.');continue;}
   const query:CvdProjectionRequest={source,anchor,from,to:value.to,stepMs:value.stepMs,...(c.request.anchor==='daily'||c.request.anchor==='weekly'?{reset:c.request.anchor}:{})},old=c.tasks.get(source);
   const extend=old&&old.query.anchor===anchor&&old.query.from===from&&old.query.stepMs===value.stepMs&&old.query.to<value.to&&old.before>=anchor;
   c.tasks.set(source,{query,before:extend?old.before:value.to,turns:extend?old.turns:0,started:extend?old.started:this.clock(),bytes:extend?old.bytes:this.received(),done:false,retries:extend?old.retries:0,retryAt:extend?old.retryAt:0});this.project(c,source,query,'Loading history…');
  }
  this.flush();this.tick();
 }
 unsubscribe(id:string){const c=this.clients.get(id);if(!c)return;if(this.background?.client===c)this.background.abort.abort();for(const f of c.frames.values())this.bytes-=f.bytes;this.clients.delete(id);
  if(this.poll&&![...this.clients.values()].some(client=>client.request.sources.includes(this.poll!.source)))this.poll.abort.abort();
  if(this.repair&&![...this.clients.values()].some(client=>client.request.sources.includes(this.repair!.source)))this.repair.abort.abort();
  if(!this.clients.size&&this.timer){clearInterval(this.timer);this.timer=undefined;}
 }
 ack(id:string,generation:number,batchId:number){const c=this.clients.get(id);if(c?.generation===generation&&c.inFlight===batchId){c.inFlight=undefined;this.flush();}}
 retry(id:string){const c=this.clients.get(id);if(!c?.viewport)return;for(const source of c.request.sources){this.polls.delete(source);this.repairs.delete(source);const t=c.tasks.get(source);if(t){t.done=false;t.turns=0;t.started=this.clock();t.bytes=this.received();t.retries=0;t.retryAt=0;}}this.tick();}
 setOnline(value:boolean){this.online=value;if(!value){this.poll?.abort.abort();this.background?.abort.abort();this.repair?.abort.abort();for(const c of this.clients.values())for(const source of c.request.sources)this.retain(c,source,'stale','Network offline; recorded history retained.');this.flush();}else{for(const s of this.polls.values())s.next=0;this.tick();}}
 private received(){return this.owner.activity().receivedBytes;}
 private active(){return this.owner.activity().active;}
 private tick(){
  if(this.dead)return;this.flush();if(!this.online)return;
  const activity=this.owner.activity();
  if(!this.poll&&!activity.cancelling&&activity.queued<CVD_HISTORY_OWNER_LIMITS.queued){
   const sources=[...new Set([...this.clients.values()].filter(c=>c.viewport).flatMap(c=>[...c.tasks.keys()]))];
   const start=(sources.indexOf(this.lastPoll!)+1)%Math.max(1,sources.length),ordered=[...sources.slice(start),...sources.slice(0,start)];
   const source=ordered.find(s=>{const state=this.polls.get(s),live=[...this.clients.values()].some(c=>c.viewport&&c.request.sources.includes(s)&&c.viewport.to>Math.floor(this.now()/M)*M);return (!this.owner.basis(s)||live)&&!state?.blocked&&this.now()>=(state?.next??0);});
   if(source){void this.refresh(source);return;}
  }
  if(this.background||this.repair||this.active())return;
  if(this.startRepair())return;
  const candidates=[...this.clients.values()].filter(c=>!c.inFlight).flatMap(c=>[...c.tasks].filter(([,task])=>!task.done&&this.clock()>=task.retryAt).map(([source,task])=>({c,source,task,key:`${c.id}:${source}`}))),start=(candidates.findIndex(v=>v.key===this.lastBackground)+1)%Math.max(1,candidates.length);
  const restoring=candidates.find(v=>v.task.restoringDay!==undefined),ordered=restoring?[restoring,...candidates.filter(v=>v!==restoring)]:[...candidates.slice(start),...candidates.slice(0,start)];
  for(const {c,source,task,key}of ordered){
   if(!this.owner.basis(source))continue;
   if(this.polls.get(source)?.blocked)continue;
   const native=this.current.get(source),asOf=native?Math.min(native.asOf,native.to):this.owner.sourceState(source).asOf;
   if(Math.min(Math.floor(this.now()/M)*M,Math.floor(asOf/M)*M)<task.query.anchor)continue;
   if(task.turns>=CVD_TIERED_LIMITS.turns||this.clock()-task.started>CVD_TIERED_LIMITS.loadMs||this.received()-task.bytes>CVD_TIERED_LIMITS.archiveBytes){task.done=true;this.retain(c,source,'stale','History loading reached its configured limit.');this.flush();continue;}
   this.lastBackground=key;void this.acquire(c,source,task);return;
  }
 }
 /** Background observations stay separate from current poll clocks and faults. */
 private repairPage(source:CvdSource,before:number){
  const basis=this.owner.basis(source);if(!basis)return;
  const floor=Math.max(basis.cutover,basis.retainedFrom,Math.ceil((this.now()-7*D)/M)*M),ceiling=Math.floor(this.now()/M)*M-(CVD_TIERED_LIMITS.currentWindowMs-M);
  const ranges=[...this.clients.values()].filter(c=>!c.inFlight).flatMap(c=>{const t=c.tasks.get(source);return t?.done?[{from:Math.max(t.query.anchor,floor),to:Math.min(t.query.to,ceiling)}]:[];}).filter(r=>r.from<r.to&&r.from<before).sort((a,b)=>b.to-a.to);
  const range=ranges[0];if(!range)return;
  const to=Math.min(range.to,before),from=Math.max(range.from,Math.floor((to-1)/3600000)*3600000);return {from,to};
 }
 private startRepair(){
  if(this.clock()<this.repairNext)return false;
  const sources=[...new Set([...this.clients.values()].flatMap(c=>[...c.tasks.keys()]))],start=(sources.indexOf(this.lastRepair!)+1)%Math.max(1,sources.length);
  for(const source of [...sources.slice(start),...sources.slice(0,start)]){
   if(this.polls.get(source)?.blocked)continue;
   let state=this.repairs.get(source);if(!state){state={before:Infinity,next:this.clock()+CVD_TIERED_LIMITS.repairSpacingMs,failures:0,blocked:false};this.repairs.set(source,state);}
   if(state.blocked||this.clock()<state.next)continue;
   let page=this.repairPage(source,state.before);
   if(!page){if(state.before!==Infinity){state.before=Infinity;state.next=this.clock()+CVD_TIERED_LIMITS.repairSweepPauseMs;}continue;}
   this.lastRepair=source;this.repairNext=this.clock()+CVD_TIERED_LIMITS.repairSpacingMs;void this.refreshOlder(source,state,page);return true;
  }
  return false;
 }
 private async refreshOlder(source:CvdSource,state:Repair,page:{from:number;to:number}){
  const abort=new AbortController();this.repair={source,abort};this.metrics.repairs++;
  try{
   await this.owner.read({source,kind:'native',priority:'background',...page},abort.signal);if(abort.signal.aborted||this.dead)return;
   state.before=page.from;state.failures=0;state.reason=undefined;state.last={...page,at:this.now()};state.next=this.clock()+CVD_TIERED_LIMITS.repairSpacingMs;
   for(const c of this.clients.values()){const task=c.tasks.get(source);if(task)this.project(c,source,task.query,'Recorded history');}
  }catch(error){if(!abort.signal.aborted&&!this.dead){const r=reason(error);state.reason=r;state.failures++;state.blocked=fatal(r)||!['unavailable','capacity','cancelled'].includes(r)||state.failures>=3;state.next=this.clock()+[5000,30000,120000][Math.min(state.failures-1,2)]!;this.metrics.failures++;for(const c of this.clients.values())if(c.request.sources.includes(source))this.retain(c,source,'stale','History correction check unavailable; recorded values retained.');}}
  finally{if(this.repair?.abort===abort)this.repair=undefined;this.flush();}
 }
 private async refresh(source:CvdSource){
  const abort=new AbortController();this.poll={source,abort};this.lastPoll=source;const end=Math.ceil((this.now()+1)/M)*M,from=Math.max(0,Math.floor(this.now()/M)*M-(CVD_TIERED_LIMITS.currentWindowMs-M));this.metrics.polls++;
  try{const receipt=await this.owner.read({source,kind:'native',from,to:end},abort.signal);if(abort.signal.aborted||this.dead)return;if(receipt.native)this.current.set(source,receipt.native);this.polls.set(source,{next:this.now()+1000,blocked:false});
   for(const c of this.clients.values()){const task=c.tasks.get(source);if(task)this.project(c,source,task.query,task.done?'Recorded history':'Loading history…');}
  }catch(error){if(!abort.signal.aborted&&!this.dead){this.metrics.failures++;const r=reason(error);this.polls.set(source,{next:this.now()+5000,blocked:fatal(r),failure:r});for(const c of this.clients.values())if(c.request.sources.includes(source))this.retain(c,source,c.frames.has(source)?'stale':'unavailable',r==='rejoin-unavailable'?'History continuity unavailable; recorded values retained.':r==='basis'?'Waiting for recorded data…':'History service unavailable.');}}
  finally{if(this.poll?.abort===abort)this.poll=undefined;this.flush();}
 }
 private async acquire(c:Client,source:CvdSource,task:Task){
  const abort=new AbortController();this.background={client:c,source,task,abort};task.turns++;this.metrics.turns++;
  try{const current=this.current.get(source),asOf=current?Math.min(current.asOf,current.to):this.owner.sourceState(source).asOf,before=Math.min(task.before,Math.floor(this.now()/M)*M,Math.floor(asOf/M)*M);const result=await this.owner.window({projection:task.query,before},abort.signal);
   if(abort.signal.aborted||this.dead||this.clients.get(c.id)!==c||c.tasks.get(source)!==task)return;
   task.before=result.nextBefore??task.query.anchor;task.done=result.state!=='loading'||result.failures.length>0;
   task.restoringDay=result.restoringDay;
   this.metrics.failures+=result.failures.length;
   if(result.failures.length&&result.failures.every(f=>['unavailable','capacity'].includes(f.reason))&&task.retries<3){task.retryAt=this.clock()+[5000,30000,120000][task.retries]!;task.retries++;task.before=Math.min(task.query.to,Math.max(task.before,...result.failures.map(f=>f.to)));task.done=false;}
   this.project(c,source,task.query,result.state==='available'?'Recorded history':result.failures.length?'Some history is unavailable.':'Loading history…');
  }catch(error){if(!abort.signal.aborted&&!this.dead&&this.clients.get(c.id)===c&&c.tasks.get(source)===task){task.done=reason(error)!=='cancelled';this.metrics.failures++;this.retain(c,source,c.frames.has(source)?'stale':'unavailable',task.done?'History request unavailable; recorded values retained.':'Loading history…');}}
  finally{if(this.background?.abort===abort)this.background=undefined;this.flush();}
 }
 private project(c:Client,source:CvdSource,query:CvdProjectionRequest,message:string){
  if(!this.owner.basis(source))return;
  try{
   const projection=this.owner.project(query);if(projection.stale||!projection.points.some(p=>p.available)){this.retain(c,source,c.frames.has(source)?'stale':'awaiting',message);return;}
   const native=this.current.get(source)??this.owner.sourceState(source),points=projection.points.map((p,i)=>{const period=p.period??query.anchor,base=Number(p.base),quote=Number(p.quote);if(!Number.isFinite(base)||!Number.isFinite(quote))throw Error('CVD plot capacity');return {time:p.time,period,base,quote,baseText:p.base,quoteText:p.quote,observed:p.observed,available:p.available,partial:p.partial,reset:i===0||period!==(projection.points[i-1]?.period??query.anchor)};});
   const gaps:CvdSeries['coverage']['gaps']=[];
   for(const p of points)if(!p.available){const from=Math.max(query.anchor,p.time-query.stepMs),last=gaps.at(-1);if(last&&(last.to===from||gaps.length>=1024))last.to=p.time;else gaps.push({from,to:p.time,reason:'Recorded coverage unavailable'});}
   const asOf='to' in native?Math.min(native.asOf,native.to):native.asOf;
   if(!this.install(c,{source,points,snapshot:true,removeBefore:query.from+query.stepMs,stepMs:query.stepMs,coverage:{from:Math.max(query.anchor,query.from),to:query.to,gaps},status:!this.online||this.polls.get(source)?.failure||this.repairs.get(source)?.reason||this.owner.sourceState(source).status==='stale'?'stale':native.status==='awaiting'?'stale':native.status,message,asOf})){this.metrics.failures++;this.retain(c,source,'stale','History limit.');}
  }catch{this.retain(c,source,c.frames.has(source)?'stale':'awaiting',message);}
 }
 private install(c:Client,series:CvdSeries){
  const old=c.frames.get(series.source),key=JSON.stringify({...series,asOf:0}),bytes=new TextEncoder().encode(key).byteLength+512;if(old?.key===key){c.frames.set(series.source,{...old,series:{...old.series,asOf:series.asOf}});return true;}
  if(this.bytes-(old?.bytes??0)+bytes>CVD_TIERED_LIMITS.frameBytes)return false;
  this.bytes+=bytes-(old?.bytes??0);c.frames.set(series.source,{series,bytes,key});
  const sameGrid=old&&old.series.stepMs===series.stepMs&&old.series.points.length===series.points.length&&old.series.points.every((p,i)=>p.time===series.points[i]!.time);
  if(sameGrid&&!c.inFlight&&!c.pending.has(series.source)){const changed=series.points.filter((p,i)=>{const prior=old.series.points[i]!;return p.baseText!==prior.baseText||p.quoteText!==prior.quoteText||p.partial!==prior.partial||p.available!==prior.available||p.observed!==prior.observed||p.period!==prior.period||p.reset!==prior.reset;});c.pending.set(series.source,{...series,points:changed,snapshot:false});}
  else c.pending.set(series.source,series);
  return true;
 }
 private retain(c:Client,source:CvdSource,status:CvdSeries['status'],message:string){const old=c.frames.get(source)?.series,range=c.viewport;this.install(c,old?{...old,status,message}:{source,points:[],snapshot:true,removeBefore:range?.from??0,coverage:{from:range?.from??0,to:range?.to??0,gaps:[]},status,message,asOf:0,stepMs:range?.stepMs});}
 private flush(){for(const c of this.clients.values())if(!c.inFlight&&c.pending.size){const batchId=++this.batch;c.inFlight=batchId;const series=[...c.pending.values()];c.pending.clear();this.metrics.frames++;this.emit({type:'cvd-batch',ids:[c.id],generation:c.generation,batchId,series});}}
 diagnostics(){return {clients:this.clients.size,online:this.online,disposed:this.dead,polling:!!this.poll,loading:!!this.background,repairing:!!this.repair,repairsBySource:Object.fromEntries([...this.repairs].map(([source,r])=>[source,{before:Number.isFinite(r.before)?r.before:null,next:r.next,failures:r.failures,blocked:r.blocked,reason:r.reason,last:r.last}])),frameBytes:this.bytes,owner:this.owner.diagnostics(),...this.metrics};}
 dispose(){this.dead=true;this.poll?.abort.abort();this.background?.abort.abort();this.repair?.abort.abort();for(const id of [...this.clients.keys()])this.unsubscribe(id);if(this.timer)clearInterval(this.timer);this.timer=undefined;}
}
