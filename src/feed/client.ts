import { type Command, type Event, type Series, keyOf, validDepthBand } from './protocol';
export class FeedClient {
  private sequence=0;private current=new Map<string,string>();private currentDepth=new Map<string,string>();private worker:Worker;private listeners=new Map<string,{key:string;callback:(e:Event)=>void}>();private depthListeners=new Map<string,(e:Event)=>void>();
  diagnostics:Record<string,unknown>={};
  constructor(fixture=false, alignFixtureToNow=false) {
    // Explicit diagnostic build mode only, never automatic fallback.
    this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
    // Vite worker URL query isn't preserved consistently; fixture selected by command initialization below.
    if(fixture)this.worker.postMessage({type:'initFixture',alignToNow:alignFixtureToNow});
    this.worker.onmessage=(message:MessageEvent<Event>)=>{const e=message.data;if(e.type==='diagnostics'){this.diagnostics=e.data;return;}for(const id of e.ids){const l=this.listeners.get(id);if(l&&'key'in e&&l.key===e.key)l.callback(e);const depth=this.depthListeners.get(id);depth?.(e);}};
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
  dispose(){this.listeners.clear();this.current.clear();this.depthListeners.clear();this.currentDepth.clear();this.worker.terminate();}
}
