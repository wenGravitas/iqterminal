import {test,expect,vi,afterEach} from 'vitest';import {createHash} from 'node:crypto';
import {OrderWallsArchiveProjector,loadOrderWallsArchive} from '../src/feed/order-walls-archive';
import {orderWallsSettings} from '../src/feed/order-walls';import {readPreparedWallProjection} from '../src/feed/prepared-wall-projection';
import {WALL_PROJECTION_CORE_SHA256} from '../src/shared/order-walls-projection-version';
import {OrderWallsArchiveService} from '../src/feed/order-walls-archive-service';
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
function transport(f:ReturnType<typeof fixture>,options:{changed?:boolean;corrupt?:boolean;gateSource?:Promise<void>;tailGate?:Promise<void>}={}){
 const calls:string[]=[];const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
  const url=new URL(String(input),'http://test');calls.push(url.pathname);
  if(url.pathname.endsWith('/discover'))return Response.json({state:'ready',manifest:f.canonical,source:f.source,projection:f.advertised});
  if(url.pathname.endsWith('/source')){await options.gateSource;return Response.json(options.changed?{...f.source,token:'c'.repeat(64)}:f.source);}
  if(url.pathname.endsWith('/projection-batch')){
   const start=Number(url.searchParams.get('start')),selected=f.manifest.parts.slice(start,start+32);let i=start;
   const body=new ReadableStream<Uint8Array>({async pull(controller){if(i>=start+selected.length){controller.close();return;}if(i>start)await options.tailGate;controller.enqueue(new TextEncoder().encode((options.corrupt&&i===start?f.texts[i]!.replace('100.00000001','100.00000002'):f.texts[i])+'\n'));i++;}});
   return new Response(body,{headers:{'x-iq-wall-start':String(start),'x-iq-wall-next':String(start+selected.length),'x-iq-wall-parts':String(selected.length),'x-iq-chunk-key':f.manifest.key,'x-iq-source-revision':f.manifest.sourceToken}});
  }
  throw Error('Unexpected canonical replay request: '+url.pathname);
 });return {fetcher:fetcher as typeof fetch,calls};
}
test('actual archive loader imports exact prepared cells, retains gaps and rebases only the quiet head',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(true),t=transport(f),updates:any[]=[],metrics:any[]=[];
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u),onPageMetrics:m=>metrics.push(m)});
 const reference=new OrderWallsArchiveProjector(settings,from,to);reference.applyPage({...f.page,watermark:40,head,page:{...f.page.page,nextAfter:40}});
 expect(result.segments).toEqual(reference.snapshot());expect(result.projector?.selectedState()).toEqual(reference.selectedState());expect(result.head).toEqual(head);expect(result.cursor).toBe(40);
 expect(result.status.archive).toMatchObject({requestComplete:true,rangeComplete:false,gaps:[{from:from+3000,to:from+3000,reason:'Observed disconnect'}]});
 expect(updates.slice(0,-1).every(u=>u.status.archive.requestComplete===false&&u.status.archive.loadedThrough===from)).toBe(true);
 expect(t.calls).toEqual(['/market-data/v2/history/walls/discover','/market-data/v2/history/walls/projection-batch','/market-data/v2/history/walls/source']);expect(metrics.every(m=>m.delivery==='projection')).toBe(true);
});
test('painted prepared records remain incomplete while final independent source validation is delayed or fails',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');let release!:()=>void;const gateSource=new Promise<void>(r=>release=r),f=fixture(),t=transport(f,{changed:true,gateSource}),updates:any[]=[];
 const work=loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u)});void work.catch(()=>{});
 await vi.waitFor(()=>expect(t.calls.at(-1)).toMatch(/\/source$/));expect(updates.at(-1).presentation.size).toBe(f.full.segments.length);expect(updates.every(u=>u.status.archive.requestComplete===false)).toBe(true);
 const before=[...updates.at(-1).presentation.values()];release();await expect(work).rejects.toThrow(/source changed/);expect([...updates.at(-1).presentation.values()]).toEqual(before);
});
test('fragment holes, wrong order, duplicate coordinates and corrupted content never publish completion',async()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>f.manifest.closed[0].reverse(),(f:ReturnType<typeof fixture>)=>f.manifest.closed.push(f.manifest.closed[0])]){
  const f=fixture(true);mutate(f);const t=transport(f);await expect(readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:new AbortController().signal},()=>{})).rejects.toThrow(/fragment|coordinates/);
 }
 const f=fixture(),t=transport(f,{corrupt:true}),updates:any[]=[];
 await expect(readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:new AbortController().signal},u=>updates.push(u))).rejects.toThrow(/hash mismatch/);
 expect(updates).toHaveLength(1);expect(updates[0].segments.every((s:any)=>s.end===null)).toBe(true);
});
test('incompatible settings/core fall back before transfer and abort prevents further progressive publication',async()=>{
 const f=fixture(),t=transport(f),signal=new AbortController();
 expect(await readPreparedWallProjection(f.advertised,{...f.context,settings:{...settings,topLevels:4},fetcher:t.fetcher,signal:signal.signal},()=>{})).toBeNull();expect(t.calls).toHaveLength(0);
 const old={...f.advertised,manifest:{...f.manifest,core:'c'.repeat(64)}};expect(await readPreparedWallProjection(old,{...f.context,fetcher:t.fetcher,signal:signal.signal},()=>{})).toBeNull();
 let count=0;await expect(readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:signal.signal},()=>{count++;signal.abort();})).rejects.toThrow(/abort/i);expect(count).toBe(1);expect(t.calls).toHaveLength(0);
});
test('thirty-five immutable parts use two byte-bounded batches and retain every selected identity',async()=>{
 const f=fixture(),closed=JSON.parse(f.texts[0]!)[0],texts:string[]=[];
 for(let i=0;i<35;i++)texts.push(JSON.stringify([{...closed,order:i,segment:{...closed.segment,id:closed.segment.id+':'+i},valueRunOrder:closed.valueRunOrder.map((n:number)=>n+i*10)}]));
 f.texts=texts;f.manifest.parts=texts.map(text=>({hash:hash(text),bytes:Buffer.byteLength(text),records:1}));f.manifest.closed=texts.map((_,i)=>[[i,0]]);
 f.manifest.activeOrder=[35];f.manifest.active.valueRunOrder=f.manifest.active.valueRunOrder.map((values:number[])=>values.map(n=>n+400));f.manifest.active.nextValueRunSequence=500;
 const t=transport(f),result=await readPreparedWallProjection(f.advertised,{...f.context,fetcher:t.fetcher,signal:new AbortController().signal},()=>{});
 expect(result?.parts).toBe(35);expect(result?.projector.snapshot()).toHaveLength(36);expect(t.calls).toHaveLength(2);expect(t.calls.every(path=>path.endsWith('/projection-batch'))).toBe(true);
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
  expect(events.at(-1).segments).toHaveLength(f.full.segments.length);
  // A late subscriber receives the complete shared presentation/projector,
  // rather than only the most recently delivered batch.
  service.subscribe('two',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.filter(event=>event.ids?.includes('two')).at(-1)?.segments).toHaveLength(f.full.segments.length));
  service.unsubscribe('one');service.unsubscribe('two');expect(service.diagnostics().historyJobs).toBe(0);
 }finally{release();service.dispose();}
 await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
});
