import type {OrderWallSegment} from '../shared/order-walls-projection';
const detached=(segment:OrderWallSegment):OrderWallSegment=>({...segment,valueRuns:segment.valueRuns.map(point=>({...point}))});
/** Prepared closed records are immutable presentation inputs, detached during
 * projector restore. Active replay records can be censored before admission;
 * copy their current financial state, never an earlier raw active checkpoint.
 * Canonical fallback owns mutable rows and therefore detaches all its points.
 * No projector, cursor, candidates or retention queues belong in this cache. */
export function wallHistoryPresentation(segments:readonly OrderWallSegment[],prepared?:ReadonlyMap<string,OrderWallSegment>):ReadonlyMap<string,OrderWallSegment>|undefined{
 if(prepared&&(prepared.size!==segments.length||segments.some(segment=>!prepared.has(segment.id))))return;
 return new Map(segments.map(segment=>{
  const raw=prepared?.get(segment.id);
  return [segment.id,raw&&raw.end!==null?raw:detached(segment)];
 }));
}
