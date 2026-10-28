import {InvalidationLevel,type Chart,type SeriesApi}from 'openalgo-charts';
import type {FeedClient}from '../feed/client';
import {duration,instrumentOf,type Candle,type Series}from '../feed/protocol';
import type {Scheduler,Drawable}from '../chart/scheduler';
import type {Notifications}from '../notifications';
import {anchorTimeAxisToPrimary}from '../chart/primary-time-axis';
import {compactSize}from '../ticker/presentation';
import {MarketPicker}from '../market-picker';
import {button}from '../ticker/ui';
import {LiquidationControls}from './controls';
import {LiquidationHistogram,LiquidationMarkers}from './chart';
import {liquidationSettings,type LiquidationSettings}from './settings';
import {liquidationCoverageText}from './coverage';
import {deliverLiquidationAlerts,liquidationText,liquidationTime,liquidationColour}from './presentation';
import type {LiquidationBatch}from './protocol';
export class LiquidationsView implements Drawable {
 visible=true;private dead=false;private settings=liquidationSettings(undefined);private pane:HTMLElement;private anchor:SeriesApi;private histogram:LiquidationHistogram;private markers=new LiquidationMarkers();private batch?:LiquidationBatch;
 private legend=document.createElement('div');private status=document.createElement('div');private tooltip=document.createElement('div');private controls:LiquidationControls;private picker:MarketPicker;private release?:()=>void;private listeners:(()=>void)[]=[];private timer?:ReturnType<typeof setTimeout>;private hostKey='';private legendKey='';private owner=`liquidations-pane-${crypto.randomUUID()}`;
 constructor(private chart:Chart,private feed:FeedClient,private scheduler:Scheduler,private series:Series,private change:(s:LiquidationSettings)=>void,private notifications?:Notifications){
  const index=chart.panes().length;this.anchor=chart.addSeries('line',{paneIndex:index,priceScaleId:'right',style:{visible:false}});this.pane=chart.panes()[index]!.element;this.pane.dataset.liquidations='true';this.anchor.priceScale().setOptions({marginTop:.34,marginBottom:.1,minMove:0,minPrecision:2});
  this.histogram=new LiquidationHistogram(()=>this.range());chart.addPrimitive(this.histogram,index);chart.addPrimitive(this.markers,{anchor:'primary-pane'});
  this.legend.className='liquidation-legend net-positioning-legend';this.legend.setAttribute('aria-label','Liquidation venues');this.legend.setAttribute('role','group');this.status.className='cvd-status liquidation-pane-status';this.status.setAttribute('role','status');this.tooltip.className='liquidation-tooltip net-positioning-tooltip';this.tooltip.hidden=true;this.tooltip.setAttribute('role','tooltip');this.pane.append(this.legend,this.status,this.tooltip);
  const parent=this.pane.closest<HTMLElement>('.candle-panel')??document.body;this.controls=new LiquidationControls(parent,s=>this.change(s),'chart');this.picker=new MarketPicker(parent);
  for(const type of ['pointerdown','mousedown','click','dblclick','wheel'])this.legend.addEventListener(type,e=>e.stopPropagation());
  this.listeners.push(chart.on('pan',()=>this.viewport()),chart.on('zoom',()=>this.viewport()),chart.on('resize',()=>this.viewport()),chart.on('paneResized',e=>{if(e.paneIndex===this.paneIndex()){const weight=chart.paneWeight(this.paneIndex());if(Math.abs(weight-this.settings.paneWeight)>.001)this.change({...this.settings,paneWeight:weight});}}),chart.subscribeCrosshairMove(e=>{
   this.tooltip.hidden=true;if(!e.point||!this.batch)return;const primary=chart.plotRect(chart.primaryPaneIndex());const marker=primary&&e.paneIndex===chart.primaryPaneIndex()?this.markers.hit(e.point.x-primary.left,e.point.y-primary.top):undefined;
   if(marker){this.tooltip.textContent=liquidationText(marker);this.tooltip.hidden=false;return;}
   if(e.paneIndex!==this.paneIndex()||e.time==null)return;const time=Math.floor(e.time*1000/duration[this.series.interval])*duration[this.series.interval],bar=this.batch.bars.find(b=>b.time===time);if(!bar)return;
   this.tooltip.textContent=`${liquidationTime(time)} UTC · ${this.settings.units} · `+this.settings.venues.map(v=>`${v.toUpperCase()} L ${compactSize(bar.longs[v])} / S ${compactSize(bar.shorts[v])}`).join(' · ')+' · '+this.quality();this.tooltip.hidden=false;
  }));anchorTimeAxisToPrimary(chart);
 }
 paneIndex(){return this.chart.panes().findIndex(p=>p.element===this.pane);}
 private range(){const visible=this.chart.timeScale.visibleRange();const from=this.chart.dataLayer.indexToTimeFloat(visible.from-1)*1000,to=this.chart.dataLayer.indexToTimeFloat(visible.to+1)*1000,now=Date.now();return Number.isFinite(from+to)&&from<to?{from,to}:{from:now-900000,to:now};}
 private request(){const range=this.range();return {settings:this.settings,from:Math.max(range.from,range.to-7*86400000),to:range.to,intervalMs:duration[this.series.interval],kind:'chart' as const};}
 configure(value:unknown,series:Series){this.series=series;this.settings=liquidationSettings(value);const index=this.paneIndex();if(Math.abs(this.chart.paneWeight(index)-this.settings.paneWeight)>.001)this.chart.setPaneWeight(index,this.settings.paneWeight);this.anchor.priceScale().setPriceFormatter(v=>`${compactSize(v)} ${this.settings.units}`);this.anchor.priceScale().setAutoScale(true);
  if(!this.release)this.release=this.feed.subscribeLiquidations(this.owner,this.request(),batch=>{if(this.dead)return;this.batch=batch;if(this.notifications)deliverLiquidationAlerts(batch,{...this.settings,tiers:[]},this.notifications,this.owner);this.scheduler.invalidate(this);});else this.feed.updateLiquidations(this.owner,this.request());this.scheduler.invalidate(this);
 }
 setHostCandles(candles:readonly Candle[]){const key=`${candles.length}:${candles[0]?.t}:${candles.at(-1)?.t}`;if(key===this.hostKey)return;this.hostKey=key;this.anchor.setData(candles.map(c=>({time:c.t/1000,open:0,high:0,low:0,close:0,volume:0})));this.viewport();}
 private viewport(){clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.dead)return;this.feed.updateLiquidations(this.owner,this.request());this.scheduler.invalidate(this);},150);this.scheduler.invalidate(this);}
 setVisible(value:boolean){this.visible=value;if(value)this.viewport();}
 openSettings(){this.controls.open(this.settings);}
 private quality(){if(!this.batch)return 'Loading recorded liquidation history';const r=this.range();return liquidationCoverageText(this.batch.coverage,this.settings.venues,r.from,r.to,this.batch.truncated);}
 draw(){if(this.dead||!this.visible)return;const s=this.settings,info=instrumentOf(this.series),compatible=info.base==='BTC'&&info.quote==='USDT';
  this.histogram.coverage=this.batch?.coverage;this.histogram.venues=s.venues;
  this.histogram.update(this.batch?.bars??[],duration[this.series.interval]);this.markers.update(this.batch?.events??[],s,compatible);
  this.legend.hidden=!s.legend;const key=JSON.stringify(s.venues);if(key!==this.legendKey){this.legendKey=key;this.legend.replaceChildren();const select=button('Sources',()=>this.picker.open(s.venues.map(v=>`${v}:perpetual` as const),{multiple:true,capability:'liquidations',apply:ids=>this.change({...s,venues:ids.filter(id=>id==='bybit:perpetual'||id==='binance:perpetual').map(id=>id.startsWith('bybit')?'bybit':'binance')})}));select.className='net-positioning-source';select.setAttribute('aria-label','Select liquidation sources');this.legend.append(select);
  for(const venue of s.venues){const label=document.createElement('span');label.className='liquidation-venue-label';label.textContent=venue==='bybit'?'Bybit · bankruptcy':'Binance · sampled';this.legend.append(label);}}
  this.status.textContent=`${this.batch?.state??'loading'} · ${this.quality()}${s.markers&&!compatible?' · Price markers unavailable: chart quote is not USDT; no FX mapping':''}`;this.status.title=this.status.textContent;
  const plot=this.chart.plotRect(this.paneIndex());if(plot){this.legend.style.right=`${Math.max(6,this.pane.clientWidth-plot.left-plot.width+6)}px`;this.legend.style.maxWidth=`${Math.max(0,plot.width-12)}px`;}
  this.chart.invalidate(mask=>{mask.invalidatePane(this.paneIndex(),{level:InvalidationLevel.Full,autoScale:true});if(s.markers)mask.invalidatePane(this.chart.primaryPaneIndex(),{level:InvalidationLevel.Full,autoScale:false});});
 }
 diagnostics(){return {settings:this.settings,paneIndex:this.paneIndex(),batch:this.batch,draws:this.histogram.draws,bars:this.histogram.bars.length,painted:this.histogram.painted,histogramDrawMs:this.histogram.lastDrawMs,markers:this.markers.geometry.length};}
 dispose(){this.dead=true;clearTimeout(this.timer);this.release?.();this.listeners.forEach(r=>r());this.controls.dispose();this.picker.dispose();this.scheduler.remove(this);this.chart.removePrimitive(this.histogram);this.chart.removePrimitive(this.markers);this.legend.remove();this.status.remove();this.tooltip.remove();const index=this.paneIndex();if(index>=0)this.chart.removePane(index);anchorTimeAxisToPrimary(this.chart);this.notifications?.release(this.owner);}
}
