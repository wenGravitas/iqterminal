import{test,expect}from'vitest';
import{preparedWallDelta}from'../src/feed/prepared-wall-delta';import{fixture}from'./helpers/prepared-wall-fixture';
function source(){const f=fixture(),presentation=new Map(f.full.segments.map(s=>[s.id,s]));return{revision:'verified-old',through:f.full.confirmedTo,presentation};}
test('an exact delta retains unchanged history and replaces values, closes/removes old active state and adds new records',async()=>{
 const base=source(),next=new Map(base.presentation),[id,old]=[...next][0]!;next.set(id,{...old,meanUsd:old.meanUsd+0.0001,valueRuns:old.valueRuns.map((p,i)=>i?{...p}:{...p,usd:p.usd+0.0001})});const removed=[...next.keys()][1]!;next.delete(removed);next.set('new',{...old,id:'new',valueRuns:old.valueRuns.map(v=>({...v}))});
 const delta=await preparedWallDelta(base,next,new AbortController().signal);expect(delta?.patches).toHaveLength(3);const applied=new Map(base.presentation);for(const p of delta!.patches){if(p.segment)applied.set(p.id,p.segment);else applied.delete(p.id);}expect(applied).toEqual(next);expect(delta!.baseRevision).toBe(base.revision);expect(delta!.baseThrough).toBe(base.through);
});
test('equal replacement objects and every exact value-point property avoid redundant transfer without rounding',async()=>{
 const base=source(),equal=new Map([...base.presentation].map(([id,s])=>[id,structuredClone(s)]));expect((await preparedWallDelta(base,equal,new AbortController().signal))?.patches).toHaveLength(0);
 const [id,s]=[...equal][0]!;s.valueRuns[0]!.notionalExact='300.00000000030001';expect((await preparedWallDelta(base,equal,new AbortController().signal))?.patches.map(p=>p.id)).toEqual([id]);
});
test('large corrections choose a full-snapshot fallback and cancellation never publishes an unfinished delta',async()=>{
 const base=source(),s=[...base.presentation.values()][0]!,next=new Map(Array.from({length:5000},(_,i)=>['new-'+i,{...s,id:'new-'+i}] as const));expect(await preparedWallDelta(base,next,new AbortController().signal)).toBeUndefined();const c=new AbortController();c.abort();await expect(preparedWallDelta(base,next,c.signal)).rejects.toThrow();
});
