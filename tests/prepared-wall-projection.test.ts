import {encodeWallPointTransport,WALL_POINT_TRANSPORT,WALL_PRODUCT_POINT_TRANSPORT} from '../src/shared/order-wall-point-transport';
import {OrderWallsPrimitive} from '../src/chart/order-walls';
import type {PrimitiveRenderContext} from 'openalgo-charts';
import * as compactCodec from '../src/feed/compact-wall-presentation';
import {wallHistoryPresentation,wallCompactPresentation} from '../src/feed/wall-history-presentation-cache';
import {test,expect,vi,afterEach} from 'vitest';import {createHash} from 'node:crypto';
import {OrderWallsArchiveProjector,loadOrderWallsArchive} from '../src/feed/order-walls-archive';
import {orderWallsSettings} from '../src/feed/order-walls';import {readPreparedWallProjection} from '../src/feed/prepared-wall-projection';
import {WALL_PROJECTION_CORE_SHA256} from '../src/shared/order-walls-projection-version';
import {OrderWallsArchiveService} from '../src/feed/order-walls-archive-service';
import {preparedWallReader} from '../src/feed/prepared-wall-history';
import {historyScheduler} from '../src/feed/history-scheduler';
afterEach(()=>vi.unstubAllEnvs());
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const from=1800000000000,to=from+30*3600000,settings=orderWallsSettings({enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10});
const normalized={topLevels:8,minimumNotionalEnabled:false,minimumNotionalUsd:0,minDurationMs:0};
const profile:any={id:'binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1',version:1,market:'spot',venue:'binance',instrument:'binance:spot:BTCUSDT',feed:'binance:spot:BTCUSDT:spot-diff-depth',aggregation:'native',bandPercent:10,midpointBasis:'best-observed-bid-ask',topN:10,algorithmVersion:1,schemaVersion:1,confirmationMs:0,selectionTopN:10,minimumNotionalUsd:null,exactDerivations:{bandPercent:[10],topNMax:10,minimumNotional:true,confirmation:true}};
const oldHead={cursor:30,epoch:2,at:to+1000},head={cursor:40,epoch:3,at:to+2000};
function fixture(split=false){
 const coverage:any={availableFrom:from-1000,requestedFrom:from,requestedTo:to,confirmedTo:to,gaps:[{at:from+3000,reason:'Observed disconnect'}],partial:true,status:'partial'};
 const candidate=(id:string)=>({entryId:id,side:'bid',price:'100.00000001',quantity:'2.000000000001',notional:'200.0000000001',rank:1,startedAt:from-1000,startCursor:1,startEpoch:1,startKnown:true});
 const page:any={version:1,profile,market:'spot',instrument:profile.instrument,feed:profile.feed,from,to,watermark:30,head:oldHead,
  page:{after:1,nextAfter:30,hasMore:false,lastAt:to,limit:4096,sameMillisecondClosed:true},seed:{at:from-1,cursor:1,epoch:1,midpoint:'100',bids:[candidate('A')],asks:[]},
  patches:[{kind:'patch',cursor:2,epoch:1,at:from+1000,midpoint:'100',bids:{upserts:[{...candidate('A'),quantity:'3.000000000003',notional:'300.0000000003'}],removals:[]},asks:{upserts:[],removals:[]}},
   {kind:'gap',cursor:3,epoch:2,at:from+3000,midpoint:'100',reason:'Observed disconnect',bids:{upserts:[],removals:[]},asks:{upserts:[],removals:[]}},
   {kind:'patch',cursor:4,epoch:2,at:from+4000,midpoint:'100',bids:{upserts:[{...candidate('B'),startCursor:4,startEpoch:2,startedAt:from+4000}],removals:[]},asks:{upserts:[],removals:[]}}],coverage};
 const original=new OrderWallsArchiveProjector(settings,from,to);original.applyPage(page);
 const full=original.checkpoint(),closed=original.takeClosedSegments(),active=original.checkpoint();
 const groups=closed.map(item=>{
  const base={order:full.segments.findIndex(s=>s.id===item.segment.id),totalRuns:item.segment.valueRuns.length};
  if(!split||item.segment.valueRuns.length<2)return [{...item,...base,offset:0}];
  return [0,1].map((offset,i)=>({...base,offset,segment:{...item.segment,valueRuns:i===0?item.segment.valueRuns.slice(0,1):item.segment.valueRuns.slice(1)},valueRunOrder:i===0?item.valueRunOrder.slice(0,1):item.valueRunOrder.slice(1)}));
 });
 const texts=groups.flatMap(group=>group.map(row=>JSON.stringify([row]))),parts=texts.map(text=>({hash:hash(text),bytes:Buffer.byteLength(text),records:1}));let index=0;
 const coordinates=groups.map(group=>group.map(()=>[index++,0]));
 const sourceKey='b'.repeat(64),sourceToken='a'.repeat(64),key=hash(JSON.stringify({version:2,sourceKey,core:WALL_PROJECTION_CORE_SHA256,settings:normalized}));
 const manifest:any={version:2,key,sourceKey,sourceToken,core:WALL_PROJECTION_CORE_SHA256,complete:true,settings:normalized,parts,closed:coordinates,active,activeOrder:active.segments.map(s=>full.segments.findIndex(v=>v.id===s.id)),coverage,profile};
 const source:any={version:1,kind:'wall-source-sha256-xor-v1',market:'spot',profile:profile.id,from,to,token:sourceToken,eligible:true,watermark:40,head};
 const canonicalText=JSON.stringify(page),canonicalPart={index:0,hash:hash(canonicalText),canonicalHash:hash(canonicalText),bytes:Buffer.byteLength(canonicalText),after:1,nextAfter:30};
 const canonical:any={version:5,key:sourceKey,complete:true,watermark:30,head:oldHead,after:30,request:{market:'spot',profile:profile.id,from,to,watermark:30,sourceRevision:hash(JSON.stringify([canonicalPart.canonicalHash]))},parts:[canonicalPart],sourceProof:{...source,watermark:30,head:oldHead}};
 const advertised={manifest,delivery:{version:1,maxParts:32,maxDecodedBytes:8*1024*1024}};
 return {manifest,texts,source,canonical,advertised,full,page,context:{sourceKey,sourceToken,watermark:30,epoch:2,from,to,profile:profile.id,market:'spot' as const,settings}};
}
function transport(f:ReturnType<typeof fixture>,options:{horizonAt?:number;changed?:boolean;corrupt?:boolean;gateSource?:Promise<void>;tailGate?:Promise<void>;firstGate?:Promise<void>}={}){
 const calls:string[]=[];const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input),'http://test');calls.push(url.pathname);
  if(url.pathname.endsWith('/horizon'))return Response.json({version:1,kind:'wall-source-horizon-v1',market:'spot',profile:profile.id,head:head,availableFrom:from-3600000});
  if(url.pathname.endsWith('/discover')){const response=Response.json({state:'ready',manifest:f.canonical,source:f.source,projection:f.advertised});if(new Headers(init?.headers).get('X-IQ-Wall-Resolve-Eligible')!=='1')return response;const requested={market:'spot',profile:profile.id,from:Number(url.searchParams.get('from')),to:Number(url.searchParams.get('to'))},horizon={version:1,kind:'wall-source-horizon-v1',market:'spot',profile:profile.id,head:{...head,at:options.horizonAt??head.at},availableFrom:from-3600000},request={...requested,to:Math.max(requested.from,Math.min(requested.to,horizon.head.at+1))};return Response.json({...await response.json(),eligibility:{version:1,kind:'wall-eligible-discovery-v1',requested,request,horizon}});}
  if(url.pathname.endsWith('/source')){await options.gateSource;return Response.json(options.changed?{...f.source,token:'c'.repeat(64)}:f.source);}
  if(url.pathname.endsWith('/projection-batch')){
   const start=Number(url.searchParams.get('start')),selected=f.manifest.parts.slice(start,start+32),mode=(f.advertised.delivery as any).productTransport===1?2:(f.advertised.delivery as any).pointTransport,compact=mode===1||mode===2;expect(url.searchParams.get('version')).toBe(mode===2?'3':compact?'2':'1');
   const texts=await Promise.all(f.texts.map(async text=>{const raw=options.corrupt?text.replace('100.00000001','100.00000002'):text;return compact?JSON.stringify((await encodeWallPointTransport(JSON.parse(raw),undefined,mode===2?2:1)).value):raw;}));let i=start;
   const body=new ReadableStream<Uint8Array>({async pull(controller){if(i>=start+selected.length){controller.close();return;}if(i===start)await options.firstGate;if(i>start)await options.tailGate;controller.enqueue(new TextEncoder().encode(texts[i]+'\n'));i++;}});
   return new Response(body,{headers:{...(compact?{'x-iq-wall-transport':mode===2?WALL_PRODUCT_POINT_TRANSPORT:WALL_POINT_TRANSPORT,'x-iq-wall-part-bytes':JSON.stringify(texts.slice(start,start+selected.length).map(text=>Buffer.byteLength(text))),'x-iq-canonical-bytes':String(selected.reduce((n:number,p:{bytes:number})=>n+p.bytes+1,0)),'x-iq-decoded-bytes':String(texts.slice(start,start+selected.length).reduce((n,text)=>n+Buffer.byteLength(text)+1,0))}:{}),'x-iq-wall-start':String(start),'x-iq-wall-next':String(start+selected.length),'x-iq-wall-parts':String(selected.length),'x-iq-chunk-key':f.manifest.key,'x-iq-source-revision':f.manifest.sourceToken}});
  }
  throw Error('Unexpected canonical replay request: '+url.pathname);
 });return {fetcher:fetcher as typeof fetch,calls};
}
test('progressive chunks validate without throwaway restores and final restore retains exact financial state',async()=>{
 const f=fixture(true),t=transport(f),restore=vi.spyOn(OrderWallsArchiveProjector,'restoreCheckpointCooperatively');
 try{
  const result=await readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:new AbortController().signal},()=>{});
  expect(restore).toHaveBeenCalledTimes(1);
  expect(result?.projector.checkpoint()).toEqual(OrderWallsArchiveProjector.restoreCheckpoint(f.full,settings,from,to).checkpoint());
 }finally{restore.mockRestore();}
});
test('a cold service view fingerprints the full manifest once without a redundant warm-cache probe',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f),events:any[]=[],expected=Buffer.from(JSON.stringify(f.manifest)),digest=vi.spyOn(crypto.subtle,'digest');
 const service=new OrderWallsArchiveService(event=>events.push(event),t.fetcher,()=>to+1000);
 try{
  service.subscribe('cold',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.requestComplete).toBe(true));
  expect(digest.mock.calls.filter(([,bytes])=>Buffer.from(bytes as Uint8Array).equals(expected))).toHaveLength(1);
 }finally{service.dispose();digest.mockRestore();}
});
test('actual archive loader imports exact prepared cells, retains gaps and rebases only the quiet head',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f),updates:any[]=[],metrics:any[]=[];
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u),onPageMetrics:m=>metrics.push(m)});
 const reference=new OrderWallsArchiveProjector(settings,from,to);reference.applyPage({...f.page,watermark:40,head,page:{...f.page.page,nextAfter:40}});
 expect(result.segments).toEqual(reference.snapshot());expect(result.projector?.selectedState()).toEqual(reference.selectedState());expect(result.head).toEqual(head);expect(result.cursor).toBe(40);
 expect(result.status.archive).toMatchObject({requestComplete:true,rangeComplete:false,gaps:[{from:from+3000,to:from+3000,reason:'Observed disconnect'}]});
 expect(updates.slice(0,-1).every(u=>u.status.archive.requestComplete===false&&u.status.archive.loadedThrough===from)).toBe(true);
 expect(t.calls).toEqual(['/market-data/v2/history/walls/discover','/market-data/v2/history/walls/projection-batch','/market-data/v2/history/walls/source']);expect(metrics.every(m=>m.delivery==='projection')).toBe(true);
});
test('explicit projection capability accepts a manifest above the legacy discovery budget',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),t=transport(f);(f.manifest as any).testMetadataPadding='x'.repeat(200000);
 let capability:string|null=null;const fetcher:typeof fetch=(input,init)=>{if(String(input).includes('/discover?'))capability=new Headers(init?.headers).get('X-IQ-Wall-Projection');return t.fetcher(input,init);};
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher});expect(capability).toBe(WALL_PROJECTION_CORE_SHA256);expect(result.status.archive?.requestComplete).toBe(true);
});
test('painted prepared records remain incomplete while final independent source validation is delayed or fails',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');let release!:()=>void;const gateSource=new Promise<void>(r=>release=r),f=fixture(),t=transport(f,{changed:true,gateSource}),updates:any[]=[];
 const work=loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u)});void work.catch(()=>{});
 await vi.waitFor(()=>expect(t.calls.at(-1)).toMatch(/\/source$/));expect(updates.at(-1).presentation.size).toBe(f.full.segments.length);expect(updates.every(u=>u.status.archive.requestComplete===false)).toBe(true);
 const before=[...updates.at(-1).presentation.values()];release();await expect(work).rejects.toThrow(/source changed/);expect([...updates.at(-1).presentation.values()]).toEqual(before);
});
test('independent revision read overlaps final assembly but cannot publish completion until validated',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');
 const f=fixture(true);let release!:()=>void;
 const gateSource=new Promise<void>(resolve=>release=resolve),io=transport(f,{gateSource}),updates:any[]=[];
 const original=OrderWallsArchiveProjector.restoreCheckpointCooperatively;
 const restore=vi.spyOn(OrderWallsArchiveProjector,'restoreCheckpointCooperatively');let finalRestored=false;
 restore.mockImplementation((...args)=>{
  if((args[0] as any).segments.length===f.full.segments.length){
   expect(io.calls.at(-1)).toMatch(/\/source$/);finalRestored=true;
  }
  return original.apply(OrderWallsArchiveProjector,args);
 });
 const work=loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:io.fetcher,onUpdate:u=>updates.push(u)});void work.catch(()=>{});
 try{
  await vi.waitFor(()=>expect(finalRestored).toBe(true));
  expect(updates.every(u=>u.status.archive.requestComplete===false)).toBe(true);
  release();const result=await work;expect(result.status.archive?.requestComplete).toBe(true);
  restore.mockRestore();expect(result.segments).toEqual(OrderWallsArchiveProjector.restoreCheckpoint(f.full,settings,from,to).snapshot());
  expect(io.calls.filter(path=>path.endsWith('/source'))).toHaveLength(1);
 }finally{release();restore.mockRestore();}
});

test('cancel during overlapped source validation retains partial data and prevents completion',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');
 const f=fixture(true);let release!:()=>void;const controller=new AbortController();
 const gateSource=new Promise<void>(resolve=>release=resolve),io=transport(f,{gateSource}),updates:any[]=[];
 const work=loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:io.fetcher,signal:controller.signal,onUpdate:u=>updates.push(u)});void work.catch(()=>{});
 try{
  await vi.waitFor(()=>expect(io.calls.at(-1)).toMatch(/\/source$/));
  controller.abort();release();await expect(work).rejects.toThrow(/abort/i);
  expect(updates.at(-1).presentation.size).toBe(f.full.segments.length);
  expect(updates.every(u=>u.status.archive.requestComplete===false)).toBe(true);
 }finally{release();}
});

test('global checkpoint failure remains fatal when overlapping source validation also rejects',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),rows=JSON.parse(f.texts[0]!);
 // Each part is valid on its own, but this closed value collides with an active
 // value's global retention sequence. Only the final full restore can reject it.
 rows[0].valueRunOrder[0]=f.manifest.active.valueRunOrder[0][0];
 f.texts[0]=JSON.stringify(rows);Object.assign(f.manifest.parts[0],{hash:hash(f.texts[0]!),bytes:Buffer.byteLength(f.texts[0]!)});
 const io=transport(f,{changed:true}),updates:any[]=[];
 await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:io.fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/Invalid wall projection checkpoint/);
 expect(io.calls.filter(path=>path.endsWith('/source'))).toHaveLength(1);
 expect(updates.every(u=>u.status.archive.requestComplete===false)).toBe(true);
});

test('fragment holes, wrong order, duplicate coordinates and corrupted content never publish completion',async()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>f.manifest.closed[0].reverse(),(f:ReturnType<typeof fixture>)=>f.manifest.closed.push(f.manifest.closed[0])]){
  const f=fixture(true);mutate(f);const t=transport(f);await expect(readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:new AbortController().signal},()=>{})).rejects.toThrow(/fragment|coordinates/);
 }
 const f=fixture(),t=transport(f,{corrupt:true}),updates:any[]=[];
 await expect(readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:new AbortController().signal},u=>updates.push(u))).rejects.toThrow(/hash mismatch/);
 expect(updates).toHaveLength(1);expect(updates[0].segments.every((s:any)=>s.end===null)).toBe(true);expect(t.calls.some(path=>path.endsWith('/source'))).toBe(false);
});
test('incompatible settings/core fall back before transfer and abort prevents further progressive publication',async()=>{
 const f=fixture(),t=transport(f),signal=new AbortController();
 expect(await readPreparedWallProjection(f.advertised,{...f.context,settings:{...settings,topLevels:4},fetcher:t.fetcher,signal:signal.signal},()=>{})).toBeNull();expect(t.calls).toHaveLength(0);
 const old={...f.advertised,manifest:{...f.manifest,core:'c'.repeat(64)}};expect(await readPreparedWallProjection(old,{...f.context,fetcher:t.fetcher,signal:signal.signal},()=>{})).toBeNull();
 let count=0;await expect(readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:signal.signal},()=>{count++;signal.abort();})).rejects.toThrow(/abort/i);expect(count).toBe(1);expect(t.calls).toHaveLength(0);
});
test('first wall member leaves admission for native prices before bounded batch pipelining',async()=>{
 const f=fixture(),closed=JSON.parse(f.texts[0]!)[0],texts:string[]=[];
 for(let i=0;i<35;i++)texts.push(JSON.stringify([{...closed,order:i,segment:{...closed.segment,id:closed.segment.id+':'+i},valueRunOrder:closed.valueRunOrder.map((n:number)=>n+i*10)}]));
 f.texts=texts;f.manifest.parts=texts.map(text=>({hash:hash(text),bytes:Buffer.byteLength(text),records:1}));f.manifest.closed=texts.map((_,i)=>[[i,0]]);
 f.manifest.activeOrder=[35];f.manifest.active.valueRunOrder=f.manifest.active.valueRunOrder.map((values:number[])=>values.map(n=>n+400));f.manifest.active.nextValueRunSequence=500;
 let releaseFirst!:()=>void,releaseNative!:()=>void;const firstGate=new Promise<void>(r=>releaseFirst=r),nativeGate=new Promise<void>(r=>releaseNative=r),abort=new AbortController();
 const t=transport(f,{firstGate}),work=readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:abort.signal},()=>{});void work.catch(()=>{});
 let native:Promise<number>|undefined,nativeStarted=false;
 try{
  await vi.waitFor(()=>expect(t.calls.length).toBeGreaterThan(0));
  native=historyScheduler.read('fixture-visible-native-prices','candles',abort.signal,async()=>{nativeStarted=true;await nativeGate;return 1;});void native.catch(()=>{});
  await vi.waitFor(()=>expect(nativeStarted).toBe(true));expect(t.calls).toHaveLength(1);
  releaseFirst();await vi.waitFor(()=>expect(t.calls).toHaveLength(2));releaseNative();
  const result=await work;await native;
  expect(result?.parts).toBe(35);expect(result?.projector.snapshot()).toHaveLength(36);expect(t.calls.every(path=>path.endsWith('/projection-batch'))).toBe(true);
 }finally{releaseFirst();releaseNative();abort.abort();await Promise.allSettled([work,...(native?[native]:[])]);}
});
test('shared service joins and Retry retain the prepared presentation until the full replacement validates',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),old=transport(f,{changed:true});let release!:()=>void;
 const gateSource=new Promise<void>(resolve=>release=resolve),next=transport(f,{gateSource});let phase=0;
 const fetcher:typeof fetch=(input,init)=>(phase===0?old:next).fetcher(input,init),events:any[]=[],service=new OrderWallsArchiveService(event=>events.push(event),fetcher,()=>to+3600000);
 try{
  service.subscribe('one',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.at(-1)?.status?.message).toMatch(/source changed/));
  expect(events.some(event=>event.kind==='patch'&&event.patches?.some((p:any)=>p.segment?.end!==null))).toBe(true);
  const before=events.length;phase=1;service.retry('one');await vi.waitFor(()=>expect(next.calls.at(-1)).toMatch(/\/source$/));
  expect(events.slice(before).every(event=>event.kind!=='snapshot')).toBe(true);
  release();await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.requestComplete).toBe(true));
  expect(events.filter(event=>event.kind==='snapshot').at(-1).segments).toHaveLength(f.full.segments.length);
  // A late subscriber receives the complete shared presentation/projector,
  // rather than only the most recently delivered batch.
  service.subscribe('two',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.filter(event=>event.ids?.includes('two')).at(-1)?.segments).toHaveLength(f.full.segments.length));
  service.unsubscribe('one');service.unsubscribe('two');expect(service.diagnostics().historyJobs).toBe(0);
 }finally{release();service.dispose();}
 await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
});
test('prepared completion preserves already painted segments and a late join still receives a full snapshot',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f),events:any[]=[],service=new OrderWallsArchiveService(event=>events.push(event),t.fetcher,()=>to+3600000);
 try{
  service.subscribe('first',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.requestComplete).toBe(true));
  const first=events.filter(event=>event.ids?.includes('first'));expect(first.filter(event=>event.kind==='snapshot'&&event.segments.length)).toHaveLength(1);
  const displayed=new Map<string,any>();for(const event of first){if(event.kind==='snapshot'){displayed.clear();for(const segment of event.segments)displayed.set(segment.id,segment);}else for(const patch of event.patches){if(patch.segment)displayed.set(patch.id,patch.segment);else displayed.delete(patch.id);}}
  const reference=new OrderWallsArchiveProjector(settings,from,to);reference.applyPage(f.page);
  expect([...displayed.values()].sort((a,b)=>a.id.localeCompare(b.id))).toEqual(reference.snapshot().sort((a,b)=>a.id.localeCompare(b.id)));
  service.subscribe('late',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.filter(event=>event.ids?.includes('late')).at(-1)?.segments).toHaveLength(displayed.size));
 }finally{service.dispose();}
 await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
});
test('settled prepared jobs release mutable retention queues and late joins own detached exact records',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f),events:any[]=[],restore=vi.spyOn(OrderWallsArchiveProjector,'restoreCheckpointCooperatively');
 const service=new OrderWallsArchiveService(event=>events.push(event),t.fetcher,()=>to+3600000),request={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('first',request);await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.requestComplete).toBe(true));
  expect(service.diagnostics()).toMatchObject({historyJobs:1,historyConsumers:1,projections:[]});
  const completed=await restore.mock.results.at(-1)!.value as OrderWallsArchiveProjector;
  expect(completed.diagnostics().retainedSegments).toBe(f.full.segments.length);
  // A deliberately mutated discarded replay cannot corrupt the still-open
  // history job, its late subscribers, or the independently owned warm cache.
  completed.censorOpen(to,'Discarded mutable replay');
  for(const segment of completed.snapshot())for(const point of segment.valueRuns)point.quantity=0;
  const before=t.calls.length;service.subscribe('late',request);
  await vi.waitFor(()=>expect(events.filter(event=>event.ids?.includes('late')).at(-1)?.status?.archive?.requestComplete).toBe(true));
  expect(t.calls).toHaveLength(before);
  const late=events.filter(event=>event.ids?.includes('late')).at(-1);
  expect(late.segments.sort((a:any,b:any)=>a.id.localeCompare(b.id))).toEqual([...f.full.segments].sort((a,b)=>a.id.localeCompare(b.id)));
  expect(service.diagnostics()).toMatchObject({historyJobs:1,historyConsumers:2,projections:[]});
  service.unsubscribe('first');service.unsubscribe('late');expect(service.diagnostics()).toMatchObject({historyJobs:0,historyConsumers:0,projections:[]});
 }finally{service.dispose();restore.mockRestore();}
});

test('projection retry attempts reach page diagnostics and financial records publish once',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),t=transport(f),metrics:any[]=[],updates:any[]=[];let batches=0;
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input).includes('/projection-batch?')&&++batches===1)return new Response(null,{status:408});
  return t.fetcher(input,init);
 };
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher,onPageMetrics:m=>metrics.push(m),onUpdate:u=>updates.push(u)});
 const reference=new OrderWallsArchiveProjector(settings,from,to);reference.applyPage(f.page);
 expect(result.status.archive?.requestComplete).toBe(true);expect(result.segments).toEqual(reference.snapshot());
 expect(metrics.filter(m=>m.delivery==='projection')).toHaveLength(f.manifest.parts.length);
 expect(metrics.filter(m=>m.delivery==='projection').every(m=>m.attempts===2)).toBe(true);
 expect(updates.filter(u=>u.presentation&&u.kind==='patch').flatMap(u=>u.patches??[]).map(p=>p.id)).toHaveLength(f.full.segments.length-f.manifest.active.segments.length);
});

test.each(['newer','older'] as const)('%s quiet-head rebinding restores retained history once without a transport-metadata clone',async direction=>{
 const f=fixture(true),target=direction==='newer'?head:{cursor:25,epoch:2,at:to+1000};
 const anchor={cursor:1,epoch:1,at:from-1,hash:'c'.repeat(64)};Object.assign(f.source,{maxCursor:4,anchor});Object.assign(f.canonical.sourceProof,{maxCursor:4,anchor});
 const t=transport(f),reader=await preparedWallReader({market:'spot',profile:profile.id,from,to,watermark:target.cursor,head:target},t.fetcher,new AbortController().signal,undefined,settings);
 expect(reader).not.toBeNull();
 const checkpoint=vi.spyOn(OrderWallsArchiveProjector.prototype,'checkpoint'),restore=vi.spyOn(OrderWallsArchiveProjector,'restoreCheckpointCooperatively');
 try{
  const result=await reader!.readProjection(settings,()=>{});
  expect(result).not.toBeNull();expect(checkpoint).not.toHaveBeenCalled();
  const completeRestores=restore.mock.calls.filter(([value])=>(value as any).segments.length===f.full.segments.length);
  expect(completeRestores).toHaveLength(1);expect(completeRestores[0]![0]).toMatchObject({cursor:target.cursor,epoch:target.epoch});
  const reference=new OrderWallsArchiveProjector(settings,from,to);reference.applyPage({...f.page,watermark:target.cursor,head:target,page:{...f.page.page,nextAfter:target.cursor}});
  expect(result!.projector.snapshot()).toEqual(reference.snapshot());expect(result!.projector.selectedState()).toEqual(reference.selectedState());
 }finally{checkpoint.mockRestore();restore.mockRestore();reader?.dispose();}
});

test('prepared warm revisits retain detached presentation without a second mutable projector or history clone',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),first=transport(f);let release!:()=>void;
 const gateSource=new Promise<void>(resolve=>release=resolve),validation=transport(f,{gateSource}),events:any[]=[];let phase=0;
 const restore=vi.spyOn(OrderWallsArchiveProjector,'restoreCheckpointCooperatively'),clone=vi.spyOn(OrderWallsArchiveProjector.prototype,'cloneForLiveTail');
 const service=new OrderWallsArchiveService(event=>events.push(event),(input,init)=>(phase===0?first:validation).fetcher(input,init),()=>to+3600000);
 const subscription={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('first',subscription);await vi.waitFor(()=>expect(events.at(-1)?.status.archive.requestComplete).toBe(true));
  expect(clone).not.toHaveBeenCalled();expect(service.diagnostics()).toMatchObject({warmEntries:1,warmSegments:f.full.segments.length,warmRuns:f.full.segments.reduce((n,s)=>n+s.valueRuns.length,0)});
  const completed=(await Promise.all(restore.mock.results.map(result=>result.value as Promise<OrderWallsArchiveProjector>|undefined))).find(projector=>projector?.diagnostics().retainedSegments===f.full.segments.length)!;
  // Even an active replay mutation cannot change the detached cached records.
  completed.censorOpen(to,'Test replay mutation after cache admission');
  service.unsubscribe('first');expect(service.diagnostics()).toMatchObject({projections:[],historyJobs:0});
  phase=1;service.subscribe('revisit',subscription);
  const cached=events.filter(event=>event.ids?.includes('revisit')&&event.kind==='snapshot').at(-1);
  expect(cached.segments.sort((a:any,b:any)=>a.id.localeCompare(b.id))).toEqual(f.full.segments.map(segment=>({...segment,currentSelection:false})).sort((a,b)=>a.id.localeCompare(b.id)));
  expect(cached.status.archive).toMatchObject({state:'loading',requestComplete:false});
  await vi.waitFor(()=>expect(validation.calls.at(-1)).toMatch(/\/source$/));
  expect(events.filter(event=>event.ids?.includes('revisit')&&event.kind==='snapshot'&&event.segments?.length)).toHaveLength(1);
  release();await vi.waitFor(()=>expect(events.at(-1)?.status.archive.requestComplete).toBe(true));
  expect(clone).not.toHaveBeenCalled();service.unsubscribe('revisit');expect(service.diagnostics().projections).toHaveLength(0);
  for(let cycle=0;cycle<20;cycle++){
   const id='reopen-'+cycle;service.subscribe(id,subscription);
   await vi.waitFor(()=>expect(events.filter(event=>event.ids?.includes(id)).at(-1)?.status.archive.requestComplete).toBe(true),{interval:5});
   service.unsubscribe(id);expect(service.diagnostics()).toMatchObject({subscriptions:0,historyJobs:0,historyConsumers:0,groups:0,projections:[],warmEntries:1,warmSegments:f.full.segments.length});
  }
  expect(clone).not.toHaveBeenCalled();
 }finally{release();service.dispose();restore.mockRestore();clone.mockRestore();}
 expect(service.diagnostics()).toMatchObject({warmEntries:0,warmSegments:0,warmRuns:0,warmBytes:0});
});

test('presentation cache preserves a censorship applied after final restore and detaches active/fallback points',()=>{
 const f=fixture(),projector=OrderWallsArchiveProjector.restoreCheckpoint(f.full,settings,from,to),prepared=new Map(f.full.segments.map(segment=>[segment.id,segment]));
 projector.censorOpen(to,'Verified tail could not be joined');const snapshot=projector.snapshot(),cache=wallHistoryPresentation(snapshot,prepared)!;
 expect([...cache.values()]).toEqual(snapshot);expect([...cache.values()].every(segment=>segment.end!==null)).toBe(true);
 const formerlyActive=f.full.segments.find(segment=>segment.end===null)!,cached=cache.get(formerlyActive.id)!;
 expect(cached).not.toBe(formerlyActive);expect(cached.valueRuns[0]).not.toBe(snapshot.find(s=>s.id===cached.id)!.valueRuns[0]);
 expect(cached.censoredReason).toBe('Verified tail could not be joined');
 const compact=wallCompactPresentation(snapshot,prepared)!.get(formerlyActive.id)!;expect(compact).toEqual(cached);expect(compact.valueRuns).toBe(formerlyActive.valueRuns);expect(compact.valueRuns).not.toBe(snapshot.find(s=>s.id===cached.id)!.valueRuns);
 const fallback=wallHistoryPresentation(snapshot)!;for(const segment of snapshot){expect(fallback.get(segment.id)).not.toBe(segment);expect(fallback.get(segment.id)!.valueRuns[0]).not.toBe(segment.valueRuns[0]);}
 expect(wallHistoryPresentation(snapshot,new Map())).toBeUndefined();
});

test('compact warm replay is shared, survives one unsubscribe and never marks fresh coverage complete',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),first=transport(f);let release!:()=>void,phase=0;
 const gateSource=new Promise<void>(r=>release=r),fresh=transport(f,{gateSource}),events:any[]=[];
 // Lower representation threshold exercises the exact same bounded codec on a
 // small fixture. Real default-budget admission is verified by the file probe.
 const service=new OrderWallsArchiveService(event=>events.push(event),(input,init)=>(phase?fresh:first).fetcher(input,init),()=>to+1000,0);
 const subscription={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('seed',subscription);await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmEntries:1,warmCompactEntries:1,warmBuilds:0}));service.unsubscribe('seed');
  expect(service.diagnostics().projections).toHaveLength(0);phase=1;service.subscribe('a',subscription);service.subscribe('b',subscription);
  await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('b')&&e.kind==='patch').flatMap(e=>e.patches??[]).filter(p=>p.segment)).toHaveLength(f.full.segments.length));
  expect(events.filter(e=>e.ids?.includes('b')).at(-1)?.status.archive.gaps).toHaveLength(1);
  const firstCached=events.find(e=>e.ids?.includes('b')&&e.kind==='patch'&&e.patches?.some((p:any)=>p.segment));
  expect(firstCached.status.archive.loadedThrough).toBe(from);expect(firstCached.status.archive.requestComplete).toBe(false);
  const primitive=new OrderWallsPrimitive({...settings,showHistory:true,aggregation:'native'},900000);
  const context={timeScale:{visibleRange:()=>({from:0,to:120}),indexToX:(index:number)=>index*500/120,xToIndex:(x:number)=>x*120/500},priceScale:{priceRange:()=>({min:95,max:105}),priceToY:()=>100},dataLayer:{length:121,baseIndex:120,indexToTime:(index:number)=>(from+index*(to-from)/120)/1000,indexToTimeFloat:(index:number)=>(from+index*(to-from)/120)/1000,timeToIndexFloat:(seconds:number)=>(seconds*1000-from)*120/(to-from)},plotWidth:500,plotHeight:200,dpr:1} as unknown as PrimitiveRenderContext;
  const canvas={save(){},beginPath(){},rect(){},clip(){},setLineDash(){},moveTo(){},lineTo(){},stroke(){},restore(){}} as unknown as CanvasRenderingContext2D;
  primitive.setSnapshot(firstCached.patches.filter((p:any)=>p.segment).map((p:any)=>p.segment),firstCached.status);primitive.draw(canvas,context);
  expect(primitive.orderWallAt(400,100)?.segment.archiveEntryId).toBe('B');primitive.detached();
  expect(service.diagnostics().warmReplayConsumers).toBe(2);service.unsubscribe('a');expect(service.diagnostics().warmReplayConsumers).toBe(1);
  const visible=new Map<string,any>();for(const e of events.filter(e=>e.ids?.includes('b'))){if(e.kind==='snapshot'){visible.clear();for(const segment of e.segments)visible.set(segment.id,segment);}else for(const p of e.patches){if(p.segment)visible.set(p.id,p.segment);else visible.delete(p.id);}}
  expect([...visible.values()].sort((a,b)=>a.id.localeCompare(b.id))).toEqual(f.full.segments.map(segment=>({...segment,currentSelection:false})).sort((a,b)=>a.id.localeCompare(b.id)));
  expect(events.filter(e=>e.ids?.includes('b')).every(e=>e.status.archive.requestComplete===false)).toBe(true);
  release();await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('b')).at(-1)?.status.archive.requestComplete).toBe(true));
  service.unsubscribe('b');await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmBuilds:0,warmReplayConsumers:0,historyConsumers:0,projections:[]}));
 }finally{release();service.dispose();}
});

test('compact cached history paints and validates independently of delayed current bootstrap; last release cancels current',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f),events:any[]=[],signals:AbortSignal[]=[];
 const service=new OrderWallsArchiveService(event=>events.push(event),(input,init)=>{
  if(String(input).includes('/current?')){signals.push(init!.signal as AbortSignal);return new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}
  return t.fetcher(input,init);
 },()=>to+1000,0);
 try{
  service.subscribe('seed',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(service.diagnostics().warmCompactEntries).toBe(1));service.unsubscribe('seed');
  service.subscribe('live',{market:'binance-spot',from,to,settings,followLive:true});
  await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('live')&&e.kind==='patch').flatMap(e=>e.patches??[]).filter(p=>p.segment)).toHaveLength(f.full.segments.length));
  expect(events.filter(e=>e.ids?.includes('live')).some(e=>e.status.archive.requestComplete===false)).toBe(true);
  await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('live')).at(-1)?.status.archive.requestComplete).toBe(true));
  expect(signals).toHaveLength(1);expect(signals[0]!.aborted).toBe(false);
  service.unsubscribe('live');expect(signals[0]!.aborted).toBe(true);expect(service.diagnostics()).toMatchObject({warmReplayConsumers:0,historyJobs:0,groups:0,projections:[]});
  await vi.waitFor(()=>expect(service.diagnostics().warmReplayJobs).toBe(0));
 }finally{service.dispose();}
});


test('bounded compact builds cancel obsolete work and cannot overwrite a later completed view',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),t=transport(f),events:any[]=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),encode=compactCodec.compactWallPresentation,signals:AbortSignal[]=[];
 const spy=vi.spyOn(compactCodec,'compactWallPresentation').mockImplementation(async(...args)=>{signals.push(args[2]);await gate;args[2].throwIfAborted();return encode(...args);});
 const service=new OrderWallsArchiveService(event=>events.push(event),t.fetcher,()=>to+1000,0),request={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  for(let i=0;i<3;i++){service.subscribe('build-'+i,request);await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('build-'+i)).at(-1)?.status.archive.requestComplete).toBe(true));service.unsubscribe('build-'+i);}
  expect(service.diagnostics()).toMatchObject({warmEntries:0,warmBuilds:2,warmCapacityMisses:1});expect(signals[0]!.aborted).toBe(true);
  release();await vi.waitFor(()=>expect(service.diagnostics().warmBuilds).toBe(0));expect(service.diagnostics()).toMatchObject({warmEntries:0,warmBuildFailures:0});
  service.subscribe('recovered',request);await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmEntries:1,warmCompactEntries:1,warmBuilds:0}));
 }finally{release();service.dispose();spy.mockRestore();}
});

test('a corrupt compact cache falls back to the good fresh prefix and recovers without resetting its job',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),seed=transport(f);let phase=0,release!:()=>void;
 const gateSource=new Promise<void>(resolve=>release=resolve),fresh=transport(f,{gateSource}),events:any[]=[];
 const service=new OrderWallsArchiveService(event=>events.push(event),(input,init)=>(phase?fresh:seed).fetcher(input,init),()=>to+1000,0),request={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('seed',request);await vi.waitFor(()=>expect(service.diagnostics().warmCompactEntries).toBe(1));service.unsubscribe('seed');
  // Fault injection changes retained bytes, not source financial fixtures.
  const entry=[...(service as any).warmHistory.values()][0],body=entry.compact.chunks[0].body as Uint8Array;body[body.length-1]^=255;
  phase=1;service.subscribe('retry',request);await vi.waitFor(()=>expect(service.diagnostics().warmDecodeFailures).toBe(1));
  await vi.waitFor(()=>expect(fresh.calls.at(-1)).toMatch(/\/source$/));
  expect(events.filter(e=>e.ids?.includes('retry')).at(-1).status.archive.requestComplete).toBe(false);
  release();await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('retry')).at(-1).status.archive.requestComplete).toBe(true));
  await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmCompactEntries:1,warmBuilds:0,warmReplayConsumers:0}));expect(service.diagnostics().historyRequests).toBe(2);
 }finally{release();service.dispose();}
});

test('negotiated exact point transport reconstructs the identical selected walls and rejects canonical corruption',async()=>{
 for(const mode of [1,2])for(const corrupt of [false,true]){const f=fixture();(f.advertised.delivery as any).pointTransport=1;if(mode===2)(f.advertised.delivery as any).productTransport=1;const io=transport(f,{corrupt});const ready:any[]=[];
  if(corrupt)await expect(readPreparedWallProjection(f.advertised,{...f.context,fetcher:io.fetcher,signal:new AbortController().signal},p=>ready.push(p))).rejects.toThrow(/hash/);
  else{const result=await readPreparedWallProjection(f.advertised,{...f.context,fetcher:io.fetcher,signal:new AbortController().signal},p=>ready.push(p));expect(result?.projector.snapshot()).toEqual(OrderWallsArchiveProjector.restoreCheckpoint(f.full,f.context.settings,f.context.from,f.context.to).snapshot());expect(ready.at(-1).metrics.validationMs).toBeGreaterThanOrEqual(0);}
 }
});

function displayedWalls(events:any[],id:string){
 const rows=new Map<string,any>();for(const e of events.filter(e=>e.ids?.includes(id))){if(e.kind==='snapshot'){rows.clear();for(const s of e.segments??[])rows.set(s.id,s);}else for(const p of e.patches??[]){if(p.segment)rows.set(p.id,p.segment);else rows.delete(p.id);}}return rows;
}
test('identical complete prepared manifest validates warm rows without a second presentation snapshot',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');
 for(const compact of [false,true]){
  const f=fixture(true),seed=transport(f);let release!:()=>void;const sourceGate=new Promise<void>(r=>release=r),fresh=transport(f,{gateSource:sourceGate});let phase=0;
  const events:any[]=[],service=new OrderWallsArchiveService(e=>events.push(e),(input,init)=>(phase?fresh:seed).fetcher(input,init),()=>to+1000,compact?0:16*1024*1024),request={market:'binance-spot' as const,from,to,settings,followLive:false};
  try{
   service.subscribe('seed',request);await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmEntries:1,warmBuilds:0}));service.unsubscribe('seed');phase=1;
   service.subscribe('warm',request);await vi.waitFor(()=>expect(fresh.calls.at(-1)).toMatch(/\/source$/));
   await vi.waitFor(()=>expect(displayedWalls(events,'warm').size).toBe(f.full.segments.length));await vi.waitFor(()=>expect(service.diagnostics().warmReplayJobs).toBe(0));
   const displayed=[...displayedWalls(events,'warm').values()],snapshots=events.filter(e=>e.ids?.includes('warm')&&e.kind==='snapshot').length,before=events.length;
   expect(events.at(-1).status.archive.requestComplete).toBe(false);release();
   await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('warm')).at(-1).status.archive.requestComplete).toBe(true));
   expect(events.slice(before).filter(e=>e.ids?.includes('warm')).every(e=>e.kind==='patch'&&e.patches.length===0)).toBe(true);
   expect(events.filter(e=>e.ids?.includes('warm')&&e.kind==='snapshot')).toHaveLength(snapshots);
   expect([...displayedWalls(events,'warm').values()]).toEqual(displayed);expect(service.diagnostics().warmValidatedReuses).toBe(1);
   expect(fresh.calls).toEqual(['/market-data/v2/history/walls/discover','/market-data/v2/history/walls/source']);
   expect(service.diagnostics().projections).toHaveLength(0);
   // A new viewer still needs a complete authoritative shared snapshot.
   service.subscribe('late',request);await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('late')).at(-1)?.segments).toHaveLength(f.full.segments.length));
   service.unsubscribe('late');service.unsubscribe('warm');expect(service.diagnostics()).toMatchObject({warmReplayConsumers:0,historyJobs:0,historyConsumers:0});
  }finally{release();service.dispose();}
 }
});

test('cached manifest reuse retains exact rows through failed source proof and a successful explicit Retry',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),seed=transport(f),bad=transport(f,{changed:true}),recovered=transport(f);let phase=0;
 const events:any[]=[],service=new OrderWallsArchiveService(e=>events.push(e),(input,init)=>(phase===0?seed:phase===1?bad:recovered).fetcher(input,init),()=>to+1000,0),request={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('seed',request);await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmCompactEntries:1,warmBuilds:0}));service.unsubscribe('seed');phase=1;
  service.subscribe('warm',request);await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('warm')).at(-1)?.status.message).toMatch(/source changed/));
  expect(events.filter(e=>e.ids?.includes('warm')).at(-1).status.archive.requestComplete).toBe(false);
  expect(displayedWalls(events,'warm').size).toBe(f.full.segments.length);expect(bad.calls.some(path=>path.endsWith('/projection-batch'))).toBe(false);
  const before=[...displayedWalls(events,'warm').values()];phase=2;service.retry('warm');
  await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('warm')).at(-1)?.status.archive.requestComplete).toBe(true));
  expect([...displayedWalls(events,'warm').values()]).toEqual(before);
  expect(events.filter(e=>e.ids?.includes('warm')).at(-1).status.message??'').not.toMatch(/source changed/);
  expect(recovered.calls.some(path=>path.endsWith('/projection-batch'))).toBe(false);
 }finally{service.dispose();}
});

test('a failed cached replay falls back to full authenticated prepared records',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f),events:any[]=[],service=new OrderWallsArchiveService(e=>events.push(e),t.fetcher,()=>to+1000,0),request={market:'binance-spot' as const,from,to,settings,followLive:false};
 let spy:{mockRestore:()=>unknown}|undefined;
 try{
  service.subscribe('seed',request);await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmCompactEntries:1,warmBuilds:0}));service.unsubscribe('seed');const before=t.calls.length;
  spy=vi.spyOn(compactCodec,'replayCompactWallPresentation').mockRejectedValueOnce(Error('Corrupt cached presentation'));
  service.subscribe('warm',request);await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('warm')).at(-1)?.status.archive.requestComplete).toBe(true));
  expect(t.calls.slice(before).some(path=>path.endsWith('/projection-batch'))).toBe(true);
  expect(service.diagnostics().warmDecodeFailures).toBe(1);
  expect([...displayedWalls(events,'warm').values()].sort((a,b)=>a.id.localeCompare(b.id))).toEqual([...f.full.segments].sort((a,b)=>a.id.localeCompare(b.id)));
 }finally{service.dispose();spy?.mockRestore();}
});

test('changed presentation metadata with the same source token cannot reuse warm geometry',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const old=fixture(true),revised=fixture(true);revised.manifest.coverage.gaps[0].reason='Corrected coverage detail';expect(revised.manifest.sourceToken).toBe(old.manifest.sourceToken);
 const seed=transport(old);let release!:()=>void;const gateSource=new Promise<void>(r=>release=r),fresh=transport(revised,{gateSource});let phase=0;
 const events:any[]=[],service=new OrderWallsArchiveService(e=>events.push(e),(input,init)=>(phase?fresh:seed).fetcher(input,init),()=>to+1000,0),request={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('seed',request);await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmCompactEntries:1,warmBuilds:0}));service.unsubscribe('seed');phase=1;
  service.subscribe('warm',request);await vi.waitFor(()=>expect(fresh.calls.at(-1)).toMatch(/\/source$/));await vi.waitFor(()=>expect(service.diagnostics().warmReplayJobs).toBe(0));
  const before=events.filter(e=>e.ids?.includes('warm')&&e.kind==='snapshot').length;release();
  await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('warm')).at(-1)?.status.archive.requestComplete).toBe(true));
  expect(events.filter(e=>e.ids?.includes('warm')&&e.kind==='snapshot').length).toBeGreaterThan(before);expect(service.diagnostics().warmValidatedReuses).toBe(0);
  expect(events.filter(e=>e.ids?.includes('warm')).at(-1).status.archive.gaps[0].reason).toBe('Corrected coverage detail');
 }finally{release();service.dispose();}
});

test('an unfinished warm replay cannot certify complete presentation from a matching revision',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f),events:any[]=[],service=new OrderWallsArchiveService(e=>events.push(e),t.fetcher,()=>to+1000,0),request={market:'binance-spot' as const,from,to,settings,followLive:false};
 let release!:()=>void;const gate=new Promise<void>(r=>release=r),original=compactCodec.replayCompactWallPresentation;let spy:{mockRestore:()=>unknown}|undefined;
 try{
  service.subscribe('seed',request);await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmCompactEntries:1,warmBuilds:0}));service.unsubscribe('seed');
  spy=vi.spyOn(compactCodec,'replayCompactWallPresentation').mockImplementationOnce(async(...args)=>{await gate;return original.apply(OrderWallsArchiveProjector,args);});
  const before=t.calls.length;service.subscribe('warm',request);await vi.waitFor(()=>expect(t.calls.at(-1)).toMatch(/\/source$/));
  expect(events.filter(e=>e.ids?.includes('warm')).every(e=>e.status.archive.requestComplete===false)).toBe(true);
  expect(t.calls.slice(before).some(path=>path.endsWith('/projection-batch'))).toBe(false);
  release();await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('warm')).at(-1)?.status.archive.requestComplete).toBe(true));
  expect(service.diagnostics().warmValidatedReuses).toBe(1);const reference=f.full.segments.map(segment=>({...segment,currentSelection:false}));
  expect([...displayedWalls(events,'warm').values()].sort((a,b)=>a.id.localeCompare(b.id))).toEqual(reference.sort((a,b)=>a.id.localeCompare(b.id)));
 }finally{release();service.dispose();spy?.mockRestore();}
});

test('a late shared join cannot turn unavailable prepared coverage into validated cached history',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),bad=fixture(true);bad.manifest.coverage.status='unavailable';
 let phase=0;const first=transport(f),unavailable=transport(bad),events:any[]=[],service=new OrderWallsArchiveService(e=>events.push(e),(input,init)=>(phase?unavailable:first).fetcher(input,init),()=>to+1000),request={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('seed',request);await vi.waitFor(()=>expect(service.diagnostics()).toMatchObject({warmEntries:1,warmBuilds:0}));phase=1;service.retry('seed');
  await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('seed')).at(-1)?.status.archive.state).toBe('unavailable'));
  service.subscribe('late',request);await vi.waitFor(()=>expect(events.filter(e=>e.ids?.includes('late')).at(-1)?.status.archive.state).toBe('unavailable'));
  expect(displayedWalls(events,'late').size).toBe(f.full.segments.length);
  expect(events.filter(e=>e.ids?.includes('late')).at(-1).status.archive.requestComplete).toBe(false);
  expect(service.diagnostics().warmValidatedReuses).toBe(0);
 }finally{service.dispose();}
});

test('eligible prepared history preserves exact rows and requested bounds across future whitespace',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f,{horizonAt:to-1}),calls:{url:URL;view:string|null}[]=[],updates:any[]=[];
 const fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input),'http://test');calls.push({url,view:new Headers(init?.headers).get('X-IQ-View-Id')});
  if(url.pathname.endsWith('/horizon'))return Response.json({version:1,kind:'wall-source-horizon-v1',market:'spot',profile:profile.id,head:{...head,at:to-1},availableFrom:from+1000});
  return t.fetcher(input,init);
 };
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to:to+7200000,settings},eligibleHistory:true,fetcher,onUpdate:u=>updates.push(u)});
 const reference=new OrderWallsArchiveProjector(settings,from,to);reference.applyPage({...f.page,watermark:40,head,page:{...f.page.page,nextAfter:40}});
 expect(result.segments).toEqual(reference.snapshot());expect(result.status.archive).toMatchObject({from,to:to+7200000,eligibleTo:to,horizonAt:to-1,requestComplete:true,rangeComplete:false,state:'partial'});
 expect(updates.slice(0,-1).every(u=>u.status.archive.requestComplete===false)).toBe(true);
 expect(calls.filter(c=>c.url.pathname.endsWith('/discover')).map(c=>[Number(c.url.searchParams.get('from')),Number(c.url.searchParams.get('to'))])).toEqual([[from,to+7200000]]);
 expect(calls.filter(c=>c.url.pathname.endsWith('/horizon'))).toHaveLength(0);expect(calls.find(c=>c.url.pathname.endsWith('/source'))?.url.searchParams.get('to')).toBe(String(to));expect(new Set(calls.map(c=>c.view)).size).toBe(1);expect(calls[0].view).toBeTruthy();
});
test('a wholly future wall view performs metadata only and never claims retained empty coverage',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const horizon={version:1,kind:'wall-source-horizon-v1',market:'spot',profile:profile.id,head:{cursor:1,epoch:1,at:from-1},availableFrom:null},requested={market:'spot',profile:profile.id,from,to};const fetcher=vi.fn(async()=>Response.json({state:'future',eligibility:{version:1,kind:'wall-eligible-discovery-v1',requested,request:{...requested,to:from},horizon}}));
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},eligibleHistory:true,fetcher});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(result.segments).toEqual([]);expect(result.status.archive).toMatchObject({from,to,eligibleTo:from,requestComplete:true,rangeComplete:false,state:'partial'});
});

test('an older gateway falls back to its horizon route without weakening final source validation',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),io=transport(f),paths:string[]=[];
 const fetcher:typeof fetch=async(input,init)=>{const path=new URL(String(input),'http://test').pathname;paths.push(path);const headers=new Headers(init?.headers);headers.delete('X-IQ-Wall-Resolve-Eligible');return io.fetcher(input,{...init,headers});};
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},eligibleHistory:true,fetcher});
 expect(result.status.archive?.requestComplete).toBe(true);expect(result.segments).toEqual(f.full.segments);expect(paths.filter(p=>p.endsWith('/discover'))).toHaveLength(2);expect(paths.filter(p=>p.endsWith('/horizon'))).toHaveLength(1);expect(paths.filter(p=>p.endsWith('/source'))).toHaveLength(1);
});
