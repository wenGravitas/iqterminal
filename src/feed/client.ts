import { type Command, type Event, type Series, footprintKeyOf, keyOf, marketOf, validDepthBand, validFootprintRowPrice } from './protocol';
export class FeedClient {
  private sequence=0;private current=new Map<string,string>();private currentDepth=new Map<string,string>();private currentFootprint=new Map<string,string>();private worker:Worker;private listeners=new Map<string,{key:string;callback:(e:Event)=>void}>();private depthListeners=new Map<string,(e:Event)=>void>();private footprintListeners=new Map<string,{key:string;callback:(e:Event)=>void}>();
  diagnostics:Record<string,unknown>={};
  constructor(fixture=false, alignFixtureToNow=false) {
    // Explicit diagnostic build mode only, never automatic fallback.
    this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
    // Vite worker URL query isn't preserved consistently; fixture selected by command initialization below.
    if(fixture)this.worker.postMessage({type:'initFixture',alignToNow:alignFixtureToNow});
    this.worker.onmessage=(message:MessageEvent<Event>)=>{
      const e=message.data;
      if(e.type==='diagnostics'){this.diagnostics=e.data;return;}
      try {
        for(const id of e.ids){
          try {
            const l=this.listeners.get(id);if(l&&'key'in e&&l.key===e.key)l.callback(e);
            const depth=this.depthListeners.get(id);depth?.(e);
            const footprint=this.footprintListeners.get(id);if(footprint&&'key'in e&&footprint.key===e.key&&e.type.startsWith('footprint-'))footprint.callback(e);
          } catch(error) { console.error('Market data subscriber callback failed',error); }
        }
      } finally {
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
  retryDepth(){this.send({type:'depth-retry'});}
  subscribeFootprint(id:string,series:Series,rowPrice:number,callback:(e:Event)=>void) {
    if(series.venue!=='binance'||marketOf(series)!=='perpetual')return ()=>{};
    if(!validFootprintRowPrice(rowPrice))throw new RangeError('Price level must be greater than $0 and no more than $10,000 USDT');
    const previous=this.currentFootprint.get(id);if(previous){this.footprintListeners.delete(previous);this.send({type:'footprint-unsubscribe',id:previous});}
    const token=`footprint:${id}:${++this.sequence}`;const key=footprintKeyOf(series,rowPrice);this.currentFootprint.set(id,token);this.footprintListeners.set(token,{key,callback});this.send({type:'footprint-subscribe',id:token,series,rowPrice});
    return ()=>{this.footprintListeners.delete(token);if(this.currentFootprint.get(id)===token)this.currentFootprint.delete(id);this.send({type:'footprint-unsubscribe',id:token});};
  }
  retryFootprint(){this.send({type:'footprint-retry'});}
  dispose(){this.worker.onmessage=null;this.listeners.clear();this.current.clear();this.depthListeners.clear();this.currentDepth.clear();this.footprintListeners.clear();this.currentFootprint.clear();this.worker.terminate();}
}

function isFootprintBatch(event:Event):event is Extract<Event,{type:'footprint-status'|'footprint-snapshot'|'footprint-patch'}> {
  return event.type==='footprint-status'||event.type==='footprint-snapshot'||event.type==='footprint-patch';
}
