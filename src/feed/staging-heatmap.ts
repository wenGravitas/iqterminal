import {PreparedHistory} from './prepared-history';
import {historyScheduler} from './history-scheduler';
import {IndexedHeatmapCache,cachedTiles,type HeatmapHistoryCache} from './heatmap-cache';
import {heatmapKey,HEATMAP_STRIDE,type HeatmapResolution,type HeatmapStatus,type LiquidityBucket} from './heatmap-model';
import {depthSource,preparedDepthFeed} from './prepared-history';
import type {Command,Event,Market} from './protocol';
export interface HeatmapViewport {from:number;to:number;low:number;high:number;width:number;height:number;}
export type DepthHeadNotice = { type:'head'; cursor:number; at:number; epoch:number } | { type:'stale'; message:string } | { type:'reset'; message:string };
type DepthHeadObserver = { market:Market; callback:(notice:DepthHeadNotice)=>void };
interface HistoryProgress {serial:number;range:ReturnType<typeof viewportRequest>;at:number;span:number;combined?:any;}
interface Group {validatedAt?:number;formingFrom?:number;history?:HistoryProgress;id:string;key:string;market:Market;resolution:HeatmapResolution;generation:number;view?:HeatmapViewport;requestKey?:string;serial:number;abort?:AbortController;ws?:WebSocket;head:number;at:number;busy:boolean;dirty:boolean;retry:number;retryAt:number;streamAt:number;loadedSerial?:number;cacheEnd?:number;gaps?:any[];lastStatus?:HeatmapStatus;buckets:LiquidityBucket[];inFlight?:number;pending?:Extract<Event,{type:'heatmap-batch'}>;}
/** Viewport queries run in the feed worker; durable server collection never depends on subscriptions. */
export class StagingHeatmapService {
 private prepared:PreparedHistory;private usePrepared=import.meta.env.VITE_HISTORY_TILES!=='0';
 private groups=new Map<string,Group>();private streams=new Map<Market,WebSocket>();private headObservers=new Map<string,DepthHeadObserver>();private marketHeads=new Map<Market,{cursor:number;at:number;epoch:number}>();private marketStreamAt=new Map<Market,number>();private marketRetryAt=new Map<Market,number>();private generation=0;private batch=0;private online=true;private timer:ReturnType<typeof setInterval>;
 constructor(private emit:(e:Event)=>void,private request:typeof fetch=(...a)=>fetch(...a),private now=Date.now,private socket:(url:string)=>WebSocket=url=>new WebSocket(url),private cache:HeatmapHistoryCache=new IndexedHeatmapCache()) {this.prepared=new PreparedHistory(request);this.timer=setInterval(()=>this.refresh(),100);}
 command(c:Command){
  if(c.type==='heatmap-subscribe'){this.remove(c.id);if(this.groups.size>=16)return;this.groups.set(c.id,{id:c.id,key:heatmapKey(c.resolution),market:c.market??'perpetual',resolution:c.resolution,generation:++this.generation,serial:0,head:0,at:0,busy:false,dirty:false,retry:0,retryAt:0,streamAt:0,buckets:[]});}
  else if(c.type==='heatmap-viewport'){const g=this.groups.get(c.id);if(!g)return;const view=c.viewport;if(![view.from,view.to,view.low,view.high,view.width,view.height].every(Number.isFinite)||view.from>=view.to||view.low>=view.high)return;g.view=view;const request=viewportRequest(view,g.resolution.candleMs??60000,g.resolution.rowPrice,this.now());const key=JSON.stringify({...request,from:Math.floor(request.from/request.timeMs),to:Math.ceil(view.to/request.timeMs)});if(key!==g.requestKey){g.requestKey=key;g.serial++;g.history=undefined;g.abort?.abort();g.dirty=true;g.retryAt=this.now()+(this.usePrepared?50:150);}}
  else if(c.type==='heatmap-unsubscribe')this.remove(c.id);
  else if(c.type==='heatmap-ack'){for(const g of this.groups.values())if(g.key===c.key&&g.generation===c.generation&&g.inFlight===c.batchId){g.inFlight=undefined;const pending=g.pending;g.pending=undefined;if(pending)this.publish(g,pending);}}
  else if(c.type==='online'){this.online=c.online;for(const g of this.groups.values()){if(!c.online){g.abort?.abort();g.ws?.close();g.ws=undefined;this.status(g,'stale','Staging depth · offline; historical observations preserved');}else{g.retryAt=0;g.dirty=true;}}if(!c.online){for(const market of this.observedMarkets())this.notifyHeadObservers(market,{type:'stale',message:'Staging depth · offline'});for(const ws of this.streams.values())ws.close();this.streams.clear();this.marketStreamAt.clear();}else for(const market of this.observedMarkets())this.connectMarket(market,this.marketHeads.get(market)?.cursor??0);}
  else if(c.type==='depth-retry'){for(const g of this.groups.values()){g.retry=0;g.retryAt=0;g.dirty=true;}for(const market of this.observedMarkets()){this.marketRetryAt.set(market,0);this.connectMarket(market,this.marketHeads.get(market)?.cursor??0);}}
 }
 observeDepthHeads(id:string,market:Market,after:number,callback:(notice:DepthHeadNotice)=>void){
  if(!id||!Number.isSafeInteger(after)||after<0)return ()=>{};
  this.headObservers.set(id,{market,callback});
  const known=this.marketHeads.get(market);if(known)callback({type:'head',...known});
  if(this.online)this.connectMarket(market,Math.max(after,known?.cursor??0));
  return ()=>{this.headObservers.delete(id);this.closeIfUnused(market);};
 }
 private observedMarkets(){return [...new Set([...this.headObservers.values()].map(x=>x.market))];}
 private hasMarketConsumer(market:Market){return [...this.groups.values()].some(x=>x.market===market)||[...this.headObservers.values()].some(x=>x.market===market);}
 private closeIfUnused(market:Market){if(!this.hasMarketConsumer(market)){this.streams.get(market)?.close();this.streams.delete(market);}}
 private notifyHeadObservers(market:Market,notice:DepthHeadNotice){for(const x of this.headObservers.values())if(x.market===market){try{x.callback(notice);}catch(error){console.error('Depth head observer failed',error);}}}
 private remove(id:string){const g=this.groups.get(id);g?.abort?.abort();this.groups.delete(id);if(g)this.closeIfUnused(g.market);}
 private status(g:Group,state:HeatmapStatus['state'],message:string){g.lastStatus={state,message,tickSize:marketTickSize(g.market),collectionStart:g.lastStatus?.collectionStart??null,retentionStart:g.buckets[0]?.start??null,capacityLimited:Boolean(g.view&&g.view.to-g.view.from>14400000)};this.publish(g,{type:'heatmap-batch',key:g.key,ids:[g.id],generation:g.generation,batchId:0,snapshot:true,buckets:g.buckets,status:g.lastStatus});}
 private publish(g:Group,event:Extract<Event,{type:'heatmap-batch'}>){if(g.inFlight!==undefined){g.pending=g.pending?.snapshot&&!event.snapshot?{...event,snapshot:true,buckets:g.buckets}:event;return;}event={...event,batchId:++this.batch};g.inFlight=event.batchId;this.emit(event);}
 private refresh(){for(const g of this.groups.values())if(this.usePrepared&&g.loadedSerial===g.serial&&this.now()-(g.validatedAt??g.at)>30000)g.dirty=true;for(const [market,ws]of this.streams){if(this.now()-(this.marketStreamAt.get(market)??this.now())>15000){this.marketRetryAt.set(market,this.now()+1000);this.notifyHeadObservers(market,{type:'stale',message:'Staging depth heartbeat stale'});ws.close();}}if(this.online)for(const market of this.observedMarkets())if(!this.streams.has(market))this.connectMarket(market,this.marketHeads.get(market)?.cursor??0);if(!this.online||!this.usePrepared&&[...this.groups.values()].some(g=>g.busy))return;const ready=[...this.groups.values()].filter(g=>!g.busy&&g.view&&this.now()>=g.retryAt&&(g.dirty||!g.ws)).sort((a,b)=>a.at-b.at);if(ready[0])void this.load(ready[0]);}
 private async load(g:Group){if(this.usePrepared)return this.loadPrepared(g);if(!g.view)return;g.busy=true;g.dirty=false;const serial=g.serial;const abort=new AbortController();g.abort=abort;
 try{if(!g.buckets.length)this.status(g,'syncing','Staging depth · loading recorded viewport');const bounds={...(g.history?.serial===serial?g.history.range:viewportRequest(g.view,g.resolution.candleMs??60000,g.resolution.rowPrice,this.now())),market:g.market};
 if(!g.buckets.length){const saved=await Promise.race([this.cache.read(bounds.rowPrice,bounds.timeMs,g.market).catch(()=>undefined),new Promise<undefined>(resolve=>setTimeout(()=>resolve(undefined),200))]);if(this.groups.get(g.id)!==g||serial!==g.serial||abort.signal.aborted)return;const tiles=cachedTiles(saved,bounds,this.now());if(tiles.length){g.buckets=tiles;this.status(g,'syncing','Staging depth · cached closed history; checking coverage and loading live');}}
 const tail=g.loadedSerial===serial&&g.buckets.length>0;const queryBounds={...bounds,from:tail?Math.max(bounds.from,g.buckets.at(-2)?.start??g.buckets.at(-1)!.start):bounds.from};
 const readPage=async (range:typeof bounds,watermark?:number)=>{const params=marketParams(range,g.market);if(watermark!==undefined)params.set('watermark',String(watermark));let data:any;for(let attempt=0;;attempt++){const r=await this.request('/market-data/v1/heatmap?'+params,{signal:abort.signal});data=await r.json();if(r.ok)break;if(/capacity/i.test(data.error)&&attempt<5){await retryDelay(abort.signal,Math.min(4000,500*2**attempt));continue;}throw new Error(data.error??`Heatmap HTTP ${r.status}`);}if(this.groups.get(g.id)!==g||serial!==g.serial||abort.signal.aborted)return;
 if(data.version!==1||data.source!==depthSource(g.market)||!Array.isArray(data.cells)||data.cells.length>16384||!Number.isSafeInteger(data.watermark)||(watermark!==undefined&&data.watermark!==watermark))throw new Error('Invalid depth history contract');return data;};
 // Replay bounded fragments at a single captured head, including coarse display
 // columns. Duration-weighted fragments preserve average/peak and unknown coverage.
 const read=async (range:typeof bounds,progressive=false)=>{
  const progress:HistoryProgress=progressive?(g.history??={serial,range,at:range.from,span:20*60000}):{serial,range,at:range.from,span:20*60000};
  while(progress.at<range.to){const end=Math.min(range.to,progress.at+progress.span);let page:any;
   try{page=await readPage({...range,from:progress.at,to:end},progress.combined?.watermark);}
   catch(e){if(e instanceof Error&&/budget|deadline|smaller.*range|resource limit|memory limit|heap out of memory/i.test(e.message)&&progress.span>60000){progress.span=Math.max(60000,Math.floor(progress.span/2));continue;}throw e;}
   if(!page)return;progress.combined=mergeHeatmapResponses(progress.combined,page);progress.at=end;
   if(progressive&&end<range.to){
    // Publish completed fragments immediately. A partial coarse column replaces
    // its overlap; completed pages and their watermark survive transient retries.
    const tiles=heatmapTiles(progress.combined,range.from,end);
    g.buckets=[...tiles,...g.buckets.filter(b=>b.start>=Math.ceil(end/range.timeMs)*range.timeMs)].slice(-240);
    g.head=progress.combined.watermark;
    g.lastStatus={state:'syncing',message:`Staging depth · loading history ${Math.floor(100*(end-range.from)/(range.to-range.from))}%`,tickSize:marketTickSize(g.market),collectionStart:progress.combined.coverage.epochs[0]?.from??null,retentionStart:g.buckets[0]?.start??null,capacityLimited:Boolean(g.view&&g.view.to-g.view.from>14400000)};
    this.publish(g,{type:'heatmap-batch',key:g.key,ids:[g.id],generation:g.generation,batchId:0,snapshot:true,buckets:g.buckets,status:g.lastStatus});
   }
  }
  const combined=progress.combined;if(!combined)return;combined.coverage.from=range.from;combined.coverage.to=range.to;
  for(const c of combined.cells){const dt=Math.max(0,Math.min(c.time+range.timeMs,range.to,combined.coverage.confirmedTo)-Math.max(c.time,range.from));c.bidComplete&&=c.bidDuration>=dt;c.askComplete&&=c.askDuration>=dt;}
  return combined;
 };
 // Show the most recent two columns before replaying a longer viewport. Both are
 // authoritative replacements; the footer remains loading until history completes.
 if(!g.buckets.length&&bounds.to-bounds.from>3*bounds.timeMs){const recent={...bounds,from:Math.max(bounds.from,Math.ceil(bounds.to/bounds.timeMs)*bounds.timeMs-2*bounds.timeMs)};const preview=await read(recent);if(!preview)return;g.buckets=[...g.buckets.filter(b=>b.end<=recent.from),...heatmapTiles(preview,recent.from,recent.to)].slice(-240);g.head=preview.watermark;g.lastStatus={state:'syncing',message:'Staging depth · recent liquidity loaded; loading earlier recorded viewport',tickSize:marketTickSize(g.market),collectionStart:preview.coverage.epochs[0]?.from??null,retentionStart:g.buckets[0]?.start??null,capacityLimited:false};this.publish(g,{type:'heatmap-batch',key:g.key,ids:[g.id],generation:g.generation,batchId:0,snapshot:true,buckets:g.buckets,status:g.lastStatus});if(!g.ws)this.connect(g);}
 const data=await read(queryBounds,!tail);if(!data)return;g.history=undefined;
 const tiles=heatmapTiles(data,queryBounds.from,queryBounds.to);g.buckets=(tail?[...g.buckets.filter(b=>b.end<=queryBounds.from),...tiles]:tiles).filter(b=>b.end>bounds.from).slice(-240);g.loadedSerial=serial;g.gaps=[...(tail?g.gaps??[]:[]),...data.coverage.gaps.filter((x:any)=>x.reason!=='Pending durable depth tail')].filter((x,i,a)=>x.to>bounds.from&&a.findIndex(y=>y.from===x.from&&y.to===x.to)===i).slice(-128);g.head=data.watermark;g.at=this.now();g.retry=0;g.retryAt=this.now()+500;
 const unavailable=data.availability?.filter((a:any)=>a.state==='unavailable').length??0;const partial=data.cells.some((c:any)=>!c.bidComplete||!c.askComplete),gaps=g.gaps.length;
 g.lastStatus={state:data.status.state==='live'?'live':'stale',message:`Staging durable depth · ${partial?'partial outer coverage':'snapshot-covered viewport'} · ${gaps} coverage gap(s)${g.view.to-g.view.from>14400000?' · viewport limited to 4h':''}${g.market==='perpetual'?' · RPI excluded':''}`,tickSize:marketTickSize(g.market),collectionStart:data.coverage.epochs[0]?.from??null,retentionStart:g.buckets[0]?.start??null,capacityLimited:Boolean(g.view&&g.view.to-g.view.from>14400000)};this.publish(g,{type:'heatmap-batch',key:g.key,ids:[g.id],generation:g.generation,batchId:0,snapshot:true,buckets:g.buckets,status:g.lastStatus});if(!g.ws)this.connect(g);
 const closed=g.buckets.filter(b=>b.end===b.start+bounds.timeMs&&b.end<=Math.floor(this.now()/bounds.timeMs)*bounds.timeMs),end=closed.at(-1)?.end;if(end&&(!tail||end!==g.cacheEnd)){g.cacheEnd=end;void this.cache.write({version:1,savedAt:this.now(),rowPrice:bounds.rowPrice,timeMs:bounds.timeMs,market:g.market,buckets:closed}).catch(()=>{});}
 }catch(e){if(!abort.signal.aborted&&this.groups.get(g.id)===g){if(e instanceof Error&&/Depth watermark (?:not retained|beyond durable head)/i.test(e.message))g.history=undefined;g.dirty=true;g.retry=Math.min(g.retry+1,7);g.retryAt=this.now()+(e instanceof Error&&/capacity/i.test(e.message)?Math.min(4000,500*2**g.retry):Math.min(30000,500*2**g.retry));this.status(g,'stale',`Staging depth · ${e instanceof Error?e.message:String(e)} · retrying`);}}finally{g.busy=false;if(g.serial!==serial)g.dirty=true;}
 }
 private async loadPrepared(g:Group){if(!g.view||g.busy)return;g.busy=true;g.dirty=false;const serial=g.serial,abort=new AbortController();g.abort=abort;
 try{const bounds={...viewportRequest(g.view,g.resolution.candleMs??60000,g.resolution.rowPrice,this.now()),market:g.market};if(!g.buckets.length)this.status(g,'syncing','Staging depth · loading prepared visible history');
 const formingFrom=Math.floor(this.now()/bounds.timeMs)*bounds.timeMs;
 if(g.loadedSerial===serial&&g.formingFrom===formingFrom&&this.now()-(g.validatedAt??0)<30000){
  const current=await this.prepared.current({...bounds,from:formingFrom,to:Math.min(bounds.to,formingFrom+bounds.timeMs)},abort.signal);
  if(abort.signal.aborted||g.serial!==serial||this.groups.get(g.id)!==g)return;
  g.lastStatus={...g.lastStatus!,state:current.ready?'live':'syncing',message:g.lastStatus!.message.replace(' · current state catching up','')+(current.ready?'':' · current state catching up')};
  if(current.data){const changed=heatmapTiles(current.data,bounds.from,bounds.to);if(changed.length){const starts=new Set(changed.map(b=>b.start));g.buckets=[...g.buckets.filter(b=>!starts.has(b.start)),...changed].sort((a,b)=>a.start-b.start);g.head=current.data.watermark;g.at=this.now();this.publish(g,{type:'heatmap-batch',key:g.key,ids:[g.id],generation:g.generation,batchId:0,snapshot:false,buckets:changed,status:g.lastStatus!});}}
  g.retryAt=this.now()+1000;if(!current.ready)g.dirty=true;if(!g.ws)this.connect(g);return;
 }

 await this.prepared.load(bounds,abort.signal,(data,validated,complete)=>{if(abort.signal.aborted||this.groups.get(g.id)!==g||g.serial!==serial)return;
 const tiles=heatmapTiles(data,bounds.from,bounds.to);g.buckets=mergePreparedSnapshot(g.buckets,tiles,data.availability??[],g.view!,bounds.timeMs,bounds.rowPrice,this.now(),complete);g.head=data.watermark;g.at=this.now();g.gaps=data.coverage.gaps;
 const unavailable=data.availability?.filter((a:any)=>a.state==='unavailable').length??0;const partial=data.cells.some((c:any)=>!c.bidComplete||!c.askComplete);g.lastStatus={state:complete?'live':'syncing',message:`Staging prepared depth · ${bounds.timeMs/60000}m buckets · $${bounds.rowPrice} rows · ${validated?'validated':'cached; validating'}${complete?'':' · loading visible history'} · ${unavailable?`${unavailable} unavailable bucket(s)`:partial?'partial depth/time coverage':data.cells.length?'snapshot-covered viewport':'no observed depth in viewport'} · ${g.gaps?.length??0} coverage gap(s)${g.market==='perpetual'?' · RPI excluded':''}`,tickSize:marketTickSize(g.market),collectionStart:data.coverage.epochs[0]?.from??null,retentionStart:g.buckets[0]?.start??null,capacityLimited:Boolean(g.view&&g.view.to-g.view.from>14400000)};
 if(complete){g.loadedSerial=serial;g.validatedAt=this.now();g.formingFrom=data.availability?.find((a:any)=>a.state==='forming')?.from;}this.publish(g,{type:'heatmap-batch',key:g.key,ids:[g.id],generation:g.generation,batchId:0,snapshot:true,buckets:g.buckets,status:g.lastStatus});});
 g.retry=0;g.retryAt=this.now()+1000;if(!g.ws)this.connect(g);
 }catch(e){if(!abort.signal.aborted&&this.groups.get(g.id)===g){g.dirty=true;g.retry=Math.min(g.retry+1,7);g.retryAt=this.now()+Math.min(10000,500*2**g.retry);this.status(g,'stale',`Staging prepared depth · ${e instanceof Error?e.message:String(e)} · retrying`);}}
 finally{g.busy=false;if(g.serial!==serial)g.dirty=true;}
 }
 private connect(g:Group){this.connectMarket(g.market,g.head);g.ws=this.streams.get(g.market);if(g.ws)g.streamAt=this.marketStreamAt.get(g.market)??this.now();}
 /** Heatmap and order-wall consumers share this one durable-head stream per market. */
 private connectMarket(market:Market,after:number){
  if(!this.online||!this.hasMarketConsumer(market)||this.streams.has(market)||this.now()<(this.marketRetryAt.get(market)??0))return;
  const origin=typeof location==='undefined'?'http://127.0.0.1:5173':location.origin,url=new URL('/market-data/v1/stream',origin.replace(/^http/,'ws'));
  if(market==='spot')url.searchParams.set('market','spot');
  let ws:WebSocket;try{ws=this.socket(url.href);}catch{this.marketRetryAt.set(market,this.now()+1000);this.notifyHeadObservers(market,{type:'stale',message:'Staging depth · connection unavailable'});return;}
  this.streams.set(market,ws);this.marketStreamAt.set(market,this.now());
  for(const g of this.groups.values())if(g.market===market){g.ws=ws;g.streamAt=this.now();}
  const cursor=Math.max(after,this.marketHeads.get(market)?.cursor??0);
  ws.onopen=()=>{if(this.streams.get(market)===ws)ws.send(JSON.stringify({type:'subscribe',version:1,channel:'depth',after:cursor,...(market==='spot'?{market:'spot'}:{})}));};
  ws.onmessage=e=>{
   if(this.streams.get(market)!==ws)return;const at=this.now();this.marketStreamAt.set(market,at);
   for(const g of this.groups.values())if(g.market===market)g.streamAt=at;
   try{
    const m=JSON.parse(String(e.data));
    if(m.type==='depth-head'){
     const head=m.watermark;if(!Number.isSafeInteger(head?.cursor)||head.cursor<0)throw new Error('Invalid depth head');
     const prior=this.marketHeads.get(market),headAt=Number.isFinite(head.at)?head.at:at,headEpoch=Number.isSafeInteger(head.epoch)?head.epoch:prior?.epoch??0;
     if(!prior||head.cursor>prior.cursor||headEpoch!==prior.epoch||headAt>prior.at)this.marketHeads.set(market,{cursor:head.cursor,at:headAt,epoch:headEpoch});
     // A valid same-cursor head after a stale/reconnect notice confirms that the
     // retained watermark is still authoritative even though no cursor advanced.
     this.notifyHeadObservers(market,{type:'head',cursor:head.cursor,at:headAt,epoch:headEpoch});
     ws.send(JSON.stringify({type:'ack',cursor:head.cursor}));
     for(const g of this.groups.values())if(g.market===market&&head.cursor>g.head){if(g.loadedSerial===g.serial&&g.view&&g.view.to<this.now()-2*(g.resolution.candleMs??60000)){g.head=head.cursor;continue;}g.dirty=true;g.retryAt=Math.max(g.retryAt,this.now()+100);}
    }else if(m.type==='health'&&m.depth?.status.state!=='live'){
     const message=`Staging depth · ${m.depth?.status.message??'recovery pending'}`;this.notifyHeadObservers(market,{type:'stale',message});
     for(const g of this.groups.values())if(g.market===market){g.validatedAt=0;this.status(g,'stale',message);}
    }else if(m.type==='reset'){
     this.notifyHeadObservers(market,{type:'reset',message:m.reason??'Depth stream reset'});this.marketRetryAt.set(market,this.now()+1000);ws.close();
    }
   }catch{this.marketRetryAt.set(market,this.now()+1000);ws.close();}
  };
  ws.onerror=()=>ws.close();
  ws.onclose=()=>{
   if(this.streams.get(market)!==ws)return;this.streams.delete(market);this.marketStreamAt.delete(market);this.marketRetryAt.set(market,this.now()+1000);
   for(const g of this.groups.values())if(g.market===market){g.ws=undefined;g.validatedAt=0;g.dirty=true;g.retryAt=this.now()+1000;this.status(g,'stale','Staging depth · reconnecting; retained history preserved');}
   this.notifyHeadObservers(market,{type:'stale',message:'Staging depth · reconnecting; retained history preserved'});
  };
 }
 diagnostics(){return {prepared:this.prepared.metrics,scheduler:historyScheduler.diagnostics(),configurations:this.groups.size,streams:[...this.streams.keys()],groups:[...this.groups.values()].map(g=>({key:g.key,market:g.market,cursor:g.head,buckets:g.buckets.length,loading:g.busy,status:g.lastStatus}))};}
 dispose(){this.prepared.dispose();this.cache.dispose?.();clearInterval(this.timer);for(const id of this.groups.keys())this.remove(id);for(const ws of this.streams.values())ws.close();this.streams.clear();this.headObservers.clear();}
}
/** Keep the last validated viewport visible while a new prepared snapshot is incomplete. */
export function mergePreparedSnapshot(previous:LiquidityBucket[],incoming:LiquidityBucket[],availability:{from:number;to:number;state:string}[],view:Pick<HeatmapViewport,'from'|'to'|'low'|'high'>,timeMs:number,rowPrice:number,now:number,complete:boolean):LiquidityBucket[]{
 const result=new Map(incoming.map(bucket=>[bucket.start,bucket]));
 const currentFrom=Math.floor(now/timeMs)*timeMs;
 for(const old of previous){
  if(old.timeMs!==timeMs||old.rowSize!==rowPrice||old.end<=view.from||old.start>=view.to||!bucketIntersectsPrice(old,view.low,view.high))continue;
  const explicitGap=availability.some(a=>(a.state==='gap'||a.state==='unavailable')&&a.from<old.start+timeMs&&a.to>old.start);
  if(explicitGap)continue;
  const candidate=result.get(old.start),tail=old.start>=currentFrom-timeMs&&old.start<=currentFrom;
  if(candidate){
   const newer=candidate.cells.length>0&&candidate.revision>old.revision;
   const closed=candidate.cells.length>0&&candidate.end>=old.start+timeMs&&candidate.revision>=old.revision;
   const confirmedEmpty=complete&&candidate.cells.length===0;
   if(newer||closed||confirmedEmpty||complete&&!tail)continue;
   result.set(old.start,old);
  }else if(!complete||tail)result.set(old.start,old);
 }
 return [...result.values()].sort((a,b)=>a.start-b.start).slice(-240);
}
function bucketIntersectsPrice(bucket:LiquidityBucket,low:number,high:number){for(let i=0;i<bucket.cells.length;i+=13){const rowLow=bucket.cells[i]!;if(rowLow<high&&rowLow+bucket.rowSize>low)return true;}return false;}
export function viewportRequest(v:HeatmapViewport,interval:number,row:number,now:number){
 const visibleTo=Math.min(now+1,v.to),visibleFrom=Math.max(1,v.from,visibleTo-14400000);
 const margin=visibleTo-visibleFrom+2*interval<=14400000?interval:0;
 const from=Math.max(interval,Math.floor((visibleFrom-margin)/interval)*interval),to=Math.min(now+1,Math.ceil((visibleTo+margin)/interval)*interval);
 let timeMs=interval;while(Math.ceil((to-from)/timeMs)>240)timeMs*=2;
 const low=Math.max(0,v.low),high=v.high;let rowPrice=row;
 const rows=Math.min(512,Math.max(16,Math.floor(v.height/4))),needed=Math.max(row,(high-low)/rows,(high-low)*Math.ceil((to-from)/timeMs)/16384);
 if(needed>row){rowPrice=[10,25,50,100,250,1000].find(w=>w>=needed)??Math.ceil(needed/row)*row;}
 return {from:Math.floor(from/timeMs)*timeMs,to,low:Math.floor(low/rowPrice)*rowPrice,high:Math.ceil(high/rowPrice)*rowPrice,rowPrice,timeMs,mode:'average'};
}
function marketParams(values:Record<string,unknown>,market:Market){const params=new URLSearchParams(Object.entries(values).filter(([key])=>key!=='market').map(([key,value])=>[key,String(value)]));if(market==='spot')params.set('market','spot');return params;}
function marketTickSize(market:Market){return market==='spot'?0.01:0.1;}
export function heatmapTiles(data:any,from:number,to:number):LiquidityBucket[]{const map=new Map<number,any[]>();for(const a of data.availability??[])if(['ready','gap','unavailable'].includes(a.state))for(let time=Math.floor(a.from/data.resolution.timeMs)*data.resolution.timeMs;time<a.to;time+=data.resolution.timeMs)if(time<to&&time+data.resolution.timeMs>from)map.set(time,[]);for(const c of data.cells){const cells=map.get(c.time)??[];cells.push(c);map.set(c.time,cells);}return [...map].sort(([a],[b])=>a-b).slice(-240).map(([time,rows])=>{rows.sort((a,b)=>a.low-b.low);const start=Math.max(time,from),end=Math.min(time+data.resolution.timeMs,to,data.coverage.confirmedTo),dt=Math.max(0,end-start);const cells=new Float64Array(rows.length*HEATMAP_STRIDE);rows.forEach((c,i)=>cells.set([c.low,(c.bid??0)*c.bidDuration,(c.ask??0)*c.askDuration,c.bidPeak??c.bid??0,c.askPeak??c.ask??0,c.bidDuration,c.askDuration,c.bidComplete?dt:0,c.askComplete?dt:0,(c.bidQuote??0)*c.bidDuration,(c.askQuote??0)*c.askDuration,c.bidQuotePeak??c.bidQuote??0,c.askQuotePeak??c.askQuote??0],i*HEATMAP_STRIDE));return {preaggregated:true,timeMs:data.resolution.timeMs,id:`depth:${time}`,start,end,epoch:rows[0]?.epochs[0]??0,rowSize:data.resolution.rowPrice,revision:data.revisions?.[time]??data.watermark,capacityLimited:false,cells,peaks:new Float64Array()};}).filter(b=>b.end>b.start);}

/** Fragments share a watermark; means use observed duration, never unknown time. */
export function mergeHeatmapResponses(previous:any,page:any):any {
 if(!previous)return page;
 if(previous.watermark!==page.watermark)throw new Error('Depth fragment watermark mismatch');
 const cells=new Map(previous.cells.map((c:any)=>[`${c.time}:${c.low}`,c]));
 for(const cell of page.cells){const key=`${cell.time}:${cell.low}`,old:any=cells.get(key);if(!old){cells.set(key,cell);continue;}const merged={...old,epochs:[...new Set([...old.epochs,...cell.epochs])]};for(const side of ['bid','ask']){const d=side+'Duration',duration=old[d]+cell[d];merged[side]=duration?((old[side]??0)*old[d]+(cell[side]??0)*cell[d])/duration:null;merged[side+'Quote']=duration?((old[side+'Quote']??0)*old[d]+(cell[side+'Quote']??0)*cell[d])/duration:null;merged[d]=duration;merged[side+'Complete']=old[side+'Complete']&&cell[side+'Complete'];for(const suffix of ['Peak','QuotePeak'])merged[side+suffix]=Math.max(old[side+suffix]??0,cell[side+suffix]??0);}cells.set(key,merged);}
 if(cells.size>16384)throw new Error('Depth fragment cell budget exceeded');
 const epochs=[...new Map([...previous.coverage.epochs,...page.coverage.epochs].map((e:any)=>[e.epoch,e])).values()];const gaps=[...new Map([...previous.coverage.gaps,...page.coverage.gaps].map((g:any)=>[`${g.from}:${g.to}:${g.reason}`,g])).values()];
 return {...page,cells:[...cells.values()],coverage:{...page.coverage,epochs,gaps,priceSpans:[...(previous.coverage.priceSpans??[]),...(page.coverage.priceSpans??[])]},inputRecords:(previous.inputRecords??0)+(page.inputRecords??0)};
}

function retryDelay(signal:AbortSignal,ms:number):Promise<void>{return new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(new DOMException('Aborted','AbortError'));}if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});});}
