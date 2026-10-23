import { depthSource } from './prepared-history';
import type { Market } from './protocol';
import { depthMatrixSettings, depthMatrixSourceDefinition, depthMatrixSourceLabel, matrixBucketBounds, matrixBucketIndex, type DepthMatrixColumn, type DepthMatrixSettings, type DepthMatrixSource, type DepthMatrixViewport, type MatrixCoverage, type MatrixRow } from './depth-matrix';
import type { DepthHeadNotice, StagingHeatmapService } from './staging-heatmap';

interface MatrixResponse {
  version: number; source: string; market: Market; instrument: string; feed: string;
  state: 'live'|'stale'|'syncing'; message: string; cursor: number; epoch: number|null; at: number; lastAt: number;
  width: string; viewport: DepthMatrixViewport; rows: MatrixRow[]; bestBid: string|null; bestAsk: string|null; mid: string|null;
  quantityUnit: 'BTC'; notionalUnit: 'USDT';
}
interface MarketFeed { market: Market; release?: () => void; target?: {cursor:number;at:number;epoch:number}; transport:'live'|'stale'|'syncing'|'disconnected'; message:string; lastStreamAt:number; lastProbeAt:number; probe?:AbortController; httpRecovery?:boolean }
interface Grid {
  key:string; market:Market; width:string; viewport?:DepthMatrixViewport; data?:MatrixResponse; busy:boolean; serial:number;
  abort?:AbortController; requestedCursor:number; retryTimer?:ReturnType<typeof setTimeout>; prefetchOnly:boolean; prefetchStarted:boolean;
}
interface MatrixSubscription { id:string; settings:DepthMatrixSettings; viewport?:DepthMatrixViewport; pendingViewport?:DepthMatrixViewport; dirty:boolean; lastEmit:number }

const MAX_ACTIVE_WIDGETS=8, MAX_PAGES_PER_MARKET=4, SUPPORTED_MARKETS=2;
const MAX_CACHED_GRIDS=MAX_ACTIVE_WIDGETS*MAX_PAGES_PER_MARKET*SUPPORTED_MARKETS, PUBLISH_INTERVAL_MS=160, STALE_AFTER_MS=5_000;
const marketOfSource=(source:DepthMatrixSource):Market|null=>{const definition=depthMatrixSourceDefinition(source);return definition?.supported?definition.market??null:null;};

/** Current visible book snapshots only. Historical reconstruction remains under the existing heatmap/order-wall APIs. */
export class StagingDepthMatrixService {
  private subscriptions=new Map<string,MatrixSubscription>();
  private feeds=new Map<Market,MarketFeed>();
  private grids=new Map<string,Grid>();
  private online=true;
  private disposed=false;
  private timer:ReturnType<typeof setInterval>;
  readonly stats={requests:0,failures:0,activeWidgets:0,activeMarkets:0,activeGrids:0,emittedRows:0,cacheHits:0};

  constructor(private heads:StagingHeatmapService,private emit:(event:Extract<import('./protocol').Event,{type:'depth-matrix-batch'}>)=>void,
    private request:typeof fetch=(...args)=>fetch(...args),private now=Date.now){this.timer=setInterval(()=>this.publishDirty(),PUBLISH_INTERVAL_MS);}

  command(command:Extract<import('./protocol').Command,{type:'depth-matrix-subscribe'|'depth-matrix-settings'|'depth-matrix-viewport'|'depth-matrix-unsubscribe'|'depth-matrix-retry'}>){
    if(command.type==='depth-matrix-subscribe')this.subscribe(command.id,command.settings);
    else if(command.type==='depth-matrix-settings')this.updateSettings(command.id,command.settings);
    else if(command.type==='depth-matrix-viewport')this.updateViewport(command.id,command.viewport);
    else if(command.type==='depth-matrix-unsubscribe')this.unsubscribe(command.id);
    else this.retry();
  }

  private subscribe(id:string,value:DepthMatrixSettings){
    if(!id)return;let sub=this.subscriptions.get(id);if(!sub&&this.subscriptions.size>=MAX_ACTIVE_WIDGETS)return;
    if(!sub)sub={id,settings:depthMatrixSettings(value),dirty:true,lastEmit:0};
    sub.settings=depthMatrixSettings(value);sub.dirty=true;this.subscriptions.set(id,sub);this.stats.activeWidgets=this.subscriptions.size;
    this.updateFeedLifetimes();this.reconcile();
  }
  private updateSettings(id:string,value:DepthMatrixSettings){
    const sub=this.subscriptions.get(id);if(!sub)return;const next=depthMatrixSettings(value);
    if(next.bucketWidth!==sub.settings.bucketWidth){sub.viewport=undefined;sub.pendingViewport=undefined;}
    sub.settings=next;sub.dirty=true;this.updateFeedLifetimes();this.reconcile();
  }
  private updateViewport(id:string,viewport:DepthMatrixViewport){
    const sub=this.subscriptions.get(id);if(!sub||!validViewport(viewport))return;
    if(sub.pendingViewport?.low===viewport.low&&sub.pendingViewport?.high===viewport.high)return;
    if(sub.viewport?.low===viewport.low&&sub.viewport?.high===viewport.high)sub.pendingViewport=undefined;
    else sub.pendingViewport={...viewport};
    sub.dirty=true;this.reconcile();
  }
  private unsubscribe(id:string){this.subscriptions.delete(id);this.stats.activeWidgets=this.subscriptions.size;this.updateFeedLifetimes();this.reconcile();}

  setOnline(online:boolean){
    if(this.online===online)return;this.online=online;
    for(const feed of this.feeds.values()){
      if(!online){feed.probe?.abort();feed.release?.();feed.release=undefined;feed.transport='disconnected';feed.message='Network offline';}
      else{feed.transport='syncing';feed.message='Reconnecting to synchronized depth';}
    }
    if(!online)for(const grid of this.grids.values())this.cancelGrid(grid);
    else for(const grid of this.grids.values())if(!grid.data){grid.requestedCursor=0;grid.prefetchStarted=false;}
    this.updateFeedLifetimes();this.markAllDirty();this.reconcile();
  }
  retry(){for(const grid of this.grids.values())if(!grid.prefetchOnly){clearTimeout(grid.retryTimer);grid.retryTimer=undefined;grid.requestedCursor=0;this.fetchGrid(grid);}}

  private updateFeedLifetimes(){
    for(const sub of this.subscriptions.values())for(const source of sub.settings.sources){const market=marketOfSource(source);if(market)this.ensureMarket(market);}
    for(const [market,feed]of this.feeds){
      const used=this.online&&[...this.subscriptions.values()].some(sub=>sub.settings.sources.some(source=>marketOfSource(source)===market));
      if(used&&!feed.release)feed.release=this.heads.observeDepthHeads(`depth-matrix:${market}`,market,feed.target?.cursor??0,notice=>this.streamHead(feed,notice));
      else if(!used&&feed.release){feed.release();feed.release=undefined;feed.transport='syncing';feed.message='Waiting for an active matrix view';feed.target=undefined;feed.probe?.abort();this.feeds.delete(market);}
      else if(!used)this.feeds.delete(market);
    }
    this.stats.activeMarkets=this.feeds.size;
  }
  private ensureMarket(market:Market){
    let feed=this.feeds.get(market);if(!feed){feed={market,transport:'syncing',message:'Waiting for a synchronized depth head',lastStreamAt:this.now(),lastProbeAt:this.now()};this.feeds.set(market,feed);}
    if(this.online&&!feed.release)feed.release=this.heads.observeDepthHeads(`depth-matrix:${market}`,market,feed.target?.cursor??0,notice=>this.streamHead(feed!,notice));
    return feed;
  }
  private streamHead(feed:MarketFeed,notice:DepthHeadNotice){
    if(notice.type==='head'){feed.lastStreamAt=this.now();feed.httpRecovery=false;}
    this.onHead(feed,notice);
  }
  private recoverHeads(){
    if(!this.online||this.disposed)return;
    for(const feed of this.feeds.values()){
      if(feed.probe||this.now()-feed.lastStreamAt<5_000||this.now()-feed.lastProbeAt<5_000)continue;
      const abort=new AbortController();feed.probe=abort;feed.lastProbeAt=this.now();
      const timeout=setTimeout(()=>abort.abort(),12_000);
      void this.request(`/market-data/v1/health${feed.market==='spot'?'?market=spot':''}`,{signal:abort.signal}).then(async response=>{
        if(!response.ok)throw Error(`Depth health HTTP ${response.status}`);
        const health=await response.json(),head=health?.depth?.head;
        if(this.disposed||!this.online||this.feeds.get(feed.market)!==feed||abort.signal.aborted)return;
        if(health?.market!==feed.market||health?.depth?.status?.state!=='live'||!Number.isSafeInteger(head?.cursor)||!Number.isSafeInteger(head?.epoch)
          ||!Number.isFinite(head?.at)||head.at<=0||this.now()-head.at>STALE_AFTER_MS)throw Error('No fresh synchronized depth snapshot');
        // A stream head arriving during this request takes precedence.
        if(this.now()-feed.lastStreamAt<5_000)return;
        feed.httpRecovery=true;
        this.onHead(feed,{type:'head',cursor:head.cursor,at:head.at,epoch:head.epoch});
        feed.message='HTTP snapshot recovery · depth stream reconnecting';this.markMarketDirty(feed.market);
      }).catch(error=>{
        if(this.disposed||!this.online||this.feeds.get(feed.market)!==feed||this.now()-feed.lastStreamAt<5_000)return;
        feed.transport='stale';feed.message=abort.signal.aborted?'Depth snapshot recovery timed out':error instanceof Error?error.message:String(error);this.markMarketDirty(feed.market);
      }).finally(()=>{clearTimeout(timeout);if(feed.probe===abort)feed.probe=undefined;});
    }
  }
  private onHead(feed:MarketFeed,notice:DepthHeadNotice){
    if(this.disposed)return;
    if(notice.type==='stale'){feed.transport='stale';feed.message=notice.message;this.markMarketDirty(feed.market);return;}
    if(notice.type==='reset'){
      feed.transport='syncing';feed.message=notice.message;feed.target=undefined;
      for(const grid of this.grids.values())if(grid.market===feed.market){this.cancelGrid(grid);grid.data=undefined;grid.requestedCursor=0;grid.prefetchStarted=false;}
      this.markMarketDirty(feed.market);return;
    }
    if(!Number.isSafeInteger(notice.cursor)||notice.cursor<0||!Number.isFinite(notice.at)||notice.at<=0||!Number.isSafeInteger(notice.epoch))return;
    const epochChanged=feed.target!==undefined&&feed.target.epoch!==notice.epoch;
    if(epochChanged){for(const grid of this.grids.values())if(grid.market===feed.market){this.cancelGrid(grid);grid.data=undefined;grid.requestedCursor=0;grid.prefetchStarted=false;}
      feed.transport='syncing';feed.message='Depth epoch changed; waiting for a fresh snapshot';}
    if(!feed.target||notice.cursor>=feed.target.cursor||notice.epoch!==feed.target.epoch)feed.target={cursor:notice.cursor,at:notice.at,epoch:notice.epoch};
    const hasCurrentData=[...this.grids.values()].some(grid=>grid.market===feed.market&&grid.data?.epoch===notice.epoch);
    const revalidate=feed.transport!=='live';feed.transport=hasCurrentData?'live':'syncing';feed.message=hasCurrentData?'Durable depth head received':'Waiting for a matching durable book snapshot';
    this.markMarketDirty(feed.market);this.reconcile();
  }
  private reconcile(){
    const wanted=new Map<string,{key:string;market:Market;width:string;viewport?:DepthMatrixViewport;priority:boolean}>();
    const add=(market:Market,width:string,viewport:DepthMatrixViewport|undefined,priority:boolean)=>{
      const key=gridKey(market,width,viewport),existing=wanted.get(key);
      if(existing){existing.priority||=priority;return;}
      wanted.set(key,{key,market,width,...(viewport?{viewport}:{}),priority});
    };
    for(const sub of this.subscriptions.values()){
      const markets=[...new Set(sub.settings.sources.map(marketOfSource).filter((market):market is Market=>market!==null))];
      const firstMarket=markets[0];
      for(const market of markets){
        // The first source resolves the initial shared price range; subsequent venues query that same range.
        if(!sub.viewport&&!sub.pendingViewport&&market!==firstMarket)continue;
        if(sub.viewport)add(market,sub.settings.bucketWidth,sub.viewport,true);
        if(sub.pendingViewport)add(market,sub.settings.bucketWidth,sub.pendingViewport,true);
        const preloadBase=sub.pendingViewport??sub.viewport;
        if(preloadBase){
          for(const direction of [-1,1] as const){
            const neighbor=adjacentViewport(preloadBase,sub.settings.bucketWidth,direction);
            if(neighbor)add(market,sub.settings.bucketWidth,neighbor,false);
          }
        }else add(market,sub.settings.bucketWidth,undefined,true);
      }
    }
    for(const [key,grid]of this.grids)if(!wanted.has(key)){this.cancelGrid(grid);this.grids.delete(key);}
    for(const item of wanted.values()){
      const grid=this.getGrid(item.key,item.market,item.width,item.viewport);
      if(item.priority){
        if(grid.prefetchOnly){
          grid.prefetchOnly=false;
          if(!this.gridFreshForCurrentTarget(grid)){clearTimeout(grid.retryTimer);grid.retryTimer=undefined;if(!grid.busy)grid.requestedCursor=0;}
        }
        this.fetchGrid(grid);
      }else{
        grid.prefetchOnly=true;
        if(grid.retryTimer){clearTimeout(grid.retryTimer);grid.retryTimer=undefined;}
        if(!grid.prefetchStarted&&!grid.data)this.fetchGrid(grid);
      }
    }
    this.stats.activeGrids=this.grids.size;
  }
  private getGrid(key:string,market:Market,width:string,viewport?:DepthMatrixViewport){
    let grid=this.grids.get(key);if(grid){this.grids.delete(key);this.grids.set(key,grid);this.stats.cacheHits++;return grid;}
    grid={key,market,width,viewport:viewport?{...viewport}:undefined,busy:false,serial:0,requestedCursor:0,prefetchOnly:false,prefetchStarted:false};this.grids.set(key,grid);
    while(this.grids.size>MAX_CACHED_GRIDS){const oldest=this.grids.keys().next().value!;const removed=this.grids.get(oldest)!;this.cancelGrid(removed);this.grids.delete(oldest);}
    return grid;
  }
  private fetchGrid(grid:Grid,force=false){
    if(!this.online||this.disposed)return;const feed=this.feeds.get(grid.market),target=feed?.target;if(!target)return;
    if(!force&&this.gridFreshForCurrentTarget(grid)){grid.requestedCursor=target.cursor;return;}
    if(grid.busy)return;
    if(!force&&grid.requestedCursor===target.cursor)return;
    const serial=++grid.serial,abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),15_000);grid.abort=abort;grid.busy=true;grid.requestedCursor=target.cursor;this.stats.requests++;
    if(grid.prefetchOnly)grid.prefetchStarted=true;
    const params=new URLSearchParams({width:grid.width});if(grid.viewport){params.set('low',grid.viewport.low);params.set('high',grid.viewport.high);}if(grid.market==='spot')params.set('market','spot');
    void this.request(`/market-data/v1/depth-matrix?${params}`,{signal:abort.signal}).then(async response=>{
      const value=await response.json() as MatrixResponse&{error?:string};if(!response.ok)throw new Error(value.error??`Depth Matrix HTTP ${response.status}`);
      if(abort.signal.aborted||grid.serial!==serial||this.grids.get(grid.key)!==grid)return;
      validateResponse(value,grid.market,target,grid,grid.data?.cursor??0);
      grid.data=value;grid.busy=false;grid.abort=undefined;grid.retryTimer=undefined;
      const feedNow=this.feeds.get(grid.market);
      if(feedNow?.target?.epoch===value.epoch){
        if(value.cursor>feedNow.target.cursor)feedNow.target={cursor:value.cursor,at:value.at,epoch:value.epoch};
        if(value.state==='live'&&!grid.prefetchOnly&&feedNow.transport!=='stale'){feedNow.transport='live';feedNow.message=feedNow.httpRecovery?'HTTP snapshot recovery · depth stream reconnecting':value.message;}
      }
      for(const sub of this.subscriptions.values()){
        const first=sub.settings.sources.find(source=>marketOfSource(source)!==null);
        if(!sub.viewport&&first&&sub.settings.bucketWidth===grid.width&&marketOfSource(first)===grid.market&&grid.viewport===undefined&&validViewport(value.viewport)){
          sub.viewport={...value.viewport};sub.dirty=true;
          const aliasKey=gridKey(grid.market,sub.settings.bucketWidth,sub.viewport);
          if(!this.grids.has(aliasKey))this.grids.set(aliasKey,{key:aliasKey,market:grid.market,width:grid.width,viewport:sub.viewport,data:value,busy:false,serial:0,requestedCursor:value.cursor,prefetchOnly:false,prefetchStarted:false});
        }
      }
      this.markGridDirty(grid);this.reconcile();
      const newest=this.feeds.get(grid.market)?.target;
      if(!grid.prefetchOnly&&newest&&newest.epoch===value.epoch&&newest.cursor>value.cursor){grid.requestedCursor=value.cursor;grid.retryTimer=setTimeout(()=>{grid.retryTimer=undefined;this.fetchGrid(grid);},PUBLISH_INTERVAL_MS);}
    }).catch(error=>{
      if(grid.serial!==serial||this.grids.get(grid.key)!==grid)return;
      grid.busy=false;grid.abort=undefined;this.stats.failures++;
      if(!grid.prefetchOnly){
        const current=this.feeds.get(grid.market);
        if(current&&!this.hasFreshActiveGrid(grid.market,current.target?.epoch??null)){
          current.transport='stale';current.message=abort.signal.aborted?'Depth snapshot request timed out':error instanceof Error?error.message:String(error);
        }
        this.markGridDirty(grid);
        clearTimeout(grid.retryTimer);grid.retryTimer=setTimeout(()=>{grid.retryTimer=undefined;grid.requestedCursor=0;this.fetchGrid(grid);},Math.min(8_000,500*2**Math.min(this.stats.failures,4)));
      }
    }).finally(()=>{clearTimeout(timeout);if(grid.serial===serial){grid.busy=false;grid.abort=undefined;}});
  }
  private cancelGrid(grid:Grid){grid.serial++;grid.abort?.abort();grid.abort=undefined;grid.busy=false;clearTimeout(grid.retryTimer);grid.retryTimer=undefined;}

  private gridFreshForCurrentTarget(grid:Grid){
    const data=grid.data,target=this.feeds.get(grid.market)?.target;
    return !!data&&!!target&&data.epoch===target.epoch&&data.cursor>=target.cursor&&data.state==='live'
      &&data.lastAt>0&&this.now()-data.lastAt<=STALE_AFTER_MS;
  }
  private hasFreshActiveGrid(market:Market,epoch:number|null){
    if(epoch===null)return false;const at=this.now();
    for(const sub of this.subscriptions.values()){
      if(!sub.viewport||!sub.settings.sources.some(source=>marketOfSource(source)===market))continue;
      const grid=this.grids.get(gridKey(market,sub.settings.bucketWidth,sub.viewport)),data=grid?.data;
      if(data&&data.epoch===epoch&&data.state==='live'&&data.lastAt>0&&at-data.lastAt<=STALE_AFTER_MS)return true;
    }
    return false;
  }
  private markGridDirty(grid:Grid){
    const resolved=grid.viewport??grid.data?.viewport;
    for(const sub of this.subscriptions.values()){
      if(sub.settings.bucketWidth!==grid.width||!sub.settings.sources.some(source=>marketOfSource(source)===grid.market))continue;
      if((!sub.viewport&&!sub.pendingViewport&&grid.viewport===undefined)
        ||(resolved&&sub.viewport&&sameViewport(sub.viewport,resolved))
        ||(resolved&&sub.pendingViewport&&sameViewport(sub.pendingViewport,resolved)))sub.dirty=true;
    }
  }
  private pendingViewportReady(sub:MatrixSubscription,at:number){
    const viewport=sub.pendingViewport;if(!viewport)return false;
    const markets=[...new Set(sub.settings.sources.map(marketOfSource).filter((market):market is Market=>market!==null))];
    for(const market of markets){
      const grid=this.grids.get(gridKey(market,sub.settings.bucketWidth,viewport)),data=grid?.data,feed=this.feeds.get(market);
      if(!this.online||!data||!feed?.target||feed.transport==='disconnected'||feed.transport==='stale'||data.state!=='live'||data.epoch!==feed.target.epoch
        ||data.lastAt<=0||at-data.lastAt>STALE_AFTER_MS)return false;
    }
    return true;
  }
  private promoteReadyViewports(at:number){
    let promoted=false;
    for(const sub of this.subscriptions.values())if(this.pendingViewportReady(sub,at)){
      sub.viewport=sub.pendingViewport;sub.pendingViewport=undefined;sub.dirty=true;promoted=true;
    }
    if(promoted)this.reconcile();
  }
  private markMarketDirty(market:Market){for(const sub of this.subscriptions.values())if(sub.settings.sources.some(source=>marketOfSource(source)===market))sub.dirty=true;}
  private markAllDirty(){for(const sub of this.subscriptions.values())sub.dirty=true;}
  private publishDirty(){
    if(this.disposed)return;const at=this.now();
    this.recoverHeads();
    this.promoteReadyViewports(at);
    for(const sub of this.subscriptions.values()){
      if(!sub.dirty&&at-sub.lastEmit<1_000)continue;if(at-sub.lastEmit<PUBLISH_INTERVAL_MS)continue;
      const columns=sub.settings.sources.map(source=>this.column(source,sub,at));
      const resolvedViewport=sub.viewport;
      sub.dirty=false;sub.lastEmit=at;this.stats.emittedRows+=columns.reduce((sum,column)=>sum+column.rows.length,0);
      this.emit({type:'depth-matrix-batch',ids:[sub.id],settings:sub.settings,...(resolvedViewport?{viewport:resolvedViewport}:{}),columns,emittedAt:at});
    }
  }
  private column(source:DepthMatrixSource,sub:MatrixSubscription,at:number):DepthMatrixColumn{
    const market=marketOfSource(source);
    if(!market)return {source,label:depthMatrixSourceLabel(source),state:'unavailable',message:'No synchronized live BTC depth source is configured.',rows:[],bestBid:null,bestAsk:null,mid:null,quantityUnit:'BTC',notionalUnit:'USDT',lastAt:0,ageMs:null,cursor:0,epoch:null};
    const feed=this.feeds.get(market),viewport=sub.viewport;
    const grid=viewport?this.grids.get(gridKey(market,sub.settings.bucketWidth,viewport)):
      this.grids.get(gridKey(market,sub.settings.bucketWidth,undefined));
    const data=grid?.data;
    const offline=!this.online||feed?.transport==='disconnected';
    if(!data)return {source,label:depthMatrixSourceLabel(source),state:offline?'disconnected':feed?.transport==='stale'?'stale':'syncing',message:offline?'Network offline':feed?.message??'Waiting for a durable depth snapshot',rows:[],bestBid:null,bestAsk:null,mid:null,quantityUnit:'BTC',notionalUnit:'USDT',lastAt:0,ageMs:null,cursor:0,epoch:null};
    if(feed?.target&&data.epoch!==feed.target.epoch)return {source,label:depthMatrixSourceLabel(source),state:offline?'disconnected':'syncing',message:offline?'Network offline':'Waiting for a fresh snapshot in the current depth epoch',rows:[],bestBid:null,bestAsk:null,mid:null,quantityUnit:'BTC',notionalUnit:'USDT',lastAt:0,ageMs:null,cursor:0,epoch:null};
    const ageMs=data.lastAt>0?Math.max(0,at-data.lastAt):null;
    let state:DepthMatrixColumn['state']=data.state;
    if(offline)state='disconnected';
    else if(feed?.transport==='stale')state='stale';
    // A fresh same-epoch book remains valid while a later head request is pending.
    else if(ageMs!==null&&ageMs>STALE_AFTER_MS)state='stale';
    const rows=state==='stale'||state==='disconnected'?data.rows.map(row=>transportCoverage(row,state)):data.rows;
    return {source,label:depthMatrixSourceLabel(source),state,message:offline?'Network offline':state==='stale'&&feed?.transport==='stale'?feed.message:feed?.message??data.message,rows,bestBid:data.bestBid,bestAsk:data.bestAsk,mid:data.mid,
      quantityUnit:'BTC',notionalUnit:'USDT',lastAt:data.lastAt,ageMs,cursor:data.cursor,epoch:data.epoch};
  }
  diagnostics(){return {...this.stats,activeWidgets:this.subscriptions.size,activeMarkets:this.feeds.size,activeGrids:this.grids.size,
    markets:[...this.feeds.values()].map(feed=>({market:feed.market,cursor:feed.target?.cursor??0,epoch:feed.target?.epoch??null,state:feed.transport,busy:[...this.grids.values()].some(grid=>grid.market===feed.market&&grid.busy),consumers:[...this.subscriptions.values()].filter(sub=>sub.settings.sources.some(source=>marketOfSource(source)===feed.market)).length}))};}
  dispose(){if(this.disposed)return;this.disposed=true;clearInterval(this.timer);for(const feed of this.feeds.values()){feed.release?.();feed.probe?.abort();}for(const grid of this.grids.values())this.cancelGrid(grid);this.feeds.clear();this.grids.clear();this.subscriptions.clear();this.stats.activeWidgets=0;this.stats.activeMarkets=0;this.stats.activeGrids=0;}
}

function gridKey(market:Market,width:string,viewport?:DepthMatrixViewport){return `${market}|${width}|${viewport?`${viewport.low}:${viewport.high}`:'auto'}`;}
function sameViewport(a:DepthMatrixViewport,b:DepthMatrixViewport){return a.low===b.low&&a.high===b.high;}
function adjacentViewport(viewport:DepthMatrixViewport,width:string,direction:-1|1):DepthMatrixViewport|null{
  const first=matrixBucketIndex(viewport.low,width),last=matrixBucketIndex(viewport.high,width);
  if(first===null||last===null)return null;const start=BigInt(first),end=BigInt(last),size=end-start;
  if(size<=0n)return null;const shift=size/2n>0n?size/2n:1n,low=direction>0?start+shift:start-shift;
  if(low<0n)return null;const boundsLow=matrixBucketBounds(low,width),boundsHigh=matrixBucketBounds(low+size,width);
  return boundsLow&&boundsHigh?{low:boundsLow.low,high:boundsHigh.low}:null;
}
function validViewport(value:DepthMatrixViewport){return typeof value?.low==='string'&&typeof value?.high==='string'&&Number.isFinite(Number(value.low))&&Number.isFinite(Number(value.high))&&Number(value.low)>=0&&Number(value.high)>Number(value.low);}
function transportCoverage(row:MatrixRow,state:'stale'|'disconnected'):MatrixRow{
  const cover=(value:MatrixCoverage)=>value==='unknown'||value==='syncing'?value:state;
  return {...row,bidCoverage:cover(row.bidCoverage),askCoverage:cover(row.askCoverage)};
}
function validateResponse(value:MatrixResponse,market:Market,target:{cursor:number;at:number;epoch:number},grid:Grid,priorCursor:number){
  if(value.version!==1||value.market!==market||value.source!==depthSource(market)||value.instrument!==`binance:${market}:BTCUSDT`||value.feed!==depthSource(market)
    ||!['live','stale','syncing'].includes(value.state)||!Number.isSafeInteger(value.cursor)||value.cursor<target.cursor||value.cursor<priorCursor||value.epoch!==target.epoch
    ||!Number.isFinite(value.lastAt)||value.lastAt<0||value.width!==grid.width||value.quantityUnit!=='BTC'||value.notionalUnit!=='USDT'
    ||!validViewport(value.viewport)||!Array.isArray(value.rows)||value.rows.length<1||value.rows.length>2_000)throw new Error('Invalid compact depth matrix response');
  if(grid.viewport&&(value.viewport.low!==grid.viewport.low||value.viewport.high!==grid.viewport.high))throw new Error('Depth Matrix viewport mismatch');
  const first=matrixBucketIndex(value.viewport.low,value.width),end=matrixBucketIndex(value.viewport.high,value.width);
  if(first===null||end===null||matrixBucketBounds(first,value.width)?.low!==value.viewport.low||matrixBucketBounds(end,value.width)?.low!==value.viewport.high
    ||BigInt(end)-BigInt(first)!==BigInt(value.rows.length))throw new Error('Invalid compact depth matrix viewport alignment');
  for(let offset=0;offset<value.rows.length;offset++){
    const row=value.rows[offset]!,index=(BigInt(first)+BigInt(offset)).toString(),expected=matrixBucketBounds(index,value.width);
    if(row.index!==index||!expected||row.low!==expected.low||row.high!==expected.high
      ||![row.bidQuantity,row.askQuantity,row.bidNotional,row.askNotional].every(value=>Number.isFinite(value)&&value>=0)
      ||!validCoverage(row.bidCoverage)||!validCoverage(row.askCoverage))throw new Error('Invalid compact depth matrix row');
  }
}
function validCoverage(value:MatrixCoverage){return ['observed','known-empty','partial','unknown','stale','disconnected','syncing'].includes(value);}
