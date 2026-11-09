/** Cooperatively resume bounded history slices. Visible imports share normal
 * task priority; optional cache preparation stays behind visible/current work.
 * No persistent channel, worker or queue is owned by this helper. */
export type HistoryTaskPriority='user-visible'|'background';
interface TaskScheduler {
 postTask(callback:()=>void,options:{priority:HistoryTaskPriority;signal?:AbortSignal}):Promise<void>;
}
export function yieldHistoryTask(signal?:AbortSignal,priority:HistoryTaskPriority='background'):Promise<void>{
 if(signal?.aborted)return Promise.reject(signal.reason);
 const scheduler=(globalThis as unknown as {scheduler?:TaskScheduler}).scheduler;
 if(typeof scheduler?.postTask==='function')return scheduler.postTask(()=>{}, {priority,...(signal?{signal}:{})});
 return new Promise<void>((resolve,reject)=>{
  const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal?.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},0);
  signal?.addEventListener('abort',cancel,{once:true});
 });
}

export function historyTaskYieldMode(priority:HistoryTaskPriority='background'){
 return typeof (globalThis as unknown as {scheduler?:TaskScheduler}).scheduler?.postTask==='function'?priority+'-post-task':'timer-fallback';
}
