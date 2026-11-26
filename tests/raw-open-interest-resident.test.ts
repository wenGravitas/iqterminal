import {describe,it,expect,vi} from 'vitest';
import {RawOpenInterestHistory,validateRawOpenInterestPayload,type RawOpenInterestObservation,type RawOpenInterestPayload,type RawOpenInterestEvent} from '../src/feed/raw-open-interest';
import {StagingRawOpenInterestService} from '../src/feed/staging-raw-open-interest';
import {OpenInterestDataController,projectOpenInterest} from '../src/indicators/open-interest-data';
import {ChartNumericOutputRegistry} from '../src/scripts/output-registry';
import type {FeedClient} from '../src/feed/client';
const now=1800000000000,hour=3600000,old=now-30*24*hour;
const observation=(time=now-30000,patch:Partial<RawOpenInterestObservation>={}):RawOpenInterestObservation=>({venue:'binance',market:'perpetual',nativeSymbol:'BTCUSDT',sourceTimeMs:time,observedAtMs:time+500,epoch:1,value:100.00000001,valueDecimal:'100.00000001',units:'BTC',source:'recorded',sourceTimeQuality:'exchange-event',quality:'valid',gapBefore:false,...patch});
const payload=(observations:RawOpenInterestObservation[]=[],to=now):RawOpenInterestPayload=>({version:1,market:'perpetual',nativeSymbol:'BTC',semantics:'observed-open-interest-level',units:'BTC',from:to-4*hour,to,asOfMs:now,venues:['binance'],unitVerification:{binance:{status:'verified',units:'BTC',evidence:'explicit unit test contract'}},observations,truncated:false,invalidRows:0,expectedIntervalMs:30000,retentionDays:7,feeds:{},history:'Explicit recorded observations fixture.'});
const window=(key='old',from=old,to=old+hour)=>({window:{key,from,to}});

describe('bounded resident OI ownership',()=>{
 it('keeps admitted old windows through live and delayed response merges without rewinding the live horizon',()=>{
  const history=new RawOpenInterestHistory({maxWindows:2,maxObservations:10}),past=observation(old+1000),live=observation();
  history.merge(payload([live]));history.merge(payload([past],old+hour),window());history.merge(payload([],now+10000));history.merge(payload([],now-hour));
  expect(history.observations(['binance'],old,now+10000)).toEqual([past,live]);expect(history.retainedWindows()).toEqual([{key:'old',from:old,to:old+hour,resident:true}]);
  history.merge(payload([],now+5*hour));expect(history.observations(['binance'],old,now+6*hour)).toEqual([past]);
 });
 it('uses explicit window admission, immutable range identity and hard configurable bounds',()=>{
  expect(()=>new RawOpenInterestHistory({maxWindows:17})).toThrow(/bounds/);expect(()=>new RawOpenInterestHistory({maxObservations:32001})).toThrow(/bounds/);
  expect(()=>new RawOpenInterestHistory().merge(payload([],old+hour),window())).toThrow(/window/);
  const history=new RawOpenInterestHistory({maxWindows:2});history.merge(payload([],old+hour),window());
  expect(()=>history.merge(payload([],old+2*hour),window('old',old,old+2*hour))).toThrow(/identity/);
  expect(()=>history.merge(payload([observation(old-1)],old+hour),window('outside'))).toThrow(/window/);
  expect(()=>history.merge(payload([],old+5*hour),window('wide',old,old+5*hour))).toThrow(/window/);
 });
 it('evicts least recently admitted windows without losing overlap owned by another window',()=>{
  const history=new RawOpenInterestHistory({maxWindows:2,maxObservations:10});
  const a=observation(old+1000),shared=observation(old+hour+1000),b=observation(old+2*hour+1000);
  history.merge(payload([a,shared],old+2*hour),window('a',old,old+2*hour));history.merge(payload([shared,b],old+3*hour),window('b',old+hour,old+3*hour));
  history.merge(payload([],old+4*hour),window('c',old+3*hour,old+4*hour));
  expect(history.retainedWindows().map(w=>w.key)).toEqual(['b','c']);expect(history.observations(['binance'],old,now)).toEqual([shared,b]);
 });
 it('protects recent live rows under capacity and reports an affected historical window nonresident',()=>{
  const history=new RawOpenInterestHistory({maxWindows:2,maxObservations:2}),live=observation();history.merge(payload([live]));
  history.merge(payload([observation(old+1000),observation(old+2000)],old+hour),window());
  expect(history.diagnostics()).toMatchObject({tracked:2,evictions:1,maxObservations:2});expect(history.observations(['binance'],now-hour,now)).toEqual([live]);expect(history.retainedWindows()[0]!.resident).toBe(false);
  history.merge(payload([],old+hour),window());expect(history.retainedWindows()[0]!.resident).toBe(false);
 });
 it('bounds a full resident cache while retaining the next live batch',()=>{
  const history=new RawOpenInterestHistory({maxWindows:16,maxObservations:32000});
  for(let i=0;i<16;i++){const start=old+i*hour;history.merge(payload(Array.from({length:2000},(_,j)=>observation(start+j+1)),start+hour),window(String(i),start,start+hour));}
  expect(history.diagnostics()).toMatchObject({tracked:32000,windows:16,evictions:0});
  history.merge(payload(Array.from({length:2000},(_,j)=>observation(now-30000+j))));
  expect(history.diagnostics()).toMatchObject({tracked:32000,evictions:2000});expect(history.observations(['binance'],now-hour,now)).toHaveLength(2000);expect(history.retainedWindows()[0]!.resident).toBe(false);
 });
 it('preserves native versions and keeps a highest-version conflict withheld through repeated responses',()=>{
  const history=new RawOpenInterestHistory(),a=observation(),b=observation(a.sourceTimeMs,{value:200,valueDecimal:'200'});
  history.merge(payload([a]));expect(history.merge(payload([b]))).toEqual([]);expect(history.observations(['binance'],now-hour,now)).toEqual([]);expect(history.conflicts(['binance'],now-hour,now)).toHaveLength(1);
  history.merge(payload([a]));expect(history.observations(['binance'],now-hour,now)).toEqual([]);
  const newer={...b,observedAtMs:b.observedAtMs+1};history.merge(payload([newer]));history.merge(payload([a]));expect(history.observations(['binance'],now-hour,now)).toEqual([newer]);expect(history.conflicts(['binance'],now-hour,now)).toEqual([]);
 });
 it('retains conflict notices without a local row and never resurrects an older/equal version',()=>{
  const history=new RawOpenInterestHistory(),a=observation(),notice={venue:a.venue,market:a.market,nativeSymbol:a.nativeSymbol,epoch:a.epoch,sourceTimeMs:a.sourceTimeMs,observedAtMs:a.observedAtMs};
  history.merge({...payload(),conflicts:[notice]});history.merge(payload([a]));history.merge(payload([{...a,observedAtMs:a.observedAtMs-1}]));expect(history.observations(['binance'],now-hour,now)).toEqual([]);expect(history.diagnostics()).toMatchObject({tracked:1,retained:0,conflicts:1});
 });
 it('does not mistake caller mutation or delimiter-containing provenance for identical content',()=>{
  const history=new RawOpenInterestHistory(),a=observation(undefined,{source:'a|b',sourceTimeQuality:'c'});history.merge(payload([a]));a.value=999;
  expect(history.observations(['binance'],now-hour,now)[0]!.value).toBe(100.00000001);
  history.merge(payload([observation(undefined,{source:'a',sourceTimeQuality:'b|c'})]));expect(history.conflicts(['binance'],now-hour,now)).toHaveLength(1);
 });
 it('validates bounded conflict identities and preserves explicit unknown versions',()=>{
  const a=observation(),conflicts=[{venue:a.venue,market:a.market,nativeSymbol:a.nativeSymbol,epoch:a.epoch,sourceTimeMs:a.sourceTimeMs,observedAtMs:a.observedAtMs}];
  expect(validateRawOpenInterestPayload({...payload(),conflicts},['binance'],now-4*hour,now).conflicts).toEqual(conflicts);
  for(const bad of [[{...conflicts[0],venue:'bybit'}],[{...conflicts[0],epoch:-1}],[{...conflicts[0],sourceTimeMs:now+1}],[...conflicts,...conflicts]])expect(()=>validateRawOpenInterestPayload({...payload(),conflicts:bad},['binance'],now-4*hour,now)).toThrow(/conflict/i);
 });
 it('rejects unbounded or non-finite exact decimals before retaining observations',()=>{
  for(const valueDecimal of ['9'.repeat(400),'9'.repeat(161)])expect(()=>validateRawOpenInterestPayload(payload([observation(undefined,{value:1,valueDecimal})]),['binance'],now-4*hour,now)).toThrow(/observation/);
  expect(()=>validateRawOpenInterestPayload(payload([observation(undefined,{value:1e-13,valueDecimal:'0'})]),['binance'],now-4*hour,now)).toThrow(/observation/);
 });
 it('preserves a valid original zero epoch rather than substituting a current epoch',()=>{
  expect(validateRawOpenInterestPayload(payload([observation(undefined,{epoch:0})]),['binance'],now-4*hour,now).observations[0]!.epoch).toBe(0);
  expect(()=>validateRawOpenInterestPayload(payload([observation(undefined,{epoch:-1})]),['binance'],now-4*hour,now)).toThrow(/observation/);
 });
});

describe('resident OI projection and lifecycle',()=>{
 it('projects explicitly retained old observations on host time without extending their freshness',()=>{
  const history=new RawOpenInterestHistory({maxWindows:1}),row=observation(old+10000);history.merge(payload([row],old+hour),window());
  const frame=projectOpenInterest(history,payload(),['binance'],[old,old+60000],60000,now);
  expect(frame.lines.get('binance')!.points[0]).toMatchObject({value:row.value,ageMs:49999,sourceTimeMs:row.sourceTimeMs});expect(frame.lines.get('binance')!.points[1]).toMatchObject({value:null,quality:'stale'});
  const unverified={...payload(),unitVerification:{}};expect(projectOpenInterest(history,unverified,['binance'],[old],60000,now).lines.get('binance')!.points[0]!.value).toBeNull();
 });
 it('does not carry a previous good level through a conflicting source timestamp',()=>{
  const base=now-180000,history=new RawOpenInterestHistory(),a=observation(base+10000),b=observation(base+40000);
  history.merge(payload([a,b]));history.merge(payload([{...b,value:2,valueDecimal:'2'}]));
  const frame=projectOpenInterest(history,payload(),['binance'],[base,base+30000],30000,now);
  expect(frame.lines.get('binance')!.points.map(p=>p.value)).toEqual([a.value,null]);expect(frame.lines.get('binance')!.points[1]).toMatchObject({quality:'partial',reset:true});
  history.merge(payload([{...b,observedAtMs:b.observedAtMs+1,value:3,valueDecimal:'3'}]));expect(projectOpenInterest(history,payload(),['binance'],[base+30000],30000,now).lines.get('binance')!.points[0]!.value).toBe(3);
 });
 it('keeps resident rows on live resubscription snapshots and resets only on an explicit fixture reset',()=>{
  vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  let receive!:(event:RawOpenInterestEvent)=>void;
  const feed={subscribeRawOpenInterest:vi.fn((_id:unknown,_request:unknown,listener:typeof receive)=>{receive=listener;return vi.fn();})};
  const registry=new ChartNumericOutputRegistry('resident-chart'),controller=new OpenInterestDataController('resident-chart','oi',feed as unknown as FeedClient,registry,{}, {venue:'binance',interval:'1m'},()=>now,{maxWindows:1,maxObservations:10});
  try{
   const a=observation(old+10000);controller.history.merge(payload([a],old+hour),window());controller.setHostCandles([{t:old,o:1,h:1,l:1,c:1,v:1,closed:true,revision:1}]);controller.setDataDemand(true);
   receive({type:'raw-open-interest-snapshot',ids:['oi'],payload:payload()});expect(controller.viewFrame().lines.get('binance')!.points[0]!.value).toBe(a.value);
   controller.setHostVisible(false);controller.setHostVisible(true);receive({type:'raw-open-interest-snapshot',ids:['oi'],payload:payload()});expect(controller.history.observations(['binance'],old,now)).toEqual([a]);
   receive({type:'raw-open-interest-snapshot',ids:['oi'],payload:payload(),reset:true});expect(controller.history.observations(['binance'],old,now)).toEqual([]);expect(controller.history.retainedWindows()).toEqual([]);
   receive({type:'raw-open-interest-snapshot',ids:['oi'],payload:payload([observation()]),context:'fixture',reset:true});expect(controller.history.diagnostics().retained).toBe(1);
   receive({type:'raw-open-interest-snapshot',ids:['oi'],payload:payload(),context:'recorder'});expect(controller.history.diagnostics().retained).toBe(0);
  }finally{controller.dispose();registry.dispose();vi.unstubAllGlobals();}
 });
 it('propagates a worker conflict patch to a replica cache and permits a strictly newer correction',async()=>{
  vi.useFakeTimers();let count=0;const row=observation(),events:RawOpenInterestEvent[]=[],replica=new RawOpenInterestHistory();
  const service=new StagingRawOpenInterestService(event=>{events.push(event);if(event.type==='raw-open-interest-snapshot'||event.type==='raw-open-interest-patch')replica.merge(event.payload);},true,async()=>{
   count++;return new Response(JSON.stringify(payload([count===1?row:{...row,value:200,valueDecimal:'200',observedAtMs:row.observedAtMs+(count===2?0:1)}])),{status:200});
  },()=>now);
  try{
   service.subscribe('one',{venues:['binance']});await vi.advanceTimersByTimeAsync(0);expect(replica.observations(['binance'],now-hour,now)).toHaveLength(1);
   await vi.advanceTimersByTimeAsync(10000);expect(events.at(-1)).toMatchObject({type:'raw-open-interest-patch',payload:{observations:[],conflicts:[expect.objectContaining({observedAtMs:row.observedAtMs})]}});expect(replica.observations(['binance'],now-hour,now)).toEqual([]);
   await vi.advanceTimersByTimeAsync(10000);expect(replica.observations(['binance'],now-hour,now)[0]).toMatchObject({value:200,observedAtMs:row.observedAtMs+1});expect(replica.conflicts(['binance'],now-hour,now)).toEqual([]);
  }finally{service.dispose();vi.useRealTimers();}
 });
});
