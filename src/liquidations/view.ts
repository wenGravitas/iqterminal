import {InvalidationLevel,type Chart,type CrosshairMoveEvent,type SeriesApi}from 'openalgo-charts';
import type {FeedClient}from '../feed/client';
import {duration,instrumentOf,type Candle,type Series}from '../feed/protocol';
import type {Scheduler,Drawable}from '../chart/scheduler';
import type {Notifications}from '../notifications';
import {anchorTimeAxisToPrimary}from '../chart/primary-time-axis';
import {compactSize}from '../ticker/presentation';
import {paneHeaderSlots,PANE_HEADER_ACTION_SPACE}from '../chart/pane-header';
import {venueBadge,venueIconPath}from '../chart/venue-label';
import {button}from '../ticker/ui';
import {LiquidationControls}from './controls';
import {LiquidationHistogram,LiquidationMarkers}from './chart';
import {liquidationSettings,type LiquidationSettings}from './settings';
import {liquidationCoverageText,liquidationElapsedRange}from './coverage';
import {deliverLiquidationAlerts,liquidationText}from './presentation';
import type {LiquidationBatch}from './protocol';
import {renderLiquidationTooltip}from './tooltip';
import {TooltipDwell}from '../tooltip-dwell';
export class LiquidationsView implements Drawable {
 visible=true;private dead=false;private settings=liquidationSettings(undefined);private pane:HTMLElement;private anchor:SeriesApi;private histogram:LiquidationHistogram;private markers=new LiquidationMarkers();private batch?:LiquidationBatch;
 private legend=document.createElement('div');private status=document.createElement('div');private tooltip=document.createElement('div');private tooltipHost:HTMLElement;private controls:LiquidationControls;private venueButtons=new Map<'bybit'|'binance',HTMLButtonElement>();private release?:()=>void;private listeners:(()=>void)[]=[];private timer?:ReturnType<typeof setTimeout>;private hostKey='';private owner=`liquidations-pane-${crypto.randomUUID()}`;private tooltipDwell=new TooltipDwell();private abort=new AbortController();private hoverPointerType?:string;private pointerDown=false;private blockedUntilMove=false;
 private paneControlHome?:HTMLElement;
 constructor(private chart:Chart,private feed:FeedClient,private scheduler:Scheduler,private series:Series,private change:(s:LiquidationSettings)=>void,private notifications?:Notifications){
  const index=chart.panes().length;this.anchor=chart.addSeries('line',{paneIndex:index,priceScaleId:'right',style:{visible:false}});this.pane=chart.panes()[index]!.element;this.pane.dataset.liquidations='true';this.anchor.priceScale().setOptions({marginTop:.34,marginBottom:.1,minMove:0,minPrecision:2});
  this.histogram=new LiquidationHistogram(()=>this.range());chart.addPrimitive(this.histogram,index);chart.addPrimitive(this.markers,{anchor:'primary-pane'});
  this.legend.className='liquidation-legend net-positioning-legend';this.legend.setAttribute('aria-label','Liquidation venues');this.legend.setAttribute('role','group');this.status.className='cvd-status liquidation-pane-status';this.status.setAttribute('role','status');this.tooltip.className='liquidation-tooltip net-positioning-tooltip';this.tooltip.hidden=true;this.tooltip.setAttribute('role','tooltip');this.pane.append(this.legend,this.status);this.tooltipHost=this.pane.closest<HTMLElement>('.chart-stage')??this.pane;this.tooltipHost.append(this.tooltip);
  const parent=this.pane.closest<HTMLElement>('.candle-panel')??document.body;this.controls=new LiquidationControls(parent,s=>this.change(s),'chart');
  for(const venue of ['bybit','binance']as const){
   const control=button('',()=>{this.tooltip.hidden=true;const venues=this.settings.venues.includes(venue)?this.settings.venues.filter(v=>v!==venue):[...this.settings.venues,venue];this.change({...this.settings,venues});});
   control.className='net-positioning-source';control.dataset.source=venue;control.style.setProperty('--source-color','var(--focus)');
   const icon=document.createElement('img');icon.src=venueIconPath(venue);icon.alt='';icon.width=12;icon.height=12;const label=document.createElement('span');label.textContent=venueBadge(venue);control.append(icon,label);
   control.title=venue==='bybit'?'Bybit BTCUSDT perpetual · bankruptcy-price reports':'Binance BTCUSDT USD-M perpetual · sampled cumulative snapshots';control.setAttribute('aria-label',`Show ${venue==='bybit'?'Bybit':'Binance'} liquidation reports`);
   this.venueButtons.set(venue,control);this.legend.append(control);
  }
  for(const type of ['pointerdown','mousedown','click','dblclick','wheel'])this.legend.addEventListener(type,e=>e.stopPropagation());
  this.tooltipHost.addEventListener('pointermove',event=>{this.hoverPointerType=event.pointerType;if(!this.pointerDown)this.blockedUntilMove=false;},{capture:true,signal:this.abort.signal});
  this.tooltipHost.addEventListener('pointerleave',()=>{this.hoverPointerType=undefined;this.cancelTooltip();},{signal:this.abort.signal});
  this.tooltipHost.addEventListener('pointerdown',()=>{this.pointerDown=true;this.blockedUntilMove=true;this.cancelTooltip();},{capture:true,signal:this.abort.signal});
  this.tooltipHost.addEventListener('pointerup',()=>{this.pointerDown=false;},{capture:true,signal:this.abort.signal});
  this.tooltipHost.addEventListener('wheel',()=>{this.blockedUntilMove=true;this.cancelTooltip();},{capture:true,passive:true,signal:this.abort.signal});
  this.tooltipHost.addEventListener('click',()=>this.cancelTooltip(),{capture:true,signal:this.abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancelTooltip();},{signal:this.abort.signal});
  this.listeners.push(chart.on('pan',()=>this.viewport()),chart.on('zoom',()=>this.viewport()),chart.on('resize',()=>this.viewport()),chart.on('paneResized',e=>{if(e.paneIndex===this.paneIndex()){const weight=chart.paneWeight(this.paneIndex());if(Math.abs(weight-this.settings.paneWeight)>.001)this.change({...this.settings,paneWeight:weight});}}),chart.subscribeCrosshairMove(e=>this.crosshair(e)));anchorTimeAxisToPrimary(chart);
 }
 private crosshair(e:CrosshairMoveEvent){
  if(!this.visible||!this.batch||!e.point||this.hoverPointerType==='touch'||this.pointerDown||this.blockedUntilMove||document.hidden){this.cancelTooltip();return;}
  const primary=this.chart.plotRect(this.chart.primaryPaneIndex()),marker=primary&&e.paneIndex===this.chart.primaryPaneIndex()?this.markers.hit(e.point.x-primary.left,e.point.y-primary.top):undefined;
  if(marker){const show=()=>{if(this.dead||!this.visible)return;this.tooltip.textContent=liquidationText(marker);this.tooltip.hidden=false;this.placeTooltip(e.point!.x,e.point!.y);};const ready=this.tooltipDwell.request(`liquidation-marker:${marker.id}`,show);this.tooltip.hidden=!ready;if(ready)show();return;}
  if(e.paneIndex!==this.paneIndex()||e.time==null){this.cancelTooltip();return;}
  const time=Math.floor(e.time*1000/duration[this.series.interval])*duration[this.series.interval],bar=this.batch.bars.find(b=>b.time===time);if(!bar){this.cancelTooltip();return;}
  const plot=this.chart.plotRect(this.paneIndex());if(!plot){this.cancelTooltip();return;}
  const side=e.point.y-plot.top>=this.anchor.priceScale().priceToY(0)?'LONG':'SHORT';
  const show=()=>{if(this.dead||!this.visible)return;renderLiquidationTooltip(this.tooltip,{bar,side,venues:this.settings.venues,units:this.settings.units,intervalMs:duration[this.series.interval],quality:this.quality(),light:this.chart.theme().background==='#f6f4ee'});this.tooltip.hidden=false;this.placeTooltip(e.point!.x,e.point!.y);};
  const ready=this.tooltipDwell.request(`liquidation-bar:${bar.time}:${side}`,show);this.tooltip.hidden=!ready;if(ready)show();
 }
 private cancelTooltip(){this.tooltipDwell.clear();this.tooltip.hidden=true;}
 paneIndex(){return this.chart.panes().findIndex(p=>p.element===this.pane);}
 paneControlElement(){return this.legend;}
 /** Reuse the venue selector inside the indicator header at every pane width. */
 setPaneControlHost(home:HTMLElement|null){
  if(home===this.paneControlHome&&this.legend.parentElement===home)return;
  if(home){this.paneControlHome=home;this.legend.dataset.paneHeader='true';home.append(this.legend);for(const property of ['left','top','right','max-width'])this.legend.style.removeProperty(property);}
  else if(this.paneControlHome){delete this.legend.dataset.paneHeader;this.pane.append(this.legend);this.paneControlHome=undefined;this.scheduler.invalidate(this);}
 }
 private placeTooltip(x:number,y:number){const width=this.tooltip.offsetWidth,height=this.tooltip.offsetHeight,above=y-height-8;this.tooltip.style.left=`${Math.max(4,Math.min(this.tooltipHost.clientWidth-width-4,x-width/2))}px`;this.tooltip.style.top=`${Math.max(4,Math.min(this.tooltipHost.clientHeight-height-4,above>=4?above:y+8))}px`;}
 private range(){const visible=this.chart.timeScale.visibleRange();const from=this.chart.dataLayer.indexToTimeFloat(visible.from-1)*1000,to=this.chart.dataLayer.indexToTimeFloat(visible.to+1)*1000,now=Date.now();return Number.isFinite(from+to)&&from<to?{from,to}:{from:now-900000,to:now};}
 private request(){const range=this.range();return {settings:this.settings,from:Math.max(range.from,range.to-7*86400000),to:range.to,intervalMs:duration[this.series.interval],kind:'chart' as const};}
 private conciseStatus(compatible:boolean){
  if(!this.settings.venues.length)return 'Choose an exchange.';
  const batch=this.batch;if(!batch)return 'Waiting for reports…';
  if(batch.state==='unsupported')return 'Liquidation data is unavailable for this market.';
  if(batch.state==='loading')return 'Waiting for reports…';
  const now=Date.now(),elapsed=liquidationElapsedRange(this.range(),now),from=elapsed?.from??now;
  const coverage=liquidationCoverageText(batch.coverage,this.settings.venues,from,elapsed?.to??from,batch.truncated),notes:string[]=[];
  if(batch.state==='stale'||batch.state==='disconnected'||coverage.includes('Source disconnected / stale'))notes.push('Some exchange data is delayed.');
  if(coverage.includes('Source history unavailable'))notes.push('Data unavailable.');
  if(coverage.includes('Incomplete history / connection gaps'))notes.push('Some reports may be missing.');
  if(batch.truncated)notes.push('Some earlier reports may be missing.');
  if(this.settings.markers&&!compatible)notes.push('Price markers are unavailable for this market.');
  if(!notes.length&&!batch.events.length&&!batch.bars.length)notes.push('No reports in this range.');
  return notes.join(' ');
 }
 configure(value:unknown,series:Series){if(this.series.venue!==series.venue||this.series.market!==series.market||this.series.interval!==series.interval)this.cancelTooltip();this.series=series;this.settings=liquidationSettings(value);const index=this.paneIndex();if(Math.abs(this.chart.paneWeight(index)-this.settings.paneWeight)>.001)this.chart.setPaneWeight(index,this.settings.paneWeight);this.anchor.priceScale().setPriceFormatter(v=>`${compactSize(v)} ${this.settings.units}`);this.anchor.priceScale().setAutoScale(true);
  if(!this.release)this.release=this.feed.subscribeLiquidations(this.owner,this.request(),batch=>{if(this.dead)return;this.batch=batch;if(this.notifications)deliverLiquidationAlerts(batch,{...this.settings,tiers:[]},this.notifications,this.owner);this.scheduler.invalidate(this);});else this.feed.updateLiquidations(this.owner,this.request());this.scheduler.invalidate(this);
 }
 setHostCandles(candles:readonly Candle[]){const key=`${candles.length}:${candles[0]?.t}:${candles.at(-1)?.t}`;if(key===this.hostKey)return;this.hostKey=key;this.anchor.setData(candles.map(c=>({time:c.t/1000,open:0,high:0,low:0,close:0,volume:0})));this.viewport();}
 private viewport(){clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.dead)return;this.feed.updateLiquidations(this.owner,this.request());this.scheduler.invalidate(this);},150);this.scheduler.invalidate(this);}
 setVisible(value:boolean){this.visible=value;if(!value)this.cancelTooltip();if(value)this.viewport();}
 openSettings(){this.controls.open(this.settings);}
 private quality(){if(!this.batch)return 'Loading recorded liquidation history';const now=Date.now(),elapsed=liquidationElapsedRange(this.range(),now),from=elapsed?.from??now;return liquidationCoverageText(this.batch.coverage,this.settings.venues,from,elapsed?.to??from,this.batch.truncated);}
 draw(){if(this.dead||!this.visible)return;const s=this.settings,info=instrumentOf(this.series),compatible=info.base==='BTC'&&info.quote==='USDT';
  this.histogram.coverage=this.batch?.coverage;this.histogram.venues=s.venues;
  this.histogram.update(this.batch?.bars??[],duration[this.series.interval]);this.markers.update(this.batch?.events??[],s,compatible);
  this.legend.hidden=!s.legend;for(const [venue,control]of this.venueButtons)control.setAttribute('aria-pressed',String(s.venues.includes(venue)));
  this.status.textContent=this.conciseStatus(compatible);this.status.hidden=!this.status.textContent;this.status.title=this.status.textContent;
  const plot=this.chart.plotRect(this.paneIndex());if(plot){for(const control of this.venueButtons.values())control.dataset.compact=String(plot.width<400);if(this.legend.dataset.paneHeader!=='true'){this.legend.style.right=`${Math.max(6,this.pane.clientWidth-plot.left-plot.width+PANE_HEADER_ACTION_SPACE)}px`;this.legend.style.maxWidth=`${paneHeaderSlots(plot.width,plot.width<400?50:140).optionsWidth}px`;}}
  this.chart.invalidate(mask=>{mask.invalidatePane(this.paneIndex(),{level:InvalidationLevel.Full,autoScale:true});if(s.markers)mask.invalidatePane(this.chart.primaryPaneIndex(),{level:InvalidationLevel.Full,autoScale:false});});
 }
 diagnostics(){return {settings:this.settings,paneIndex:this.paneIndex(),batch:this.batch,draws:this.histogram.draws,bars:this.histogram.bars.length,painted:this.histogram.painted,histogramDrawMs:this.histogram.lastDrawMs,markers:this.markers.geometry.length};}
 dispose(){this.tooltipDwell.dispose();this.dead=true;this.abort.abort();clearTimeout(this.timer);this.release?.();this.listeners.forEach(r=>r());this.controls.dispose();this.scheduler.remove(this);this.chart.removePrimitive(this.histogram);this.chart.removePrimitive(this.markers);this.legend.remove();this.status.remove();this.tooltip.remove();const index=this.paneIndex();if(index>=0)this.chart.removePane(index);anchorTimeAxisToPrimary(this.chart);this.notifications?.release(this.owner);}
}
