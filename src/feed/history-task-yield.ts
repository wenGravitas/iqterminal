/** Cooperatively resume history behind normal current/input tasks. Native
 * background tasks avoid chained zero-delay timer clamping where supported.
 * No persistent channel, worker or queue is owned by this helper. */
interface BackgroundScheduler {
 postTask(callback:()=>void,options:{priority:'background';signal?:AbortSignal}):Promise<void>;
}
export function yieldHistoryTask(signal?:AbortSignal):Promise<void>{
 if(signal?.aborted)return Promise.reject(signal.reason);
 const scheduler=(globalThis as unknown as {scheduler?:BackgroundScheduler}).scheduler;
 if(typeof scheduler?.postTask==='function')return scheduler.postTask(()=>{}, {priority:'background',...(signal?{signal}:{})});
 return new Promise<void>((resolve,reject)=>{
  const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal?.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},0);
  signal?.addEventListener('abort',cancel,{once:true});
 });
}

export function historyTaskYieldMode(){
 return typeof (globalThis as unknown as {scheduler?:BackgroundScheduler}).scheduler?.postTask==='function'?'background-post-task':'timer-fallback';
}
