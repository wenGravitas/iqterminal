import {it,expect,vi} from 'vitest';
import {cvdHistoryFixture,DAY_START as day,DAY as D,HOUR as H,MINUTE as M,CVD_SOURCE as source} from './helpers/cvd-history-fixture';
const signal=()=>new AbortController().signal;
it('restores one fragmented day through the shared owner admission without changing totals or projections',async()=>{
 const f=cvdHistoryFixture();await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},signal());const q={source,anchor:day,from:day+M,to:day+3*M,stepMs:M},before=f.owner.project(q),total=f.owner.sum(source,day,day+D),version=f.owner.diagnostics().sources[0]!.version;f.owner.evict(source,day);
 let pages=0,next=f.owner.nextRestorePage(source,day);
 while(next){const result=await f.owner.restorePage({source,day,...next},signal());pages++;expect(result.version).toBe(version);expect(f.owner.sum(source,day,day+D)).toEqual(total);if(result.complete)break;next=f.owner.nextRestorePage(source,day);}
 expect(pages).toBe(24);expect(f.owner.diagnostics().restorations).toEqual([]);expect(f.owner.sum(source,day+M,day+3*M)).toMatchObject({base:'0',complete:true});expect(f.owner.project(q)).toEqual(before);await f.owner.dispose();
});
it('keeps accepted data and existing staged pages through archive failure',async()=>{
 const f=cvdHistoryFixture();await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},signal());f.owner.evict(source,day);const total=f.owner.sum(source,day,day+D),next=f.owner.nextRestorePage(source,day)!;
 await f.owner.restorePage({source,day,...next},signal());const before=f.owner.diagnostics().restorations;f.offline();await expect(f.owner.restorePage({source,day,...f.owner.nextRestorePage(source,day)!},signal())).rejects.toMatchObject({reason:'unavailable'});expect(f.owner.diagnostics().restorations).toEqual(before);expect(f.owner.sum(source,day,day+D)).toEqual(total);await f.owner.dispose();
});
it('automatically expires bounded reconstruction stages and releases timers on disposal',async()=>{
 vi.useFakeTimers();const f=cvdHistoryFixture(day+4*D);
 try{await f.seed();for(let n=0;n<4;n++){const from=day+n*D;await f.owner.read({source,kind:'archive',from,to:from+D},signal());f.owner.evict(source,from);f.owner.nextRestorePage(source,from);}
  expect(f.owner.diagnostics().restorations).toHaveLength(4);expect(()=>f.owner.nextRestorePage(source,day-D)).toThrowError(expect.objectContaining({reason:'capacity'}));
  await vi.advanceTimersByTimeAsync(60000);expect(f.owner.diagnostics().restorations).toEqual([]);expect(f.owner.sum(source,day,day+4*D)!.base).toBe('96.00000096');f.owner.nextRestorePage(source,day);await f.owner.dispose();expect(f.owner.diagnostics().restorations).toEqual([]);
 }finally{await f.owner.dispose();vi.useRealTimers();}
});
it('disabled restoration rejects without inspecting an unselected request',async()=>{
 const f=cvdHistoryFixture();await f.owner.dispose();const poison=new Proxy({},{get(){throw Error('unselected');}});await expect(f.owner.restorePage(poison as any,poison as any)).rejects.toMatchObject({reason:'disabled'});expect(f.fetch).not.toHaveBeenCalled();
});
it('rejects late pages by monotonic stage expiry even when a fresh lease is still valid',async()=>{
 let now=0;const f=cvdHistoryFixture(day+D,()=>now);await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},signal());f.owner.evict(source,day);const total=f.owner.sum(source,day,day+D);
 now=10000;const page=f.owner.nextRestorePage(source,day)!;now=65000;const original=f.fetch.getMockImplementation()!;
 f.fetch.mockImplementation(async(...args)=>{const response=await original(...args);if(String(args[0]).includes('recorded-minutes?'))now=70001;return response;});
 await expect(f.owner.restorePage({source,day,...page},signal())).rejects.toMatchObject({reason:'unavailable'});expect(f.owner.diagnostics().restorations).toEqual([]);expect(f.owner.sum(source,day,day+D)).toEqual(total);expect(f.owner.diagnostics().sources[0]!.sealedDays).toBe(1);await f.owner.dispose();
});
it('keeps progressing fragmented restores alive across interleaved turns, then expires idle input',async()=>{
 vi.useFakeTimers();const began=Date.now(),f=cvdHistoryFixture(day+D,()=>Date.now()-began);
 try{await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},signal());f.owner.evict(source,day);const total=f.owner.sum(source,day,day+D),page=f.owner.nextRestorePage(source,day)!;
  await vi.advanceTimersByTimeAsync(40000);await f.owner.restorePage({source,day,...page},signal());await vi.advanceTimersByTimeAsync(50000);expect(f.owner.diagnostics().restorations[0]).toMatchObject({missingRecords:23});expect(f.owner.sum(source,day,day+D)).toEqual(total);
  await vi.advanceTimersByTimeAsync(10000);expect(f.owner.diagnostics().restorations).toEqual([]);
 }finally{await f.owner.dispose();vi.useRealTimers();}
});
it('bounds total restore lifetime even when valid pages keep arriving',async()=>{
 vi.useFakeTimers();const began=Date.now(),f=cvdHistoryFixture(day+D,()=>Date.now()-began);
 try{await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},signal());f.owner.evict(source,day);f.owner.nextRestorePage(source,day);
  for(let n=0;n<14;n++){await vi.advanceTimersByTimeAsync(40000);await f.owner.restorePage({source,day,...f.owner.nextRestorePage(source,day)!},signal());}
  expect(f.owner.diagnostics().restorations).toHaveLength(1);await vi.advanceTimersByTimeAsync(40000);expect(f.owner.diagnostics().restorations).toEqual([]);expect(f.owner.diagnostics().sources[0]!.sealedDays).toBe(1);
 }finally{await f.owner.dispose();vi.useRealTimers();}
});
