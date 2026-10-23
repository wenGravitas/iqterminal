import { describe,it,expect } from 'vitest';
import { ConditionsEngine, RollingRank, Confirmation, bandWidth, choppiness, composite, efficiency, historicalVolatility, scoreBand, suitability, trueRange, classifyRegime, type ConditionsPoint } from '../src/market-conditions/engine';
import { conditionsSettings, DEFAULT_CONDITIONS, warmupBars } from '../src/market-conditions/settings';
import { ConditionsAlerts } from '../src/market-conditions/alerts';
import { ConditionsService } from '../src/market-conditions/service';
import { type Candle, type Event, type Series, duration, keyOf } from '../src/feed/protocol';
import { nativeInstance, validateInstances } from '../src/indicators/model';
import { MARKET_CONDITIONS_ID } from '../src/market-conditions/settings';
const step=60000,origin=1700000040000;
const candles=(n:number,close:(i:number)=>number=()=>100):Candle[]=>Array.from({length:n},(_,i)=>{const c=close(i);return {t:origin+i*step,o:c,h:c+1,l:c-1,c,v:1,revision:1,closed:true};});
const quick=()=>conditionsSettings({atrPeriod:3,atrLookback:20,bbwPeriod:3,bbwLookback:20,erPeriod:3,chopPeriod:3,regimeConfirmation:1,scoreHysteresis:0});
const point=(t:number,extra:Partial<ConditionsPoint>={}):ConditionsPoint=>({t,atr:1,atrPercent:1,atrRank:50,bbw:1,bbwRank:50,er:.5,chop:40,hv:{},score:60,regime:'NORMAL',band:'DEVELOPING',warning:false,ready:true,count:600,...extra});
describe('Market Conditions calculations',()=>{
 it('true range includes gaps and Wilder ATR seeds with an SMA then smooths',()=>{const bars=candles(5);bars[0].h=102;bars[1].h=104;bars[2].h=106;const e=new ConditionsEngine(quick(),step);e.update(bars);expect(e.points[2].atr).toBe(5);expect(e.points[3].atr).toBe(4);expect(e.points[4].atr).toBeCloseTo(10/3);expect(e.points[2].atrPercent).toBe(5);expect(trueRange({...bars[0],h:110,l:105,o:106,c:108},100)).toBe(10);});
 it('strict percentile excludes current values and handles ties deterministically',()=>{const r=new RollingRank(3);expect(r.push(1)).toBeNull();r.push(2);r.push(3);expect(r.push(2)).toBeCloseTo(100/3);expect(r.push(4)).toBe(100);const flat=new RollingRank(2);flat.push(0);flat.push(0);expect(flat.push(0)).toBe(0);});
 it('BBW uses population standard deviation and safely handles zero means',()=>{expect(bandWidth([1,2,3],2)).toBeCloseTo(100*4*Math.sqrt(2/3)/2);expect(bandWidth([0,0],2)).toBeNull();});
 it('ER measures directional efficiency, with zero for a flat path',()=>{expect(efficiency([1,2,3,4])).toBe(1);expect(efficiency([1,2,1])).toBe(0);expect(efficiency([2,2,2])).toBe(0);});
 it('CHOP follows summed true ranges and flat markets are maximally choppy',()=>{const bars=candles(3);expect(choppiness(bars,[2,2,2])).toBeCloseTo(100);expect(choppiness(bars.map(b=>({...b,h:100,l:100})),[0,0,0])).toBe(100);});
 it('HV uses log returns, population variance and actual 24/7 timeframe duration',()=>{const closes=[100,110,99];const r=[Math.log(1.1),Math.log(.9)],mean=(r[0]+r[1])/2,sd=Math.sqrt(((r[0]-mean)**2+(r[1]-mean)**2)/2);expect(historicalVolatility(closes,step)).toBeCloseTo(sd*100*Math.sqrt(365*1440));expect(historicalVolatility(closes,86400000)).toBeCloseTo(sd*100*Math.sqrt(365));expect(historicalVolatility([0,1,2],step)).toBeNull();});
 it('piecewise suitability penalizes extremes; weights normalize and guardrails cap',()=>{const s=conditionsSettings({});expect(suitability(15,s)).toBe(0);expect(suitability(25,s)).toBe(50);expect(suitability(35,s)).toBe(100);expect(suitability(80,s)).toBe(100);expect(suitability(100,s)).toBe(25);expect(composite(1,0,60,s)).toBe(100);expect(composite(1,0,10,s)).toBeLessThanOrEqual(35);expect(composite(.1,0,60,s)).toBeLessThanOrEqual(45);expect(composite(.6,30,60,conditionsSettings({efficiencyWeight:80,volatilityWeight:70,choppinessWeight:50}))).toBeCloseTo(composite(.6,30,60,s));});
 it('classification boundaries belong to the upper band',()=>{const s=conditionsSettings({});expect([0,24.9,25,45,65,85,100].map(n=>scoreBand(n,s))).toEqual(['DEAD','DEAD','CHOPPY','DEVELOPING','TRADEABLE','STRONG','STRONG']);});
 it('regime precedence, rising window, recent exits and hysteresis are explicit',()=>{const s=quick(),history=[point(1,{atrRank:10,bbwRank:10}),point(2,{atrRank:15,bbwRank:15}),point(3,{atrRank:20,bbwRank:20})];expect(classifyRegime(95,10,history,null,s)).toBe('EXTREME');expect(classifyRegime(10,10,history,null,s)).toBe('COMPRESSION');expect(classifyRegime(35,35,history,null,s)).toBe('EXPANDING');expect(classifyRegime(22,22,history,'COMPRESSION',s)).toBe('COMPRESSION');expect(classifyRegime(88,40,history,'EXTREME',s)).toBe('EXTREME');expect(classifyRegime(40,10,history,null,s)).toBe('NORMAL');});
 it('confirmation does not flicker when a candidate reverses',()=>{const c=new Confirmation<string>();expect(c.next('A',2)).toBeNull();expect(c.next('A',2)).toBe('A');expect(c.next('B',2)).toBe('A');expect(c.next('A',2)).toBe('A');expect(c.next('B',2)).toBe('A');expect(c.next('B',2)).toBe('B');});
 it.each([
  ['flat',()=>100],['slow sideways',(i:number)=>100+Math.sin(i)*.1],['volatile sideways',(i:number)=>100+Math.sin(i)*15],
  ['smooth trend',(i:number)=>100+i*.5],['volatile trend',(i:number)=>100+i*.5+Math.sin(i)*5],
  ['compression to expansion',(i:number)=>100+Math.sin(i)*(i<300?.01:10)],['spike',(i:number)=>100+(i===590?100:Math.sin(i)*.1)],
 ] as const)('%s stays finite and historical/streaming results match',(_name,close)=>{const bars=candles(620,close),s=quick();const batch=new ConditionsEngine(s,step),stream=new ConditionsEngine(s,step);batch.update(bars);for(const bar of bars)stream.update([bar]);expect(stream.points).toEqual(batch.points);expect(batch.points.at(-1)?.ready).toBe(true);expect(JSON.stringify(batch.points)).not.toMatch(/NaN|Infinity/);expect(batch.rebuilds).toBe(0);});
 it('flat data reaches compression, zero ER, high CHOP and low score',()=>{const e=new ConditionsEngine(quick(),step);const flat=candles(100).map(b=>({...b,h:100,l:100}));e.update(flat);expect(e.points.at(-1)).toMatchObject({atr:0,atrRank:0,bbw:0,bbwRank:0,er:0,chop:100,score:0,regime:'COMPRESSION',band:'DEAD'});});
 it('ATR and BBW ranks are independently warmed; disabled HV does not delay output',()=>{const s=conditionsSettings({atrLookback:20,bbwLookback:100,hvEnabled:false}),e=new ConditionsEngine(s,step);e.update(candles(50));expect(e.points.at(-1)?.atrRank).not.toBeNull();expect(e.points.at(-1)?.score).not.toBeNull();expect(e.points.at(-1)?.bbwRank).toBeNull();expect(e.points.at(-1)?.regime).toBeNull();expect(e.points.at(-1)?.ready).toBe(false);expect(e.points.at(-1)?.hv).toEqual({});});
 it('intrabar updates cannot overwrite completed classifications',()=>{const bars=candles(100),e=new ConditionsEngine(quick(),step);e.update(bars);const before=structuredClone(e.points),forming={...candles(101).at(-1)!,closed:false};e.update([forming]);e.update([{...forming,c:100.5,h:102,revision:2}]);expect(e.points).toEqual(before);e.update([{...forming,closed:true,revision:3}]);expect(e.points.length).toBe(101);expect(e.processed).toBe(101);});
 it('historical corrections and out-of-order inserts replay to the same result as clean history',()=>{const bars=candles(150,i=>100+Math.sin(i)),s=quick(),e=new ConditionsEngine(s,step);e.update(bars.filter((_,i)=>i!==80));expect(e.points[80].ready).toBe(false);e.update([bars[80]]);expect(e.rebuilds).toBe(1);const corrected={...bars[90],c:101,h:103,revision:2};e.update([corrected]);const clean=new ConditionsEngine(s,step);clean.update(bars.map((b,i)=>i===90?corrected:b));expect(e.points).toEqual(clean.points);});
 it('missing candles reset warmup; no synthetic observations are inserted',()=>{const e=new ConditionsEngine(quick(),step),bars=candles(160);e.update([...bars.slice(0,100),...bars.slice(101)]);expect(e.points[100].count).toBe(1);expect(e.points[100].ready).toBe(false);expect(e.points).toHaveLength(159);});
 it('invalid/zero price candles never reach output',()=>{const e=new ConditionsEngine(quick(),step);e.update([{...candles(1)[0],c:0,l:0},{...candles(1)[0],c:Infinity}]);expect(e.points).toEqual([]);});
 it('settings validate, bound work and preserve layout-compatible instances',()=>{const s=conditionsSettings({mode:'dashboard',timeframes:['1d','5m','1d','bad'],atrLookback:1e6,efficiencyWeight:-1,referenceLines:[25,NaN],bands:[85,65,45,25]});expect(s.timeframes).toEqual(['1d','5m']);expect(s.atrLookback).toBe(750);expect(s.bands).toEqual([25,45,65,85]);expect(s.efficiencyWeight).toBe(0);expect(warmupBars(s)).toBeLessThan(1000);const instances=validateInstances(JSON.parse(JSON.stringify([nativeInstance(MARKET_CONDITIONS_ID,{...s})])));expect(instances[0].settings).toEqual(s);expect(instances[0].placement).toBe('pane');});
});
describe('shared multi-timeframe calculations',()=>{
 it('shares identical requests, separates timeframes and releases the last consumer',()=>{let subscriptions=0,releases=0;const callbacks=new Map<string,(event:Event)=>void>();const source={subscribe(id:string,series:Series,callback:(event:Event)=>void){subscriptions++;callbacks.set(keyOf(series),callback);return()=>{releases++;callbacks.delete(keyOf(series));};}};const service=new ConditionsService(source),series:Series={venue:'binance',interval:'5m'},s=quick(),updates:any[]=[];
 const a=service.subscribe(series,s,u=>updates.push(u)),b=service.subscribe(series,{...s,mode:'dashboard'},u=>updates.push(u));expect(subscriptions).toBe(1);const c=service.subscribe({...series,interval:'1d'},s,()=>{});expect(subscriptions).toBe(2);
 callbacks.get(keyOf(series))!({type:'snapshot',ids:[],key:keyOf(series),candles:candles(100).map(b=>({...b,t:b.t*5}))});expect(updates.at(-1).points.at(-1).ready).toBe(true);expect(service.diagnostics()[0].consumers).toBe(2);a();expect(releases).toBe(0);b();expect(releases).toBe(1);c();expect(releases).toBe(2);expect(service.diagnostics()).toEqual([]);
 });
});
describe('alerts',()=>{
 it('deduplicates confirmed transitions and supports every event',()=>{const s=conditionsSettings({alertEvents:[...DEFAULT_CONDITIONS.alertEvents,'compression-exit','expansion','extreme','classification','score-above','score-below','combined']}),a=new ConditionsAlerts(s);a.seed(point(1,{regime:'COMPRESSION',score:30,band:'CHOPPY'}));const expanding=point(2,{regime:'EXPANDING',score:75,band:'TRADEABLE'});expect(a.next(expanding)).toEqual(expect.arrayContaining(['compression-exit','expansion','classification','score-above','combined']));expect(a.next(expanding)).toEqual([]);expect(a.next(point(3,{regime:'EXTREME',score:30,band:'CHOPPY'}))).toEqual(expect.arrayContaining(['extreme','score-below']));});
 it('threshold confirmation and hysteresis prevent repeated edge alerts',()=>{const a=new ConditionsAlerts(conditionsSettings({alertEvents:['score-above'],alertAbove:65,alertConfirmation:2,alertHysteresis:3}));a.seed(point(1,{score:60}));expect(a.next(point(2,{score:66}))).toEqual([]);expect(a.next(point(3,{score:66}))).toEqual(['score-above']);expect(a.next(point(4,{score:64}))).toEqual([]);expect(a.next(point(5,{score:66}))).toEqual([]);});
 it('seeding correction/backfill does not alert retroactively',()=>{const a=new ConditionsAlerts(conditionsSettings({alertEvents:['extreme']}));a.seed(point(3,{regime:'EXTREME'}));expect(a.next(point(2,{regime:'NORMAL'}))).toEqual([]);expect(a.next(point(4,{regime:'EXTREME'}))).toEqual([]);});
});
describe('bounded history and non-repainting metadata',()=>{
 it('ignores a forming update to an already closed candle and honors unchanged newer revisions',()=>{
 const e=new ConditionsEngine(quick(),step),bars=candles(100);e.update(bars);const before=structuredClone(e.points);
 e.update([{...bars[90],revision:5}]);e.update([{...bars[90],revision:4,c:101,h:102}]);expect(e.points).toEqual(before);
 e.update([{...bars[90],revision:6,c:101,h:102,closed:false}]);expect(e.points).toEqual(before);expect(e.candles.get(bars[90].t)?.closed).toBe(true);
 });
 it('bounds plotted history without restarting the rolling Wilder state',()=>{
 const s=quick(),bars=candles(5400,i=>100+Math.sin(i)),e=new ConditionsEngine(s,step);let trims=0;
 for(const c of bars){const update=e.update([c]);if(update.reset)trims++;}
 expect(e.points.length).toBeLessThanOrEqual(5000);expect(e.candles.size).toBeLessThanOrEqual(5000);expect(e.processed).toBe(5400);expect(e.rebuilds).toBe(0);expect(trims).toBeGreaterThan(0);
 const clean=new ConditionsEngine(s,step);clean.update(bars);expect(e.points.at(-1)).toEqual(clean.points.at(-1));
 });
 it('ranks match a direct rolling oracle without an inclusive tie bias',()=>{
 const rank=new RollingRank(20),values:number[]=[];
 for(let i=0;i<250;i++){const value=(i*17)%31;const oracle=values.length===20?100*values.filter(v=>v<value).length/20:null;expect(rank.push(value)).toBe(oracle);values.push(value);if(values.length>20)values.shift();}
 });
 it('uses independent timeframe durations for HV and canonical series keys',()=>{
 expect(duration['30m']).toBe(1800000);expect(duration['1d']).toBe(86400000);
 const s=conditionsSettings({hvEnabled:true}),bars=candles(620,i=>100+Math.sin(i));
 const minute=new ConditionsEngine(s,step),daily=new ConditionsEngine(s,86400000);minute.update(bars);daily.update(bars.map((b,i)=>({...b,t:origin+i*86400000})));
 expect(minute.points.at(-1)!.hv['20']/daily.points.at(-1)!.hv['20']).toBeCloseTo(Math.sqrt(1440));
 });
});
describe('classification stability',()=>{
 it('retains a tradeability label inside its expanded score corridor',()=>{
 const s=conditionsSettings({...quick(),scoreHysteresis:12}),e=new ConditionsEngine(s,step);e.update(candles(600,i=>100+i*.01+Math.sin(i*.1)*2+Math.sin(i)*.2));
 let held=0;
 for(let i=1;i<e.points.length;i++){const previous=e.points[i-1],p=e.points[i];if(!previous.band||p.score===null)continue;const index=['DEAD','CHOPPY','DEVELOPING','TRADEABLE','STRONG'].indexOf(previous.band),lower=s.bands[index-1]??0,upper=s.bands[index]??100;
 if(p.score>=lower-12&&p.score<upper+12){expect(p.band).toBe(previous.band);held++;}}
 expect(held).toBeGreaterThan(100);
 });
});
describe('render safety and trim semantics',()=>{
 it('does not send nonfinite metrics or invalid dates to presentation',()=>{
 const e=new ConditionsEngine(conditionsSettings({hvEnabled:true}),step);
 const bars=candles(620).map(b=>({...b,o:5e307,h:1e308,l:1e307,c:5e307}));e.update(bars);
 const walk=(v:unknown):void=>{if(typeof v==='number')expect(Number.isFinite(v)).toBe(true);else if(v&&typeof v==='object')for(const child of Object.values(v))walk(child);};walk(e.points);
 e.update([{...bars[0],t:9000000000000000,revision:5}]);expect(e.candles.has(9000000000000000)).toBe(false);
 });
 it('distinguishes presentation trimming from historical correction for alert eligibility',()=>{
 const e=new ConditionsEngine(quick(),step);const bars=candles(5002,i=>100+Math.sin(i));e.update(bars.slice(0,5000));const trim=e.update([bars[5000]]);expect(trim.reset).toBe(true);expect(trim.corrected).toBe(false);expect(trim.changed).toHaveLength(1);
 const correction=e.update([{...bars[4990],c:100,h:103,revision:5}]);expect(correction.reset).toBe(true);expect(correction.corrected).toBe(true);
 });
});

it('volatility alerts remain independent while tradeability is warming',()=>{
 const a=new ConditionsAlerts(conditionsSettings({alertEvents:['extreme']}));a.seed(point(1,{score:null,band:null,ready:false}));
 expect(a.next(point(2,{regime:'EXTREME',score:null,band:null,ready:false}))).toEqual(['extreme']);
});
