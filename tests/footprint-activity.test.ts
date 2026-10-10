import { expect, it } from 'vitest';
import { DEFAULT_FOOTPRINT_OPTIONS } from 'openalgo-charts/profile';
import { FootprintActivity } from '../src/chart/footprint-activity';
import type { FootprintBar } from '../src/feed/protocol';

const bar=(revision:number,bidVol:number,askVol:number):FootprintBar=>({time:1800000000,revision,
  cells:[{price:83000,bidVol,askVol}],rowSize:25,delta:askVol-bidVol,minDelta:0,maxDelta:0,
  open:83000,high:83000,low:83000,close:83000,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',
  coverage:'partial',gapBefore:false,aggregateRecordCount:revision});
const paint=(activity:FootprintActivity)=>{
  const rectangles:{x:number,color:string}[]=[];
  const ctx:any={save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(){},strokeRect(x:number){rectangles.push({x,color:this.strokeStyle});}};
  activity.draw(ctx,{dpr:1,plotWidth:300,plotHeight:200,timeScale:{barSpacing:80,indexToX:()=>100},
    dataLayer:{timeToIndex:()=>0},priceScale:{priceToY:(price:number)=>100+(83000-price)*.64}} as any);
  return rectangles;
};
it('pulses only increasing classified sides, deduplicates revisions and expires',()=>{
  let now=0;
  const activity=new FootprintActivity(()=>DEFAULT_FOOTPRINT_OPTIONS,()=>false,()=>now);
  activity.observe(bar(1,.1,.2),bar(2,.15,.2));
  const bid=paint(activity);expect(bid).toHaveLength(1);expect(bid[0]!.color).toBe('#d98b8b');
  activity.observe(bar(2,.15,.2),bar(2,.15,.2));expect(activity.size).toBe(1);
  now=400;paint(activity);expect(activity.size).toBe(0);expect(activity.needsFrame).toBe(false);
  activity.observe(bar(2,.15,.2),bar(3,.15,.25));
  const ask=paint(activity);expect(ask).toHaveLength(1);expect(ask[0]!.color).toBe('#8bcc91');expect(ask[0]!.x).toBeGreaterThan(bid[0]!.x);
  now=800;paint(activity);activity.observe(bar(3,.15,.25),bar(4,.14,.24));expect(activity.size).toBe(0);
});
it('bounds burst feedback and clears reduced-motion and disposed surface state',()=>{
  let reduced=false;
  const activity=new FootprintActivity(()=>DEFAULT_FOOTPRINT_OPTIONS,()=>reduced,()=>0);
  const burst={...bar(1,0,0),cells:Array.from({length:100},(_,index)=>({price:83000+index*25,bidVol:.1,askVol:.2}))};
  activity.observe(undefined,burst);expect(activity.size).toBe(64);
  reduced=true;paint(activity);expect(activity.size).toBe(0);expect(activity.needsFrame).toBe(false);
  activity.observe(undefined,burst);expect(activity.size).toBe(0);
  reduced=false;activity.observe(undefined,bar(2,.1,0));activity.clear();expect(activity.size).toBe(0);
});
