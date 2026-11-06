import {afterEach,expect,test,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {loadOrderWallsArchive,OrderWallsArchiveProjector} from '../src/feed/order-walls-archive';
import {preparedWallReader,rebasePreparedWallPage} from '../src/feed/prepared-wall-history';
import {OrderWallsArchiveService} from '../src/feed/order-walls-archive-service';
import {orderWallsSettings} from '../src/feed/order-walls';
import {historyScheduler} from '../src/feed/history-scheduler';
afterEach(()=>vi.unstubAllEnvs());
const from=1_800_000_000_000,to=from+30*3600000;
const id='binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1';
const profile={id,version:1,market:'spot',venue:'binance',instrument:'binance:spot:BTCUSDT',feed:'binance:spot:BTCUSDT:spot-diff-depth',aggregation:'native',bandPercent:10,midpointBasis:'best-observed-bid-ask',topN:10,algorithmVersion:1,schemaVersion:1,confirmationMs:0,selectionTopN:10,minimumNotionalUsd:null,exactDerivations:{bandPercent:[10],topNMax:10,minimumNotional:true,confirmation:true,confirmationCrossings:false}};
const request={market:'spot' as const,profile:id,from,to};
const settings=orderWallsSettings({enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10});
const oldHead={cursor:30,epoch:2,at:to+10000},newHead={cursor:40,epoch:3,at:to+20000};
const sourceProof={...request,version:1,kind:'wall-source-sha256-xor-v1',token:'a'.repeat(64),eligible:true,watermark:30,head:oldHead};
const current={...sourceProof,watermark:40,head:newHead};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const candidate={entryId:'1:bid:100',side:'bid',price:'100.00000000',quantity:'2.00000000',notional:'200.00000000',rank:1,startedAt:from-5000,startCursor:2,startEpoch:1,startKnown:true};
const side=(upserts:any[]=[],removals:any[]=[])=>({upserts,removals});
const patch=(cursor:number,at:number,changes:any={})=>({kind:'patch',cursor,at,epoch:1,midpoint:'100.00',bookScope:null,bids:side(),asks:side(),...changes});
function fixture(){
 const coverage={availableFrom:from-3600000,requestedFrom:from,requestedTo:to,confirmedTo:to,gaps:[{cursor:21,epoch:2,at:from+3*3600000,reason:'Observed disconnect'}],partial:true,status:'partial'};
 const patches=[
  [patch(10,from+2*3600000,{bids:side([{...candidate,quantity:'3.00000001',notional:'300.00000100',rank:2}])})],
  [patch(20,from+3600000,{bids:side([{...candidate,quantity:'4.00000002',notional:'400.00000200',rank:1}])})],
  [patch(21,from+3*3600000,{kind:'gap',epoch:2,reason:'Observed disconnect'}),patch(22,from+3*3600000+1,{epoch:2,bids:side([{...candidate,entryId:'2:bid:100',startedAt:from+3*3600000+1,startCursor:22,startEpoch:2}])})],
 ];
 const pages=patches.map((items,i)=>({version:1,displayVersion:1,profile,market:'spot',instrument:profile.instrument,feed:profile.feed,from,to,watermark:30,head:oldHead,snapshot:`${id}:30:${from}:${to}`,
  page:{after:[5,10,20][i],nextAfter:[10,20,30][i],hasMore:i<2,lastAt:items.at(-1)!.at,limit:i===0?512:4096,sameMillisecondClosed:true,observations:items.length},
  ...(i===0?{seed:{at:from-1,cursor:5,epoch:1,midpoint:'100.00',bookScope:null,bids:[candidate],asks:[]}}:{}),patches:items,coverage,profileStatus:'backfilling'}));
 const texts=pages.map(p=>JSON.stringify(p));
 const parts=texts.map((text,i)=>({index:i,hash:digest(text),canonicalHash:digest(JSON.stringify((({profileStatus,...rest})=>rest)(pages[i]!))),bytes:Buffer.byteLength(text),after:pages[i]!.page.after,nextAfter:pages[i]!.page.nextAfter,encoding:'json-gzip-v1'}));
 const manifest={version:5,key:'b'.repeat(64),complete:true,request:{...request,watermark:30,sourceRevision:digest(JSON.stringify(parts.map(p=>p.canonicalHash)))},watermark:30,head:oldHead,after:30,sourceProof,parts};
 const discovery={state:'ready',source:current,manifest};
 return {pages,texts,parts,manifest,discovery};
}
function transport(f=fixture(),options:{changed?:boolean;corrupt?:boolean;beforePart?:(index:number,signal?:AbortSignal|null)=>Promise<void>}={}){
 const calls:string[]=[];let active=0,peak=0;
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input),'http://test');calls.push(url.pathname);
  if(url.pathname.endsWith('/discover'))return new Response(JSON.stringify(f.discovery));
  if(url.pathname.endsWith('/source'))return new Response(JSON.stringify(options.changed?{...current,token:'c'.repeat(64)}:current));
  if(url.pathname.endsWith('/batch')){
   const start=Number(url.searchParams.get('start')),selected=f.parts.slice(start,start+8),body=selected.map((p,i)=>(options.corrupt&&start+i===1?f.texts[start+i]+' ':f.texts[start+i])+'\n').join('');
   return new Response(body,{headers:{'x-iq-wall-start':String(start),'x-iq-wall-next':String(start+selected.length),'x-iq-wall-parts':String(selected.length),'x-iq-chunk-key':f.manifest.key,'x-iq-source-revision':f.manifest.request.sourceRevision}});
  }
  if(url.pathname.endsWith('/part')){
   const index=f.parts.findIndex(p=>p.hash===url.searchParams.get('hash'));expect(index).toBeGreaterThanOrEqual(0);
   active++;peak=Math.max(peak,active);try{await options.beforePart?.(index,init?.signal);return new Response(options.corrupt&&index===1?f.texts[index]+' ':f.texts[index]);}finally{active--;}
  }
  throw Error('Prepared chart must not use serial legacy pages: '+url.pathname);
 });
 return {fetcher:fetcher as typeof fetch,calls,peak:()=>peak};
}
test('30h prepared parts preserve the independent canonical projector through timestamp regression, gaps and head progress',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),t=transport(f),updates:any[]=[];
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u)});
 const reference=new OrderWallsArchiveProjector(settings,from,to);
 for(const [i,page] of f.pages.entries()){
  const rebased={...page,watermark:40,head:newHead,page:{...page.page,nextAfter:i===2?40:page.page.nextAfter}};
  reference.applyPage(rebased as any);
 }
 expect(result.segments).toEqual(reference.snapshot());expect(result.status.archive?.requestComplete).toBe(true);expect(result.status.archive?.gaps.length).toBeGreaterThan(0);
 expect(result.head).toEqual(newHead);expect(result.cursor).toBe(40);expect(result.pages).toBe(3);
 expect(updates.slice(0,-1).every(u=>u.status.archive.requestComplete===false)).toBe(true);
 expect(t.calls.filter(path=>path.endsWith('/part'))).toHaveLength(3);expect(t.calls.at(-1)).toMatch(/\/source$/);expect(t.peak()).toBeLessThanOrEqual(2);
});
test('a changed source never completes a painted prefix or resets its financial state',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const t=transport(fixture(),{changed:true}),updates:any[]=[];
 await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/source changed/);
 expect(updates).toHaveLength(2);expect(updates.every(u=>u.status.archive.requestComplete===false)).toBe(true);expect(updates.at(-1).resume.after).toBe(20);expect(updates[0].segments.length).toBeGreaterThan(0);
});
test('content mismatch is rejected before the corrupted page reaches the projector',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const t=transport(fixture(),{corrupt:true}),updates:any[]=[];
 await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/hash mismatch/);
 expect(updates).toHaveLength(1);expect(updates[0].resume.after).toBe(10);
});
test('older backends or a missing prepared view retain canonical loading',async()=>{
 const fetcher=vi.fn(async()=>new Response('{}',{status:404}));expect(await preparedWallReader(request,fetcher as typeof fetch,new AbortController().signal)).toBeNull();
 const missing=vi.fn(async()=>new Response(JSON.stringify({state:'missing'})));expect(await preparedWallReader(request,missing as typeof fetch,new AbortController().signal)).toBeNull();
});
test('a cache built after the requested current fence cannot be rebound backwards',async()=>{
 const f=fixture(),t=transport(f);expect(await preparedWallReader({...request,watermark:25,head:{cursor:25,epoch:1,at:to+1}},t.fetcher,new AbortController().signal)).toBeNull();
 expect(t.calls).toEqual(['/market-data/v2/history/walls/discover']);
});
test('canceling one chart releases only its consumers of coalesced immutable parts',async()=>{
 const gates=new Map<number,{resolve:()=>void;aborted:boolean}>();
 const t=transport(fixture(),{beforePart:(index,signal)=>new Promise<void>((resolve,reject)=>{
  const gate={resolve,aborted:false};gates.set(index,gate);signal?.addEventListener('abort',()=>{gate.aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});
 })});
 const a=await preparedWallReader(request,t.fetcher,new AbortController().signal),b=await preparedWallReader(request,t.fetcher,new AbortController().signal);
 try{
  const first=a!.read(0),second=b!.read(0);void first.catch(()=>{});await vi.waitFor(()=>expect(gates.size).toBe(2));a!.dispose();
  await expect(first).rejects.toThrow(/Aborted/);expect(gates.get(0)!.aborted).toBe(false);gates.get(0)!.resolve();expect((await second).body).toMatchObject({watermark:40});
 }finally{a?.dispose();b?.dispose();}
 await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
});

test('retry resumes only remaining immutable parts without duplicating the retained projector',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),first=transport(f,{corrupt:true}),updates:any[]=[];
 await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:first.fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/hash mismatch/);
 const resume=updates.at(-1).resume;expect(resume.preparedSourceToken).toBe(current.token);
 const retry=transport(f),result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:retry.fetcher,resume});
 const fresh=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:transport(f).fetcher});
 expect(result.segments).toEqual(fresh.segments);expect(result.pages).toBe(3);expect(result.status.archive?.requestComplete).toBe(true);
 expect(retry.calls.filter(path=>path.endsWith('/part'))).toHaveLength(2);
});
test('a retained prepared prefix cannot silently resume through missing, changed or backward-fenced history',async()=>{
 const f=fixture();
 for(const discovery of [{state:'missing'},{...f.discovery,source:{...current,token:'c'.repeat(64)}}]){
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(discovery)));
  await expect(preparedWallReader(request,fetcher as typeof fetch,new AbortController().signal,current.token)).rejects.toThrow(/source changed/);
  expect(fetcher).toHaveBeenCalledTimes(1);
 }
 const t=transport(f);
 await expect(preparedWallReader({...request,watermark:25,head:{cursor:25,epoch:1,at:to+1}},t.fetcher,new AbortController().signal,current.token)).rejects.toThrow(/source changed/);
});

test('service Retry restarts a superseded prepared prefix once and retains its display until validation',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const original=fixture(),replacement=fixture();
 replacement.manifest.sourceProof={...replacement.manifest.sourceProof,token:'c'.repeat(64)};
 replacement.discovery.source={...replacement.discovery.source,token:'c'.repeat(64)};
 let phase=0,release:()=>void=()=>{},blocked=false,discoveries=0;
 const old=transport(original,{corrupt:true}),next=transport(replacement,{beforePart:async(index)=>{if(index===1){blocked=true;await new Promise<void>(resolve=>release=resolve);}}});
 const fetcher:typeof fetch=async(input,init)=>{
  const path=new URL(String(input),'http://test').pathname;if(path.endsWith('/discover'))discoveries++;
  if(phase===0)return old.fetcher(input,init);
  if(path.endsWith('/source'))return new Response(JSON.stringify(replacement.discovery.source));
  return next.fetcher(input,init);
 };
 const events:any[]=[],service=new OrderWallsArchiveService(event=>events.push(event),fetcher,()=>to+3600000);
 try{
  service.subscribe('revision',{market:'binance-spot',from,to,settings,followLive:false});
  await vi.waitFor(()=>expect(events.at(-1)?.status?.message).toMatch(/hash mismatch/));
  const retained=events.filter(e=>e.kind==='snapshot'&&e.segments?.length).at(-1);expect(retained).toBeDefined();
  const before=events.length;phase=1;service.retry('revision');
  await vi.waitFor(()=>expect(blocked).toBe(true));
  expect(events.slice(before).every(e=>e.kind!=='snapshot')).toBe(true);
  release();await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.requestComplete).toBe(true));
  expect(discoveries).toBe(3);expect(events.at(-1).kind).toBe('snapshot');
  expect(service.diagnostics().groups).toBe(0);
 }finally{release();service.dispose();}
});

test('service Retry restarts a source-invalidated view without a resume cursor and retains its display until validation',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const original=fixture(),replacement=fixture();
 replacement.manifest.sourceProof={...replacement.manifest.sourceProof,token:'c'.repeat(64)};
 replacement.discovery.source={...replacement.discovery.source,token:'c'.repeat(64)};
 let phase=0,release:()=>void=()=>{},blocked=false,discoveries=0;
 const old=transport(original,{changed:true}),next=transport(replacement,{beforePart:async(index)=>{if(index===1){blocked=true;await new Promise<void>(resolve=>release=resolve);}}});
 const fetcher:typeof fetch=async(input,init)=>{
  const path=new URL(String(input),'http://test').pathname;if(path.endsWith('/discover'))discoveries++;
  if(phase===0)return old.fetcher(input,init);
  if(path.endsWith('/source'))return new Response(JSON.stringify(replacement.discovery.source));
  return next.fetcher(input,init);
 };
 const events:any[]=[],service=new OrderWallsArchiveService(event=>events.push(event),fetcher,()=>to+3600000);
 try{
  service.subscribe('revision',{market:'binance-spot',from,to,settings,followLive:false});
  await vi.waitFor(()=>expect(events.at(-1)?.status?.message).toMatch(/source changed/));
  const retained=events.filter(e=>e.kind==='snapshot'&&e.segments?.length).at(-1);expect(retained).toBeDefined();
  expect(events.at(-1).status.archive).toMatchObject({retryable:true,requestComplete:false});
  expect(events.at(-1).status.archive.resumeAfter).toBeUndefined();
  const before=events.length;phase=1;service.retry('revision');
  await vi.waitFor(()=>expect(blocked).toBe(true));
  expect(events.slice(before).every(e=>e.kind!=='snapshot')).toBe(true);
  release();await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.requestComplete).toBe(true));
  expect(discoveries).toBe(2);expect(events.at(-1).kind).toBe('snapshot');
  expect(service.diagnostics().groups).toBe(0);
 }finally{release();service.dispose();}
});

test('busy prepared discovery does not multiply load through a serial canonical fallback',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const fetcher=vi.fn(async()=>new Response('{}',{status:503}));
 await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:fetcher as typeof fetch})).rejects.toThrow(/discovery HTTP 503/);
 expect(fetcher).toHaveBeenCalledTimes(1);
});

test('advertised bounded batches preserve the canonical projection with fewer requests',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture();(f.discovery as any).delivery={version:2,maxDecodedBytes:8*1024*1024,maxParts:8};
 const t=transport(f),updates:any[]=[],result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u)});
 const reference=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:transport().fetcher});
 expect(result.segments).toEqual(reference.segments);expect(result.status.archive?.requestComplete).toBe(true);
 expect(t.calls.filter(x=>x.endsWith('/part'))).toHaveLength(1);expect(t.calls.filter(x=>x.endsWith('/batch'))).toHaveLength(1);
 expect(updates.slice(0,-1).every(u=>!u.status.archive.requestComplete)).toBe(true);
});
test('a corrupt batch retains the first painted part without publishing an invalid financial page',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture();(f.discovery as any).delivery={version:2,maxDecodedBytes:8*1024*1024,maxParts:8};
 const t=transport(f,{corrupt:true}),updates:any[]=[];
 await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/byte identity|hash mismatch/);
 expect(updates).toHaveLength(1);expect(updates[0].resume.after).toBe(10);expect(updates[0].status.archive.requestComplete).toBe(false);
});
test('batch Retry resumes the retained part boundary without duplicate financial state',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture();(f.discovery as any).delivery={version:2,maxDecodedBytes:8*1024*1024,maxParts:8};
 const updates:any[]=[];
 await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:transport(f,{corrupt:true}).fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/byte identity|hash mismatch/);
 const t=transport(f),result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher,resume:updates[0].resume});
 const fresh=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:transport().fetcher});
 expect(result.segments).toEqual(fresh.segments);expect(result.pages).toBe(3);expect(t.calls.filter(p=>p.endsWith('/part'))).toHaveLength(0);expect(t.calls.filter(p=>p.endsWith('/batch'))).toHaveLength(1);
});
test('batch consumers coalesce while cancellation releases only the obsolete chart',async()=>{
 const f=fixture();(f.discovery as any).delivery={version:2,maxDecodedBytes:8*1024*1024,maxParts:8};const t=transport(f);
 let release:()=>void=()=>{},upstream:AbortSignal|null|undefined,batches=0;
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input).includes('/batch?')){batches++;upstream=init?.signal;await new Promise<void>(resolve=>release=resolve);}
  return t.fetcher(input,init);
 };
 const a=await preparedWallReader(request,fetcher,new AbortController().signal),b=await preparedWallReader(request,fetcher,new AbortController().signal);
 try{
  const first=a!.read(10),second=b!.read(10);void first.catch(()=>{});
  await vi.waitFor(()=>expect(batches).toBe(1));a!.dispose();await expect(first).rejects.toThrow(/Aborted/);expect(upstream?.aborted).toBe(false);
  release();expect((await second).body).toMatchObject({page:{after:10}});
 }finally{release();a?.dispose();b?.dispose();}
 await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
});
test('invalid batch headers cancel the unread response and preserve the painted prefix',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture();(f.discovery as any).delivery={version:2,maxDecodedBytes:8*1024*1024,maxParts:8};const t=transport(f);let canceled=false;
 const fetcher:typeof fetch=async(input,init)=>String(input).includes('/batch?')?new Response(new ReadableStream({cancel(){canceled=true;}})):t.fetcher(input,init);
 const updates:any[]=[];await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/batch identity/);
 expect(canceled).toBe(true);expect(updates).toHaveLength(1);expect(updates[0].status.archive.requestComplete).toBe(false);
});
