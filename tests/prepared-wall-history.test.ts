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
  if(url.pathname.endsWith('/horizon'))return Response.json({version:1,kind:'wall-source-horizon-v1',market:'spot',profile:profile.id,head:newHead,availableFrom:from-3600000});
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
const preparation=(phase:string,extra:Record<string,unknown>={})=>({version:1,leaseMs:15000,pollMs:250,job:{id:'d'.repeat(64),request,phase,state:'building',pages:3,projectionPages:0,
 coverage:{availableFrom:from-10000,confirmedTo:to,gapCount:1,gapsTruncated:false},...extra}});
test('admitted cold preparation remains incomplete until real prepared content validates, without serial fallback',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');
  const f=fixture(),t=transport(f),updates:any[]=[];let discoveries=0,firstUpdate!:()=>void;const first=new Promise<void>(resolve=>firstUpdate=resolve);
  const fetcher:typeof fetch=async(input,init)=>{const path=new URL(String(input),'http://test').pathname;if(init?.method==='DELETE')return new Response('{}');
   if(path.endsWith('/discover')&&++discoveries<=2)return new Response(JSON.stringify({state:'building',preparation:preparation(discoveries===1?'canonical':'projection')}));return t.fetcher(input,init);};
  const pending=loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher,onUpdate:u=>{updates.push(u);firstUpdate();}});
  await Promise.race([first,pending.then(()=>{throw Error('Completed before preparation status');})]);expect(updates[0]).toMatchObject({kind:'patch',patches:[],status:{archive:{state:'building',requestComplete:false,rangeComplete:false,loadedThrough:from,preparation:{sourceCoverage:{confirmedTo:to,gapCount:1}}}}});
  expect(updates[0].segments).toBeUndefined();const result=await pending;
  const reference=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:transport(f).fetcher});
  expect(result.segments).toEqual(reference.segments);expect(result.status.archive?.requestComplete).toBe(true);expect(result.status.archive?.gaps).not.toHaveLength(0);
  expect(updates.filter(u=>u.status.archive?.preparation).every(u=>u.status.archive.requestComplete===false&&u.status.archive.loadedThrough===from)).toBe(true);
  expect(t.calls.every(p=>!p.includes('/archive'))).toBe(true);
});
test.each(['query','source-changed'])('service Retry clears %s build failure with stable command metadata',async category=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const t=transport(),events:any[]=[],headers:Headers[]=[];let repair=false,renewals=0;
 const fetcher:typeof fetch=async(input,init)=>{const path=new URL(String(input),'http://test').pathname;if(init?.method==='DELETE')return new Response('{}');
  if(path.endsWith('/discover')){
   headers.push(new Headers(init?.headers));if(!repair)return new Response(JSON.stringify({state:'building',preparation:preparation('canonical',{state:'failed',category,error:'Failure removed by operator',retryable:true})}));
   if(++renewals===1)return new Response(JSON.stringify({state:'building',preparation:preparation('canonical')}));
  }return t.fetcher(input,init);};
 const service=new OrderWallsArchiveService(event=>events.push(event),fetcher,()=>to+3600000);
 try{
  service.subscribe('prepare-retry',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.at(-1)?.status?.message).toMatch(/Failure removed/));
  expect(events.at(-1).status.archive).toMatchObject({requestComplete:false,retryable:true});repair=true;service.retry('prepare-retry');
  await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.requestComplete).toBe(true),{timeout:2000});
  expect(events.at(-1).status.message??'').not.toMatch(/Failure removed/);expect(service.diagnostics().groups).toBe(0);
  const retried=headers.slice(1);expect(retried.length).toBeGreaterThanOrEqual(2);expect(new Set(retried.map(h=>h.get('X-IQ-Wall-Retry'))).size).toBe(1);expect(retried[0].get('X-IQ-Wall-Retry')).toBeTruthy();
  expect(retried.every(h=>h.get('X-IQ-Wall-New-Revision')===(category==='source-changed'?'1':null))).toBe(true);
 }finally{service.dispose();}
});
test('specific nonretryable preparation failure is preserved in the chart history status',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const events:any[]=[],fetcher:typeof fetch=async(input,init)=>String(input).includes('/horizon?')?Response.json({version:1,kind:'wall-source-horizon-v1',market:'spot',profile:id,head:newHead,availableFrom:from-3600000}):new Response(JSON.stringify(init?.method==='DELETE'?{}:{state:'building',preparation:preparation('canonical',{state:'failed',category:'invalid-content',error:'Invalid prepared content',retryable:false})}));
 const service=new OrderWallsArchiveService(event=>events.push(event),fetcher,()=>to+3600000);try{
  service.subscribe('bad-preparation',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.retryable).toBe(false));
  expect(events.at(-1).status.archive.requestComplete).toBe(false);expect(events.at(-1).status.message).toMatch(/Invalid prepared content/);
 }finally{service.dispose();}
});
test('Retry of a retained prefix escalates a source-changed worker with a distinct revision command, retaining good bars',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const old=transport(fixture(),{corrupt:true}),replacement=fixture();
 replacement.discovery.source={...replacement.discovery.source,token:'c'.repeat(64)};replacement.manifest.sourceProof={...replacement.manifest.sourceProof,token:'c'.repeat(64)};
 const next=transport(replacement),events:any[]=[],commands:Headers[]=[];let repair=false,failedToken:string|null=null;
 const fetcher:typeof fetch=async(input,init)=>{
  const path=new URL(String(input),'http://test').pathname;if(init?.method==='DELETE')return new Response('{}');if(!repair)return old.fetcher(input,init);
  if(path.endsWith('/source'))return new Response(JSON.stringify(replacement.discovery.source));
  if(path.endsWith('/discover')){
   const header=new Headers(init?.headers);commands.push(header);
   if(header.get('X-IQ-Wall-New-Revision')!=='1'||header.get('X-IQ-Wall-Retry')===failedToken){
    failedToken??=header.get('X-IQ-Wall-Retry');return new Response(JSON.stringify({state:'building',preparation:preparation('canonical',{state:'failed',category:'source-changed',error:'Prepared wall source changed',retryable:true})}));
   }
  }return next.fetcher(input,init);
 };
 const service=new OrderWallsArchiveService(event=>events.push(event),fetcher,()=>to+3600000);try{
  service.subscribe('retry-revision',{market:'binance-spot',from,to,settings,followLive:false});await vi.waitFor(()=>expect(events.at(-1)?.status?.message).toMatch(/hash mismatch/));
  expect(events.some(e=>e.kind==='snapshot'&&e.segments?.length)).toBe(true);const before=events.length;repair=true;service.retry('retry-revision');
  await vi.waitFor(()=>expect(events.at(-1)?.status?.archive?.requestComplete).toBe(true));expect(commands).toHaveLength(2);
  expect(commands[0].get('X-IQ-Wall-New-Revision')).toBeNull();expect(commands[1].get('X-IQ-Wall-New-Revision')).toBe('1');expect(commands[1].get('X-IQ-Wall-Retry')).not.toBe(failedToken);
  expect(events.slice(before).filter(e=>e.kind==='snapshot').every(e=>e.status.archive.requestComplete===true)).toBe(true);expect(service.diagnostics().groups).toBe(0);
 }finally{service.dispose();}
});
function headBoundaryFixture(){
 const f=fixture(),head={cursor:30,epoch:2,at:to-1};
 f.pages=f.pages.map(page=>({...page,head,coverage:{...page.coverage,confirmedTo:head.at}}));
 const tail=f.pages[2]!;
 for(const cursor of [29,30])tail.patches.push(patch(cursor,head.at,{epoch:2,bids:side([{...candidate,entryId:'2:bid:100',startedAt:from+3*3600000+1,startCursor:22,startEpoch:2,quantity:String(cursor),notional:String(cursor*100)}])}));
 tail.page.lastAt=head.at;
 f.texts=f.pages.map(page=>JSON.stringify(page));
 f.parts=f.texts.map((text,i)=>({...f.parts[i]!,hash:digest(text),canonicalHash:digest(JSON.stringify((({profileStatus,...rest})=>rest)(f.pages[i]!))),bytes:Buffer.byteLength(text)}));
 f.manifest={...f.manifest,head,sourceProof:{...f.manifest.sourceProof,head},parts:f.parts,
  request:{...f.manifest.request,sourceRevision:digest(JSON.stringify(f.parts.map(part=>part.canonicalHash)))}};
 f.discovery={...f.discovery,source:{...f.discovery.source,watermark:30,head},manifest:f.manifest};
 return f;
}
test('prepared history includes the complete fixed-head millisecond and preserves the same-time final quantity and gaps',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=headBoundaryFixture(),t=transport(f),head=f.manifest.head;
 const fetcher:typeof fetch=(input,init)=>String(input).includes('/walls/source?')?Promise.resolve(new Response(JSON.stringify(f.discovery.source))):t.fetcher(input,init);
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings,watermark:30,head},fetcher});
 const reference=new OrderWallsArchiveProjector(settings,from,to);for(const page of f.pages)reference.applyPage(page as any);
 expect(result.segments).toEqual(reference.snapshot());expect(result.projector!.selectedState()).toEqual(reference.selectedState());
 expect(result.head).toEqual(head);expect(result.cursor).toBe(30);
 expect(result.status.archive).toMatchObject({requestComplete:true,rangeComplete:false,confirmedTo:to-1});
 expect(result.status.archive!.gaps).not.toHaveLength(0);
 const last=result.segments.find(segment=>segment.archiveEntryId==='2:bid:100')!.valueRuns.at(-1)!;
 expect(last).toMatchObject({at:to-1,quantityExact:'30',notionalExact:'3000'});
 expect(t.calls.filter(path=>path.endsWith('/part'))).toHaveLength(3);
});
test('prepared history rejects a bootstrap one millisecond behind the required fixed-head observation',async()=>{
 const f=headBoundaryFixture(),head={...f.manifest.head,at:to-2};
 expect(await preparedWallReader({...request,watermark:30,head},transport(f).fetcher,new AbortController().signal)).toBeNull();
 expect(()=>rebasePreparedWallPage(f.pages[2],f.manifest as any,f.parts[2] as any,head)).toThrow(/fence cannot cover/);
 f.discovery.source={...f.discovery.source,head};
 await expect(preparedWallReader(request,transport(f).fetcher,new AbortController().signal)).rejects.toThrow(/source validation/);
});
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
test('failed final source validation retains the good prefix and exposes the specific server failure',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const t=transport(fixture()),updates:any[]=[];
 const fetcher:typeof fetch=(input,init)=>String(input).includes('/walls/source?')
  ?Promise.resolve(new Response(JSON.stringify({error:'ClickHouse 500: source query time budget'}),{status:503})):t.fetcher(input,init);
 await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow('Prepared wall source validation HTTP 503: ClickHouse 500: source query time budget');
 expect(updates).toHaveLength(2);expect(updates.every(u=>u.status.archive.requestComplete===false)).toBe(true);
 expect(updates.at(-1).resume.after).toBe(20);expect(updates[0].segments.length).toBeGreaterThan(0);
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
test('a cache newer than the requested current fence requires explicit canonical cursor proof',async()=>{
 const f=fixture(),t=transport(f);expect(await preparedWallReader({...request,watermark:25,head:{cursor:25,epoch:1,at:to+1}},t.fetcher,new AbortController().signal)).toBeNull();
 expect(t.calls).toEqual(['/market-data/v2/history/walls/discover']);
});
function quietFenceFixture(){
 const f=fixture(),anchor={cursor:5,epoch:1,at:from-1,hash:'e'.repeat(64)};
 f.manifest.sourceProof={...f.manifest.sourceProof,maxCursor:22,anchor} as any;f.discovery.source={...f.discovery.source,maxCursor:22,anchor} as any;
 return f;
}
test('a quiet newer prepared horizon reuses exact canonical inputs inside the older bootstrap without advancing its cursor',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=quietFenceFixture(),t=transport(f),target={cursor:25,epoch:2,at:to+5000};
 const actual=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings,watermark:25,head:target},fetcher:t.fetcher});
 const reference=new OrderWallsArchiveProjector(settings,from,to);for(const [index,page] of f.pages.entries())reference.applyPage({...page,watermark:25,head:target,page:{...page.page,nextAfter:index===2?25:page.page.nextAfter}} as any);
 expect(actual.segments).toEqual(reference.snapshot());expect(actual.projector!.selectedState()).toEqual(reference.selectedState());expect(actual.head).toEqual(target);expect(actual.cursor).toBe(25);expect(actual.status.archive?.requestComplete).toBe(true);
 expect(t.calls.filter(path=>path.endsWith('/part'))).toHaveLength(3);
});
test.each(['late-input','late-anchor','changed-anchor-proof','out-of-fence-page'])('backward transport rebinding rejects %s rather than crossing a bootstrap fence',async mode=>{
 const f=quietFenceFixture();
 if(mode==='late-input'){(f.manifest.sourceProof as any).maxCursor=26;(f.discovery.source as any).maxCursor=26;}
 if(mode==='late-anchor'){(f.manifest.sourceProof as any).anchor={...(f.manifest.sourceProof as any).anchor,cursor:26};(f.discovery.source as any).anchor=(f.manifest.sourceProof as any).anchor;}
 if(mode==='changed-anchor-proof')(f.discovery.source as any).anchor={...(f.discovery.source as any).anchor,hash:'f'.repeat(64)};
 if(mode==='out-of-fence-page'){f.parts[1].nextAfter=26;f.parts[2].after=26;}
 expect(await preparedWallReader({...request,watermark:25,head:{cursor:25,epoch:2,at:to+5000}},transport(f).fetcher,new AbortController().signal)).toBeNull();
});
test('a decoded financial input cannot cross an older bootstrap even if its metadata claims a quiet horizon',()=>{
 const f=quietFenceFixture(),page={...f.pages[2],patches:[{...f.pages[2].patches[0],cursor:26}]};
 expect(()=>rebasePreparedWallPage(page,f.manifest as any,f.parts[2] as any,{cursor:25,epoch:2,at:to+5000})).toThrow(/financial input exceeds/);
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
test('the first discovery failure replaces the initial historical loading status before any good page exists',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const events:any[]=[];
 const service=new OrderWallsArchiveService(e=>events.push(e),(async()=>new Response(JSON.stringify({error:'Diagnostic source query budget exceeded'}),{status:503})) as typeof fetch,()=>to+100000);
 try{
  service.subscribe('first-discovery-failure',{market:'binance-spot',from,to,settings,followLive:false});
  await vi.waitFor(()=>expect(events.at(-1)?.status.archive?.reason).toContain('Diagnostic source query budget exceeded'));
  expect(events.at(-1).status.archive.requestComplete).toBe(false);
  expect(events.at(-1).status.state).toBe('gap');
  expect(events.at(-1).status.archive.retryable).toBe(true);expect(events.at(-1).status.archive.state).toBe('partial');
 }finally{service.dispose();}
});
test.each(['binance-spot','binance-perp'] as const)('late restore/chart consumers inherit a settled %s history failure without restarting it',async market=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const events:any[]=[];
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:'Diagnostic source query budget exceeded'}),{status:503}));
 const service=new OrderWallsArchiveService(e=>events.push(e),fetcher as typeof fetch,()=>to+100000),req={market,from,to,settings,followLive:false};
 try{
  service.subscribe('restore-one',req);await vi.waitFor(()=>expect(service.stats.failures).toBe(1));
  service.subscribe('restore-two',req);service.subscribe('chart',req);
  service.unsubscribe('restore-one');service.unsubscribe('restore-two');
  const latest=events.filter(e=>e.ids.includes('chart')).at(-1);
  expect(latest.status.archive.reason).toContain('Diagnostic source query budget exceeded');
  expect(latest.status.archive).toMatchObject({state:'partial',requestComplete:false,retryable:true});
  expect(latest.status.state).toBe('gap');
  expect(fetcher).toHaveBeenCalledOnce();expect(service.diagnostics().historyConsumers).toBe(1);
 }finally{service.dispose();}
});
test('late join during Retry clears the shared failure and awaits fresh validation before completion',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const events:any[]=[],t=transport(fixture());let failed=true,release!:()=>void;
 const held=new Promise<void>(r=>{release=r;});
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input).includes('/walls/discover?')){
   if(failed)return new Response(JSON.stringify({error:'Diagnostic source query budget exceeded'}),{status:503});
   await held;
  }
  return t.fetcher(input,init);
 };
 const service=new OrderWallsArchiveService(e=>events.push(e),fetcher,()=>to+100000),req={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('first',req);await vi.waitFor(()=>expect(service.stats.failures).toBe(1));service.subscribe('second',req);
  failed=false;service.retry('first');service.subscribe('third',req);
  const waiting=events.filter(e=>e.ids.includes('third')).at(-1);
  expect(waiting.status.archive.requestComplete).toBe(false);expect(waiting.status.archive.reason).toBeUndefined();
  release();await vi.waitFor(()=>expect(events.filter(e=>e.ids.includes('third')).at(-1).status.archive.requestComplete).toBe(true));
  for(const id of ['first','second','third'])expect(events.filter(e=>e.ids.includes(id)).at(-1).status.archive.reason??'').not.toContain('Diagnostic source query budget exceeded');
  expect(service.stats.historyRequests).toBe(1);expect(t.calls.filter(p=>p.endsWith('/discover'))).toHaveLength(1);
 }finally{release();service.dispose();}
});
test('Retry of a previously ready shared view never presents its old revision as validated to a late consumer',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const events:any[]=[],t=transport(fixture());let hold=false,release!:()=>void;
 const held=new Promise<void>(r=>{release=r;});
 const fetcher:typeof fetch=async(input,init)=>{if(hold&&String(input).includes('/walls/discover?'))await held;return t.fetcher(input,init);};
 const service=new OrderWallsArchiveService(e=>events.push(e),fetcher,()=>to+100000),req={market:'binance-spot' as const,from,to,settings,followLive:false};
 try{
  service.subscribe('ready-view',req);await vi.waitFor(()=>expect(events.at(-1).status.archive.requestComplete).toBe(true));
  hold=true;service.retry('ready-view');service.subscribe('late-view',req);
  const late=events.filter(e=>e.ids.includes('late-view'));
  expect(late.length).toBeGreaterThan(0);expect(late.every(e=>e.status.archive.requestComplete===false)).toBe(true);
  release();await vi.waitFor(()=>expect(events.filter(e=>e.ids.includes('late-view')).at(-1).status.archive.requestComplete).toBe(true));
  expect(service.stats.historyRequests).toBe(1);expect(t.calls.filter(p=>p.endsWith('/discover'))).toHaveLength(2);
 }finally{release();service.dispose();}
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
test('an older batch encoding falls back to exact immutable parts without consuming its cached response',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture();(f.discovery as any).delivery={version:1,maxDecodedBytes:8*1024*1024,maxParts:8};const t=transport(f);
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher:t.fetcher});
 expect(result.status.archive?.requestComplete).toBe(true);expect(t.calls.filter(path=>path.endsWith('/batch'))).toHaveLength(0);expect(t.calls.filter(path=>path.endsWith('/part'))).toHaveLength(3);
});
test('a slow batch tail does not hold back its hash-validated progressive prefix',async()=>{
 const f=fixture();(f.discovery as any).delivery={version:2,maxDecodedBytes:8*1024*1024,maxParts:8};const t=transport(f);
 let tail!:ReadableStreamDefaultController<Uint8Array>;
 const fetcher:typeof fetch=async(input,init)=>{
  const response=await t.fetcher(input,init);if(!String(input).includes('/batch?'))return response;
  const stream=new ReadableStream<Uint8Array>({start(controller){tail=controller;controller.enqueue(new TextEncoder().encode(f.texts[1]+'\n'));}});
  return new Response(stream,{headers:response.headers});
 };
 const reader=await preparedWallReader(request,fetcher,new AbortController().signal);
 try{
  const prefix=await reader!.read(10);expect(prefix.body).toMatchObject({page:{after:10,hasMore:true}});
  expect(historyScheduler.diagnostics().active).toBe(1);
  let terminal=false;const pending=reader!.read(20).then(value=>{terminal=true;return value;});
  await Promise.resolve();expect(terminal).toBe(false);
  tail.enqueue(new TextEncoder().encode(f.texts[2]+'\n'));tail.close();expect((await pending).body).toMatchObject({page:{hasMore:false}});
 }finally{reader?.dispose();}
 await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
});
test('a truncated batch retains only validated members and never completes its final candle interval',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture();(f.discovery as any).delivery={version:2,maxDecodedBytes:8*1024*1024,maxParts:8};const t=transport(f);
 const fetcher:typeof fetch=async(input,init)=>{
  const response=await t.fetcher(input,init);return String(input).includes('/batch?')?new Response(f.texts[1]+'\n'+f.texts[2]!.slice(0,20),{headers:response.headers}):response;
 };
 const updates:any[]=[];await expect(loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/byte identity/);
 expect(updates).toHaveLength(2);expect(updates.at(-1).resume.after).toBe(20);expect(updates.every(u=>!u.status.archive.requestComplete)).toBe(true);
});
test('unsubscribing the last batch consumer cancels its held stream and releases admission',async()=>{
 const f=fixture();(f.discovery as any).delivery={version:2,maxDecodedBytes:8*1024*1024,maxParts:8};const t=transport(f);let started=false,canceled=false;
 const fetcher:typeof fetch=async(input,init)=>{
  const response=await t.fetcher(input,init);if(!String(input).includes('/batch?'))return response;
  started=true;return new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:response.headers});
 };
 const reader=await preparedWallReader(request,fetcher,new AbortController().signal),pending=reader!.read(10);void pending.catch(()=>{});
 await vi.waitFor(()=>expect(started).toBe(true));reader!.dispose();await expect(pending).rejects.toThrow(/Aborted/);
 await vi.waitFor(()=>{expect(canceled).toBe(true);expect(historyScheduler.diagnostics().active).toBe(0);});
});

test('reader holds and renews its advertised lease through blocked pages and independent final validation',async()=>{
 vi.useFakeTimers();const f=fixture();Object.assign(f.discovery,{readerLease:{version:1,leaseMs:15000}});
 let releasePages!:()=>void,releaseSource!:()=>void;const pages=new Promise<void>(r=>releasePages=r),sourceGate=new Promise<void>(r=>releaseSource=r);
 const t=transport(f,{beforePart:async index=>{if(index>0)await pages;}}),calls:RequestInit[]=[];let validating=false;
 const fetcher:typeof fetch=async(input,init)=>{
  const path=new URL(String(input),'http://test').pathname;
  if(path.endsWith('/reader')){calls.push(init!);return new Response(JSON.stringify({version:1,leaseMs:15000,canonicalKey:f.manifest.key}));}
  if(init?.method==='DELETE'){calls.push(init);return new Response('{}');}
  if(path.endsWith('/source')){validating=true;await sourceGate;}
  return t.fetcher(input,init);
 };
 let reader:Awaited<ReturnType<typeof preparedWallReader>>=null;const pendingReads:Promise<unknown>[]=[];
 try{
  reader=await preparedWallReader(request,fetcher,new AbortController().signal);expect(reader).not.toBeNull();
  const first=await reader!.read(0);expect((first.body as any).page.hasMore).toBe(true);
  const second=reader!.read(10);pendingReads.push(second);await vi.advanceTimersByTimeAsync(11000);expect(historyScheduler.diagnostics().active).toBe(2);expect(calls.filter(c=>c.method==='POST')).toHaveLength(3);expect(calls.some(c=>c.method==='DELETE')).toBe(false);
  releasePages();await second;const terminal=reader!.read(20);pendingReads.push(terminal);await vi.waitFor(()=>expect(validating).toBe(true));
  await vi.advanceTimersByTimeAsync(11000);expect(calls.filter(c=>c.method==='POST')).toHaveLength(5);expect(calls.some(c=>c.method==='DELETE')).toBe(false);
  releaseSource();expect((await terminal).body).toMatchObject({page:{hasMore:false}});reader!.dispose();await vi.advanceTimersByTimeAsync(0);expect(calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
 }finally{releasePages();releaseSource();reader?.dispose();await Promise.allSettled(pendingReads);await vi.advanceTimersByTimeAsync(0);vi.useRealTimers();}
});

test('archive correlation preserves reader identity on shared content and final source requests',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture();Object.assign(f.discovery,{readerLease:{version:1,leaseMs:15000}});const t=transport(f);let token='',released=0;const identities:Headers[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const path=new URL(String(input),'http://test').pathname;
  if(path.endsWith('/reader')){token=JSON.parse(init!.body as string).consumer;return new Response(JSON.stringify({version:1,leaseMs:15000,canonicalKey:f.manifest.key}));}
  if(init?.method==='DELETE'){released++;return new Response('{}');}
  if(path.endsWith('/part')||path.endsWith('/source'))identities.push(new Headers(init?.headers));return t.fetcher(input,init);
 };
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings},fetcher});
 expect(result.status.archive?.requestComplete).toBe(true);expect(identities.length).toBeGreaterThan(0);expect(identities.every(h=>h.get('x-iq-wall-reader')===token&&h.get('x-iq-view-id'))).toBe(true);await vi.waitFor(()=>expect(released).toBe(1));
});

test('eligible history Retry retains its original horizon and resumes exact immutable rows after the archive advances',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const f=fixture(),first=transport(f,{corrupt:true}),updates:any[]=[];
 const fetcher:typeof fetch=async(input,init)=>String(input).includes('/horizon?')?Response.json({version:1,kind:'wall-source-horizon-v1',market:'spot',profile:id,head:{...newHead,at:to-1},availableFrom:from-3600000}):first.fetcher(input,init);
 const request={market:'binance-spot' as const,from,to:to+7200000,settings};
 await expect(loadOrderWallsArchive({request,eligibleHistory:true,fetcher,onUpdate:u=>updates.push(u)})).rejects.toThrow(/hash mismatch/);
 const resume=updates.at(-1).resume;expect(resume).toMatchObject({eligibleTo:to,eligibleHorizonAt:to-1,after:10});
 const next=transport(f),paths:string[]=[];
 const result=await loadOrderWallsArchive({request,eligibleHistory:true,resume,fetcher:async(input,init)=>{paths.push(String(input));if(String(input).includes('/horizon?'))throw Error('Resume must keep the pinned horizon');return next.fetcher(input,init);}});
 const fresh=await loadOrderWallsArchive({request:{...request,to},fetcher:transport(f).fetcher});
 expect(result.segments).toEqual(fresh.segments);expect(result.status.archive).toMatchObject({from,to:request.to,eligibleTo:to,horizonAt:to-1,requestComplete:true,rangeComplete:false});
 expect(paths.some(p=>p.includes('/source?'))).toBe(true);expect(next.calls.filter(path=>path.endsWith('/part'))).toHaveLength(2);
});
