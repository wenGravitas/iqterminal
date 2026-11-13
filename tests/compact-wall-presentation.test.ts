import {test,expect,vi} from 'vitest';
import {compactWallPresentation,replayCompactWallPresentation} from '../src/feed/compact-wall-presentation';
import type {OrderWallSegment} from '../src/shared/order-walls-projection';
const segment=(id:string,count=20):OrderWallSegment=>({id,archiveEntryId:'entry-'+id,epoch:1,side:'bid',price:100.00000001,priceExact:'100.00000001',start:1800000000000,end:null,peakUsd:200,meanUsd:190,durationMs:1000,percentile:null,scopePartial:true,startKnown:false,endKnown:false,detectionMode:'top-levels',rank:1,valueRunsTruncated:false,endReason:null,valueRuns:Array.from({length:count},(_,i)=>({at:1800000000000+i,quantity:2.000000000001,quantityExact:'2.000000000001',usd:200.0000000001,notionalExact:'200.0000000001',rank:i%8+1,percentile:null}))});
test('compact presentation round-trips every point, metadata and ordering across fragment/chunk boundaries',async()=>{
 const rows=Array.from({length:200},(_,i)=>({...segment(String(i),i===3?1000:20),...(i%2?{end:1800000003000,endKnown:true,endReason:'removed' as const}:{})}));
 const data=await compactWallPresentation('exact-profile-view',rows,new AbortController().signal),received:OrderWallSegment[]=[];
 expect(data.chunks.length).toBeGreaterThan(1);expect(data.retainedBytes).toBeLessThan(16*1024*1024);
 await replayCompactWallPresentation(data,'exact-profile-view',new AbortController().signal,part=>received.push(...part));
 expect(received).toEqual(rows);expect(data.runs).toBe(rows.reduce((n,s)=>n+s.valueRuns.length,0));expect(received[3]!.valueRuns).toHaveLength(1000);
});
test('zero-point and empty presentations remain exact rather than fabricating a wall',async()=>{
 for(const rows of [[],[segment('zero',0)]]){const data=await compactWallPresentation('empty',rows,new AbortController().signal),received:OrderWallSegment[]=[];await replayCompactWallPresentation(data,'empty',new AbortController().signal,x=>received.push(...x));expect(received).toEqual(rows);}
});
test('wrong view, corrupted compressed bytes and inconsistent totals cannot certify a cached snapshot',async()=>{
 const data=await compactWallPresentation('pinned',[segment('one')],new AbortController().signal);let published=0;
 await expect(replayCompactWallPresentation(data,'different-profile',new AbortController().signal,()=>published++)).rejects.toThrow(/identity/);expect(published).toBe(0);
 const broken=structuredClone(data);broken.chunks[0]!.body[broken.chunks[0]!.body.length-1]^=255;
 await expect(replayCompactWallPresentation(broken,'pinned',new AbortController().signal,()=>published++)).rejects.toThrow();expect(published).toBe(0);
 await expect(replayCompactWallPresentation({...data,runs:data.runs+1},'pinned',new AbortController().signal,()=>{})).rejects.toThrow(/coverage/);
});
test('encoding cancellation yields to other work and replay cancellation never emits a later chunk',async()=>{
 const input=Array.from({length:500},(_,i)=>segment(String(i))),build=new AbortController();const encoding=compactWallPresentation('cancel',input,build.signal);setTimeout(()=>build.abort(),0);await expect(encoding).rejects.toThrow(/abort/i);
 const data=await compactWallPresentation('cancel',input,new AbortController().signal),read=new AbortController();let callbacks=0;
 await expect(replayCompactWallPresentation(data,'cancel',read.signal,()=>{callbacks++;read.abort();})).rejects.toThrow(/abort/i);expect(callbacks).toBe(1);
});

test('oversized exact decimal metadata misses the optional cache before whole-array serialization',async()=>{
 const row=segment('large-exact',256);row.valueRuns[0]!.quantityExact='2.'+'0'.repeat(300000);row.valueRuns[0]!.quantity=2;
 await expect(compactWallPresentation('bounded-input',[row],new AbortController().signal)).rejects.toThrow(/capacity/);
 expect(row.valueRuns).toHaveLength(256);expect(row.valueRuns[0]!.quantityExact).toHaveLength(300002);
});

test('optional encoding schedules background slices while cached visible replay schedules visible slices',async()=>{
 const priorities:string[]=[],postTask=vi.fn(async(callback:()=>void,options:{priority:string})=>{priorities.push(options.priority);callback();});vi.stubGlobal('scheduler',{postTask});
 try{
  const rows=[segment('priority',600)],signal=new AbortController().signal,data=await compactWallPresentation('priority',rows,signal);
  expect(priorities.length).toBeGreaterThan(1);expect(new Set(priorities)).toEqual(new Set(['background']));priorities.length=0;
  const restored:OrderWallSegment[]=[];await replayCompactWallPresentation(data,'priority',signal,s=>restored.push(...s));expect(restored).toEqual(rows);
  expect(priorities.length).toBe(data.chunks.length);expect(new Set(priorities)).toEqual(new Set(['user-visible']));
 }finally{vi.unstubAllGlobals();}
});

test('canceling the queued background start does not serialize optional cache data',async()=>{
 let touched=0;const row=segment('queued'),points=row.valueRuns;Object.defineProperty(row,'valueRuns',{get(){touched++;return points;},enumerable:true});
 vi.stubGlobal('scheduler',{postTask:(_callback:()=>void,{signal}:{signal:AbortSignal})=>new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
 try{const control=new AbortController(),build=compactWallPresentation('queued',[row],control.signal);expect(touched).toBe(0);control.abort();await expect(build).rejects.toMatchObject({name:'AbortError'});expect(touched).toBe(0);}
 finally{vi.unstubAllGlobals();}
});
