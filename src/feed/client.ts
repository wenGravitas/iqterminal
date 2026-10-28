import type {WatchMessage,WatchSnapshot} from '../level-watch/types';
import { heatmapKey, type HeatmapResolution } from './heatmap-model';
import { type Command, type Event, type Market, type Series, connectionKey, instrumentOf, footprintKeyOf, keyOf, marketOf, validDepthBand, validFootprintRowPrice } from './protocol';
import type { OrderWallRequest, OrderWallsSettings } from './order-walls';
import type { NetPositioningEvent, NetPositioningRequest } from './net-positioning';
import type { DepthMatrixSettings, DepthMatrixViewport } from './depth-matrix';
import type { TpoIndicatorSettings } from '../indicators/tpo-settings';
export class FeedClient {
  private effortClaims=new Map<string,{resolve:(value:boolean)=>void;timer:ReturnType<typeof setTimeout>}>();
  claimEffort(key:string,eventId:string,state:import('../effort-result/engine').EventState){if(this.effortClaims.size>=8)return Promise.resolve(false);const id=`effort-claim:${++this.sequence}`;return new Promise<boolean>(resolve=>{const timer=setTimeout(()=>{this.effortClaims.delete(id);resolve(false);},8000);this.effortClaims.set(id,{resolve,timer});this.send({type:'effort-claim',id,key,eventId,state});});}
  private effortExports=new Map<string,{resolve:(value:import('../effort-result/engine').SavedEffort)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  exportEffort(key:string){if(this.effortExports.size>=4)return Promise.reject(new Error('Export capacity reached'));const id=`effort-export:${++this.sequence}`;return new Promise<import('../effort-result/engine').SavedEffort>((resolve,reject)=>{const timer=setTimeout(()=>{this.effortExports.delete(id);reject(new Error('Evidence export timed out'));},5000);this.effortExports.set(id,{resolve,reject,timer});this.send({type:'effort-export',id,key});});}
  private effortListeners=new Map<string,(event:import('../effort-result/service').EffortUpdate)=>void>();
  subscribeEffort(id:string,series:Series,settings:import('../effort-result/settings').EffortSettings,callback:(event:import('../effort-result/service').EffortUpdate)=>void){const token=`effort:${id}:${++this.sequence}`;this.effortListeners.set(token,callback);this.send({type:'effort-subscribe',id:token,series,settings});return ()=>{this.effortListeners.delete(token);this.send({type:'effort-unsubscribe',id:token});};}
  private sequence=0;private current=new Map<string,string>();private currentDepth=new Map<string,string>();private currentFootprint=new Map<string,string>();private worker:Worker;private listeners=new Map<string,{key:string;callback:(e:Event)=>void}>();private depthListeners=new Map<string,(e:Event)=>void>();private footprintListeners=new Map<string,{key:string;callback:(e:Event)=>void}>();
  private tickerListeners = new Map<string,{revision:number;callback:(e: import('../ticker/model').TickerBatch) => void}>();
  private currentTicker = new Map<string,string>();
  private tradeBubbleListeners = new Map<string,{revision:number;callback:(e:import('../trade-bubbles/model').TradeBubbleBatch)=>void}>();
  private currentTradeBubbles = new Map<string,string>();
  private heatmapListeners = new Map<string,{key:string;callback:(e:Event)=>void}>();
  private currentHeatmap = new Map<string,string>();
  private orderWallListeners = new Map<string,(e:Extract<Event,{type:'order-wall-batch'}>)=>void>();
  private currentOrderWalls = new Map<string,string>();
  private netPositioningListeners = new Map<string,(event:NetPositioningEvent)=>void>();
  private currentNetPositioning = new Map<string,string>();
  private depthMatrixListeners = new Map<string,(event:Extract<Event,{type:'depth-matrix-batch'}>)=>void>();
  private currentDepthMatrix = new Map<string,string>();
  private tpoListeners = new Map<string,{key:string;callback:(event:Extract<Event,{type:'tpo-snapshot'|'tpo-patch'|'tpo-status'}>)=>void}>();
  private cvdListeners=new Map<string,(event:import('./cvd').CvdEvent)=>void>();
  private currentCvd=new Map<string,string>();
  private liquidationListeners=new Map<string,(e:import('../liquidations/protocol').LiquidationBatch)=>void>();
  private liquidationTokens=new Map<string,string>();
  private currentTpo = new Map<string,string>();
  private watchListeners=new Set<(snapshot:WatchSnapshot|undefined,error?:string)=>void>();
  private watchSnapshot?:WatchSnapshot;private watchError?:string;private watchStarted=false;
  private watchRequests=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  watchRequest<T=unknown>(path:string,body?:unknown,key:string=crypto.randomUUID()):Promise<T>{if(this.watchRequests.size>=8)return Promise.reject(new Error('Watch request capacity; retry'));const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.watchRequests.delete(id);reject(new Error('Watch request timed out; refresh before retrying a mutation'));},15000);this.watchRequests.set(id,{resolve:value=>resolve(value as T),reject,timer});this.worker.postMessage({type:'watch-rpc',id,path,body,key});});}
  subscribeWatches(listener:(snapshot:WatchSnapshot|undefined,error?:string)=>void){this.watchListeners.add(listener);if(this.watchSnapshot||this.watchError)listener(this.watchSnapshot,this.watchError);if(!this.watchStarted){this.watchStarted=true;this.worker.postMessage({type:'watch-start'});}return ()=>{this.watchListeners.delete(listener);};}
  readonly historyApply={footprintMs:0,heatmapMs:0,orderWallsMs:0,footprintBatches:0,heatmapBatches:0,orderWallsBatches:0};
  diagnostics:Record<string,unknown>={};
  constructor(fixture=false, alignFixtureToNow=false) {
    // Explicit diagnostic build mode only, never automatic fallback.
    this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
    // Vite worker URL query isn't preserved consistently; fixture selected by command initialization below.
    if(fixture)this.worker.postMessage({type:'initFixture',alignToNow:alignFixtureToNow});
    this.worker.onmessage=(message:MessageEvent<Event>)=>{
      const wm=message.data as unknown as WatchMessage;
      if(wm.type==='watch-result'){const request=this.watchRequests.get(wm.id);if(request){clearTimeout(request.timer);this.watchRequests.delete(wm.id);if(wm.error)request.reject(new Error(wm.error));else request.resolve(wm.value);}return;}
      if(wm.type==='watch-state'){if(wm.snapshot)this.watchSnapshot=wm.snapshot;this.watchError=wm.error;try{for(const listener of this.watchListeners){try{listener(this.watchSnapshot,this.watchError);}catch(error){console.error('Watch subscriber failed',error);}}}finally{if(wm.snapshot?.events)this.worker.postMessage({type:'watch-ack',cursor:wm.snapshot.cursor});}return;}
      const e=message.data;
      if(e.type==='effort-claim'){const pending=this.effortClaims.get(e.ids[0]);if(pending){clearTimeout(pending.timer);this.effortClaims.delete(e.ids[0]);pending.resolve(e.accepted);}return;}
      if(e.type==='effort-export'){const pending=this.effortExports.get(e.ids[0]);if(pending){clearTimeout(pending.timer);this.effortExports.delete(e.ids[0]);if(e.snapshot)pending.resolve(e.snapshot);else pending.reject(new Error(e.error));}return;}
      if(e.type==='diagnostics'){this.diagnostics={...e.data,historyApply:{...this.historyApply}};return;}
      try {
        for(const id of e.ids){
          try {
            if(e.type==='liquidation-batch')this.liquidationListeners.get(id)?.(e);
            if(e.type==='cvd-batch')this.cvdListeners.get(id)?.(e);
            if(e.type==='effort-result')this.effortListeners.get(id)?.(e);
            if(e.type==='ticker-batch'){const ticker=this.tickerListeners.get(id);if(ticker?.revision===e.configRevision)ticker.callback(e);}
            if(e.type==='trade-bubbles-batch'){const bubbles=this.tradeBubbleListeners.get(id);if(bubbles?.revision===e.configRevision)bubbles.callback(e);}
            const l=this.listeners.get(id);if(l&&'key'in e&&l.key===e.key)l.callback(e);
            const heatmap=this.heatmapListeners.get(id);if(heatmap&&e.type==='heatmap-batch'&&heatmap.key===e.key){const start=performance.now();heatmap.callback(e);this.historyApply.heatmapMs+=performance.now()-start;this.historyApply.heatmapBatches++;}
            const orderWalls=this.orderWallListeners.get(id);if(orderWalls&&e.type==='order-wall-batch'){const start=performance.now();orderWalls(e);this.historyApply.orderWallsMs+=performance.now()-start;this.historyApply.orderWallsBatches++;}
            const netPositioning=this.netPositioningListeners.get(id);if(netPositioning&&e.type.startsWith('net-positioning-'))netPositioning(e as NetPositioningEvent);
            const depthMatrix=this.depthMatrixListeners.get(id);if(depthMatrix&&e.type==='depth-matrix-batch')depthMatrix(e);
            const tpo=this.tpoListeners.get(id);if(tpo&&'key'in e&&tpo.key===e.key&&e.type.startsWith('tpo-'))tpo.callback(e as Extract<Event,{type:'tpo-snapshot'|'tpo-patch'|'tpo-status'}>);
            const depth=this.depthListeners.get(id);depth?.(e);
            const footprint=this.footprintListeners.get(id);if(footprint&&'key'in e&&footprint.key===e.key&&e.type.startsWith('footprint-')){const start=performance.now();footprint.callback(e);this.historyApply.footprintMs+=performance.now()-start;this.historyApply.footprintBatches++;}
          } catch(error) { console.error('Market data subscriber callback failed',error); }
        }
      } finally {
        if(e.type==='liquidation-batch')this.send({type:'liquidation-ack',id:e.ids[0],generation:e.generation,batchId:e.batchId});
        if(e.type==='cvd-batch')this.send({type:'cvd-ack',id:e.ids[0],generation:e.generation,batchId:e.batchId});
        if(e.type==='ticker-batch')this.send({type:'ticker-ack',id:e.ids[0],generation:e.generation,batchId:e.batchId});
        if(e.type==='trade-bubbles-batch')this.send({type:'trade-bubbles-ack',id:e.ids[0],generation:e.generation,batchId:e.batchId});
        if(e.type==='heatmap-batch')this.send({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});
        if(isFootprintBatch(e)) this.send({type:'footprint-ack',key:e.key,generation:e.generation,batchId:e.batchId});
      }
    };
  }
  send(c:Command){this.worker.postMessage(c);}
  retry(id:string){const token=this.current.get(id);if(token)this.send({type:'retry',id:token});}
  subscribe(id:string,s:Series,callback:(e:Event)=>void) {
    const previous=this.current.get(id);if(previous){this.listeners.delete(previous);this.send({type:'unsubscribe',id:previous});}
    const token=`${id}:${++this.sequence}`;this.current.set(id,token);this.listeners.set(token,{key:keyOf(s),callback});this.send({type:'subscribe',id:token,series:s});
    return ()=>{this.listeners.delete(token);if(this.current.get(id)===token)this.current.delete(id);this.send({type:'unsubscribe',id:token});};
  }
  subscribeDepth(id:string,bandPercent:number,callback:(e:Event)=>void) {
    if(!validDepthBand(bandPercent))throw new RangeError('Depth band must be from 0.01% through 0.25% in 0.01% steps');
    const previous=this.currentDepth.get(id);if(previous){this.depthListeners.delete(previous);this.send({type:'depth-unsubscribe',id:previous});}
    const token=`depth:${id}:${++this.sequence}`;this.currentDepth.set(id,token);this.depthListeners.set(token,callback);this.send({type:'depth-subscribe',id:token,bandPercent});
    return ()=>{this.depthListeners.delete(token);if(this.currentDepth.get(id)===token)this.currentDepth.delete(id);this.send({type:'depth-unsubscribe',id:token});};
  }
  subscribeHeatmap(id:string,resolution:HeatmapResolution,callback:(e:Event)=>void,market:Market='perpetual') {
    const previous=this.currentHeatmap.get(id);if(previous){this.heatmapListeners.delete(previous);this.send({type:'heatmap-unsubscribe',id:previous});}
    const token=`heatmap:${id}:${++this.sequence}`;this.currentHeatmap.set(id,token);this.heatmapListeners.set(token,{key:heatmapKey(resolution),callback});
    this.send({type:'heatmap-subscribe',id:token,resolution,...(market==='spot'?{market:'spot'}:{})});
    return ()=>{this.heatmapListeners.delete(token);if(this.currentHeatmap.get(id)===token)this.currentHeatmap.delete(id);this.send({type:'heatmap-unsubscribe',id:token});};
  }
  requestHeatmapViewport(id:string,viewport:import('./staging-heatmap').HeatmapViewport){if(import.meta.env.VITE_DATA_MODE!=='staging')return;const token=this.currentHeatmap.get(id);if(token)this.send({type:'heatmap-viewport',id:token,viewport});}
  subscribeOrderWalls(id:string,request:OrderWallRequest,callback:(e:Extract<Event,{type:'order-wall-batch'}>)=>void){const previous=this.currentOrderWalls.get(id);if(previous){this.orderWallListeners.delete(previous);this.send({type:'order-wall-unsubscribe',id:previous});}const token=`order-walls:${id}:${++this.sequence}`;this.currentOrderWalls.set(id,token);this.orderWallListeners.set(token,callback);this.send({type:'order-wall-subscribe',id:token,request});return ()=>{this.orderWallListeners.delete(token);if(this.currentOrderWalls.get(id)===token)this.currentOrderWalls.delete(id);this.send({type:'order-wall-unsubscribe',id:token});};}
  updateOrderWalls(id:string,settings:OrderWallsSettings){const token=this.currentOrderWalls.get(id);if(token)this.send({type:'order-wall-settings',id:token,settings});}
  updateOrderWallsViewport(id:string,from:number,to:number,autoPriceWidth?:number){const token=this.currentOrderWalls.get(id);if(token&&Number.isFinite(from)&&Number.isFinite(to)&&from<to)this.send({type:'order-wall-viewport',id:token,from,to,...(Number.isFinite(autoPriceWidth)?{autoPriceWidth}:{})});}
  subscribeNetPositioning(id:string,request:NetPositioningRequest,callback:(event:NetPositioningEvent)=>void){
    const previous=this.currentNetPositioning.get(id);if(previous){this.netPositioningListeners.delete(previous);this.send({type:'net-positioning-unsubscribe',id:previous});}
    const token=`net-positioning:${id}:${++this.sequence}`;this.currentNetPositioning.set(id,token);this.netPositioningListeners.set(token,callback);
    this.send({type:'net-positioning-subscribe',id:token,request});
    return ()=>{this.netPositioningListeners.delete(token);if(this.currentNetPositioning.get(id)===token)this.currentNetPositioning.delete(id);this.send({type:'net-positioning-unsubscribe',id:token});};
  }
  subscribeDepthMatrix(id:string,settings:DepthMatrixSettings,callback:(event:Extract<Event,{type:'depth-matrix-batch'}>)=>void){
    const previous=this.currentDepthMatrix.get(id);if(previous){this.depthMatrixListeners.delete(previous);this.send({type:'depth-matrix-unsubscribe',id:previous});}
    const token=`depth-matrix:${id}:${++this.sequence}`;this.currentDepthMatrix.set(id,token);this.depthMatrixListeners.set(token,callback);
    this.send({type:'depth-matrix-subscribe',id:token,settings});
    return ()=>{this.depthMatrixListeners.delete(token);if(this.currentDepthMatrix.get(id)===token)this.currentDepthMatrix.delete(id);this.send({type:'depth-matrix-unsubscribe',id:token});};
  }
  updateDepthMatrixSettings(id:string,settings:DepthMatrixSettings){const token=this.currentDepthMatrix.get(id);if(token)this.send({type:'depth-matrix-settings',id:token,settings});}
  updateDepthMatrixViewport(id:string,viewport:DepthMatrixViewport){const token=this.currentDepthMatrix.get(id);if(token)this.send({type:'depth-matrix-viewport',id:token,viewport});}
  retryDepthMatrix(){this.send({type:'depth-matrix-retry',id:'depth-matrix-retry'});}
  subscribeTpo(id:string,series:Series,settings:TpoIndicatorSettings,callback:(event:Extract<Event,{type:'tpo-snapshot'|'tpo-patch'|'tpo-status'}>)=>void){
    const previous=this.currentTpo.get(id);if(previous){this.tpoListeners.delete(previous);this.send({type:'tpo-unsubscribe',id:previous});}
    const token=`tpo:${id}:${++this.sequence}`;const key=`${connectionKey(series)}:${instrumentOf(series).native}:tpo:1m`;this.currentTpo.set(id,token);this.tpoListeners.set(token,{key,callback});
    this.send({type:'tpo-subscribe',id:token,series,settings});
    return ()=>{this.tpoListeners.delete(token);if(this.currentTpo.get(id)===token)this.currentTpo.delete(id);this.send({type:'tpo-unsubscribe',id:token});};
  }
  updateTpo(id:string,settings:TpoIndicatorSettings){const token=this.currentTpo.get(id);if(token)this.send({type:'tpo-settings',id:token,settings});}
  retryTpo(id:string){const token=this.currentTpo.get(id);if(token)this.send({type:'tpo-retry',id:token});}
  requestFootprintViewport(id:string,from:number,to:number){if(import.meta.env.VITE_DATA_MODE!=='staging')return;const token=this.currentFootprint.get(id);if(token)this.send({type:'footprint-viewport',id:token,from,to});}
  retryDepth(){this.send({type:'depth-retry'});}
  subscribeFootprint(id:string,series:Series,rowPrice:number,callback:(e:Event)=>void) {
    if(series.venue!=='binance')return ()=>{};
    if(!validFootprintRowPrice(rowPrice))throw new RangeError('Price level must be greater than $0 and no more than $10,000 USDT');
    const previous=this.currentFootprint.get(id);if(previous){this.footprintListeners.delete(previous);this.send({type:'footprint-unsubscribe',id:previous});}
    const token=`footprint:${id}:${++this.sequence}`;const key=footprintKeyOf(series,rowPrice);this.currentFootprint.set(id,token);this.footprintListeners.set(token,{key,callback});this.send({type:'footprint-subscribe',id:token,series,rowPrice});
    return ()=>{this.footprintListeners.delete(token);if(this.currentFootprint.get(id)===token)this.currentFootprint.delete(id);this.send({type:'footprint-unsubscribe',id:token});};
  }
  subscribeLiquidations(id:string,request:import('../liquidations/protocol').LiquidationRequest,callback:(e:import('../liquidations/protocol').LiquidationBatch)=>void){
    const old=this.liquidationTokens.get(id);if(old){this.liquidationListeners.delete(old);this.send({type:'liquidation-unsubscribe',id:old});}
    const token=`liquidation:${id}:${++this.sequence}`;this.liquidationTokens.set(id,token);this.liquidationListeners.set(token,callback);this.send({type:'liquidation-subscribe',id:token,request});
    return ()=>{this.liquidationListeners.delete(token);if(this.liquidationTokens.get(id)===token)this.liquidationTokens.delete(id);this.send({type:'liquidation-unsubscribe',id:token});};
  }
  updateLiquidations(id:string,request:import('../liquidations/protocol').LiquidationRequest){const token=this.liquidationTokens.get(id);if(token)this.send({type:'liquidation-update',id:token,request});}
  subscribeCvd(id:string,request:import('./cvd').CvdRequest,callback:(event:import('./cvd').CvdEvent)=>void){
    const old=this.currentCvd.get(id);if(old){this.cvdListeners.delete(old);this.send({type:'cvd-unsubscribe',id:old});}
    const token=`cvd:${id}:${++this.sequence}`;this.currentCvd.set(id,token);this.cvdListeners.set(token,callback);this.send({type:'cvd-subscribe',id:token,request});
    return ()=>{this.cvdListeners.delete(token);if(this.currentCvd.get(id)===token)this.currentCvd.delete(id);this.send({type:'cvd-unsubscribe',id:token});};
  }
  subscribeTicker(id:string,config:import('../ticker/model').TickerConfig,callback:(e:import('../ticker/model').TickerBatch)=>void) {
    const previous=this.currentTicker.get(id);if(previous){this.tickerListeners.delete(previous);this.send({type:'ticker-unsubscribe',id:previous});}
    const token=`ticker:${id}:${++this.sequence}`;this.currentTicker.set(id,token);this.tickerListeners.set(token,{revision:0,callback});this.send({type:'ticker-subscribe',id:token,configRevision:0,config});
    return ()=>{this.tickerListeners.delete(token);if(this.currentTicker.get(id)===token)this.currentTicker.delete(id);this.send({type:'ticker-unsubscribe',id:token});};
  }
  updateTicker(id:string,config:import('../ticker/model').TickerConfig) {const token=this.currentTicker.get(id);const listener=token&&this.tickerListeners.get(token);if(token&&listener){listener.revision++;this.send({type:'ticker-update',id:token,configRevision:listener.revision,config});}}
  subscribeTradeBubbles(id:string,request:import('./trade-bubbles-service').TradeBubbleRequest,callback:(event:import('../trade-bubbles/model').TradeBubbleBatch)=>void){
    const previous=this.currentTradeBubbles.get(id);if(previous){this.tradeBubbleListeners.delete(previous);this.send({type:'trade-bubbles-unsubscribe',id:previous});}
    const token=`trade-bubbles:${id}:${++this.sequence}`;this.currentTradeBubbles.set(id,token);this.tradeBubbleListeners.set(token,{revision:0,callback});
    this.send({type:'trade-bubbles-subscribe',id:token,configRevision:0,request});
    return ()=>{this.tradeBubbleListeners.delete(token);if(this.currentTradeBubbles.get(id)===token)this.currentTradeBubbles.delete(id);this.send({type:'trade-bubbles-unsubscribe',id:token});};
  }
  updateTradeBubbles(id:string,request:import('./trade-bubbles-service').TradeBubbleRequest){const token=this.currentTradeBubbles.get(id),listener=token&&this.tradeBubbleListeners.get(token);if(token&&listener){listener.revision++;this.send({type:'trade-bubbles-update',id:token,configRevision:listener.revision,request});}}
  retryTradeBubbles(){this.send({type:'trade-bubbles-retry',id:'trade-bubbles-retry'});}
  retryFootprint(){this.send({type:'footprint-retry'});}
  dispose(){for(const r of this.effortClaims.values()){clearTimeout(r.timer);r.resolve(false);}this.effortClaims.clear();for(const r of this.effortExports.values()){clearTimeout(r.timer);r.reject(new Error('Feed disposed'));}this.effortExports.clear();this.effortListeners.clear();for(const r of this.watchRequests.values()){clearTimeout(r.timer);r.reject(new Error('Feed disposed'));}this.watchRequests.clear();this.watchListeners.clear();this.worker.onmessage=null;this.liquidationListeners.clear();this.liquidationTokens.clear();this.tickerListeners.clear();this.currentTicker.clear();this.tradeBubbleListeners.clear();this.currentTradeBubbles.clear();this.listeners.clear();this.current.clear();this.depthListeners.clear();this.currentDepth.clear();this.footprintListeners.clear();this.currentFootprint.clear();this.heatmapListeners.clear();this.currentHeatmap.clear();this.orderWallListeners.clear();this.currentOrderWalls.clear();this.netPositioningListeners.clear();this.currentNetPositioning.clear();this.depthMatrixListeners.clear();this.currentDepthMatrix.clear();this.cvdListeners.clear();this.currentCvd.clear();this.tpoListeners.clear();this.currentTpo.clear();this.worker.terminate();}
}

function isFootprintBatch(event:Event):event is Extract<Event,{type:'footprint-status'|'footprint-snapshot'|'footprint-patch'}> {
  return event.type==='footprint-status'||event.type==='footprint-snapshot'||event.type==='footprint-patch';
}
