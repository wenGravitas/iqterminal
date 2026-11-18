import{test,expect,vi}from'vitest';
import{projectionOnlyFixture,profile,settings}from'./helpers/prepared-wall-fixture';
import{OrderWallsArchiveService}from'../src/feed/order-walls-archive-service';
const from=1800000000000,to=from+30*3600000,ends=[to,to+7429,to+14858];
const usdm={...profile,id:'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1',market:'perpetual',instrument:'binance:perpetual:BTCUSDT',feed:'binance:perpetual:BTCUSDT:usd-m-standard-diff-depth-rpi-excluded'};
for(const followLive of [true,false])test(followLive?'live viewport commands keep the validated prefix through two pending same-start extensions':'historical viewport fetches only missing history and reuses resident overscan on the next extension',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const requestedEnds=followLive?ends:[to,ends[1]+3600000],fixtures=requestedEnds.map((end,index)=>projectionOnlyFixture(true,end,!followLive&&index?to:from,usdm)),events:any[]=[],discoveries:number[]=[],releases:Array<()=>void>=[],entered=new Set<number>();let now=followLive?to:to+24*3600000;const gates=[Promise.resolve(),new Promise<void>(r=>releases[1]=r),new Promise<void>(r=>releases[2]=r)];
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input),'http://fixture'),index=Math.max(0,requestedEnds.indexOf(Number(url.searchParams.get('to'))));
  if(init?.method==='DELETE'||url.pathname.endsWith('/reader'))return Response.json({version:1,leaseMs:15000});
  if(url.pathname.endsWith('/current')){const f=fixtures[Math.max(0,ends.indexOf(now))],cursor=100+Math.max(0,ends.indexOf(now))*10;return Response.json({version:1,profile:usdm,market:'perpetual',instrument:usdm.instrument,feed:usdm.feed,watermark:cursor,head:{cursor,epoch:2,at:now-1,midpoint:'100',valid:true},state:{bids:[f.page.seed.bids[0]],asks:[]},page:{after:Number(url.searchParams.get('after')??0),nextAfter:cursor,hasMore:false,lastAt:now-1,limit:256,sameMillisecondClosed:true},patches:[],profileStatus:'ready',coverage:{availableFrom:from-1000,confirmedTo:now-1,status:'complete',gaps:[]}});}
  if(url.pathname.endsWith('/horizon'))return Response.json({version:1,kind:'wall-source-horizon-v1',market:'perpetual',profile:usdm.id,head:fixtures[index].source.head,availableFrom:from-1000});
  if(url.pathname.endsWith('/discover')){expect(new Headers(init?.headers).get('X-IQ-Wall-Projection-Only')).toBe('1');discoveries.push(Number(url.searchParams.get('to')));const requested={market:'perpetual',profile:usdm.id,from:Number(url.searchParams.get('from')),to:Number(url.searchParams.get('to'))};return Response.json({...fixtures[index].discovery,eligibility:{version:1,kind:'wall-eligible-discovery-v1',requested,request:requested,horizon:{version:1,kind:'wall-source-horizon-v1',market:'perpetual',profile:usdm.id,head:fixtures[index].source.head,availableFrom:from-1000}}});}
  if(url.pathname.endsWith('/projection-batch')){const f=fixtures.find(f=>f.manifest.key===url.searchParams.get('key'))!;expect(f).toBeDefined();return new Response(f.texts.join('\n')+'\n',{headers:{'x-iq-wall-start':'0','x-iq-wall-next':String(f.texts.length),'x-iq-wall-parts':String(f.texts.length),'x-iq-chunk-key':f.manifest.key,'x-iq-source-revision':f.source.token}});}
  if(url.pathname.endsWith('/source')){entered.add(index);await gates[index];return Response.json(fixtures[index].source);}
  throw Error('Unexpected fixture route (no canonical fallback allowed): '+url.pathname);
 };
 const service=new OrderWallsArchiveService(e=>events.push(e),fetcher,()=>now);
 const latest=()=>events.filter(e=>e.type==='order-wall-batch').at(-1);
 try{
  service.subscribe('r5-view',{market:'binance-perp',from,to,settings,followLive});await vi.waitFor(()=>expect(latest()?.status.archive?.requestComplete,JSON.stringify(latest()?.status)).toBe(true));
  for(let i=1;i<ends.length;i++){
   const before=events.length,oldLoaded=latest().status.archive.loadedThrough;if(followLive)now=ends[i];service.command({type:'order-wall-viewport',id:'r5-view',from,to:ends[i],autoPriceWidth:0});
   if(!followLive&&i===2){await vi.waitFor(()=>expect(latest().status.archive).toMatchObject({requestComplete:true,loadedThrough:requestedEnds[1]-1}));expect(discoveries).toEqual(requestedEnds);expect(service.diagnostics().historyActiveJobs).toBe(0);continue;}
   await vi.waitFor(()=>expect(entered.has(i)).toBe(true));const pending=latest();expect(pending.status.archive).toMatchObject({from,to:ends[i],requestComplete:false,loadedThrough:followLive?oldLoaded:to-1});
   expect(events.slice(before).filter(e=>e.kind==='snapshot')).toHaveLength(0);expect(service.diagnostics().historyJobs).toBe(1);
   releases[i]();await vi.waitFor(()=>expect(latest().status.archive.requestComplete).toBe(true));expect(latest().status.archive).toMatchObject({from,to:ends[i],loadedThrough:followLive?ends[i]:requestedEnds[1]-1,exact:true});expect(latest().status.archive.gaps.length).toBeGreaterThan(0);
  }
  expect(discoveries).toEqual(requestedEnds);expect(service.diagnostics().groups).toBe(followLive?1:0);
  service.unsubscribe('r5-view');expect(service.diagnostics()).toMatchObject({subscriptions:0,historyJobs:0,historyConsumers:0,historyActiveJobs:0});
 }finally{releases.forEach(r=>r?.());service.dispose();vi.unstubAllEnvs();}
});
