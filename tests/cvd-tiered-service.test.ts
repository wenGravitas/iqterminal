import {it,expect,vi,afterEach} from 'vitest';
import {TieredCvdService} from '../src/feed/cvd-tiered-service';
import {CvdPlotModel} from '../src/chart/cvd-model';
import {cvdSettings,type CvdEvent} from '../src/feed/cvd';
import {cvdHistoryFixture,DAY_START as day,DAY as D,HOUR as H,MINUTE as M,CVD_SOURCE as source} from './helpers/cvd-history-fixture';
const active:Array<{service:TieredCvdService;owner:ReturnType<typeof cvdHistoryFixture>['owner']}>=[];
afterEach(async()=>{for(const {service,owner}of active.splice(0)){service.dispose();await owner.dispose();}vi.useRealTimers();});
function setup(ack=true,cut=day+D){
 vi.useFakeTimers();const f=cvdHistoryFixture(cut),events:CvdEvent[]=[],model=new CvdPlotModel();let now=cut+D+M-1;
 const service=new TieredCvdService(f.owner,event=>{events.push(event);for(const series of event.series)model.update(series);if(ack)service.ack(event.ids[0]!,event.generation,event.batchId);},()=>now,()=>Date.now());active.push({service,owner:f.owner});
 const request={sources:[source],anchor:'daily' as const,origin:day,custom:day};service.subscribe('chart',request);
 return {...f,service,events,model,request,time:(t:number)=>now=t};
}
async function until(test:()=>boolean){for(let n=0;n<100;n++){await vi.advanceTimersByTimeAsync(250);if(test())return;}throw Error('Bounded chart fixture did not settle');}
it('feeds exact UTC daily chart points from tiered history and releases subscriptions without losing the owner',async()=>{
 const f=setup(true,day+2*D);f.service.viewport('chart',{from:day,to:day+2*D,stepMs:H});
 await until(()=>f.model.sources.get(source)?.points.at(-1)?.baseText==='24.00000024'&&!f.model.sources.get(source)?.points[0]?.partial);
 const series=f.model.sources.get(source)!;expect(series.points).toHaveLength(48);expect(series.points[23]).toMatchObject({baseText:'24.00000024',period:day,reset:false});expect(series.points[24]).toMatchObject({baseText:'1.00000001',period:day+D,reset:true});
 f.model.derive(cvdSettings({sources:[source]}),'btc');expect(f.model.lines.get(source)!.stepMs).toBe(H);expect(f.model.value('total')!.value).toBe(24.00000024);
 const version=f.owner.sourceState(source).version;f.service.unsubscribe('chart');expect(f.service.diagnostics().clients).toBe(0);expect(f.owner.sourceState(source).version).toBe(version);expect(f.owner.sum(source,day,day+D)!.base).toBe('24.00000024');
});
it('reopens and zooms cached historical windows without additional remote reads',async()=>{
 const f=setup();await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},new AbortController().signal);f.owner.project({source,anchor:day,from:day,to:day+D,stepMs:H,reset:'daily'});f.owner.evict(source,day);const calls=f.fetch.mock.calls.length;
 f.service.viewport('chart',{from:day,to:day+D,stepMs:H});await until(()=>f.model.sources.get(source)?.points.length===24);expect(f.fetch).toHaveBeenCalledTimes(calls);
 f.service.viewport('chart',{from:day,to:day+D,stepMs:4*H});await until(()=>f.model.sources.get(source)?.points.length===6);expect(f.fetch).toHaveBeenCalledTimes(calls);expect(f.model.sources.get(source)!.points.at(-1)!.baseText).toBe('24.00000024');
 f.service.unsubscribe('chart');f.service.subscribe('chart',f.request);f.service.viewport('chart',{from:day,to:day+D,stepMs:4*H});await vi.advanceTimersByTimeAsync(1000);expect(f.fetch).toHaveBeenCalledTimes(calls);
});
it('keeps earlier geometry while finer detail restores and replaces it only with accepted grid points',async()=>{
 const f=setup();await f.seed();await f.owner.read({source,kind:'archive',from:day,to:day+D},new AbortController().signal);f.owner.project({source,anchor:day,from:day,to:day+D,stepMs:H,reset:'daily'});f.owner.evict(source,day);
 f.service.viewport('chart',{from:day,to:day+D,stepMs:H});await until(()=>f.model.sources.get(source)?.points.length===24);const before=f.model.sources.get(source)!.points.map(p=>p.baseText),version=f.owner.sourceState(source).version;
 f.service.viewport('chart',{from:day,to:day+D,stepMs:M});expect(f.model.sources.get(source)!.points.map(p=>p.baseText)).toEqual(before);
 await until(()=>f.model.sources.get(source)?.points.length===1440);expect(f.owner.sourceState(source).version).toBe(version);expect(f.model.sources.get(source)!.points.at(-1)!.baseText).toBe('24.00000024');expect(f.model.sources.get(source)!.points[1]).toMatchObject({observed:false,available:true,partial:false});
});
it('ACK backpressure bounds acquisition and ignores obsolete generation acknowledgements',async()=>{
 const f=setup(false);f.service.viewport('chart',{from:day,to:day+D,stepMs:H});await until(()=>f.events.length===1);const first=f.events[0]!,calls=f.fetch.mock.calls.length;
 await vi.advanceTimersByTimeAsync(2000);expect(f.events).toHaveLength(1);expect(f.fetch).toHaveBeenCalledTimes(calls);f.service.ack('chart',first.generation+1,first.batchId);await vi.advanceTimersByTimeAsync(500);expect(f.fetch).toHaveBeenCalledTimes(calls);
 f.service.ack('chart',first.generation,first.batchId);await until(()=>f.events.length===2);expect(f.events[1]!.series[0]!.points.length).toBeLessThanOrEqual(5000);
});
it('native continuity failure stays stale after successful archive work and does not automatically retry',async()=>{
 const f=setup();await f.seed();const original=f.fetch.getMockImplementation()!;
 f.fetch.mockImplementation(async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/v2/cvd?')){const p=await response.json();p.incarnation='12345678-1234-4abc-8abc-123456789abd';return new Response(JSON.stringify(p));}return response;});
 f.service.viewport('chart',{from:f.cut+D,to:f.cut+D+M,stepMs:M});await until(()=>f.owner.sourceState(source).reason==='rejoin-unavailable');const calls=f.calls.filter(c=>c.url.includes('/v2/cvd?')).length;
 await f.owner.read({source,kind:'archive',from:day,to:day+H},new AbortController().signal);expect(f.owner.sourceState(source).status).toBe('stale');await vi.advanceTimersByTimeAsync(10000);expect(f.calls.filter(c=>c.url.includes('/v2/cvd?'))).toHaveLength(calls);expect(f.model.sources.get(source)?.status).toBe('stale');
});
it('does not start collection without a valid bounded viewport and caps chart subscriptions',async()=>{
 const f=setup();for(let n=0;n<9;n++)f.service.subscribe('chart'+n,f.request);expect(f.service.diagnostics().clients).toBe(8);
 for(const viewport of [{from:day,to:day+5001*M,stepMs:M},{from:day+1,to:day+H,stepMs:M},{from:day,to:day+H,stepMs:0}])f.service.viewport('chart',viewport);await vi.advanceTimersByTimeAsync(2000);expect(f.fetch).not.toHaveBeenCalled();
});
it('retries an awaiting native seed without pinning an empty basis or replaying a forming bucket',async()=>{
 const f=setup(),original=f.fetch.getMockImplementation()!;let awaiting=true,now=f.cut+D+M-1;
 f.fetch.mockImplementation(async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/v2/cvd?')){const p=await response.json();p.asOf=p.fullProjectionAt=now;p.coverage.to=Math.min(p.to,now);if(awaiting){p.status='awaiting';p.watermark='0';p.buckets=[];}return new Response(JSON.stringify(p));}return response;});
 f.service.viewport('chart',{from:f.cut+D,to:f.cut+D+5*M,stepMs:5*M});await until(()=>f.events.length>0);expect(f.owner.basis(source)).toBeUndefined();const calls=f.calls.filter(c=>c.url.includes('/v2/cvd?')).length;await vi.advanceTimersByTimeAsync(1000);expect(f.calls.filter(c=>c.url.includes('/v2/cvd?'))).toHaveLength(calls);
 awaiting=false;now+=5000;f.time(now);await until(()=>!!f.owner.basis(source)&&!!f.model.sources.get(source)?.points.length);expect(f.owner.basis(source)).toBeDefined();const ready=f.calls.filter(c=>c.url.includes('/v2/cvd?')).length;await vi.advanceTimersByTimeAsync(1000);expect(f.calls.filter(c=>c.url.includes('/v2/cvd?'))).toHaveLength(ready);
});
it('resumes a transient archive outage with bounded backoff while retaining accepted chart values',async()=>{
 const f=setup();await f.seed();await f.owner.read({source,kind:'archive',from:day+23*H,to:day+D},new AbortController().signal);f.offline();f.service.viewport('chart',{from:day,to:day+D,stepMs:H});await until(()=>f.service.diagnostics().failures>0||f.calls.some(c=>c.url.includes('recorded-minutes?from=')));
 const before=f.model.sources.get(source)!.points.at(-1)!.baseText;await vi.advanceTimersByTimeAsync(1000);const count=f.calls.length;await vi.advanceTimersByTimeAsync(1000);expect(f.calls).toHaveLength(count);expect(f.model.sources.get(source)!.points.at(-1)!.baseText).toBe(before);
 f.offline(false);await vi.advanceTimersByTimeAsync(5000);await until(()=>f.model.sources.get(source)?.points.every(p=>!p.partial)??false);expect(f.model.sources.get(source)!.points.at(-1)!.baseText).toBe('24.00000024');
});
it('finishes an active sealed-day reconstruction before opening another cold restore',async()=>{
 const f=setup(true,day+2*D);await f.seed();for(let n=0;n<2;n++)await f.owner.read({source,kind:'archive',from:day+n*D,to:day+(n+1)*D},new AbortController().signal);f.owner.project({source,anchor:day,from:day,to:day+2*D,stepMs:H,reset:'daily'});for(let n=0;n<2;n++)f.owner.evict(source,day+n*D);
 f.service.viewport('chart',{from:day,to:day+D,stepMs:H});f.service.subscribe('other',f.request);f.service.viewport('other',{from:day+D,to:day+2*D,stepMs:H});await vi.advanceTimersByTimeAsync(500);
 const count=f.calls.length;f.service.viewport('chart',{from:day,to:day+D,stepMs:M});f.service.viewport('other',{from:day+D,to:day+2*D,stepMs:M});
 await until(()=>f.owner.diagnostics().sources[0]!.sealedDays===0);const pages=f.calls.slice(count).filter(c=>c.url.includes('recorded-minutes?')).map(c=>Number(new URL(c.url,'http://fixture').searchParams.get('from')));
 expect(pages).toHaveLength(48);expect(pages.slice(0,24).every(t=>t<day+D)).toBe(true);expect(pages.slice(24).every(t=>t>=day+D)).toBe(true);expect(new Set(pages).size).toBe(48);
});
it('rechecks older native pages, applies exact corrections once and keeps hot days resident',async()=>{
 const f=setup(true,day),original=f.fetch.getMockImplementation()!;let revision=0,corrected=false;
 f.fetch.mockImplementation(async(...args)=>{const response=await original(...args);if(!String(args[0]).includes('/v2/cvd?'))return response;const p=await response.json();p.revision=++revision;if(corrected)for(const row of p.buckets)if(row.time===day){row.base='2.00000002';row.quote='20.0000002';}return new Response(JSON.stringify(p));});
 await f.seed();await f.owner.read({source,kind:'native',from:day,to:day+D},new AbortController().signal);
 f.service.viewport('chart',{from:day,to:day+H,stepMs:M});await until(()=>f.model.sources.get(source)?.points.length===60);
 expect(f.owner.diagnostics().sources[0]).toMatchObject({sealedDays:0,residentCells:1440});
 const version=f.owner.sourceState(source).version,calls=f.calls.length;corrected=true;
 await until(()=>f.model.sources.get(source)?.points.at(-1)?.baseText==='2.00000002');
 expect(f.owner.sourceState(source).version).toBe(version+1);expect(f.owner.sum(source,day,day+D)!.base).toBe('25.00000025');
 const pages=f.calls.slice(calls).filter(c=>c.url.includes('/v2/cvd?')).map(c=>new URL(c.url,'http://fixture'));
 expect(pages).toHaveLength(1);expect(f.calls.at(-1)!.init.headers).toEqual({'X-IQ-History-Priority':'background'});expect(Number(pages[0]!.searchParams.get('to'))-Number(pages[0]!.searchParams.get('from'))).toBe(H);
 await vi.advanceTimersByTimeAsync(5000);expect(f.owner.sourceState(source).version).toBe(version+1);expect(f.calls).toHaveLength(calls+1);
});
it('keeps correction-check failure stale through successful current polls and stops bounded retries',async()=>{
 const f=setup(true,day),original=f.fetch.getMockImplementation()!;let revision=0,failing=false;
 f.fetch.mockImplementation(async(...args)=>{const u=new URL(String(args[0]),'http://fixture');if(failing&&u.pathname.endsWith('/cvd')&&Number(u.searchParams.get('from'))<day+D-M)return new Response('{}',{status:503});const response=await original(...args);if(!u.pathname.endsWith('/cvd'))return response;const p=await response.json();p.revision=++revision;return new Response(JSON.stringify(p));});
 await f.seed();await f.owner.read({source,kind:'native',from:day,to:day+D},new AbortController().signal);
 f.service.viewport('chart',{from:day,to:day+D+2*M,stepMs:M});await until(()=>f.model.sources.get(source)?.points.some(p=>p.time===day+M)??false);const old=f.model.sources.get(source)!.points.find(p=>p.time===day+M)!.baseText;failing=true;
 await until(()=>f.service.diagnostics().repairs>0&&f.model.sources.get(source)?.status==='stale');
 await vi.advanceTimersByTimeAsync(1500);expect(f.model.sources.get(source)!.status).toBe('stale');expect(f.model.sources.get(source)!.points.find(p=>p.time===day+M)!.baseText).toBe(old);
 await vi.advanceTimersByTimeAsync(40000);expect(f.service.diagnostics().repairsBySource[source]).toMatchObject({blocked:true,failures:3,reason:'unavailable'});const count=f.service.diagnostics().repairs;await vi.advanceTimersByTimeAsync(10000);expect(f.service.diagnostics().repairs).toBe(count);
});
