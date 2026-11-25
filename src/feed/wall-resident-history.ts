import type {OrderWallArchiveStatus,OrderWallSegment} from './order-walls';
import {ORDER_WALL_ARCHIVE_MAX_SEGMENTS,ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS} from './order-walls';

export interface WallInterval {from:number;to:number}
export interface ResidentWallChunk extends WallInterval {
  /** Independently validated request/source revision; never inferred from overlap. */
  key:string;revision:string;sourceToken?:string;keepIds?:boolean;
  status:OrderWallArchiveStatus;
  segments:ReadonlyMap<string,OrderWallSegment>;
}
interface Entry {display:ReadonlyMap<string,OrderWallSegment>;chunk:ResidentWallChunk;segments:number;runs:number;bytes:number;used:number}
export interface ResidentWallLimits {chunks:number;segments:number;runs:number;bytes:number}
/** Same financial record caps as one archive projection. Chunks share that
 * allowance, not an allowance per chunk. Bytes are a conservative accounting
 * estimate (256/run +512/header), not a claim about measured JS heap. */
export const WALL_RESIDENT_LIMITS:ResidentWallLimits={chunks:8,segments:ORDER_WALL_ARCHIVE_MAX_SEGMENTS,runs:ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS,
 bytes:ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS*256+ORDER_WALL_ARCHIVE_MAX_SEGMENTS*512};
const valid=(range:WallInterval)=>Number.isSafeInteger(range.from)&&Number.isSafeInteger(range.to)&&range.from>=0&&range.to>range.from;
const intersects=(a:WallInterval,b:WallInterval)=>a.from<b.to&&b.from<a.to;

/** Per-subscription ownership of disjoint, independently fenced presentations.
 * It does not merge episodes or source proofs. Complete chunks are the unit of
 * eviction, and admission is atomic: failure cannot evict already visible data.
 * Geometry fragments are produced separately, retaining their original exact
 * financial records and validated interval scope. */
export class WallResidentHistory {
 private readonly entries=new Map<string,Entry>();private clock=0;
 constructor(readonly limits:ResidentWallLimits=WALL_RESIDENT_LIMITS){
  if(Object.values(limits).some(n=>!Number.isSafeInteger(n)||n<1)||limits.chunks>64)throw Error('Invalid resident wall limits');
 }
 get chunks(){return [...this.entries.values()].map(entry=>entry.chunk).sort((a,b)=>a.from-b.from);}
 get size(){return this.entries.size;}
 presentation(){const result=new Map<string,OrderWallSegment>();for(const entry of this.entries.values())for(const [id,segment]of entry.display)result.set(id,segment);return result;}

 diagnostics(){let segments=0,runs=0,bytes=0;for(const entry of this.entries.values()){segments+=entry.segments;runs+=entry.runs;bytes+=entry.bytes;}return {chunks:this.entries.size,segments,runs,bytes,limits:this.limits};}
 clear(){this.entries.clear();}
 touch(view:WallInterval){for(const entry of this.entries.values())if(intersects(entry.chunk,view))entry.used=++this.clock;}
 /** Returned intervals are unknown/unloaded, not confirmed absence of walls.
  * Known source gaps stay owned by their validated chunk and are never filled
  * by a neighbouring episode. */
 missing(view:WallInterval):WallInterval[]{
  if(!valid(view))throw Error('Invalid resident wall viewport');
  let at=view.from;const missing:WallInterval[]=[];
  for(const chunk of this.chunks){if(chunk.to<=at)continue;if(chunk.from>=view.to)break;
   if(chunk.from>at)missing.push({from:at,to:Math.min(chunk.from,view.to)});at=Math.max(at,chunk.to);if(at>=view.to)break;}
  if(at<view.to)missing.push({from:at,to:view.to});return missing;
 }
 /** Invalidation is explicit and whole-owned-chunk. A source correction cannot
  * leave a partially authenticated old fragment advertised as current. */
 invalidate(range:WallInterval){const removed:ResidentWallChunk[]=[];for(const [key,entry]of this.entries)if(intersects(entry.chunk,range)){removed.push(entry.chunk);this.entries.delete(key);}return removed;}
 admit(chunk:ResidentWallChunk,visible:WallInterval){return this.admitOwned(chunk,visible,false);}
 /** Extend only an identical validated native presentation into newly selected
  * adjacent ownership. Failed admission leaves the prior scope intact. */
 expand(chunk:ResidentWallChunk,visible:WallInterval){return this.admitOwned(chunk,visible,true);}
 private admitOwned(chunk:ResidentWallChunk,visible:WallInterval,expand:boolean):{ok:true;removed:ResidentWallChunk[]}|{ok:false;reason:'invalid'|'overlap'|'capacity'}{
  const a=chunk.status;
  if(!valid(chunk)||!valid(visible)||!chunk.key||!chunk.revision||!a.exact||!a.requestComplete||a.from>chunk.from
    ||Math.min(a.to,a.eligibleTo??a.to)<chunk.to||a.state==='loading'||a.state==='building'||a.state==='unavailable')return {ok:false,reason:'invalid'};
  const old=this.entries.get(chunk.key);
  // Same-range replacement is an explicit revision operation. General overlap
  // requires invalidation/repartitioning; silently unioning it is forbidden.
  if(expand&&(!old||chunk.from>old.chunk.from||chunk.to<old.chunk.to||!chunk.sourceToken||chunk.revision!==old.chunk.revision||chunk.sourceToken!==old.chunk.sourceToken||chunk.segments!==old.chunk.segments||chunk.status!==old.chunk.status))return {ok:false,reason:'overlap'};
  if(old&&(old.chunk.from!==chunk.from||old.chunk.to!==chunk.to)&&!expand)return {ok:false,reason:'overlap'};
  for(const entry of this.entries.values())if(entry!==old&&intersects(entry.chunk,chunk))return {ok:false,reason:'overlap'};
  let runs=0;for(const segment of chunk.segments.values())runs+=segment.valueRuns.length;
  if(chunk.segments.size>this.limits.segments||runs>this.limits.runs||runs*256+chunk.segments.size*512>this.limits.bytes)return {ok:false,reason:'capacity'};
  const display=new Map<string,OrderWallSegment>();for(const segment of chunk.segments.values()){
    const id=chunk.keepIds?segment.id:`resident:${JSON.stringify([chunk.key,segment.id])}`;
    if([...this.entries.values()].some(entry=>entry!==old&&entry.display.has(id)))return {ok:false,reason:'invalid'};
    display.set(id,{...segment,id,currentSelection:false,residentRange:{from:chunk.from,to:chunk.to,sourceId:segment.id,revision:chunk.revision}});
  }
  const next:Entry={display,chunk,segments:chunk.segments.size,runs,bytes:runs*256+chunk.segments.size*512,used:++this.clock};
  const candidates=[...this.entries.values()].filter(entry=>entry!==old),removed=old?[old.chunk]:[];
  const fits=()=>{const total=candidates.reduce((n,e)=>({segments:n.segments+e.segments,runs:n.runs+e.runs,bytes:n.bytes+e.bytes}),{segments:next.segments,runs:next.runs,bytes:next.bytes});return candidates.length+1<=this.limits.chunks&&total.segments<=this.limits.segments&&total.runs<=this.limits.runs&&total.bytes<=this.limits.bytes;};
  const evictable=candidates.filter(entry=>!intersects(entry.chunk,visible)).sort((a,b)=>a.used-b.used);
  while(!fits()){const entry=evictable.shift();if(!entry)return {ok:false,reason:'capacity'};candidates.splice(candidates.indexOf(entry),1);removed.push(entry.chunk);}
  for(const entry of removed)this.entries.delete(entry.key);this.entries.set(chunk.key,next);this.touch(visible);return {ok:true,removed};
 }
}

/** Bounded acquisition padding with a central hysteresis region. Time padding
 * does not reserve data or override the record/byte admission limits above. */
export function wallResidentOverscan(view:WallInterval,intervalMs:number):WallInterval{
 if(!valid(view)||!Number.isSafeInteger(intervalMs)||intervalMs<1)throw Error('Invalid wall overscan input');
 const padding=Math.min(3600000,Math.max(intervalMs*2,Math.ceil((view.to-view.from)*.1)));
 return {from:Math.max(0,view.from-padding),to:view.to+padding};
}
