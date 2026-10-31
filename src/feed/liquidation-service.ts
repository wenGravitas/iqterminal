import {historyScheduler} from './history-scheduler';
import {LiquidationCache,LiquidationBurstDetector,liquidationBars,liquidationSummary,selectedLiquidation,type LiquidationBurstCoverageProof} from '../liquidations/engine';
import {liquidationSettings} from '../liquidations/settings';
import {parseBybitLiquidations,parseBinanceLiquidations} from '../liquidations/adapters';
import {LIQUIDATION_MAX_EVENTS,liquidationValue,type LiquidationEvent,type LiquidationCoverage,type LiquidationHistory,type StoredLiquidation} from '../liquidations/model';
import type {LiquidationBatch,LiquidationRequest} from '../liquidations/protocol';
interface LoadedRange {from:number;to:number;head:number;asOf:number}
interface LoadResult {truncated:boolean;head:number;asOf:number}
interface Client {id:string;request:LiquidationRequest;generation:number;flight?:number;dirty:boolean;detector:LiquidationBurstDetector;burstKey:string;alerts:LiquidationBatch['alerts'];burstAlerts:LiquidationBatch['burstAlerts'];truncated:boolean;historyEpoch:number;abort:AbortController}
export interface LiquidationTransport {fetch:typeof fetch;socket:(url:string)=>WebSocket;now:()=>number;url:()=>string}
const defaultTransport:LiquidationTransport={fetch:(...args)=>fetch(...args),socket:url=>new WebSocket(url),now:Date.now,url:()=>`${location.protocol==='https:'?'wss':'ws'}://${location.host}/market-data/v1/liquidations/stream`};
const emptyCoverage=():LiquidationCoverage=>({sources:[],retentionDays:7,head:0,semantics:'reported-events-only'});
export class LiquidationService {
 private clients=new Map<string,Client>();readonly cache=new LiquidationCache();private coverage=emptyCoverage();private socket?:WebSocket;
 private generation=0;private batch=0;private revision=0;private cursor=0;private epoch=0;private cacheEpoch=0;private state:LiquidationBatch['state']='loading';private message='Loading recorded liquidations';
 private loaded:LoadedRange[]=[];private requests=new Map<string,Promise<LoadResult>>();private retry?:ReturnType<typeof setTimeout>;private timer?:ReturnType<typeof setInterval>;private abort=new AbortController();private online=true;private lastHeartbeat=0;private transportReady=false;private reconnects=0;private fixture=false;private started=false;
 readonly metrics={rejected:0,reconnects:0,historyPages:0,stalePackets:0,batches:0};
 constructor(private emit:(event:LiquidationBatch)=>void,private recorded:boolean,private transport:LiquidationTransport=defaultTransport){}
 setFixture(value:boolean){this.fixture=value;}
 subscribe(id:string,request:LiquidationRequest){this.unsubscribe(id);if(this.clients.size>=16)return;
  const normalized=this.request(request),client:Client={id,request:normalized,generation:++this.generation,dirty:true,detector:new LiquidationBurstDetector(),burstKey:this.detectorKey(normalized),alerts:[],burstAlerts:[],truncated:false,historyEpoch:0,abort:new AbortController()};this.clients.set(id,client);
  if(!this.timer)this.timer=setInterval(()=>{if(this.socket&&this.lastHeartbeat&&this.transport.now()-this.lastHeartbeat>16000){this.state='stale';this.message='Liquidation stream heartbeat stale';this.socket.close();}this.advanceBursts();this.mark();this.flush();},1000);
  if(this.fixture){if(!this.cache.events.size)this.seed();this.state='live';this.message='Explicit synthetic liquidation fixtures';this.rebuild(client);}
  else if(!this.recorded){this.state='unsupported';this.message='Recorded liquidation backend required; no synthetic/direct fallback';}
  else if(!this.started){this.started=true;void this.connect();}
  void this.history(client);this.flush();
 }
 private request(request:LiquidationRequest):LiquidationRequest {const now=this.transport.now();return {...request,settings:liquidationSettings(request.settings),from:Number.isFinite(request.from)?Math.max(0,request.from):now-900000,to:Number.isFinite(request.to)&&request.to>request.from?request.to:now,intervalMs:Number.isSafeInteger(request.intervalMs)&&request.intervalMs>0?request.intervalMs:60000};}
 update(id:string,request:LiquidationRequest){const c=this.clients.get(id);if(!c)return;c.request=this.request(request);c.generation=++this.generation;c.flight=undefined;c.alerts=[];c.burstAlerts=[];if(c.burstKey!==this.detectorKey(c.request))this.rebuild(c);else this.prime(c);void this.history(c);c.dirty=true;this.flush();}
 unsubscribe(id:string){const c=this.clients.get(id);c?.abort.abort();this.clients.delete(id);if(!this.clients.size){this.epoch++;this.started=false;this.transportReady=false;this.abort.abort();this.abort=new AbortController();this.socket?.close();this.socket=undefined;clearInterval(this.timer);this.timer=undefined;clearTimeout(this.retry);this.requests.clear();}}
 ack(id:string,generation:number,batchId:number){const c=this.clients.get(id);if(c?.generation===generation&&c.flight===batchId){c.flight=undefined;this.flush();}}
 setOnline(value:boolean){this.online=value;if(!value){this.transportReady=false;this.socket?.close();this.state='disconnected';this.message='Network offline; retained liquidation history';this.mark();this.flush();}else if(this.clients.size&&!this.fixture&&this.recorded){clearTimeout(this.retry);void this.connect();}}
 private mark(){for(const c of this.clients.values())c.dirty=true;}
 private async load(from:number,to:number,signal:AbortSignal):Promise<LoadResult>{
  const now=this.transport.now();from=Math.max(from,now-7*86400000);to=Math.min(to,from+7*86400000);if(from>=to)return {truncated:false,head:0,asOf:now};
  const loaded=this.loaded.find(r=>r.from<=from&&r.to>=to);if(loaded)return {truncated:false,head:loaded.head,asOf:loaded.asOf};
  const key=`${from}:${to}`;const existing=this.requests.get(key);if(existing)return existing;
  const cacheEpoch=this.cacheEpoch;const task=(async()=>{let after:string|null=null,head:number|undefined,truncated=false;let count=0,asOf=now;
   do{const p=new URLSearchParams({from:String(from),to:String(to),limit:'1000'});if(head!==undefined)p.set('head',String(head));if(after)p.set('after',after);
    const url='/market-data/v1/liquidations?'+p;
    const data=await historyScheduler.read(url,'liquidations',signal,async sig=>{const response=await this.transport.fetch(url,{signal:AbortSignal.any([sig,AbortSignal.timeout(25000)])});if(!response.ok)throw Error(`Liquidation history HTTP ${response.status}`);return response.json() as Promise<LiquidationHistory>;});
    if(signal.aborted||cacheEpoch!==this.cacheEpoch)throw new DOMException('Aborted','AbortError');this.validate(data);head=data.head;if(count===0&&Number.isFinite(data.coverage.asOf))asOf=data.coverage.asOf!;this.acceptCoverage(data.coverage);
    this.cache.merge(data.records.map(r=>r.event));if(this.cache.dropped)this.loaded=[];this.metrics.historyPages++;count+=data.records.length;after=data.next;
    this.revision++;this.mark();this.flush();if(count>=LIQUIDATION_MAX_EVENTS&&after){truncated=true;break;}
   }while(after);
   if(!truncated){this.loaded.push({from,to,head:head??0,asOf});if(this.loaded.length>64)this.loaded.shift();}
   for(const c of this.clients.values())this.prime(c);
   return {truncated,head:head??0,asOf};
  })();this.requests.set(key,task);try{return await task;}finally{if(this.requests.get(key)===task)this.requests.delete(key);}
 }
 private acceptCoverage(value:LiquidationCoverage){const at=(v:LiquidationCoverage)=>v.asOf??Math.max(0,...v.sources.map(s=>s.verifiedThrough));if(value.head>this.coverage.head||value.head===this.coverage.head&&at(value)>=at(this.coverage))this.coverage=value;}
 private validate(data:LiquidationHistory){if(data?.version!==1||!Array.isArray(data.records)||data.records.length>1000||!Number.isSafeInteger(data.head)||!Array.isArray(data.coverage?.sources))throw Error('Invalid liquidation history response');
  for(const r of data.records)if(!Number.isSafeInteger(r.cursor)||r.cursor>data.head||!validEvent(r.event)){this.metrics.rejected++;throw Error('Invalid liquidation event payload');}}
 private async history(c:Client){if(this.fixture||!this.recorded)return;if(c.request.kind==='ticker'&&!c.request.replay&&this.coverage.sources.length)return;const epoch=++c.historyEpoch;try{const {truncated}=await this.load(Math.floor(c.request.from/60000)*60000,Math.ceil(c.request.to/60000)*60000,this.abort.signal);if(this.clients.get(c.id)!==c||epoch!==c.historyEpoch)return;c.truncated=truncated;c.dirty=true;this.flush();}catch(e){if(c.abort.signal.aborted||epoch!==c.historyEpoch||this.clients.get(c.id)!==c)return;this.message='Liquidation history unavailable: '+String((e as Error).message);this.state='stale';c.dirty=true;this.flush();}}
 private async connect(){if(!this.online||this.fixture||!this.recorded||!this.clients.size)return;
  const epoch=++this.epoch;this.transportReady=false;this.socket?.close();this.socket=undefined;this.state='loading';this.message='Reconciling recorded liquidation history';this.mark();this.flush();
  try{if(!this.cursor){const now=this.transport.now();let initial=await this.load(now-900000,now+1000,this.abort.signal);if(epoch!==this.epoch)return;
    // Bootstrap on the collector clock when the browser clock differs. Never
    // use an unrelated viewport response to advance this resume watermark.
    if(Math.abs(initial.asOf-now)>1000){initial=await this.load(initial.asOf-900000,initial.asOf+1000,this.abort.signal);if(epoch!==this.epoch)return;}this.cursor=initial.head;}
   const ws=this.transport.socket(this.transport.url());this.socket=ws;this.lastHeartbeat=this.transport.now();
   ws.onopen=()=>{if(epoch!==this.epoch)return;ws.send(JSON.stringify({type:'subscribe',version:1,after:this.cursor}));};
   ws.onmessage=event=>{if(epoch!==this.epoch)return;try{const data=JSON.parse(String(event.data));this.lastHeartbeat=this.transport.now();
    if(data.type==='reset'){this.transportReady=false;this.cacheEpoch++;this.cursor=0;this.loaded=[];this.cache.clear();this.coverage=emptyCoverage();this.abort.abort();this.abort=new AbortController();this.requests.clear();for(const c of this.clients.values()){c.historyEpoch++;this.rebuild(c);}ws.close();return;}
    if(data.type==='ready'||data.type==='health'){this.transportReady=true;this.acceptCoverage(data.coverage);this.state=this.coverage.sources.every(s=>s.state==='live')?'live':'stale';this.message=this.state==='live'?'Reported liquidation streams connected':'One or more liquidation sources unavailable';this.mark();this.flush();return;}
    if(data.type!=='liquidations'||!Array.isArray(data.records)||data.records.length>256||!Number.isSafeInteger(data.cursor))throw Error('Invalid liquidation stream packet');
    const records=data.records as StoredLiquidation[],eligible=new Set<string>();
    for(const row of records){if(!validEvent(row.event)||!Number.isSafeInteger(row.cursor))throw Error('Invalid liquidation event');if(row.cursor>data.initialHead&&this.transport.now()-row.event.receivedAtMs<=3000&&this.transport.now()-row.event.timeMs<=3000)eligible.add(row.event.id);}
    this.acceptCoverage(data.coverage);this.ingest(records.map(row=>row.event),true,eligible);
    this.cursor=data.cursor;ws.send(JSON.stringify({type:'ack',version:1,cursor:data.cursor}));this.reconnects=0;this.revision++;this.mark();this.flush();
   }catch{this.metrics.rejected++;ws.close();}};
   ws.onerror=()=>{};ws.onclose=()=>{if(epoch!==this.epoch||!this.clients.size)return;this.transportReady=false;this.socket=undefined;this.state='disconnected';this.message='Liquidation transport disconnected; reconnect catch-up will not alert';this.mark();this.flush();this.schedule();};
  }catch(e){if(epoch!==this.epoch)return;this.state='disconnected';this.message=String((e as Error).message);this.mark();this.flush();this.schedule();}
 }
 private schedule(){clearTimeout(this.retry);if(!this.online||!this.clients.size)return;this.metrics.reconnects++;this.retry=setTimeout(()=>void this.connect(),Math.min(30000,500*2**Math.min(++this.reconnects,6)));}
 private detectorKey(request:LiquidationRequest){const rule=request.settings.burst;return JSON.stringify([request.settings.venues,request.settings.side,[rule.windowMs,rule.minimum,rule.count],request.replay?[request.from,request.to,request.asOf??request.to]:null]);}
 private burstProof(c:Client,historical=false):LiquidationBurstCoverageProof{
  const venues=c.request.settings.venues,sources=this.coverage.sources.filter(source=>venues.includes(source.venue)),complete=venues.length>0&&sources.length===venues.length;
  const replay=c.request.replay===true,healthySources=historical||replay||this.fixture||this.online&&this.transportReady&&sources.every(source=>source.state==='live');
  return {healthy:complete&&healthySources,observedFrom:complete?Math.max(...sources.map(source=>source.observedFrom)):Infinity,
   verifiedThrough:sources.length?Math.min(...sources.map(source=>source.verifiedThrough)):0,gaps:sources.flatMap(source=>source.gaps)};
 }
 private advanceClient(c:Client,historical=false){const proof=this.burstProof(c,historical),replayClock=Math.min(c.request.to,c.request.asOf??c.request.to),localAnchor=this.lastHeartbeat||this.transport.now(),clock=c.request.replay?replayClock:historical?proof.verifiedThrough:Number.isFinite(proof.verifiedThrough)&&proof.verifiedThrough>0?this.transport.now()+(proof.verifiedThrough-localAnchor):this.transport.now();const closed=c.detector.advance(clock,c.request.settings.burst,proof);if(closed.length)c.dirty=true;}
 private advanceBursts(){for(const c of this.clients.values())this.advanceClient(c);}
 private prime(c:Client){const now=c.request.replay?Math.min(c.request.to,c.request.asOf??c.request.to):this.transport.now(),proof=this.burstProof(c,true);for(const event of this.cache.sorted())if(this.member(event,c))c.detector.ingest(event,c.request.settings.burst,false,now,proof);this.advanceClient(c,true);}
 private rebuild(c:Client){c.detector=new LiquidationBurstDetector();c.burstKey=this.detectorKey(c.request);this.prime(c);c.alerts=[];c.burstAlerts=[];}
 private member(e:LiquidationEvent,c:Client){return (!c.request.replay||e.timeMs>=c.request.from&&e.timeMs<c.request.to&&e.timeMs<=(c.request.asOf??c.request.to))&&c.request.settings.venues.includes(e.venue)&&(c.request.settings.side==='BOTH'||c.request.settings.side===e.liquidatedSide);}
 ingest(events:LiquidationEvent[],live=false,eligibleIds?:Set<string>){const now=this.transport.now(),fresh=new Map<string,LiquidationEvent>();
  for(const event of events){if(!validEvent(event)){this.metrics.rejected++;continue;}if(!this.cache.events.has(event.id))fresh.set(event.id,event);}
  this.cache.merge([...fresh.values()]);
  for(const event of fresh.values()){const eligibleLive=live&&(!eligibleIds||eligibleIds.has(event.id));
   for(const c of this.clients.values()){if(!this.member(event,c))continue;const s=c.request.settings,burst=c.detector.ingest(event,s.burst,eligibleLive&&!c.request.replay,now,this.burstProof(c));if(burst?.notify&&c.burstAlerts.length<32)c.burstAlerts.push(structuredClone(burst));
    const eligible=eligibleLive&&!c.request.replay&&now-event.timeMs<=3000&&event.timeMs-now<=1000&&now-event.receivedAtMs<=3000;
    let winner:typeof s.tiers[number]|undefined;for(const tier of s.tiers){const size=liquidationValue(event,tier.unit);if(size!==null&&size>=tier.minimum)winner=tier;}
    if(eligible&&winner&&c.alerts.length<256)c.alerts.push({event,tierId:winner.id});c.dirty=true;
   }
  }this.revision++;this.mark();this.flush();}
 flush(){const all=this.cache.sorted();for(const c of this.clients.values())if(c.dirty&&!c.flight){const s=c.request.settings,events=all.filter(e=>e.timeMs>=c.request.from&&e.timeMs<(c.request.kind==='ticker'&&!c.request.replay?this.transport.now()+1000:c.request.to)&&s.venues.includes(e.venue));
   const eligibleEvents=c.request.replay?events.filter(e=>e.timeMs<=(c.request.asOf??c.request.to)):events;
   const visible=eligibleEvents.filter(e=>selectedLiquidation(e,s)),bounded=c.request.kind==='ticker'?visible.slice(-500):[...visible].sort((a,b)=>(b.quoteNotional??0)-(a.quoteNotional??0)).slice(0,500).sort((a,b)=>a.timeMs-b.timeMs);
   c.flight=++this.batch;c.dirty=false;this.metrics.batches++;
   this.emit({type:'liquidation-batch',ids:[c.id],generation:c.generation,batchId:c.flight,events:bounded,bars:liquidationBars(eligibleEvents,s,c.request.intervalMs),summary:liquidationSummary(all,s.venues,c.request.replay?(c.request.asOf??c.request.to):this.transport.now()),
    bursts:c.detector.bursts.map(b=>({...b,events:b.events.slice(-50),notify:false})),alerts:c.alerts.splice(0),burstAlerts:c.burstAlerts.splice(0),coverage:this.coverage,state:s.venues.length?this.state:'unsupported',message:s.venues.length?this.message:'No liquidation venues selected',truncated:c.truncated||(c.request.kind==='ticker'&&visible.length>bounded.length)||this.cache.dropped>0,dropped:this.cache.dropped,revision:this.revision});
  }}
 private seed(){const now=this.transport.now();const events:LiquidationEvent[]=[];for(let i=0;i<180;i++){const at=now-(179-i)*5000;const venue=i%2?'bybit':'binance';const side=i%3?'LONG':'SHORT';const quantity=i%17===0?'12':'0.125';
   const parsed=venue==='bybit'?parseBybitLiquidations({topic:'allLiquidation.BTCUSDT',type:'snapshot',ts:at,data:[{T:at,s:'BTCUSDT',S:side==='LONG'?'Buy':'Sell',v:quantity,p:String(83000+Math.sin(i)*120)}]},at):parseBinanceLiquidations({e:'forceOrder',E:at,o:{s:'BTCUSDT',S:side==='LONG'?'SELL':'BUY',q:quantity,p:'83000',ap:String(83000+Math.sin(i)*120),X:'FILLED',l:quantity,z:quantity,T:at}},at);
   events.push(...parsed.events);
  }this.cache.merge(events);this.coverage={head:0,retentionDays:7,semantics:'reported-events-only',sources:(['bybit','binance'] as const).map(venue=>({venue,state:'live',observedFrom:now-86400000,verifiedThrough:now,lastEventAt:now,lastTrafficAt:now,gaps:[],message:'Explicit synthetic fixture',rejected:0,dropped:0,reconnects:0}))};}
 diagnostics(){return {clients:this.clients.size,events:this.cache.events.size,sockets:this.socket?1:0,cursor:this.cursor,state:this.state,loaded:this.loaded.length,requests:this.requests.size,...this.metrics};}
 dispose(){for(const id of [...this.clients.keys()])this.unsubscribe(id);this.cache.clear();}
}
function validEvent(e:LiquidationEvent):boolean{return e?.version===1&&e.kind==='actual-liquidation-report'&&typeof e.id==='string'&&e.id.length<=600&&(e.venue==='bybit'||e.venue==='binance')&&e.instrument===`${e.venue}:perpetual:BTCUSDT`&&e.nativeSymbol==='BTCUSDT'&&['LONG','SHORT'].includes(e.liquidatedSide)&&Number.isSafeInteger(e.timeMs)&&Number.isSafeInteger(e.receivedAtMs)&&Number.isFinite(e.reportedPrice)&&e.reportedPrice>0&&Number.isFinite(e.baseQuantity)&&e.baseQuantity>=0&&(e.quoteNotional===null||Number.isFinite(e.quoteNotional)&&e.quoteNotional>=0);}
