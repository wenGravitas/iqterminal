import {test,expect} from '@playwright/test';
import {recordedMinuteWire} from '../helpers/recorded-minute-wire';
import type {MinuteHistoryRequest} from '../../src/feed/recorded-minute-history';
test.use({storageState:{cookies:[],origins:[]}});
test('opt-in production worker retains CVD observations across request lifetimes',async({page,context})=>{
 test.skip(process.env.IQ_TEST_CVD_HISTORY_OWNER!=='1','Requires explicit isolated opt-in Vite server');test.setTimeout(25000);
 const day=Date.UTC(2026,10,1),cut=day+180000,source='binance:perpetual',token='e'.repeat(64);
 const native={version:2,semantics:'native-recorded-execution-minute-observations',source:source+':BTCUSDT',incarnation:'12345678-1234-4abc-8abc-123456789abc',revision:1,revisionScope:'incarnation',replacement:'requested-range',fullProjectionAt:cut+61000,snapshot:true,stepMs:60000,from:cut,to:cut+60000,retainedFrom:cut,watermark:'1000',watermarkKind:'aggregate-execution-id',baseUnit:'BTC',quoteUnit:'USDT',buckets:[{time:cut,base:'9007199254740993.00000001',quote:'100',firstId:'100',lastId:'100',records:'1'}],coverage:{from:cut,to:cut+60000,gaps:[]},status:'live',asOf:cut+61000,sparse:true,cumulative:false,financialAccepted:false,currentReconciled:false,retirementAuthorized:false};
 let lease:any,fail=false;const methods:string[]=[];
 await context.route('**/__cvd-owner-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Explicit CVD owner fixture</title>'}));
 await context.route('**/market-data/v2/**',async route=>{
  const req=route.request(),url=new URL(req.url());methods.push(req.method());
  expect(req.url()).not.toContain(token);
  if(url.pathname.endsWith('/cvd'))return route.fulfill({contentType:'application/json',body:JSON.stringify(native)});
  if(req.method()==='DELETE')return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,released:true})});
  const request={dataset:'cvd',venue:'binance',market:'perpetual',from:Number(url.searchParams.get('from')),to:Number(url.searchParams.get('to'))} as MinuteHistoryRequest;
  if(req.method()==='POST'){
   const p=recordedMinuteWire({...request,to:request.from+60000}).publicationSnapshot;
   lease={kind:'iq-recorded-minute-observation-lease-v1',id:native.incarnation,checkpoint:p.checkpoint,generation:p.generation,catalogueHead:p.catalogueHead,witness:'f'.repeat(64),source:p.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope:request,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};
   return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,token,lease})});
  }
  expect(req.headers()['x-iq-minute-lease']).toBe(token);
  if(fail)return route.fulfill({status:503,contentType:'application/json',body:'{}'});
  return route.fulfill({contentType:'application/json',body:JSON.stringify({...recordedMinuteWire(request),observationLease:lease})});
 });
 await page.goto('/__cvd-owner-fixture',{waitUntil:'domcontentloaded'});
 const handle=await page.evaluateHandle(()=>{
  const worker=new Worker('/src/feed/worker.ts',{type:'module'});let sequence=0;
  const pending=new Map<string,(value:any)=>void>();let diagnostic:((value:any)=>void)|undefined;
  worker.onmessage=({data})=>{if(data.type==='diagnostics'){diagnostic?.(data.data.cvdHistory);diagnostic=undefined;}else if(data.type==='cvd-history-result'){const id=data.ids[0];pending.get(id)?.(data);pending.delete(id);}};
  const send=(type:string,request:any)=>new Promise(resolve=>{const id=String(++sequence);pending.set(id,resolve);worker.postMessage({type,id,request});});
  return {worker,read:(request:any)=>send('cvd-history-read',request),project:(request:any)=>send('cvd-history-project',request),diagnostics:()=>new Promise(resolve=>{diagnostic=resolve;worker.postMessage({type:'diagnostics'});})};
 });
 try{
  const first:any=await handle.evaluate((h,request)=>h.read(request),{source,kind:'native',from:cut,to:cut+60000});expect(first.reason).toBeUndefined();expect(first.receipt.sum.base).toBe('9007199254740993.00000001');
  const query={source,anchor:day,from:cut,to:cut+60000,stepMs:60000};
  const provisional:any=await handle.evaluate((h,q)=>h.project(q),query);expect(provisional.projection.points[0].partial).toBe(true);
  const warm={source,kind:'archive',from:day,to:cut};
  const second:any=await handle.evaluate((h,r)=>h.read(r),warm);expect(second.receipt.sum.base).toBe('-24.00000002');
  const projected:any=await handle.evaluate((h,q)=>h.project(q),query);expect(projected.projection.points[0]).toMatchObject({base:'9007199254740968.99999999',partial:false});
  const again:any=await handle.evaluate((h,r)=>h.read(r),warm);expect(again.receipt).toMatchObject({changed:false,version:2});
  fail=true;const unavailable:any=await handle.evaluate((h,r)=>h.read(r),{...warm,from:day-60000,to:day});expect(unavailable.reason).toBe('unavailable');
  const cached:any=await handle.evaluate((h,q)=>h.project(q),query);expect(cached).toEqual({...projected,ids:cached.ids});
  const diagnostics:any=await handle.evaluate(h=>h.diagnostics());expect(diagnostics).toMatchObject({enabled:true,active:false,consumers:0});expect(diagnostics.sources[0]).toMatchObject({version:2,days:1,residentCells:4});expect(JSON.stringify(diagnostics)).not.toContain(token);
  expect(methods).toEqual(['GET','POST','GET','GET']);
  await handle.evaluate(h=>h.worker.postMessage({type:'initFixture'}));
  const disabled:any=await handle.evaluate((h,r)=>h.read(r),warm);expect(disabled.reason).toBe('disabled');
  // Fixture selection disposes the real transport and releases its known lease.
  await expect.poll(()=>methods).toEqual(['GET','POST','GET','GET','DELETE']);
 }finally{await handle.evaluate(h=>h.worker.terminate());await handle.dispose();}
});
