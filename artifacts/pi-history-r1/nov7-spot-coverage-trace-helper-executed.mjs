/** Cleanup budget only: never changes the chart's loading observation deadline. */
export async function finishResponseTraces(tasks,budgetMs=1000){
 let timer,timedOut=false;
 try{await Promise.race([Promise.allSettled(tasks),new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},budgetMs);})]);}
 finally{clearTimeout(timer);}
 return {timedOut,taskCount:tasks.length};
}
