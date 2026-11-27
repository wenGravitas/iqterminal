import {describe,it,expect,vi} from 'vitest';
import {cvdHistoryFixture,DAY_START as day,DAY as D,HOUR as H,MINUTE as M,CVD_SOURCE as source} from './helpers/cvd-history-fixture';
const signal=()=>new AbortController().signal;
const view=(from=day,to=day+D,anchor=day,stepMs=H)=>({source,anchor,from,to,stepMs});
describe('finite CVD viewport acquisition',()=>{
 it('seeds native ownership, loads newest missing hours and resumes with a bounded cursor',async()=>{
  const f=cvdHistoryFixture(),request={projection:view(),seed:{from:f.cut,to:f.cut+M}};
  let result=await f.owner.window(request,signal());expect(result).toMatchObject({state:'loading',operations:4,nextBefore:day+21*H});expect(result.projection!.points.at(-1)!.available).toBe(true);
  let turns=1;while(result.nextBefore!==undefined&&result.state!=='available'){result=await f.owner.window({...request,before:result.nextBefore},signal());expect(result.operations).toBeLessThanOrEqual(4);turns++;expect(turns).toBeLessThan(10);}
  expect(result.state).toBe('available');expect(result.projection!.points.at(-1)!.base).toBe('24.00000024');expect(f.owner.diagnostics().sources[0]).toMatchObject({sealedDays:1,residentCells:1});
  const calls=f.fetch.mock.calls.length;const reopened=await f.owner.window(request,signal());expect(reopened).toMatchObject({state:'available',operations:0,scanned:0});expect(f.fetch).toHaveBeenCalledTimes(calls);await f.owner.dispose();
 });
 it('cached panning and coarser zoom do not refetch a compacted historical day',async()=>{
  const f=cvdHistoryFixture();await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},signal());f.owner.project(view());f.owner.evict(source,day);const calls=f.fetch.mock.calls.length;
  for(const projection of [view(day+12*H,day+D),view(day,day+D,day,6*H)]){const result=await f.owner.window({projection},signal());expect(result.state).toBe('available');expect(result.operations).toBe(0);}
  expect(f.fetch).toHaveBeenCalledTimes(calls);await f.owner.dispose();
 });
 it('loads thirty days within minute-cell bounds while preserving exact daily outputs',async()=>{
  const f=cvdHistoryFixture(day+30*D),projection=view(day,day+30*D,day,D);let result=await f.owner.window({projection,seed:{from:f.cut,to:f.cut+M}},signal()),turns=1;
  while(result.state!=='available'&&result.nextBefore!==undefined){result=await f.owner.window({projection,before:result.nextBefore},signal());turns++;expect(turns).toBeLessThan(190);expect(result.operations).toBeLessThanOrEqual(4);}
  expect(result.state).toBe('available');expect(result.projection!.points.at(-1)!.base).toBe('720.0000072');expect(f.owner.diagnostics().sources[0]).toMatchObject({sealedDays:30,residentCells:1});await f.owner.dispose();
 },20000);
 it('bounds scanning complete sealed windows without refetching detail needed only for amounts',async()=>{
  const f=cvdHistoryFixture(day+22*D);await f.seed();const projection=view(day,day+22*D,day-D,D);
  for(let n=0;n<22;n++){const from=day+n*D;await f.owner.read({source,kind:'archive',from,to:from+D},signal());f.owner.project(projection);f.owner.evict(source,from);}
  const calls=f.fetch.mock.calls.length,result=await f.owner.window({projection},signal());expect(result).toMatchObject({state:'loading',operations:0,scanned:512,nextBefore:day+16*H});expect(f.fetch).toHaveBeenCalledTimes(calls);await f.owner.dispose();
 });
 it('finer missing detail restores a sealed day over bounded turns without changing accepted totals',async()=>{
  const f=cvdHistoryFixture();await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},signal());f.owner.project(view());f.owner.evict(source,day);const total=f.owner.sum(source,day,day+D),version=f.owner.diagnostics().sources[0]!.version,projection=view(day+M,day+3*M,day,M);
  let result=await f.owner.window({projection},signal()),turns=1;expect(result).toMatchObject({state:'loading',operations:4,restoringDay:day});expect(f.owner.sum(source,day,day+D)).toEqual(total);
  while(result.state!=='available'){result=await f.owner.window({projection,before:result.nextBefore},signal());turns++;expect(turns).toBeLessThanOrEqual(6);}
  expect(turns).toBe(6);expect(result.projection!.points[0]!.base).toBe('1.00000001');expect(f.owner.diagnostics().sources[0]!.version).toBe(version);expect(f.owner.sum(source,day,day+D)).toEqual(total);await f.owner.dispose();
 });
 it('uncached outage retains accepted points and stops rather than retrying within the turn',async()=>{
  const f=cvdHistoryFixture();await f.seed();await f.owner.read({source,kind:'archive',from:day+23*H,to:day+D},signal());const projection=view(day+23*H,day+D),before=f.owner.project(projection);f.offline();const calls=f.fetch.mock.calls.length;
  const result=await f.owner.window({projection},signal());expect(result).toMatchObject({state:'partial',operations:1,failures:[{reason:'unavailable'}]});expect(result.projection!.points).toEqual(before.points);expect(f.fetch).toHaveBeenCalledTimes(calls+1);await f.owner.dispose();
 });
 it('does not retry a restore hour that supplies no missing accepted record',async()=>{
  const f=cvdHistoryFixture();await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},signal());f.owner.evict(source,day);
  const original=f.fetch.getMockImplementation()!;f.fetch.mockImplementation(async(...args)=>{const response=await original(...args),url=String(args[0]);if(url.includes('recorded-minutes?')){const p=await response.json();p.bars=[];p.coverage.partitions[0].coverage={state:'partial',gaps:[{from:p.request.from,to:p.request.to,reason:'Unavailable detail'}]};p.coverage.state='partial';p.partial=true;return new Response(JSON.stringify(p));}return response;});
  const result=await f.owner.window({projection:view(day+M,day+3*M,day,M)},signal());expect(result).toMatchObject({operations:1,state:'unavailable',failures:[{reason:'restore'}]});expect(f.owner.diagnostics().sources[0]!.sealedDays).toBe(1);await f.owner.dispose();
 });
 it('does not use archive data to fill an expired native ownership interval',async()=>{
  const f=cvdHistoryFixture(day);await f.seed();const original=f.fetch.getMockImplementation()!;f.fetch.mockImplementation(async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/v2/cvd?')){const p=await response.json();p.retainedFrom=day+H;return new Response(JSON.stringify(p));}return response;});
  await f.owner.read({source,kind:'native',from:day+H,to:day+H+M},signal());const calls=f.fetch.mock.calls.length,result=await f.owner.window({projection:view(day+M,day+H,day,M)},signal());expect(result.failures[0]!.reason).toBe('expired-native-basis');expect(result.operations).toBe(0);expect(f.fetch).toHaveBeenCalledTimes(calls);await f.owner.dispose();
 });
 it('cancellation releases viewport demand without clearing accepted contributions',async()=>{
  const f=cvdHistoryFixture();await f.seed();const before=f.owner.sum(source,f.cut,f.cut+M);let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);f.fetch.mockImplementationOnce(async()=>{await gate;return new Response('{}',{status:503});});
  const caller=new AbortController(),work=f.owner.window({projection:view()},caller.signal).catch(e=>e);await vi.waitFor(()=>expect(f.owner.diagnostics().active).toBe(true));caller.abort();expect(await work).toMatchObject({reason:'cancelled'});expect(f.owner.sum(source,f.cut,f.cut+M)).toEqual(before);finish();await f.owner.dispose();
 });
 it('bounds active turns and validates cursors before archive requests',async()=>{
  const f=cvdHistoryFixture();await f.seed();for(const before of [day-1,day+D+M,day+1])await expect(f.owner.window({projection:view(),before},signal())).rejects.toMatchObject({reason:'invalid'});
  let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);f.fetch.mockImplementationOnce(async()=>{await gate;return new Response('{}',{status:503});});
  const turns=Array.from({length:4},()=>f.owner.window({projection:view()},signal()).catch(e=>e));await expect(f.owner.window({projection:view()},signal())).rejects.toMatchObject({reason:'capacity'});const close=f.owner.dispose();finish();await close;await Promise.all(turns);expect(f.owner.diagnostics().windowTurns).toBe(0);
 });
});
it('leaves completed retained native days resident for bounded correction reads',async()=>{
 const f=cvdHistoryFixture(day);let result=await f.owner.window({projection:view(),seed:{from:day,to:day+M}},signal());
 for(let n=0;n<10&&result.state!=='available';n++)result=await f.owner.window({projection:view(),before:result.nextBefore},signal());
 expect(result.state).toBe('available');expect(f.owner.diagnostics().sources[0]).toMatchObject({sealedDays:0,residentCells:1440});await f.owner.dispose();
});
