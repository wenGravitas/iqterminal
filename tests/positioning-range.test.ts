import {expect,it} from 'vitest';
import {candleValueArea,PositioningRangePreview} from '../src/chart/positioning-range';
import type {FootprintBar} from '../src/feed/protocol';
const bar=(volumes=[10,20,50,10,10])=>({rowSize:10,cells:volumes.map((v,i)=>({price:100+i*10,bidVol:v/2,askVol:v/2})),coverage:'observed',gapBefore:false} as FootprintBar);
it('derives the contiguous 70% area from actual price-volume rows, using row edges',()=>{
 expect(candleValueArea(bar())).toEqual({low:110,high:130,partial:false});
 expect(candleValueArea(bar([100]))).toEqual({low:100,high:110,partial:false});
 expect(candleValueArea({...bar(),coverage:'partial'})).toMatchObject({partial:true});
 expect(candleValueArea({...bar(),gapBefore:true})).toMatchObject({partial:true});
});
it('does not invent value area from OHLC, empty, invalid or capacity-limited observations',()=>{
 for(const input of [undefined,bar([0]),{...bar(),rowSize:0},{...bar(),coverage:'capacity-limited'},{...bar(),cells:[{price:NaN,bidVol:1,askVol:2}]}])expect(candleValueArea(input as any)).toBeNull();
});
it('the hover preview has no autoscale contribution and releases its transient state',()=>{
 const p=new PositioningRangePreview();let updates=0;p.attached({requestUpdate:()=>updates++} as any);expect(p.autoscaleInfo()).toBeNull();
 p.set({timeMs:60000,endMs:120000,low:100,high:110,side:'shorts',venue:'hyperliquid',reference:'Binance chart candle',partial:false});
 expect(p.diagnostics().active).toBe(true);p.set(p.diagnostics().range);expect(updates).toBe(1);p.set(null);expect(p.diagnostics().active).toBe(false);
 p.detached();expect(p.diagnostics().range).toBeNull();
});
