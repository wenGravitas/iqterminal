import {drawAxisPriceRange} from './drawing-labels';
import {drawVenueCaption,venueBadge,amountCaption,labelCurrency} from './venue-label';
import type { IPrimitive,PrimitiveHost,PrimitiveRenderContext } from 'openalgo-charts';
import type { FootprintBar } from '../feed/protocol';
import type { NetPositioningSide,NetPositioningVenue } from '../feed/net-positioning';
export interface PositioningRange {timeMs:number;endMs:number;low:number;high:number;side:NetPositioningSide;venue:NetPositioningVenue;reference:string;partial:boolean;method?:import('../feed/net-positioning').NetPositioningMethod;baseAmount?:number|null;quoteAmount?:number|null}
/** Contiguous 70% executed-volume area, growing out from the POC. Prices are row edges. */
export function candleValueArea(bar:FootprintBar|undefined):{low:number;high:number;partial:boolean}|null{
 if(!bar||!Number.isFinite(bar.rowSize)||bar.rowSize<=0||bar.coverage==='capacity-limited')return null;
 const cells=bar.cells.map(c=>({price:c.price,volume:c.bidVol+c.askVol})).sort((a,b)=>a.price-b.price);
 if(!cells.length||cells.some((c,i)=>!Number.isFinite(c.price+c.volume)||c.price<=0||c.volume<0||(i>0&&c.price===cells[i-1]!.price)))return null;
 const total=cells.reduce((n,c)=>n+c.volume,0);if(total<=0)return null;
 let lo=0;for(let i=1;i<cells.length;i++)if(cells[i]!.volume>cells[lo]!.volume)lo=i;
 let hi=lo,sum=cells[lo]!.volume;
 while(sum<total*.7&&(lo>0||hi<cells.length-1)){
  const below=lo>0?cells[lo-1]!.volume:-1,above=hi<cells.length-1?cells[hi+1]!.volume:-1;
  if(above>below)sum+=cells[++hi]!.volume;else sum+=cells[--lo]!.volume;
 }
 return {low:cells[lo]!.price,high:cells[hi]!.price+bar.rowSize,partial:bar.coverage!=='observed'||bar.gapBefore};
}
export function positioningRangeLabel(r:PositioningRange){return `${venueBadge(r.venue)} · Net ${r.side==='longs'?'Longs':'Shorts'} · ${r.partial?'partial ':''}candle VA 70% (proxy)`;}
/** Display-only preview; native drawings own committed zones. */
export class PositioningRangePreview implements IPrimitive {
 private host?:PrimitiveHost;private range:PositioningRange|null=null;
 zOrder(){return 'top' as const;}autoscaleInfo(){return null;}
 attached(host:PrimitiveHost){this.host=host;}detached(){this.host=undefined;this.range=null;}
 set(range:PositioningRange|null){if(JSON.stringify(this.range)===JSON.stringify(range))return;this.range=range;this.host?.requestUpdate();}
 diagnostics(){return {active:this.range!==null,range:this.range};}
 draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){
  const r=this.range;if(!r||!rc.dataLayer.length)return;
  const index=rc.dataLayer.timeToIndexFloat(r.timeMs/1000),x=rc.timeScale.indexToX(index),scale=rc.readoutPriceScale??rc.priceScale;
  const top=scale.priceToY(r.high),bottom=scale.priceToY(r.low);if(!Number.isFinite(x+top+bottom)||x>rc.plotWidth||bottom<0||top>rc.plotHeight)return;
  const d=rc.dpr,left=Math.max(0,x)*d,width=rc.plotWidth*d-left,color=r.side==='longs'?rc.theme.buy:rc.theme.sell;
  ctx.save();ctx.beginPath();ctx.rect(0,0,rc.plotWidth*d,rc.plotHeight*d);ctx.clip();
  ctx.fillStyle=color;ctx.globalAlpha=.12;ctx.fillRect(left,top*d,width,(bottom-top)*d);
  ctx.strokeStyle=color;ctx.lineWidth=d;ctx.globalAlpha=.85;ctx.setLineDash([4*d,3*d]);ctx.strokeRect(left,top*d,width,(bottom-top)*d);ctx.setLineDash([]);
  ctx.font=`${10*d}px ui-monospace,monospace`;ctx.fillStyle=color;ctx.globalAlpha=1;drawVenueCaption(ctx,r.venue,amountCaption(r,labelCurrency(rc.dataLayer,'btc')),rc.plotWidth*d-4*d,Math.max(12*d,top*d-4*d),d,Math.max(0,width-8*d));ctx.restore();
  drawAxisPriceRange(ctx,rc,r.low,r.high,color);
 }
}
