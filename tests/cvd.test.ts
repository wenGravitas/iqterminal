import {describe,it,expect,vi,afterEach}from 'vitest';
import {cvdSettings,cvdAnchorAt,CVD_STEP as M,CvdCalculation,cvdValues,validateCvdPayload,type CvdPayload,type CvdRequest}from '../src/feed/cvd';
import {compactCvd,CvdPlotModel}from '../src/chart/cvd-model';
import {CvdService}from '../src/feed/cvd-service';
import {parseBinanceAggTrade,parseBinanceSpotAggTrade}from '../src/feed/footprint';
import {validateInstances,nativeInstance}from '../src/indicators/model';
const day=Date.UTC(2026,9,19),source='binance:spot' as const;
const request=(patch:Partial<CvdRequest>={}):CvdRequest=>({sources:['binance:spot','binance:perpetual'],anchor:'daily',origin:day,custom:day,...patch});
const payload=(values:number[],patch:Partial<CvdPayload>={}):CvdPayload=>({version:1,source:'binance:spot:BTCUSDT',stepMs:M,from:day,to:day+values.length*M,revision:1,snapshot:true,watermark:100,baseUnit:'BTC',quoteUnit:'USDT',
 buckets:values.map((base,i)=>({time:day+i*M,base,quote:base*(10+i),revision:1})),coverage:{from:day,to:day+values.length*M,gaps:[]},status:'live',asOf:day+values.length*M,...patch});
afterEach(()=>vi.useRealTimers());
describe('executed flow CVD',()=>{
 it('formats compact values without erasing tiny positives or awkward suffix boundaries',()=>{
   expect([999999,999.9,1e-9,-1000000,0].map(compactCvd)).toEqual(['+1M','+1K','+1e-9','−1M','0']);
 });
 it('calculates +100 -40 +20 exactly and keeps signed executed quote separate',()=>{
   const calc=new CvdCalculation(request());calc.apply(payload([100,-40,20]));
   expect(calc.snapshot().map(p=>p.base)).toEqual([100,60,80]);
   expect(calc.snapshot().map(p=>p.quote)).toEqual([1000,560,800]);
   expect(calc.snapshot().every(p=>!p.partial)).toBe(true);
 });
 it('is idempotent for repeated history, overlap and reconnect snapshots, revises suffixes',()=>{
   const calc=new CvdCalculation(request()),initial=payload([100,-40,20]);calc.apply(initial);calc.apply(initial);
   expect(calc.snapshot().at(-1)?.base).toBe(80);
   const changed=payload([100,-10,20],{revision:2});changed.buckets.forEach(b=>b.revision=2);
   calc.apply({...changed,snapshot:false,buckets:[changed.buckets[1]!]});
   expect(calc.snapshot().map(p=>p.base)).toEqual([100,90,110]);
   calc.apply(initial); // explicit authoritative restart snapshot can reset revision
   expect(calc.snapshot().at(-1)?.base).toBe(80);
   calc.apply({...initial,snapshot:false,revision:0,buckets:[]});
   expect(calc.snapshot().at(-1)?.base).toBe(80);
 });
 it('resets on UTC days and Mondays, and rounds custom anchors forward without pre-anchor flow',()=>{
   expect(cvdAnchorAt(day+5*86400000+100,request({anchor:'weekly'}))).toBe(day);
   expect(cvdAnchorAt(day+7*86400000,request({anchor:'weekly'}))).toBe(day+7*86400000);
   const daily=new CvdCalculation(request());daily.apply(payload([1,2],{from:day+86400000-M,to:day+86400000+M,buckets:[{time:day+86400000-M,base:5,quote:50,revision:1},{time:day+86400000,base:2,quote:20,revision:1}],coverage:{from:day,to:day+86400000+M,gaps:[]},asOf:day+86400000+M}));
   expect(daily.snapshot().map(p=>p.base)).toEqual([5,2]);expect(daily.snapshot()[1]?.reset).toBe(true);
   const custom=new CvdCalculation(request({anchor:'custom',custom:day+1}));custom.apply(payload([100,-40,20]));
   expect(custom.snapshot().map(p=>p.base)).toEqual([-40,-20]);expect(cvdAnchorAt(day,request({anchor:'custom',custom:day+1}))).toBe(day+M);
 });
 it('preserves cumulative checkpoints through pruning and handles earlier pagination/backfill',()=>{
   const calc=new CvdCalculation(request({anchor:'continuous'}));calc.apply(payload([100,-40,20]));
   const pruned=payload([20],{from:day+2*M,to:day+4*M,revision:2,snapshot:false,buckets:[{time:day+3*M,base:5,quote:65,revision:2}],coverage:{from:day,to:day+4*M,gaps:[]},asOf:day+4*M});
   calc.apply(pruned);expect(calc.snapshot().map(p=>p.base)).toEqual([80,85]);
   const backfilled=payload([100,-40,20,5],{revision:3});backfilled.buckets.forEach(b=>b.revision=3);
   calc.apply(backfilled);expect(calc.snapshot().map(p=>p.base)).toEqual([100,60,80,85]);
 });
 it('distinguishes confirmed zero from missing flow and does not repair gaps on reconnect',()=>{
   const calc=new CvdCalculation(request());calc.apply(payload([10,0,20],{coverage:{from:day,to:day+3*M,gaps:[{from:day+M,to:day+2*M}]}}));
   expect(calc.snapshot().map(p=>p.observed)).toEqual([true,false,true]);expect(calc.snapshot()[2]?.partial).toBe(true);
   calc.apply(payload([10,0,20],{status:'live',snapshot:false,buckets:[],coverage:{from:day,to:day+3*M,gaps:[{from:day+M,to:day+2*M}]}}));
   expect(calc.snapshot()[2]?.partial).toBe(true);
   calc.apply(payload([10,0,20],{revision:2,status:'live'}));
   // An explicit successful coverage repair can make the already-cached zero complete.
   expect(calc.snapshot()[2]?.partial).toBe(false);
   const partial=new CvdCalculation(request());partial.apply(payload([10],{coverage:{from:day+1000,to:day+30000,gaps:[]},asOf:day+30000}));
   expect(partial.snapshot()[0]?.partial).toBe(true);
 });
 it('does not draw an invented zero before any observed source data',()=>{
   const calc=new CvdCalculation(request());calc.apply(payload([0,0],{coverage:{from:day+3*M,to:day+3*M,gaps:[]}}));
   expect(calc.snapshot().every(p=>!p.available)).toBe(true);
   const plot=new CvdPlotModel();plot.update({source,points:calc.snapshot(),snapshot:true,removeBefore:day,coverage:{from:day+3*M,to:day+3*M,gaps:[]},status:'awaiting',message:'No observations',asOf:day+3*M});
   plot.derive(cvdSettings({sources:[source]}),'btc');expect(plot.value('total')?.value).toBeNull();
   const zero=new CvdCalculation(request());zero.apply(payload([0,0]));expect(zero.snapshot().at(-1)).toMatchObject({available:true,observed:true,base:0,partial:false});
 });
 it('keeps independent source identity; overlapping groups deduplicate totals and filtered groups',()=>{
   const values=new Map([['a',{value:100,observed:true,partial:false}],['b',{value:60,observed:true,partial:false}],['c',{value:20,observed:true,partial:false}]]);
   const groups=[{id:'one',name:'One',markets:['a','b'],revision:1},{id:'two',name:'Two',markets:['b','c'],revision:1}] as any;
   expect(cvdValues(['a','b','c'] as any,values,groups).total.value).toBe(180);
   const filtered=cvdValues(['a','c']as any,values,groups);
   expect(filtered.total.value).toBe(120);expect(filtered.groups.map(g=>[g.value,g.filtered])).toEqual([[100,true],[20,true]]);
   const config=cvdSettings({sources:['binance:spot','binance:perpetual','hyperliquid:perpetual']});
   expect(config.sources).toEqual(['binance:spot','binance:perpetual']);
   expect(cvdSettings({sources:[]}).sources).toEqual([]);
 });
 it('line hiding and venue/aggregation presentation never change the deduplicated total',()=>{
   const plot=new CvdPlotModel(),calc=new CvdCalculation(request());calc.apply(payload([100,-40,20]));
   const s={source,points:calc.snapshot(),snapshot:true,removeBefore:day,coverage:payload([]).coverage,status:'live' as const,message:'',asOf:day+3*M};
   plot.update(s);plot.update({...s,source:'binance:perpetual',points:calc.snapshot().map(p=>({...p,base:p.base*2,quote:p.quote*2}))});
   const settings=cvdSettings({sources:['binance:spot','binance:perpetual'],groups:[{id:'mix',name:'My basket',markets:['binance:spot','binance:perpetual'],revision:1}]});
   plot.derive(settings,'btc');expect(plot.value('total')?.value).toBe(240);
   plot.derive({...settings,hidden:['binance:spot'],mode:'aggregations'},'btc');
   expect(plot.value('total')?.value).toBe(240);expect(plot.value('mix')?.value).toBe(240);
   plot.derive({...settings,sources:['binance:spot'],mode:'aggregations'},'btc');
   expect(plot.value('total')?.value).toBe(80);expect(plot.lines.get('mix')?.filtered).toBe(true);
   plot.derive(settings,'usdt');expect(plot.value('total')?.value).toBe(2400);
 });
 it('retains stale contributions in the total and marks later combined samples incomplete',()=>{
   const plot=new CvdPlotModel(),calc=new CvdCalculation(request());calc.apply(payload([100,-40,20]));
   plot.update({source,points:calc.snapshot().slice(0,1),snapshot:true,removeBefore:day,coverage:{from:day,to:day+M,gaps:[]},status:'stale',message:'disconnect',asOf:day+3*M});
   plot.update({source:'binance:perpetual',points:calc.snapshot(),snapshot:true,removeBefore:day,coverage:{from:day,to:day+3*M,gaps:[]},status:'live',message:'',asOf:day+3*M});
   plot.derive(cvdSettings({}),'btc');expect(plot.value('total')).toMatchObject({value:180,partial:true});
   expect(plot.value(source)?.value).toBeNull();
 });
 it('incremental replacement equals full replay over many corrected buckets',()=>{
   const calc=new CvdCalculation(request()),values=Array.from({length:300},(_,i)=>Math.sin(i)*10);
   calc.apply(payload(values));for(let i=250;i<300;i++){values[i]=i%2?17:-9;const p=payload(values,{revision:i+2,snapshot:false});p.buckets=p.buckets.slice(i);p.buckets.forEach(b=>b.revision=i+2);calc.apply(p);}
   const fresh=new CvdCalculation(request());fresh.apply(payload(values));
   expect(calc.snapshot()).toEqual(fresh.snapshot());
 });
 it('verifies adapter maker semantics, base/quote conversions and persisted settings',()=>{
   const raw={e:'aggTrade',s:'BTCUSDT',a:1,f:1,l:1,T:day,E:day,p:'100',q:'2',m:true};
   expect(parseBinanceAggTrade(raw)).toMatchObject({trade:{side:'sell',quantity:2}});
   expect(parseBinanceSpotAggTrade({...raw,m:false})).toMatchObject({trade:{side:'buy',market:'spot',quantity:2}});
   expect(parseBinanceAggTrade({...raw,m:'false'})).toHaveProperty('rejected');
   const settings=cvdSettings({anchor:'continuous',origin:day,custom:day+123,mode:'aggregations',hidden:['total'],colors:{'binance:spot':'#abc123'}});
   const native=nativeInstance('native.multi-venue-cvd',{...settings});
   expect(validateInstances(JSON.parse(JSON.stringify([native])))).toEqual([native]);
   expect(validateInstances([])).toEqual([]);
 });
 it('rejects mismatched instruments, units, unbounded/duplicate buckets',()=>{
   expect(()=>validateCvdPayload(payload([1]),source)).not.toThrow();
   expect(()=>validateCvdPayload({...payload([1]),source:'binance:spot:ETHUSDT'},source)).toThrow();
   expect(()=>validateCvdPayload({...payload([1]),quoteUnit:'USD'},source)).toThrow();
   const p=payload([1]);p.buckets.push(p.buckets[0]!);expect(()=>validateCvdPayload(p,source)).toThrow();
 });
});
describe('shared CVD worker service',()=>{
 it('shares history per underlying market and ACK-coalesces without double counting',async()=>{
   vi.useFakeTimers();const events:any[]=[],calls:string[]=[];
   const fetcher=vi.fn(async(url:any)=>{calls.push(String(url));const src=String(url).includes('market=spot')?source:'binance:perpetual';return new Response(JSON.stringify({...payload([100,-40,20]),source:src+':BTCUSDT'}));});
   const service=new CvdService({},event=>events.push(event),true,fetcher as any,()=>day+3*M);
   service.subscribe('one',request());service.subscribe('two',request());
   await vi.advanceTimersByTimeAsync(20);
   expect(calls).toHaveLength(2);expect(events).toHaveLength(2);
   for(const e of events)service.ack(e.ids[0],e.generation,e.batchId);
   const update=payload([100,-10,20],{revision:2,snapshot:false});update.buckets[1]!.revision=2;service.ingest(source,update);service.ingest(source,update);
   for(const e of [...events])service.ack(e.ids[0],e.generation,e.batchId);
   expect(service.diagnostics().sources.every(s=>s.buckets===3)).toBe(true);
   service.unsubscribe('one');expect(service.diagnostics().clients).toBe(1);
   service.unsubscribe('two');expect(service.diagnostics().sources).toEqual([]);
   service.dispose();
 });
 it('reuses direct execution feeds, deduplicates IDs and keeps unrepaired reconnect gaps',()=>{
   vi.useFakeTimers();let clock=day+30000,receive:any;const release=vi.fn(),subscribe=vi.fn((_id,fn)=>{receive=fn;return release;}),events:any[]=[];
   const service=new CvdService({spot:{subscribeExecutions:subscribe} as any},e=>events.push(e),false,undefined,()=>clock);
   service.subscribe('one',request({sources:[source]}));service.subscribe('two',request({sources:[source]}));
   expect(subscribe).toHaveBeenCalledTimes(1);
   const trade={executionId:'a',timeMs:clock,side:'buy',quantity:2,price:100,quoteNotionalText:'200'};
   receive([trade,trade],{state:'live'},day);for(const e of [...events])service.ack(e.ids[0],e.generation,e.batchId);
   expect(events.at(-1).series[0].points.at(-1)).toMatchObject({base:2,quote:200,available:true});
   clock+=M;receive([],{state:'reconnecting'},day);for(const e of [...events])service.ack(e.ids[0],e.generation,e.batchId);
   clock+=M;receive([{...trade,executionId:'b',timeMs:clock,side:'sell',quantity:1,price:120,quoteNotionalText:'120'}],{state:'live'},day);
   for(const e of [...events])service.ack(e.ids[0],e.generation,e.batchId);
   expect(events.at(-1).series[0].points.at(-1)).toMatchObject({base:1,quote:80,partial:true});
   expect(events.at(-1).series[0].coverage.gaps.length).toBeGreaterThan(0);
   service.unsubscribe('one');expect(release).not.toHaveBeenCalled();service.unsubscribe('two');expect(release).toHaveBeenCalledTimes(1);
 });
 it('does not connect any source for empty membership, or enable fixtures as a fallback',async()=>{
   vi.useFakeTimers();const requestFn=vi.fn(async()=>{throw Error('offline');}),events:any[]=[];
   const service=new CvdService({},e=>events.push(e),true,requestFn as any,()=>day+3*M);
   service.subscribe('empty',request({sources:[]}));await vi.advanceTimersByTimeAsync(500);expect(requestFn).not.toHaveBeenCalled();
   service.subscribe('one',request({sources:[source]}));await vi.advanceTimersByTimeAsync(20);
   expect(events.at(-1)?.series[0]).toMatchObject({status:'unavailable',points:[]});expect(service.diagnostics().fixture).toBe(false);service.dispose();
 });
});
