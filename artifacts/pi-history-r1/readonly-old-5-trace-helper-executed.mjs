/** Cleanup budget only: never changes the chart's loading observation deadline. */
export async function finishResponseTraces(tasks,budgetMs=1000){
 let timer,timedOut=false;
 try{await Promise.race([Promise.allSettled(tasks),new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},budgetMs);})]);}
 finally{clearTimeout(timer);}
 return {timedOut,taskCount:tasks.length};
}

/** Closed history is not the stopping condition for a current-display sample. */
export function loadingObservationComplete({currentCase,currentAt,completeAt,keepObserving=false,coverageReady=true,requireCurrentAndHistory=false}){
 if(requireCurrentAndHistory)return !keepObserving&&currentAt!==null&&completeAt!==null&&coverageReady;
 return !keepObserving&&(currentCase?currentAt!==null:completeAt!==null&&coverageReady);
}

/** Inspect every eligible native closed slot; endpoints/counts cannot prove holes absent. */
export function nativeClosedCoverage(times,{from,to},step,closed){
 const end=Math.min(to,closed),count=Math.max(0,Math.ceil((end-from)/step));
 if(!Number.isSafeInteger(count)||count>5000||!Number.isFinite(step)||step<=0)return {valid:false,capacityLimited:true,requestedSlots:count,loadedSlots:0,missing:[]};
 const present=new Set(times),missing=[];let loadedSlots=0;
 for(let t=from;t<end;t+=step){if(present.has(t))loadedSlots++;else missing.push(t);}
 return {valid:missing.length===0,capacityLimited:false,from,to:end,requestedSlots:count,loadedSlots,missing};
}
