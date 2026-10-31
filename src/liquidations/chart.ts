import type {IPrimitive,PrimitiveHost,PrimitiveRenderContext} from 'openalgo-charts';
import type {LiquidationBar} from './engine';
import type {LiquidationEvent,LiquidationCoverage,LiquidationVenue} from './model';
import type {LiquidationSettings} from './settings';
import {liquidationColour} from './colors';
import {liquidationElapsedRange,type LiquidationTimeRange} from './coverage';
type TimeRange=LiquidationTimeRange;
/** Missing intervals stop at the known evaluation horizon, never in the future. */
export function liquidationMissingCoverage(range:TimeRange,coverage:LiquidationCoverage|undefined,venues:readonly LiquidationVenue[],now=Date.now()):TimeRange[]{
 const visible=liquidationElapsedRange(range,now),missing:TimeRange[]=[];
 if(!visible)return missing;
 const add=(from:number,to:number)=>{const end=Math.min(to,visible.to);if(from<end)missing.push({from,to:end});};
 for(const venue of venues){const source=coverage?.sources.find(s=>s.venue===venue);if(!source){add(visible.from,visible.to);continue;}if(visible.from<source.observedFrom)add(visible.from,Math.min(visible.to,source.observedFrom));if(visible.to>source.verifiedThrough)add(Math.max(visible.from,source.verifiedThrough),visible.to);for(const gap of source.gaps)if(gap.from<visible.to&&gap.to>visible.from)add(Math.max(gap.from,visible.from),Math.min(gap.to,visible.to));}
 return missing;
}
export class LiquidationHistogram implements IPrimitive {
 private host?:PrimitiveHost;coverage?:LiquidationCoverage;venues:LiquidationVenue[]=[];bars:LiquidationBar[]=[];intervalMs=60000;draws=0;painted=0;lastDrawMs=0;
 constructor(private range:()=>{from:number;to:number}){}
 zOrder(){return 'normal' as const;}attached(host:PrimitiveHost){this.host=host;}detached(){this.host=undefined;}
 update(bars:LiquidationBar[],intervalMs:number){this.bars=bars;this.intervalMs=intervalMs;this.host?.requestUpdate();}
 autoscaleInfo(){const range=this.range();let min=0,max=0;for(const b of this.bars)if(b.time+this.intervalMs>=range.from&&b.time<=range.to){min=Math.min(min,-b.longs.bybit-b.longs.binance);max=Math.max(max,b.shorts.bybit+b.shorts.binance);}const extent=Math.max(Math.abs(min),Math.abs(max),1);return {min:-extent,max:extent};}
 draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){const started=performance.now();this.draws++;this.painted=0;const range=this.range(),scale=rc.priceScale;ctx.save();ctx.setTransform(rc.dpr,0,0,rc.dpr,0,0);ctx.beginPath();ctx.rect(0,0,rc.plotWidth,rc.plotHeight);ctx.clip();
  const missing=liquidationMissingCoverage(range,this.coverage,this.venues);
  const merged:typeof missing=[];for(const gap of missing.sort((a,b)=>a.from-b.from)){const last=merged.at(-1);if(last&&gap.from<=last.to)last.to=Math.max(last.to,gap.to);else merged.push({...gap});}
  ctx.fillStyle=rc.theme.axisText;ctx.globalAlpha=.06;for(const gap of merged){const x1=rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(gap.from/1000)),x2=rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(gap.to/1000));if(Number.isFinite(x1+x2))ctx.fillRect(x1,0,x2-x1,rc.plotHeight);}
  const zero=scale.priceToY(0);ctx.strokeStyle=rc.theme.axisText;ctx.globalAlpha=.3;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(0,zero);ctx.lineTo(rc.plotWidth,zero);ctx.stroke();ctx.setLineDash([]);
  // Combine subpixel candle columns rather than averaging away large events.
  const columns=new Map<number,{x:number;width:number;longs:LiquidationBar['longs'];shorts:LiquidationBar['shorts']}>();
  for(const b of this.bars){if(b.time+this.intervalMs<range.from||b.time>range.to)continue;const x=rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(b.time/1000)),next=rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat((b.time+this.intervalMs)/1000));if(!Number.isFinite(x+next)||x>rc.plotWidth+2||x<-Math.abs(next-x))continue;
   const key=Math.floor(x),old=columns.get(key);if(old){for(const v of ['bybit','binance']as const){old.longs[v]+=b.longs[v];old.shorts[v]+=b.shorts[v];}}else columns.set(key,{x,width:Math.max(1,Math.abs(next-x)*.72),longs:{...b.longs},shorts:{...b.shorts}});
  }
  for(const b of columns.values())for(const side of ['LONG','SHORT']as const){let cumulative=0;for(const venue of ['bybit','binance']as const){const value=b[side==='LONG'?'longs':'shorts'][venue];if(!value)continue;const sign=side==='LONG'?-1:1,y1=scale.priceToY(sign*cumulative),y2=scale.priceToY(sign*(cumulative+value));ctx.fillStyle=liquidationColour(side,rc.theme.background==='#f6f4ee');ctx.globalAlpha=venue==='bybit'?.95:.8;ctx.fillRect(b.x-b.width/2,Math.min(y1,y2),b.width,Math.max(1,Math.abs(y2-y1)));cumulative+=value;this.painted++;}}
  ctx.restore();this.lastDrawMs=performance.now()-started;
 }
}
export class LiquidationMarkers implements IPrimitive {
 private host?:PrimitiveHost;events:LiquidationEvent[]=[];settings?:LiquidationSettings;enabled=false;geometry:{event:LiquidationEvent;x:number;y:number;r:number}[]=[];draws=0;
 zOrder(){return 'normal' as const;}attached(host:PrimitiveHost){this.host=host;}detached(){this.host=undefined;this.geometry=[];}
 update(events:LiquidationEvent[],settings:LiquidationSettings,compatible:boolean){this.events=events;this.settings=settings;this.enabled=compatible&&settings.markers;this.host?.requestUpdate();}
 draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){this.draws++;this.geometry=[];if(!this.enabled||!this.settings)return;const visible=rc.timeScale.visibleRange(),scale=rc.readoutPriceScale??rc.priceScale;
  const candidates=this.events.filter(e=>e.quoteNotional!==null&&e.quoteNotional>=this.settings!.markerMinimum).map(event=>({event,index:rc.dataLayer.timeToIndexFloat(event.timeMs/1000)})).filter(e=>e.index>=visible.from-1&&e.index<=visible.to+1).sort((a,b)=>b.event.quoteNotional!-a.event.quoteNotional!).slice(0,this.settings.markerDensity);
  ctx.save();ctx.setTransform(rc.dpr,0,0,rc.dpr,0,0);ctx.beginPath();ctx.rect(0,0,rc.plotWidth,rc.plotHeight);ctx.clip();ctx.globalAlpha=.9;
  for(const {event,index}of candidates){const x=rc.timeScale.indexToX(index),y=scale.priceToY(event.reportedPrice),r=Math.min(9,2+Math.log10(1+event.quoteNotional!/1000)*1.6);if(!Number.isFinite(x+y)||x<0||x>rc.plotWidth||y<0||y>rc.plotHeight)continue;ctx.strokeStyle=liquidationColour(event.liquidatedSide,rc.theme.background==='#f6f4ee');ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();this.geometry.push({event,x,y,r});}ctx.restore();
 }
 hit(x:number,y:number){return this.geometry.find(p=>Math.hypot(p.x-x,p.y-y)<=p.r+4)?.event;}
}
