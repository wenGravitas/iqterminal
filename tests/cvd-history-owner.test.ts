import {describe,it,expect,vi} from 'vitest';
import {CvdHistoryOwner,type CvdHistoryRead} from '../src/feed/cvd-history-owner';
import {HistoryScheduler} from '../src/feed/history-scheduler';
import {recordedMinuteWire} from './helpers/recorded-minute-wire';
import type {MinuteHistoryRequest} from '../src/feed/recorded-minute-history';
const M=60000,D=86400000,day=Date.UTC(2026,10,1),cut=day+3*M;
const id='12345678-1234-4abc-8abc-123456789abc',token='e'.repeat(64);
const request:CvdHistoryRead={source:'binance:perpetual',kind:'native',from:cut,to:cut+3*M};
const warm:CvdHistoryRead={...request,kind:'archive',from:day,to:cut};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const signal=()=>new AbortController().signal;
function native(r:CvdHistoryRead=request,incarnation=id){return {version:2,semantics:'native-recorded-execution-minute-observations',source:r.source+':BTCUSDT',incarnation,revision:1,revisionScope:'incarnation',replacement:'requested-range',fullProjectionAt:r.to+1000,snapshot:true,stepMs:M,from:r.from,to:r.to,retainedFrom:cut,watermark:'1000',watermarkKind:r.source.startsWith('bybit:')?'collector-sequence':'aggregate-execution-id',baseUnit:'BTC',quoteUnit:'USDT',buckets:[{time:r.from,base:'9007199254740993.00000001',quote:'100',firstId:'100',lastId:'100',records:'1'}],coverage:{from:r.from,to:r.to,gaps:[]},status:'live',asOf:r.to+1000,sparse:true,cumulative:false,financialAccepted:false,currentReconciled:false,retirementAuthorized:false};}
function fixture(enabled=true){
 let now=1000,lease:any;const calls:Array<{url:string;init:RequestInit}>=[];
 const fetch=vi.fn(async(input:RequestInfo|URL,init:RequestInit={})=>{
  const url=new URL(String(input),'http://localhost');calls.push({url:String(input),init});
  const page=()=>({dataset:'cvd',venue:url.searchParams.get('venue'),market:url.searchParams.get('market'),from:Number(url.searchParams.get('from')),to:Number(url.searchParams.get('to'))}) as MinuteHistoryRequest;
  if(url.pathname.endsWith('/v2/cvd')){const p=page();return json(native({source:`${p.venue}:${p.market}` as CvdHistoryRead['source'],kind:'native',from:p.from,to:p.to}));}
  if(init.method==='DELETE'){lease=undefined;return json({version:1,released:true});}
  if(init.method==='POST'){
   const scope=page(),p=recordedMinuteWire({...scope,to:scope.from+M}).publicationSnapshot;
   lease={kind:'iq-recorded-minute-observation-lease-v1',id,checkpoint:p.checkpoint,generation:p.generation,catalogueHead:p.catalogueHead,witness:'f'.repeat(64),source:p.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};return json({version:1,token,lease});
  }
  return json({...recordedMinuteWire(page()),observationLease:lease});
 });
 const owner=new CvdHistoryOwner(enabled,fetch,new HistoryScheduler(1),()=>now);
 return {owner,fetch,calls,time:(n:number)=>now=n};
}
describe('worker-lifetime CVD history admission',()=>{
 it('exposes cached exact worker projections and adjusts their prefix as warm history arrives',async()=>{
  const f=fixture();await f.owner.read(request,signal());const q={source:request.source,anchor:day,from:cut,to:request.to,stepMs:M};
  const before=f.owner.project(q);expect(before.points[0]).toMatchObject({base:'9007199254740993.00000001',partial:true});await f.owner.read(warm,signal());const calls=f.fetch.mock.calls.length;
  const after=f.owner.project(q);expect(after.points).toEqual(f.owner.series(request.source,day,cut,request.to));expect(after.points[0]).toMatchObject({base:'9007199254740968.99999999',partial:false});
  const emit=vi.fn();f.owner.command({type:'cvd-history-project',id:'projection',request:q},emit);expect(emit).toHaveBeenCalledWith({type:'cvd-history-result',ids:['projection'],projection:after});expect(f.fetch).toHaveBeenCalledTimes(calls);expect(f.owner.diagnostics().projections.updates).toBe(1);await f.owner.dispose();
 });
 it('keeps exact contributions across separate callers and uses no network for cached projections',async()=>{
  const f=fixture();const first=await f.owner.read(request,signal());expect(first.sum.base).toBe('9007199254740993.00000001');
  await f.owner.read(warm,signal());const calls=f.fetch.mock.calls.length;
  expect(f.owner.sum(request.source,day,request.to)).toMatchObject({base:'9007199254740968.99999999',complete:true,financialAccepted:false});
  const series=f.owner.series(request.source,day,cut,request.to)!;expect(series[0]!.base).toBe('9007199254740968.99999999');expect(f.fetch).toHaveBeenCalledTimes(calls);
  await f.owner.read(warm,signal());expect(f.owner.sum(request.source,day,request.to)!.base).toBe(series[0]!.base);
  expect(f.fetch).toHaveBeenCalledTimes(calls);expect(f.calls.filter(c=>c.init.method==='POST')).toHaveLength(1);expect(JSON.stringify(f.owner.diagnostics())).not.toContain(token);await f.owner.dispose();
 });
 it('coalesces equal reads; cancellation of one caller preserves the other and the admitted ledger',async()=>{
  const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>release=r);f.fetch.mockImplementationOnce(async()=>{await gate;return json(native());});
  const caller=new AbortController(),a=f.owner.read(request,caller.signal).catch(e=>e),b=f.owner.read(request,signal());caller.abort();expect(await a).toMatchObject({reason:'cancelled'});release();expect((await b).sum.knownMinutes).toBe(3);expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.owner.diagnostics()).toMatchObject({consumers:0,coalesced:1,active:false});
  expect((await f.owner.read(request,signal())).changed).toBe(false);await f.owner.dispose();
 });
 it('retains admission until actual aborted body cancellation drains',async()=>{
  const f=fixture();let drain!:()=>void;const cancel=vi.fn(()=>new Promise<void>(r=>drain=r));f.fetch.mockImplementationOnce(async()=>new Response(new ReadableStream({cancel})));
  const caller=new AbortController(),a=f.owner.read(request,caller.signal).catch(e=>e);await vi.waitFor(()=>expect(f.fetch).toHaveBeenCalledTimes(1));await Promise.resolve();caller.abort();expect(await a).toMatchObject({reason:'cancelled'});await vi.waitFor(()=>expect(cancel).toHaveBeenCalledOnce());
  const b=f.owner.read({...request,to:request.to+M},signal());await Promise.resolve();expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.owner.diagnostics()).toMatchObject({active:true,queued:1});
  await expect(f.owner.read(request,signal())).rejects.toMatchObject({reason:'capacity'});drain();expect((await b).sum.knownMinutes).toBe(4);expect(f.fetch).toHaveBeenCalledTimes(2);await f.owner.dispose();
 });
 it('preserves previous native and archive observations on outage, conflict and process restart',async()=>{
  const f=fixture();await f.owner.read(request,signal());await f.owner.read(warm,signal());const before=f.owner.sum(request.source,day,request.to),version=f.owner.diagnostics().sources[0]!.version;
  f.fetch.mockImplementationOnce(async()=>json({},503));await expect(f.owner.read(request,signal())).rejects.toMatchObject({reason:'unavailable'});
  f.fetch.mockImplementationOnce(async()=>json(native(request,'12345678-1234-4abc-8abc-123456789abd')));await expect(f.owner.read(request,signal())).rejects.toMatchObject({reason:'rejoin-unavailable'});
  expect(f.owner.diagnostics().states[request.source]).toBe('rejoin-unavailable');expect(f.owner.sum(request.source,day,request.to)).toEqual(before);expect(f.owner.diagnostics().sources[0]!.version).toBe(version);await f.owner.dispose();
 });
 it('refuses a valid payload for the wrong requested range before creating a basis',async()=>{
  const f=fixture();f.fetch.mockImplementationOnce(async()=>json(native({...request,to:request.to+M})));await expect(f.owner.read(request,signal())).rejects.toMatchObject({reason:'invalid'});expect(f.owner.diagnostics().sources).toHaveLength(0);await f.owner.dispose();
 });
 it('requires a native basis, validates input and does not retry failed acquisitions',async()=>{
  const f=fixture();await expect(f.owner.read(warm,signal())).rejects.toMatchObject({reason:'basis'});expect(f.fetch).not.toHaveBeenCalled();
  for(const patch of [{source:'unknown'},{from:day+1},{to:cut+2*D},{kind:'guess'}])await expect(f.owner.read({...request,...patch} as any,signal())).rejects.toMatchObject({reason:'invalid'});
  f.fetch.mockImplementationOnce(async()=>json({},404));await expect(f.owner.read(request,signal())).rejects.toMatchObject({reason:'disabled'});expect(f.fetch).toHaveBeenCalledTimes(1);await f.owner.dispose();
 });
 it('releases and explicitly renews an expired lease without clearing accepted totals',async()=>{
  const f=fixture();await f.owner.read(request,signal());await f.owner.read(warm,signal());const before=f.owner.sum(request.source,day,request.to);f.time(61000);expect(f.owner.diagnostics().session.session!.expired).toBe(true);
  await f.owner.read({...warm,from:day-M,to:day},signal());expect(f.calls.filter(c=>c.init.method==='POST')).toHaveLength(2);expect(f.calls.filter(c=>c.init.method==='DELETE')).toHaveLength(1);expect(f.owner.sum(request.source,day,request.to)).toEqual(before);await f.owner.dispose();
 });
 it('bounds coalesced consumers and queued jobs, and disposal drains without accepting aborted bytes',async()=>{
  const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>release=r);f.fetch.mockImplementationOnce(async()=>{await gate;return json(native());});
  const pending=Array.from({length:24},()=>f.owner.read(request,signal()).catch(e=>e));await expect(f.owner.read(request,signal())).rejects.toMatchObject({reason:'capacity'});
  let disposed=false;const close=f.owner.dispose().then(()=>disposed=true);await Promise.resolve();expect(disposed).toBe(false);release();await close;for(const p of pending)expect(await p).toMatchObject({reason:'cancelled'});expect(f.owner.diagnostics()).toMatchObject({active:false,queued:0,consumers:0,sources:[]});
  const q=fixture();let finish!:()=>void;const wait=new Promise<void>(r=>finish=r);q.fetch.mockImplementationOnce(async()=>{await wait;return json(native());});const reads=[q.owner.read(request,signal()).catch(e=>e)];
  for(let n=1;n<=4;n++)reads.push(q.owner.read({...request,to:request.to+n*M},signal()).catch(e=>e));await expect(q.owner.read({...request,to:request.to+5*M},signal())).rejects.toMatchObject({reason:'capacity'});const end=q.owner.dispose();finish();await end;await Promise.all(reads);
 });
 it('supports independent source ledgers and explicit worker command cancellation',async()=>{
  const f=fixture();for(const source of ['binance:spot','binance:perpetual','bybit:perpetual'] as const)await f.owner.read({...request,source},signal());expect(f.owner.diagnostics().sources).toHaveLength(3);
  const emit=vi.fn();f.owner.command({type:'cvd-history-read',id:'one',request},emit);await vi.waitFor(()=>expect(emit).toHaveBeenCalledOnce());expect(emit.mock.calls[0]![0]).toMatchObject({type:'cvd-history-result',ids:['one'],receipt:{changed:false}});
  let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);f.fetch.mockImplementationOnce(async()=>{await gate;return json(native());});f.owner.command({type:'cvd-history-read',id:'cancel',request},emit);f.owner.command({type:'cvd-history-cancel',id:'cancel'},emit);finish();await f.owner.dispose();expect(emit).toHaveBeenCalledOnce();expect(f.owner.sum(request.source,cut,request.to)!.base).toBe('9007199254740993.00000001');
 });
 it('disabled and disposed owners do not inspect request payloads or start network operations',async()=>{
  const f=fixture(false),poison=new Proxy({},{get(){throw Error('disabled input read');}});await expect(f.owner.read(poison as any,poison as any)).rejects.toMatchObject({reason:'disabled'});await f.owner.dispose();expect(f.fetch).not.toHaveBeenCalled();
  expect(()=>f.owner.project(poison as any)).toThrowError(expect.objectContaining({reason:'disabled'}));
 });
});
