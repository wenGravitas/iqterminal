import {test,expect} from '@playwright/test';
test.use({storageState:{cookies:[],origins:[]}});
test('measures cached exact projections after minute eviction in a dedicated Pi worker',async({page,context},info)=>{
 test.skip(process.env.IQ_TEST_CVD_PROJECTION_BENCH!=='1','Explicit bounded component benchmark');test.setTimeout(30000);
 await context.route('**/__cvd-projection-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Explicit CVD projection benchmark</title>'}));
 await context.route('**/__cvd-projection-worker.js',route=>{
  const origin=new URL(route.request().url()).origin;
  return route.fulfill({contentType:'text/javascript',body:`
   import {CvdHistoryOwner} from '${origin}/src/feed/cvd-history-owner.ts';
   import {recordedMinuteWire} from '${origin}/tests/helpers/recorded-minute-wire.ts';
   const M=60000,D=86400000,day=Date.UTC(2026,10,1),cut=day+20*D,source='binance:perpetual',id='12345678-1234-4abc-8abc-123456789abc';
   const json=value=>new Response(JSON.stringify(value));let lease;
   const owner=new CvdHistoryOwner(true,async(input,init={})=>{
    const url=new URL(input,'http://fixture'),from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to'));
    if(url.pathname.endsWith('/cvd'))return json({version:2,semantics:'native-recorded-execution-minute-observations',source:source+':BTCUSDT',incarnation:id,revision:1,revisionScope:'incarnation',replacement:'requested-range',fullProjectionAt:cut+61000,snapshot:true,stepMs:M,from:cut,to:cut+M,retainedFrom:cut,watermark:'1000',watermarkKind:'aggregate-execution-id',baseUnit:'BTC',quoteUnit:'USDT',buckets:[],coverage:{from:cut,to:cut+M,gaps:[]},status:'live',asOf:cut+61000,sparse:true,cumulative:false,financialAccepted:false,currentReconciled:false,retirementAuthorized:false});
    if(init.method==='DELETE')return json({version:1,released:true});
    const request={dataset:'cvd',venue:'binance',market:'perpetual',from,to};
    if(init.method==='POST'){const snapshot=recordedMinuteWire({...request,to:from+M}).publicationSnapshot;lease={kind:'iq-recorded-minute-observation-lease-v1',id,checkpoint:snapshot.checkpoint,generation:snapshot.generation,catalogueHead:snapshot.catalogueHead,witness:'f'.repeat(64),source:snapshot.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope:request,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};return json({version:1,token:'e'.repeat(64),lease});}
    return json({...recordedMinuteWire(request),observationLease:lease});
   });
   const request={source,anchor:day,from:day,to:cut,stepMs:5*M};let ready=false;
   self.onmessage=async()=>{try{
    if(!ready){const signal=new AbortController().signal;await owner.read({source,kind:'native',from:cut,to:cut+M},signal);for(let n=0;n<20;n++)await owner.read({source,kind:'archive',from:day+n*D,to:day+(n+1)*D},signal);
     const start=performance.now(),projection=owner.project(request),buildMs=performance.now()-start;
     for(let n=0;n<20;n++)owner.evict(source,day+n*D);
     const pan=owner.project({...request,from:day+10*D}),zoom=owner.project({...request,stepMs:60*M});ready=true;
     self.postMessage({ready:true,buildMs,points:projection.points.length,complete:projection.points.every(p=>!p.partial),last:projection.points.at(-1),panPoints:pan.points.length,zoomPoints:zoom.points.length,diagnostics:owner.diagnostics()});return;}
    const start=performance.now(),projection=owner.project(request),queryMs=performance.now()-start;self.postMessage({queryMs,projection});
   }catch(error){self.postMessage({error:String(error),reason:error.reason});}};
  `});
 });
 await page.goto('/__cvd-projection-fixture',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async()=>{
  const worker=new Worker('/__cvd-projection-worker.js',{type:'module'});
  const ask=()=>new Promise<any>((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data);worker.onerror=e=>reject(Error(e.message));worker.postMessage({});});
  try{const initial=await ask(),roundtripMs:number[]=[],queryMs:number[]=[];let last;
   for(let n=0;n<25;n++){const start=performance.now(),value=await ask();roundtripMs.push(performance.now()-start);queryMs.push(value.queryMs);last=value.projection.points.at(-1);}
   const quantile=(values:number[],q:number)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
   return {initial,last,samples:25,queryMs:{p50:quantile(queryMs,.5),p95:quantile(queryMs,.95)},roundtripMs:{p50:quantile(roundtripMs,.5),p95:quantile(roundtripMs,.95)}};
  }finally{worker.terminate();}
 });
 expect(result.initial).toMatchObject({ready:true,points:5760,complete:true,panPoints:2880,zoomPoints:480});expect(result.last).toEqual(result.initial.last);
 expect(result.initial.diagnostics.sources[0]).toMatchObject({sealedDays:20,residentCells:1});
 const report={qualification:'controlled sparse in-memory transport fixture; dedicated headless Chromium worker; no live/provider/chart acceptance',shape:{days:20,stepMs:300000,points:5760,recordedRows:40,sealedDays:20},...result};
 await info.attach('cvd-projection-cache-benchmark.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
 console.log('CVD_PROJECTION_BENCHMARK '+JSON.stringify({samples:result.samples,buildMs:result.initial.buildMs,queryMs:result.queryMs,roundtripMs:result.roundtripMs}));
});
