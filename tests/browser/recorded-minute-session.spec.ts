import {test,expect} from '@playwright/test';
import {recordedMinuteRequest as scope,recordedMinuteWire} from '../helpers/recorded-minute-wire';
test.use({storageState:{cookies:[],origins:[]}});
test('explicit minute session worker retains accepted exact data through an origin outage',async({page,context})=>{
 test.skip(process.env.IQ_TEST_MINUTE_SESSION!=='1','Requires explicit isolated Vite module test server');test.setTimeout(20000);
 const token='e'.repeat(64),payload=recordedMinuteWire(),snapshot=payload.publicationSnapshot;
 const lease={kind:'iq-recorded-minute-observation-lease-v1',id:'12345678-1234-4abc-8abc-123456789abc',checkpoint:snapshot.checkpoint,generation:snapshot.generation,catalogueHead:snapshot.catalogueHead,witness:'f'.repeat(64),source:snapshot.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};
 const calls:Array<{method:string;url:string;token:string|undefined}>=[];let reads=0;
 await context.route('**/__minute-session-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Explicit minute session fixture</title>'}));
 await context.route('**/market-data/v2/history/**',async route=>{
  const req=route.request(),url=new URL(req.url());calls.push({method:req.method(),url:req.url(),token:req.headers()['x-iq-minute-lease']});
  if(req.method()==='POST'){expect(req.headers()['x-iq-minute-lease-protocol']).toBe('1');return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,token,lease})});}
  if(req.method()==='DELETE')return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,released:true})});
  expect(url.pathname).toBe('/market-data/v2/history/recorded-minutes');reads++;
  return route.fulfill({status:reads===1?200:503,contentType:'application/json',body:JSON.stringify(reads===1?{...payload,observationLease:lease}:{error:'Controlled origin outage'})});
 });
 await context.route('**/__minute-session-worker.js',route=>{
  const origin=new URL(route.request().url()).origin;
  const source=`import {RecordedMinuteSessionClient} from '${origin}/src/feed/recorded-minute-session.ts';
   self.onmessage=async({data})=>{const client=new RecordedMinuteSessionClient(true);try{const certificate=await client.open(data),resident=await client.read(data);let failure;try{await client.read(data);}catch(error){failure=error.reason;}const released=await client.close();self.postMessage({certificate,resident,failure,released,diagnostics:client.diagnostics()});}catch(error){self.postMessage({error:String(error),reason:error.reason});}finally{await client.dispose();}};`;
  return route.fulfill({contentType:'text/javascript',body:source});
 });
 await page.goto('/__minute-session-fixture',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async scope=>{
  const worker=new Worker('/__minute-session-worker.js',{type:'module'});
  try{return await new Promise<any>((resolve,reject)=>{worker.onmessage=event=>resolve(event.data);worker.onerror=event=>reject(Error(event.message));worker.postMessage(scope);});}finally{worker.terminate();}
 },scope);
 expect(result.error).toBeUndefined();expect(result.resident.bars[0].base).toBe('-12.00000001');expect(result.resident.bars[0].firstId).toBe('9007199254740993000');expect(result.resident.observationLease).toEqual(lease);expect(result.failure).toBe('network');expect(result.released).toEqual({released:true});expect(result.diagnostics.active).toBe(false);expect(JSON.stringify(result)).not.toContain(token);
 expect(calls.map(c=>c.method)).toEqual(['POST','GET','GET','DELETE']);expect(calls.every(c=>!c.url.includes(token))).toBe(true);expect(calls.slice(1).every(c=>c.token===token)).toBe(true);
});
