import {describe,it,expect} from 'vitest';
import {OrderWallRankIndex} from '../src/feed/order-wall-rank';
import {OrderWallDetector,DEFAULT_ORDER_WALLS_SETTINGS,orderWallsSettings,orderWallValuePointAt,type OrderWallDepthRecord,type OrderWallsSettings} from '../src/feed/order-walls';
import {nativeInstance,validateInstances} from '../src/indicators/model';
const base=1800000000000;
const settings=(v:Partial<OrderWallsSettings>={})=>orderWallsSettings({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,...v});
const row=(cursor:number,bids:readonly (readonly[number,number])[]=[],asks:readonly (readonly[number,number])[]=[],kind:OrderWallDepthRecord['kind']='delta'):OrderWallDepthRecord=>({kind,cursor,at:base+cursor*100,epoch:1,bids,asks,bookScope:{bidComplete:true,askComplete:true}});
const active=(d:OrderWallDetector)=>d.snapshot().filter(s=>s.end===null);
function detector(v:Partial<OrderWallsSettings>={}){return new OrderWallDetector(settings(v),.1,50);}
describe('Top Levels ranking and episodes',()=>{
 it('defaults to native Top 8; migrates old instances to Threshold Walls',()=>{
  expect(orderWallsSettings(undefined)).toMatchObject({mode:'top-levels',topLevels:8,aggregation:'native',highContrast:true,visibleRangeOnly:true,minimumNotionalEnabled:false});
  expect(orderWallsSettings({method:'relative',aggregation:'auto'})).toMatchObject({mode:'threshold',aggregation:'auto'});
  expect(orderWallsSettings({mode:'top-levels',aggregation:'auto',topLevels:99})).toMatchObject({aggregation:'native',topLevels:8});
  const old=nativeInstance('native.order-walls',{});old.settingsVersion=1;old.settings={method:'absolute',thresholdUsd:12345,aggregation:50};
  expect(validateInstances([old])[0]).toMatchObject({settingsVersion:2,settings:{mode:'threshold',thresholdUsd:12345,aggregation:50}});
 });
 it('preserves adjacent native cent levels at real BTC magnitudes without a floating-point crossed book',()=>{
  for(const bid of [80258.84,80125.09,80000.01,100000.12]){
   const ask=Number((bid+.01).toFixed(2)),d=new OrderWallDetector(settings({topLevels:8}),.01);
   d.processBatch([row(1,[[bid,1]],[[ask,1]],'snapshot')]);
   expect(active(d).map(s=>s.price)).toEqual([bid,ask]);expect(d.status(base,base+100).rankingScope?.mid).toBe((bid+ask)/2);
  }
 });
 it('keeps retained value/rank changes exact and visibly marks bounded-history eviction as unknown',()=>{
  const d=detector({topLevels:1});d.processBatch([row(1,[[99,10]],[[101,10]],'snapshot')]);
  for(let i=2;i<=2100;i++)d.processBatch([row(i,[[99,10+i/1000]])]);
  const bid=active(d).find(s=>s.side==='bid')!;
  expect(bid.valueRuns).toHaveLength(2048);expect(bid.valueRunsTruncated).toBe(true);
  expect(orderWallValuePointAt(bid,bid.start)).toBeNull();
  expect(bid.valueRuns.at(-1)).toMatchObject({rank:1,quantity:12.1,usd:99*12.1});
  expect(d.status(base,base+300000)).toMatchObject({valueHistoryLimited:true,coverage:{complete:false,partial:true}});
 });
 it('ranks sides independently with deterministic ascending-price tie breaks',()=>{
  const d=detector({topLevels:2});d.processBatch([row(1,[[100,96],[99,100],[96,100]],[[102,3],[104,100],[105,100]],'snapshot')]);
  expect(active(d).filter(s=>s.side==='bid').map(s=>[s.price,s.rank])).toEqual([[99,1],[96,2]]);
  expect(active(d).filter(s=>s.side==='ask').map(s=>[s.price,s.rank])).toEqual([[105,1],[104,2]]);
 });
 it('retains episode identity for promotion, demotion, increases and decreases',()=>{
  const d=detector({topLevels:2});d.processBatch([row(1,[[99,10],[98,9]],[[101,10]],'snapshot')]);
  const before=active(d).find(s=>s.price===99)!;
  d.processBatch([row(2,[[98,20]]),row(3,[[99,11]]),row(4,[[99,8]])]);
  const after=active(d).find(s=>s.price===99)!;
  expect(after.id).toBe(before.id);expect(after.valueRuns.map(p=>[p.rank,p.usd,p.quantity])).toEqual([[1,990,10],[2,990,10],[2,1089,11],[2,792,8]]);
  expect(orderWallValuePointAt(after,base+250)?.usd).toBe(990);
 });
 it('ends a ranking episode without claiming a removal and creates a distinct re-entry',()=>{
  const d=detector({topLevels:1});d.processBatch([row(1,[[99,10],[98,9]],[[101,10]],'snapshot')]);
  const first=active(d).find(s=>s.side==='bid')!;
  d.processBatch([row(2,[[98,20]])]);
  const exit=d.snapshot().find(s=>s.id===first.id)!;
  expect(exit).toMatchObject({end:base+200,endReason:'rank-exit',endKnown:true});expect(exit.valueRuns.at(-1)).toMatchObject({usd:990,quantity:10,rank:null});
  d.processBatch([row(3,[[98,1]])]);expect(active(d).find(s=>s.price===99)?.id).not.toBe(first.id);
  d.processBatch([row(4,[[99,0]])]);expect(d.snapshot().find(s=>s.price===99&&s.end===base+400)?.endReason).toBe('removed');
 });
 it('ends positive liquidity as a range exit when the contemporaneous mid moves, not as a removal',()=>{
  const d=new OrderWallDetector(settings({topLevels:1,searchRangePercent:1}),.01);
  d.processBatch([row(1,[[99,10]],[[101,10]],'snapshot')]);const id=active(d).find(s=>s.side==='bid')!.id;
  d.processBatch([row(2,[[100.99,.01]],[[101,0],[101.01,1]])]);
  expect(d.snapshot().find(s=>s.id===id)).toMatchObject({endReason:'out-of-range',endKnown:true});
 });
 it('uses contemporaneous mid, range and optional minimum without looking ahead',()=>{
  const d=detector({topLevels:8,searchRangePercent:2,minimumNotionalEnabled:true,minimumNotionalUsd:500});
  d.processBatch([row(1,[[99,10],[95,1000],[98,1]],[[101,10],[105,1000]],'snapshot')]);
  expect(active(d).map(s=>s.price)).toEqual([99,101]);
  const id=active(d)[0]!.id;d.processBatch([row(2,[[99,4]])]);expect(d.snapshot().find(s=>s.id===id)?.endReason).toBe('below-minimum');
 });
 it('aggregates actual quote notional and base quantity identically regardless of Auto width',()=>{
  const a=detector({aggregation:10,topLevels:1}),b=detector({aggregation:10,topLevels:1});b.setAutoPriceWidth(100);
  const records=[row(1,[[99,10],[98,20],[90,1]],[[101,5],[102,10]],'snapshot'),row(2,[[98,25]])];
  a.processBatch(records);for(const record of records)b.processBatch([record]);
  expect(a.snapshot()).toEqual(b.snapshot());expect(active(a).find(s=>s.side==='bid')?.valueRuns.at(-1)).toMatchObject({usd:3530,quantity:36});
  expect(active(a).find(s=>s.side==='ask')?.valueRuns.at(-1)).toMatchObject({usd:1525,quantity:15});
 });
 it('censors gaps, snapshots and unknown coverage rather than manufacturing zero liquidity',()=>{
  const d=detector({topLevels:1});d.processBatch([row(1,[[99,10],[98,9]],[[101,10]],'snapshot')]);
  d.processBatch([{...row(2,[[99,0]],[[101,10]],'checkpoint'),bookScope:{bidComplete:false,askComplete:false,bidFloor:100,askCeiling:102}}]);
  expect(d.snapshot().find(s=>s.price===99)).toMatchObject({endReason:'censored',endKnown:false,end:base+100});
  expect(d.status(base,base+200)).toMatchObject({state:'stale',coverage:{complete:false,partial:true}});
  d.processBatch([row(3,[[99,10]],[[101,10]],'snapshot'),{...row(4),kind:'gap',reason:'fixture gap'}]);
  expect(active(d)).toHaveLength(0);expect(d.snapshot().at(-1)?.endReason).toBe('censored');
  d.processBatch([{...row(5,[[99,10]],[[101,10]],'snapshot'),epoch:2}]);expect(active(d).every(s=>s.epoch===2&&s.startKnown===false)).toBe(true);
 });
 it('censors a selected price evicted by the bounded local book, including at a checkpoint',()=>{
  const d=new OrderWallDetector(settings({topLevels:1}),.0001);
  d.processBatch([row(1,[[99,1000],[98,1]],[[101,1]],'snapshot')]);
  const id=active(d).find(s=>s.side==='bid')!.id;
  const many=Array.from({length:5001},(_,i)=>[100-i*.0001,1] as const);
  // Tick-valid prices on a finer-resolution source; the old selected level is outside the retained nearest 5000.
  d.processBatch([{...row(2,[...many,[99,1000]],[[101,1]],'checkpoint'),bookScope:{bidComplete:true,askComplete:true}}]);
  expect(d.snapshot().find(s=>s.id===id)).toMatchObject({endReason:'censored',endKnown:false,end:base+100});
 });
 it('ranks explicitly observed outer levels while still declaring the wider search partial',()=>{
  const d=new OrderWallDetector(settings({topLevels:1}),.01);
  d.processBatch([{...row(1,[[80000,1]],[[80000.01,1],[87000,100]],'snapshot'),bookScope:{bidComplete:true,askComplete:true,bidFloor:79500,askCeiling:80500}}]);
  expect(active(d).find(s=>s.side==='ask')?.price).toBe(87000);expect(d.status(base,base+100).rankingScope?.partial).toBe(true);
 });
 it('does not mistake a complete returned snapshot interior for global 10% coverage',()=>{
  const d=detector();d.processBatch([{...row(1,[[99,10]],[[101,10]],'snapshot'),bookScope:{bidComplete:true,askComplete:true,bidFloor:98,askCeiling:102}}]);
  expect(d.status(base,base+100).rankingScope).toMatchObject({partial:true,bidCount:1,askCount:1});
 });
 it('caps live membership at N per side and marks observed-only scope',()=>{
  const d=detector();const bids=Array.from({length:20},(_,i)=>[99-i*.1,i+1] as const),asks=Array.from({length:20},(_,i)=>[101+i*.1,i+1] as const);
  d.processBatch([{...row(1,bids,asks,'snapshot'),bookScope:{bidComplete:false,askComplete:false,bidFloor:97,askCeiling:103}}]);
  expect(active(d).filter(s=>s.side==='bid')).toHaveLength(8);expect(active(d).filter(s=>s.side==='ask')).toHaveLength(8);
  expect(d.status(base,base+1000).rankingScope).toMatchObject({partial:true,bidCount:8,askCount:8});
 });
});
describe('incremental rank index',()=>{
 it('matches an independent full-sort oracle over replacements, deletes, range changes and ties',()=>{
  const index=new OrderWallRankIndex(),levels=new Map<number,number>();let seed=77;
  const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
  for(let i=0;i<2000;i++){const price=1+Math.floor(random()*500),usd=Math.floor(random()*20)*10;index.set(price,usd);if(usd)levels.set(price,usd);else levels.delete(price);
   const low=random()*250,high=250+random()*250,n=1+Math.floor(random()*10),minimum=30;
   const expected=[...levels].filter(([p,v])=>p>=low&&p<=high&&v>=minimum).map(([price,usd])=>({price,usd})).sort((a,b)=>b.usd-a.usd||a.price-b.price).slice(0,n);
   expect(index.top(n,low,high,minimum)).toEqual(expected);
  }
 });
 it('prunes bounded Top 8 queries without visiting or sorting the full 5000-level book',()=>{
  const index=new OrderWallRankIndex();for(let i=0;i<5000;i++)index.set(50000+i,(i*37)%99991+1);
  const before=index.metrics.visited;expect(index.top(8,50000,55000)).toHaveLength(8);expect(index.metrics.visited-before).toBeLessThan(500);
 });
});

it('fixed aggregation retains bit-identical notional, quantity, rank and identity when a checkpoint reorders identical native levels',()=>{
 const levels=Array.from({length:200},(_,i)=>[Number((80000-i*.01).toFixed(2)),Number((.001+(i%17)*.000001).toFixed(8))] as const);
 const asks=Array.from({length:200},(_,i)=>[Number((80000.01+i*.01).toFixed(2)),Number((.002+(i%13)*.000001).toFixed(8))] as const);
 const d=new OrderWallDetector(settings({topLevels:8,aggregation:10}),.01);
 d.processBatch([row(1,levels,asks,'snapshot')]);const before=active(d).map(s=>({id:s.id,run:s.valueRuns.at(-1)}));
 d.processBatch([row(2,[...levels].reverse(),[...asks].reverse(),'checkpoint')]);
 expect(active(d).map(s=>({id:s.id,run:s.valueRuns.at(-1)}))).toEqual(before);
 expect(active(d).every(s=>s.valueRuns.length===1)).toBe(true);
});
