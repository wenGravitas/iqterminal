import {describe,it,expect}from 'vitest';
import {LiquidationCache,liquidationBars,liquidationSummary,LiquidationBurstDetector}from '../src/liquidations/engine';
import {liquidationSettings}from '../src/liquidations/settings';
import {parseBybitLiquidations}from '../src/liquidations/adapters';
import {liquidationCoverageText}from '../src/liquidations/coverage';
const at=1792931000000;
const event=(i=0,side='Buy',value='1')=>parseBybitLiquidations({topic:'allLiquidation.BTCUSDT',type:'snapshot',ts:at+i*1000,data:[{s:'BTCUSDT',T:at+i*1000,S:side,p:'10000',v:value}]},at+i*1000).events[0]!;
describe('actual liquidation shared calculations',()=>{
 it('deduplicates, orders by exchange time, and keeps a bounded shared cache',()=>{const c=new LiquidationCache();c.merge([event(2),event(0),event(1),event(1)]);expect(c.sorted().map(e=>e.timeMs)).toEqual([at,at+1000,at+2000]);const many=Array.from({length:20010},(_,i)=>event(i));c.merge(many);expect(c.events.size).toBe(20000);expect(c.dropped).toBe(10);});
 it('uses UTC candle boundaries and stacks venue contributions separately on each side',()=>{const a=event(0),b={...event(1),id:'binance-1',venue:'binance' as const,instrument:'binance:perpetual:BTCUSDT' as const},short=event(2,'Sell');const bars=liquidationBars([short,b,a],liquidationSettings({}),60000);expect(bars).toHaveLength(1);expect(bars[0]).toMatchObject({time:Math.floor(at/60000)*60000,longs:{bybit:10000,binance:10000},shorts:{bybit:10000,binance:0}});});
 it('keeps summary independent of display minimum and excludes future or expired events',()=>{const events=[event(-900),event(-20),event(-5,'Sell'),event(3)];const s=liquidationSummary(events,['bybit'],at);expect(s[0]).toMatchObject({longs:10000,shorts:10000,total:20000});expect(s[0]!.ratio).toBe(1);});
 it('detects concentrated side-specific bursts once through overlapping windows',()=>{const d=new LiquidationBurstDetector(),rule={...liquidationSettings({}).burst,minimum:25000,count:3,alerts:true,cooldownMs:60000};expect(d.ingest(event(0),rule,true,at)).toBeUndefined();expect(d.ingest(event(1),rule,true,at+1000)).toBeUndefined();const b=d.ingest(event(2),rule,true,at+2000)!;expect(b).toMatchObject({count:3,notional:30000,notify:true});const id=b.id;expect(d.ingest(event(3),rule,true,at+3000)).toMatchObject({id,count:4,notify:false});expect(d.ingest(event(3),rule,true,at+3000)).toBeUndefined();expect(d.bursts).toHaveLength(1);});
 it('suppresses replay/settings warmup and cooldown without hiding subsequent bursts',()=>{const d=new LiquidationBurstDetector(),rule={...liquidationSettings({}).burst,minimum:20000,count:2,alerts:true,cooldownMs:60000};d.ingest(event(0),rule,false,at+100000);expect(d.ingest(event(1),rule,false,at+100000)?.notify).toBe(false);d.ingest(event(30),rule,true,at+30000);expect(d.ingest(event(31),rule,true,at+31000)?.notify).toBe(true);d.ingest(event(50),rule,true,at+50000);expect(d.ingest(event(51),rule,true,at+51000)?.notify).toBe(false);expect(d.bursts).toHaveLength(3);});
 it('does not label missing or sampled coverage as complete liquidation volume',()=>{expect(liquidationCoverageText({sources:[],head:0,retentionDays:7,semantics:'reported-events-only'},['binance'],at,at+1)).toContain('Binance sampled');expect(liquidationCoverageText({sources:[],head:0,retentionDays:7,semantics:'reported-events-only'},['bybit'],at,at+1)).toContain('Source history unavailable');});
});

import {liquidationInk}from '../src/liquidations/colors';
it('keeps liquidation tier text legible on both terminal surfaces without changing saved colours',()=>{
 const lum=(c:string)=>[1,3,5].reduce((sum,i,j)=>{const x=parseInt(c.slice(i,i+2),16)/255;return sum+(x<=.04045?x/12.92:((x+.055)/1.055)**2.4)*[.2126,.7152,.0722][j]!;},0);
 for(const light of [false,true])for(const color of ['#995652','#c86b66','#e68a82','#367d94','#4ca7ca','#65c7e3']){const text=lum(liquidationInk(color,light)),bg=lum(light?'#f6f4ee':'#090909');expect((Math.max(text,bg)+.05)/(Math.min(text,bg)+.05)).toBeGreaterThanOrEqual(4.5);}
});
