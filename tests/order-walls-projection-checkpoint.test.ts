import {expect,test} from 'vitest';
import {OrderWallsArchiveProjector,type OrderWallsArchivePage,type OrderWallsArchiveCandidate} from '../src/shared/order-walls-projection';
import {orderWallsSettings} from '../src/feed/order-walls';
const from=10000,to=100000,settings=orderWallsSettings({enabled:true,mode:'top-levels',topLevels:8});
const candidate=(overrides:Partial<OrderWallsArchiveCandidate>={}):OrderWallsArchiveCandidate=>({entryId:'entry-A',side:'bid',price:'100',quantity:'90071992547409.93000001',notional:'9007199254740993.000001',rank:1,startedAt:9000,startCursor:1,startEpoch:1,startKnown:true,...overrides});
const patch=(cursor:number,at:number,bids:OrderWallsArchiveCandidate[]=[],asks:OrderWallsArchiveCandidate[]=[])=>({kind:'patch',cursor,epoch:1,at,midpoint:'100',bids:{upserts:bids,removals:[]},asks:{upserts:asks,removals:[]}});
const page=(patches:any[],hasMore:boolean,after=0):OrderWallsArchivePage=>({version:1,profile:{} as any,market:'perpetual',instrument:'BTCUSDT',feed:'canonical',from,to,watermark:50,head:{cursor:50,epoch:2,at:to},
 page:{after,nextAfter:hasMore?7:50,lastAt:patches.at(-1)?.at??from,hasMore,limit:4096,sameMillisecondClosed:true},patches,
 ...(after===0?{seed:{at:from-1,cursor:1,epoch:1,midpoint:'100',bookScope:{bidComplete:true,askComplete:false,snapshotLevels:{bids:1000,asks:1000}},bids:[candidate()],asks:[]}}:{}),
 coverage:{availableFrom:1,requestedFrom:from,requestedTo:to,confirmedTo:to,gaps:[],status:'complete',partial:false}});
const wire=(v:any)=>JSON.parse(JSON.stringify(v));
function prefix(){return page([
 patch(2,from+10,[candidate({quantity:'3',notional:'300'})]),
 patch(3,from+10,[candidate({quantity:'2',notional:'200'})]),
 patch(4,from+5,[candidate({quantity:'4',notional:'400'})]),
 patch(5,from+20,[candidate({rank:9})]),
 patch(6,from+25,[candidate({rank:2,quantity:'5',notional:'500'})]),
 patch(7,from+30,[],[candidate({entryId:'entry-B',side:'ask',price:'101',quantity:'1',notional:'101',rank:1,startCursor:7,startedAt:from+30})]),
 ],true);}
function tail(){return page([
 {...patch(8,from+40),kind:'gap',epoch:2,reason:'Observed disconnect'},
 {...patch(9,from+50,[candidate({entryId:'entry-C',startCursor:9,startEpoch:2,startedAt:from+50,quantity:'1.00000001',notional:'100.000001'})]),epoch:2},
 {...patch(10,from+60,[candidate({entryId:'entry-C',startCursor:9,startEpoch:2,startedAt:from+50,quantity:'2.00000002',notional:'200.000002'})]),epoch:2},
 ],false,7);}
test('JSON checkpoint preserves exact decimals, same-time replacement, regressing timestamps, ranks, gaps and continued revisions',()=>{
 const reference=new OrderWallsArchiveProjector(settings,from,to);reference.applyPage(prefix());const before=wire(reference.snapshot()),state=wire(reference.checkpoint());
 const restored=OrderWallsArchiveProjector.restoreCheckpoint(state,settings,from,to);
 expect(wire(restored.snapshot())).toEqual(before);expect(wire(restored.selectedState())).toEqual(wire(reference.selectedState()));
 expect(before.some((s:any)=>s.valueRuns.some((v:any)=>v.notionalExact==='9007199254740993.000001'))).toBe(true);
 expect(wire(restored.applyPage(tail()))).toEqual(wire(reference.applyPage(tail())));
 expect(wire(restored.snapshot())).toEqual(wire(reference.snapshot()));expect(wire(restored.selectedState())).toEqual(wire(reference.selectedState()));
 expect(restored.historyLimited).toBe(false);expect(restored.diagnostics().queuedValueRuns).toBeLessThanOrEqual(reference.diagnostics().queuedValueRuns);
});
test('checkpoint and restored mutable state are detached from the source projector',()=>{
 const source=new OrderWallsArchiveProjector(settings,from,to);source.applyPage(prefix());const state=source.checkpoint(),expected=wire(source.snapshot());
 const restored=OrderWallsArchiveProjector.restoreCheckpoint(state,settings,from,to);
 state.segments[0]!.valueRuns[0]!.quantityExact='tampered';state.bookScope!.snapshotLevels!.bids=0;
 expect(wire(source.snapshot())).toEqual(expected);expect(wire(restored.snapshot())).toEqual(expected);expect(source.selectedState().bookScope?.snapshotLevels?.bids).toBe(1000);expect(restored.selectedState().bookScope?.snapshotLevels?.bids).toBe(1000);
});
test('malformed state, wrong view/filter, duplicate references and orphan live walls cannot be restored',()=>{
 const source=new OrderWallsArchiveProjector(settings,from,to);source.applyPage(prefix());const original=wire(source.checkpoint());
 const mutations=[(s:any)=>s.from--,(s:any)=>s.to++,(s:any)=>s.settings.topLevels=4,(s:any)=>s.namespace='other',
 (s:any)=>s.segments.push(s.segments[0]),(s:any)=>s.valueRunOrder[0]=[],(s:any)=>s.valueRunOrder[0][0]=s.nextValueRunSequence+1,
 (s:any)=>s.segments[0].valueRuns[0].quantityExact='1',(s:any)=>s.candidates[0].segmentId='absent',
 (s:any)=>s.candidates=s.candidates.filter((c:any)=>c.segmentId!==s.segments.find((x:any)=>x.end===null).id),
 (s:any)=>s.candidates.push(s.candidates[0]),(s:any)=>s.confirmedTo=NaN];
 for(const mutate of mutations){const state=wire(original);mutate(state);expect(()=>OrderWallsArchiveProjector.restoreCheckpoint(state,settings,from,to)).toThrow(/Invalid wall projection checkpoint/);}
 expect(()=>OrderWallsArchiveProjector.restoreCheckpoint(original,{...settings,topLevels:4},from,to)).toThrow(/Invalid/);
 expect(()=>OrderWallsArchiveProjector.restoreCheckpoint(original,settings,from,to,'other')).toThrow(/Invalid/);
});
test('unused minimum-notional settings do not change the selected-history identity',()=>{
 const source=new OrderWallsArchiveProjector(settings,from,to);source.applyPage(prefix());
 const restored=OrderWallsArchiveProjector.restoreCheckpoint(wire(source.checkpoint()),{...settings,minimumNotionalUsd:500000},from,to);
 expect(wire(restored.snapshot())).toEqual(wire(source.snapshot()));
});
test('preparation can persist closed segments once while checkpointing only active state',()=>{
 const reference=new OrderWallsArchiveProjector(settings,from,to);let working=new OrderWallsArchiveProjector(settings,from,to);
 const order=new Map<string,number>(),closed=new Map<string,{segment:any;valueRunOrder:number[]}>();
 for(const p of [prefix(),tail()]){
  const expected=reference.applyPage(p),actual=working.applyPage(p);expect(wire(actual)).toEqual(wire(expected));
  for(const update of actual)if(update.segment){if(!order.has(update.id))order.set(update.id,order.size);if(update.segment.end===null)closed.delete(update.id);}
  for(const item of working.takeClosedSegments())closed.set(item.segment.id,wire(item));
  expect(working.snapshot().every(s=>s.end===null)).toBe(true);
  working=OrderWallsArchiveProjector.restoreCheckpoint(wire(working.checkpoint()),settings,from,to);
 }
 const state=working.checkpoint(),all=[...closed.values(),...state.segments.map((segment,i)=>({segment,valueRunOrder:state.valueRunOrder[i]!}))].sort((a,b)=>order.get(a.segment.id)!-order.get(b.segment.id)!);
 state.segments=all.map(item=>item.segment);state.valueRunOrder=all.map(item=>item.valueRunOrder);
 const restored=OrderWallsArchiveProjector.restoreCheckpoint(wire(state),settings,from,to);
 expect(wire(restored.snapshot())).toEqual(wire(reference.snapshot()));expect(wire(restored.checkpoint())).toEqual(wire(reference.checkpoint()));
});
test('same-timestamp corrections preserve actual retained counts and checkpoint capacity',()=>{
 const source=new OrderWallsArchiveProjector(settings,from,to);
 source.applyPage(page(Array.from({length:40},(_,i)=>patch(i+2,from+10,[candidate({quantity:String(i+1),notional:String((i+1)*100)})])),false));
 const actual=source.snapshot().reduce((n,s)=>n+s.valueRuns.length,0);
 expect(actual).toBe(2);expect(source.diagnostics().valueRuns).toBe(actual);
 const restored=OrderWallsArchiveProjector.restoreCheckpoint(wire(source.checkpoint()),settings,from,to);
 expect(restored.diagnostics().valueRuns).toBe(actual);expect(wire(restored.snapshot())).toEqual(wire(source.snapshot()));
});

const cooperative=(onYield=async()=>{})=>{let tick=0;return {now:()=>++tick,budgetMs:1,yield:onYield,check:()=>{}};};
test('cooperative import preserves every field, detached state, eviction order and subsequent patches',async()=>{
 const source=new OrderWallsArchiveProjector(settings,from,to);source.applyPage(prefix());const state=wire(source.checkpoint());
 // Many closed fixture identities with interleaved value sequences exercise
 // validation, long-wall cloning and every merge-sort pass independently.
 const closed=state.segments.find((s:any)=>s.end!==null),extra=Array.from({length:120},(_,i)=>({...wire(closed),id:'closed-'+i,valueRuns:Array.from({length:200},(_,j)=>({...closed.valueRuns[0],at:from+j}))}));
 state.segments.push(...extra);let sequence=1;
 state.valueRunOrder=state.segments.map((s:any)=>s.valueRuns.map(()=>sequence++));state.nextValueRunSequence=sequence;
 // Non-monotonic global insertion order must not become the eviction order.
 let descending=sequence-1;state.valueRunOrder=state.segments.map((s:any)=>s.valueRuns.map(()=>descending--));
 const expected=OrderWallsArchiveProjector.restoreCheckpoint(state,settings,from,to);let yields=0;
 const actual=await OrderWallsArchiveProjector.restoreCheckpointCooperatively(state,settings,from,to,cooperative(async()=>{yields++;}));
 expect(yields).toBeGreaterThan(100);expect(wire(actual.checkpoint())).toEqual(wire(expected.checkpoint()));
 expect((actual as any).valueRunQueue).toEqual((expected as any).valueRunQueue);
 state.segments[0].valueRuns[0].quantityExact='changed';state.bookScope.snapshotLevels.bids=0;
 expect(wire(actual.checkpoint())).toEqual(wire(expected.checkpoint()));
 expect(wire(actual.applyPage(tail()))).toEqual(wire(expected.applyPage(tail())));
 expect(wire(actual.checkpoint())).toEqual(wire(expected.checkpoint()));
});
test('cooperative validation rejects cross-segment duplicate sequences and orphan live records before returning',async()=>{
 const source=new OrderWallsArchiveProjector(settings,from,to);source.applyPage(prefix());const state=wire(source.checkpoint());
 for(const mutate of [(s:any)=>s.valueRunOrder[1][0]=s.valueRunOrder[0][0],(s:any)=>s.candidates=[],(s:any)=>s.segments[0].valueRuns[0].quantityExact='bad',(s:any)=>s.seenGaps=[5]]){
  const bad=wire(state);mutate(bad);await expect(OrderWallsArchiveProjector.restoreCheckpointCooperatively(bad,settings,from,to,cooperative())).rejects.toThrow(/Invalid wall projection checkpoint/);
  await expect(OrderWallsArchiveProjector.validateCheckpointCooperatively(bad,settings,from,to,cooperative())).rejects.toThrow(/Invalid wall projection checkpoint/);
 }
});
test('validation-only import yields and retains the exact caller checkpoint for final restore',async()=>{
 const source=new OrderWallsArchiveProjector(settings,from,to);source.applyPage(prefix());const state=wire(source.checkpoint());
 state.seenGaps=Array.from({length:600},(_,i)=>String(i));const before=wire(state);let yields=0;
 await expect(OrderWallsArchiveProjector.validateCheckpointCooperatively(state,settings,from,to,cooperative(async()=>{yields++;}))).resolves.toBeUndefined();
 expect(yields).toBeGreaterThan(0);expect(state).toEqual(before);
 expect(wire(OrderWallsArchiveProjector.restoreCheckpoint(state,settings,from,to).checkpoint())).toEqual(before);
 let calls=0;
 await expect(OrderWallsArchiveProjector.validateCheckpointCooperatively(state,settings,from,to,cooperative(async()=>{if(++calls===2)throw Error('Canceled validation');}))).rejects.toThrow('Canceled validation');
 for(const budgetMs of [0,NaN,17])await expect(OrderWallsArchiveProjector.validateCheckpointCooperatively(state,settings,from,to,{...cooperative(),budgetMs})).rejects.toThrow(/budget/);
 expect(state).toEqual(before);
});
test('cancelled cooperative work returns no partial projector and leaves the input untouched',async()=>{
 const source=new OrderWallsArchiveProjector(settings,from,to);source.applyPage(prefix());const state=wire(source.checkpoint()),before=wire(state);
 state.seenGaps=Array.from({length:600},(_,i)=>String(i));const snapshot=wire(state);let calls=0;
 await expect(OrderWallsArchiveProjector.restoreCheckpointCooperatively(state,settings,from,to,cooperative(async()=>{if(++calls===2)throw Error('Canceled import');}))).rejects.toThrow('Canceled import');
 expect(state).toEqual(snapshot);expect(wire(source.checkpoint())).toEqual(before);
 for(const budgetMs of [0,NaN,17])await expect(OrderWallsArchiveProjector.restoreCheckpointCooperatively(state,settings,from,to,{...cooperative(),budgetMs})).rejects.toThrow(/budget/);
});
