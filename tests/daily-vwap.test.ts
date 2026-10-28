import { DailyVwapPrimitive } from '../src/chart/daily-vwap';
import { describe, expect, it } from 'vitest';
import type { Bar } from 'openalgo-charts';
import { DailyVwapCalculation, DAILY_VWAP_ID, dailyVwapSettings, DEFAULT_DAILY_VWAP } from '../src/indicators/daily-vwap';
import { nativeInstance, validateInstances } from '../src/indicators/model';
const day=1761264000;
const bar=(time:number,price:number,volume:number):Bar=>({time,open:price,high:price,low:price,close:price,volume});
describe('daily UTC candle VWAP',()=>{
  it('autoscales only the visible VWAP interval and honours band visibility',()=>{
    let range={from:day+60,to:day+60};
    const overlay=new DailyVwapPrimitive({...DEFAULT_DAILY_VWAP},()=>range);
    overlay.setData([bar(day,100,1),bar(day+60,110,3),bar(day+86400,1000,1)],60);
    const extent=overlay.autoscaleInfo()!;
    expect(extent.min).toBeCloseTo(107.5-Math.sqrt(18.75));
    expect(extent.max).toBeCloseTo(107.5+Math.sqrt(18.75));
    overlay.configure({...DEFAULT_DAILY_VWAP,bands:false});
    expect(overlay.autoscaleInfo()).toEqual({min:107.5,max:107.5});
    range={from:0,to:0}; expect(overlay.autoscaleInfo()).toBeNull();
  });
  it('keeps untouched completed daily VWAPs and removes inclusive later wick touches',()=>{
    const calc = new DailyVwapCalculation(), step = 43200;
    const bars = [bar(day,100,1),bar(day+step,100,1),bar(day+86400,120,1),bar(day+86400+step,120,1),bar(day+172800,140,1)];
    calc.update(bars,'close',step);
    expect(calc.nakedGaps).toEqual([
      {time:day+step,availableAt:day+86400,value:100},
      {time:day+86400+step,availableAt:day+172800,value:120},
    ]);
    const last = {...bars[4]!,low:120,volume:0};
    bars[4] = last;
    calc.update(bars,'close',step);
    expect(calc.nakedGaps.map(g=>g.value)).toEqual([100]);
    bars[4] = {...last,low:100};
    calc.update(bars,'close',step);
    expect(calc.nakedGaps).toEqual([]);
    bars[4] = {...last,low:140,volume:1};
    calc.update(bars,'close',step);
    expect(calc.nakedGaps.map(g=>g.value)).toEqual([100,120]);
    const fresh = new DailyVwapCalculation(); fresh.update(bars,'close',step);
    expect(calc.nakedGaps).toEqual(fresh.nakedGaps);
  });
  it('does not mark incomplete or zero-volume days, missing observations, or immediately touched VWAPs as naked',()=>{
    const calc = new DailyVwapCalculation(), step=43200;
    const full = [bar(day,100,1),bar(day+step,100,1),bar(day+86400,120,1)];
    calc.update(full.slice(1),'close',step); expect(calc.nakedGaps).toEqual([]);
    calc.update(full.map((b,i)=>i<2?{...b,volume:0}:b),'close',step); expect(calc.nakedGaps).toEqual([]);
    calc.update([...full,bar(day+172800,140,1)],'close',step); expect(calc.nakedGaps).toEqual([]);
    calc.update([...full.slice(0,2),{...full[2]!,low:100}],'close',step); expect(calc.nakedGaps).toEqual([]);
    calc.update(full,'close',step); expect(calc.nakedGaps).toHaveLength(1);
    calc.update([],'close',step); expect(calc.nakedGaps).toEqual([]);
  });
  it('defaults gap visibility on for older saved settings and respects a saved opt-out',()=>{
    expect(dailyVwapSettings({}).nakedGaps).toBe(true);
    expect(dailyVwapSettings({nakedGaps:false}).nakedGaps).toBe(false);
    const old = nativeInstance(DAILY_VWAP_ID,{});
    expect(validateInstances([old])[0]!.settings.nakedGaps).toBe(true);
  });
  it('includes visible gap prices in autoscale only while the option is enabled',()=>{
    const overlay = new DailyVwapPrimitive({...DEFAULT_DAILY_VWAP,bands:false},()=>({from:day+86400,to:day+86400}));
    overlay.setData([bar(day,100,1),bar(day+43200,100,1),bar(day+86400,120,1)],43200);
    expect(overlay.autoscaleInfo()).toEqual({min:100,max:120});
    overlay.configure({...DEFAULT_DAILY_VWAP,bands:false,nakedGaps:false});
    expect(overlay.autoscaleInfo()).toEqual({min:120,max:120});
  });
  it('weights prices by volume and computes population deviation with a stable recurrence',()=>{
    const calc=new DailyVwapCalculation();
    const values=calc.update([bar(day,100,1),bar(day+60,110,3)],'hlc3',60);
    expect(values[1]!.value).toBe(107.5);
    expect(values[1]!.deviation).toBeCloseTo(Math.sqrt(18.75));
    expect(values[1]!.partial).toBe(false);
  });
  it('replaces forming volume, replays historical corrections and agrees with a fresh calculation',()=>{
    const calc=new DailyVwapCalculation(), bars=[bar(day,100,1),bar(day+60,110,3)];
    calc.update(bars,'close',60);
    bars[1]=bar(day+60,120,5);
    expect(calc.update(bars,'close',60)[1]!.value).toBeCloseTo(700/6);
    bars[0]=bar(day,90,2); bars.push(bar(day+120,115,1));
    const corrected=calc.update(bars,'close',60).map(p=>({...p}));
    expect(corrected).toEqual(new DailyVwapCalculation().update(bars,'close',60));
  });
  it('resets at midnight, breaks day/gap connections and flags incomplete sessions',()=>{
    const calc=new DailyVwapCalculation();
    const points=calc.update([bar(day+86340,100,2),bar(day+86400,200,3),bar(day+86520,210,1)],'close',60);
    expect(points[0]!.partial).toBe(true);
    expect(points[1]).toMatchObject({value:200,deviation:0,partial:false,breakBefore:true});
    expect(points[2]).toMatchObject({partial:true,breakBefore:true});
  });
  it('does not invent values without volume and carries the last observed value through zero-volume candles',()=>{
    const points=new DailyVwapCalculation().update([bar(day,100,0),bar(day+60,110,2),bar(day+120,120,0)],'close',60);
    expect(points.map(p=>p.value)).toEqual([null,110,110]);
    const invalid=new DailyVwapCalculation().update([bar(day,100,-1)],'close',60);
    expect(invalid[0]).toMatchObject({value:null,partial:true});
  });
  it('recalculates source changes, trimming and day-open backfill without retaining old contributions',()=>{
    const calc=new DailyVwapCalculation(), b={...bar(day+60,100,1),high:130,low:90};
    expect(calc.update([b],'hlc3',60)[0]!.value).toBeCloseTo(320/3);
    expect(calc.update([b],'hl2',60)[0]!.value).toBe(110);
    expect(calc.update([bar(day,80,1),b],'close',60)[1]).toMatchObject({value:90,partial:false});
    expect(calc.update([b],'close',60)[0]).toMatchObject({value:100,partial:true});
    expect(calc.update([],'close',60)).toEqual([]);
  });
  it('preserves small dispersion at large price levels and normalizes persisted settings',()=>{
    const points=new DailyVwapCalculation().update([bar(day,100000000,1),bar(day+60,100000001,1)],'close',60);
    expect(points[1]!.deviation).toBeCloseTo(.5);
    expect(dailyVwapSettings({multiplier:100,fillOpacity:-1,lineColor:'url(bad)'})).toMatchObject({multiplier:5,fillOpacity:0,lineColor:DEFAULT_DAILY_VWAP.lineColor});
    const instance=nativeInstance(DAILY_VWAP_ID,{...DEFAULT_DAILY_VWAP,multiplier:2});
    expect(validateInstances(JSON.parse(JSON.stringify([instance])))).toEqual([instance]);
  });
});
