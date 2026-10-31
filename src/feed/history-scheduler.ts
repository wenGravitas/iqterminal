export type HistoryLayer = 'footprint' | 'heatmap' | 'cvd' | 'liquidations' | 'comparison';
type Consumer<T> = {resolve:(value:T)=>void;reject:(reason:unknown)=>void;signal:AbortSignal;cancel:()=>void};
type Work<T> = {key:string;layer:HistoryLayer;priority:number;queued:number;abort:AbortController;run:(signal:AbortSignal)=>Promise<T>;consumers:Set<Consumer<T>>;started?:number};
/** Shared admission for history reads. Equal-priority layers alternate; cancelling
 * a panel releases only that panel's reference to a coalesced request. */
export class HistoryScheduler {
 private work=new Map<string,Work<any>>();private active=0;private last?:HistoryLayer;
 readonly metrics={submitted:0,coalesced:0,cancelled:0,completed:0,failed:0,peakActive:0,queueMs:0,runMs:0};
 constructor(readonly concurrency=2,private clock=()=>performance.now()){if(concurrency<1||concurrency>4)throw Error('History concurrency must be bounded');}
 read<T>(key:string,layer:HistoryLayer,signal:AbortSignal,run:(signal:AbortSignal)=>Promise<T>,priority=0):Promise<T>{
  if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
  let w=this.work.get(key) as Work<T>|undefined;
  if(!w){w={key,layer,priority,queued:this.clock(),abort:new AbortController(),run,consumers:new Set()};this.work.set(key,w);this.metrics.submitted++;}
  else{w.priority=Math.min(w.priority,priority);this.metrics.coalesced++;}
  const work=w;
  const promise=new Promise<T>((resolve,reject)=>{const consumer:Consumer<T>={resolve,reject,signal,cancel:()=>{work.consumers.delete(consumer);signal.removeEventListener('abort',consumer.cancel);this.metrics.cancelled++;reject(new DOMException('Aborted','AbortError'));if(!work.consumers.size){work.abort.abort();if(this.work.get(key)===work)this.work.delete(key);}this.pump();}};work.consumers.add(consumer);signal.addEventListener('abort',consumer.cancel,{once:true});});
  this.pump();return promise;
 }
 private pump(){while(this.active<this.concurrency){const candidates=[...this.work.values()].filter(w=>w.started===undefined&&w.consumers.size).sort((a,b)=>a.priority-b.priority||Number(a.layer===this.last)-Number(b.layer===this.last)||a.queued-b.queued);const w=candidates[0];if(!w)return;w.started=this.clock();this.last=w.layer;this.active++;this.metrics.peakActive=Math.max(this.metrics.peakActive,this.active);this.metrics.queueMs+=w.started-w.queued;
  void Promise.resolve().then(()=>w.run(w.abort.signal)).then(value=>{this.metrics.completed++;for(const c of w.consumers)c.resolve(value);},error=>{this.metrics.failed++;for(const c of w.consumers)c.reject(error);}).finally(()=>{for(const c of w.consumers)c.signal.removeEventListener('abort',c.cancel);this.metrics.runMs+=this.clock()-w.started!;if(this.work.get(w.key)===w)this.work.delete(w.key);this.active--;this.pump();});
 }}
 diagnostics(){return {...this.metrics,active:this.active,queued:[...this.work.values()].filter(w=>w.started===undefined).length};}
}
export const historyScheduler=new HistoryScheduler();
