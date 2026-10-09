import { type Command, type Event, type Series, keyOf } from './protocol';
export class FeedClient {
  private sequence=0;private current=new Map<string,string>();private worker:Worker;private listeners=new Map<string,{key:string;callback:(e:Event)=>void}>();
  diagnostics:Record<string,unknown>={};
  constructor(fixture=false) {
    // Explicit diagnostic build mode only, never automatic fallback.
    this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
    // Vite worker URL query isn't preserved consistently; fixture selected by command initialization below.
    if(fixture)this.worker.postMessage({type:'initFixture'});
    this.worker.onmessage=(message:MessageEvent<Event>)=>{const e=message.data;if(e.type==='diagnostics'){this.diagnostics=e.data;return;}for(const id of e.ids){const l=this.listeners.get(id);if(l?.key===e.key)l.callback(e);}};
  }
  send(c:Command){this.worker.postMessage(c);}
  retry(id:string){const token=this.current.get(id);if(token)this.send({type:'retry',id:token});}
  subscribe(id:string,s:Series,callback:(e:Event)=>void) {
    const previous=this.current.get(id);if(previous){this.listeners.delete(previous);this.send({type:'unsubscribe',id:previous});}
    const token=`${id}:${++this.sequence}`;this.current.set(id,token);this.listeners.set(token,{key:keyOf(s),callback});this.send({type:'subscribe',id:token,series:s});
    return ()=>{this.listeners.delete(token);if(this.current.get(id)===token)this.current.delete(id);this.send({type:'unsubscribe',id:token});};
  }
  dispose(){this.listeners.clear();this.current.clear();this.worker.terminate();}
}
