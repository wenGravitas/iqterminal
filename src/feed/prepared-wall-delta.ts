import type{OrderWallSegment,OrderWallPatch}from'./order-walls';
import{yieldHistoryTask}from'./history-task-yield';
export interface PreparedWallBase {revision:string;through:number;presentation:ReadonlyMap<string,OrderWallSegment>}
export interface PreparedWallDelta {baseRevision:string;baseCount:number;baseThrough:number;patches:OrderWallPatch[];comparedSegments:number;comparedValueRuns:number;elapsedMs:number;yieldMs:number}
/** One completion-only, exact reconciliation. Keep whole-union validation in the
 * importer; this only avoids retransferring unchanged validated rows to the UI.
 * A widespread correction falls back to the existing complete snapshot. */
export async function preparedWallDelta(base:PreparedWallBase,next:ReadonlyMap<string,OrderWallSegment>,signal:AbortSignal):Promise<PreparedWallDelta|undefined>{
 const started=performance.now();let yielded=started,work=0,yieldMs=0,comparedSegments=0,comparedValueRuns=0;const patches:OrderWallPatch[]=[];
 const checkpoint=async()=>{signal.throwIfAborted();if(++work%128===0&&performance.now()-yielded>=8){const at=performance.now();await yieldHistoryTask(signal,'user-visible');yieldMs+=performance.now()-at;yielded=performance.now();}};
 for(const [id]of base.presentation){if(!next.has(id))patches.push({id,segment:null});if(patches.length>4096){signal.throwIfAborted();return;}await checkpoint();}
 for(const [id,segment]of next){comparedSegments++;const old=base.presentation.get(id);let same=old!==undefined;
  if(old){const keys=Object.keys(segment) as Array<keyof OrderWallSegment>;same=keys.length===Object.keys(old).length&&keys.every(k=>k==='valueRuns'||segment[k]===old[k]);
   if(same){same=segment.valueRuns.length===old.valueRuns.length;
    if(same)for(let i=0;i<segment.valueRuns.length;i++){const a=segment.valueRuns[i]!,b=old.valueRuns[i]!;comparedValueRuns++;if(a!==b){const keys=Object.keys(a) as Array<keyof typeof a>;if(keys.length!==Object.keys(b).length||keys.some(k=>a[k]!==b[k])){same=false;break;}}await checkpoint();}
   }
  }
  if(!same)patches.push({id,segment,replaceValueRuns:true});if(patches.length>4096){signal.throwIfAborted();return;}await checkpoint();
 }
 signal.throwIfAborted();return{baseRevision:base.revision,baseCount:base.presentation.size,baseThrough:base.through,patches,comparedSegments,comparedValueRuns,elapsedMs:performance.now()-started,yieldMs};
}
