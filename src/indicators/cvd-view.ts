import {paneHeaderSlots,PANE_HEADER_ACTION_SPACE}from '../chart/pane-header';
import type {Chart,IPrimitive,PrimitiveHost,PrimitiveRenderContext,SeriesApi,PriceScaleId}from 'openalgo-charts';
import {InvalidationLevel}from 'openalgo-charts';
import {CURRENCY_EVENT,effectiveCurrency}from '../currency-display';
import {MarketPicker}from '../market-picker';
import {instrumentOf,type Candle,type Series}from '../feed/protocol';
import {cvdSettings,cvdDefaultColor,cvdAnchorAt,CVD_STEP,type CvdSettings,type CvdSeries,type CvdRequest}from '../feed/cvd';
import {CvdPlotModel,compactCvd,cvdLowerBound,type CvdLine}from '../chart/cvd-model';
import type {Scheduler,Drawable}from '../chart/scheduler';
import {CvdControls}from './cvd-controls';
import {anchorTimeAxisToPrimary}from '../chart/primary-time-axis';
import {getDisplayTimezone}from '../timezone';
import type {CvdDataController} from './cvd-data';
import {TooltipDwell} from '../tooltip-dwell';

class CvdLines implements IPrimitive {
  private host?:PrimitiveHost;draws=0;segments=0;
  constructor(readonly model:CvdPlotModel,private settings:()=>CvdSettings,private range:()=>{from:number;to:number},private foreground:()=>string){}
  zOrder(){return 'normal' as const;}attached(host:PrimitiveHost){this.host=host;}detached(){this.host=undefined;}
  update(){this.host?.requestUpdate();}
  autoscaleInfo(){
    let min=0,max=0;const settings=this.settings(),range=this.range();
    for(const line of this.model.lines.values())if(!settings.hidden.includes(line.id)){
      const start=cvdLowerBound(line.points,range.from,p=>p.time);
      for(let i=Math.max(0,start-1);i<line.points.length;i++){const p=line.points[i]!;if(p.time>range.to)break;if(p.value!=null){min=Math.min(min,p.value);max=Math.max(max,p.value);}}
    }
    return min===max?{min:-1,max:1}:{min,max};
  }
  draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){
    const settings=this.settings(),range=this.range();this.segments=0;this.draws++;
    ctx.save();ctx.setTransform(rc.dpr,0,0,rc.dpr,0,0);ctx.beginPath();ctx.rect(0,0,rc.plotWidth,rc.plotHeight);ctx.clip();
    const zero=rc.priceScale.priceToY(0);ctx.strokeStyle=rc.theme.axisText;ctx.globalAlpha=.25;ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(0,zero);ctx.lineTo(rc.plotWidth,zero);ctx.stroke();
    // Components first, prominent combined total last.
    const lines=[...this.model.lines.values()].sort((a,b)=>Number(a.id==='total')-Number(b.id==='total'));
    for(const line of lines){
      if(settings.hidden.includes(line.id))continue;
      const color=settings.colors[line.id]??(line.id==='total'?this.foreground():cvdDefaultColor(line.id));
      ctx.strokeStyle=color;ctx.lineWidth=line.id==='total'?settings.totalWidth:settings.componentWidth;ctx.globalAlpha=line.id==='total'?1:.85;
      const start=cvdLowerBound(line.points,range.from,p=>p.time);
      let previous:typeof line.points[number]|undefined;
      for(let index=Math.max(0,start-1);index<line.points.length;index++){
        const p=line.points[index]!;if(p.time>range.to+CVD_STEP)break;
        if(p.value==null){previous=undefined;continue;}
        if(previous&&previous.value!=null&&previous.period===p.period&&p.time-previous.time<=CVD_STEP){
          const x1=rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(previous.time/1000)),x2=rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(p.time/1000));
          const y1=rc.priceScale.priceToY(previous.value),y2=rc.priceScale.priceToY(p.value);
          if([x1,x2,y1,y2].every(Number.isFinite)){ctx.setLineDash(p.partial||previous.partial?[3,3]:[]);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();this.segments++;}
        }
        previous=p;
      }
    }
    ctx.restore();
  }
}
interface CvdHoverTarget { id:string; name:string; time:number; value:number; partial:boolean; x:number; y:number }
export class CvdView implements Drawable {
  visible=true;private dead=false;private combinedChrome=false;private settings=cvdSettings(undefined);private series:Series;private abort=new AbortController();
  private anchor:SeriesApi;private pane:HTMLElement;private controls:CvdControls;private picker:MarketPicker;
  readonly model:CvdPlotModel;private primitive:CvdLines;private toolbar=document.createElement('div');private legend=document.createElement('div');private status=document.createElement('div');
  private controlRow=document.createElement('div');private tooltip=document.createElement('div');private hoverDot=document.createElement('div');private tooltipHost:HTMLElement;private sourcesButton=document.createElement('button');private modeButtons:HTMLButtonElement[]=[];
  private paneControlHome?:HTMLElement;
  private listeners:(()=>void)[]=[];private releaseDataListener?:()=>void;private hoverTime?:number;private hoverPoint?:{x:number;y:number};private hoverPaneIndex?:number;private hoverPointerType?:string;private hoverPointerDown=false;private tooltipBlockedUntilMove=false;private paneHoverAbort?:AbortController;private lastLegendKey='';private tooltipDwell=new TooltipDwell();
  private lastTooltipLineKey='';
  private scaleTop=.16;private lastHostTimes='';private hostCandles:readonly Candle[]=[];private lineButtons=new Map<string,HTMLButtonElement>();private assignedScaleId:PriceScaleId;private ownsPaneWeight:boolean;private readonly cvdScaleIds=new Set<PriceScaleId>();
  constructor(private chart:Chart,private scheduler:Scheduler,series:Series,private change:(settings:CvdSettings)=>void,
    private data:CvdDataController,private scaleIdForUnit:(unit:'BTC'|'USDT')=>PriceScaleId,initialPaneIndex=-1,preservePaneLayout=false){
    this.series=series;this.model=data.model;this.ownsPaneWeight=(initialPaneIndex<0||initialPaneIndex>=chart.panes().length)&&!preservePaneLayout;
    const index=initialPaneIndex>=0&&initialPaneIndex<=chart.panes().length?initialPaneIndex:chart.panes().length;
    this.assignedScaleId=this.scaleIdForUnit('BTC');this.cvdScaleIds.add(this.assignedScaleId);this.cvdScaleIds.add(this.scaleIdForUnit('USDT'));
    this.anchor=this.createAnchor(index,[]);
    this.pane=chart.panes()[index]!.element;this.tooltipHost=this.pane.closest<HTMLElement>('.chart-stage')??this.pane;this.pane.dataset.cvd='true';if(this.ownsPaneWeight)chart.setPaneWeight(index,.28);
    this.anchor.priceScale().setOptions({marginTop:.16,marginBottom:.12,minMove:0,minPrecision:2});
    this.primitive=new CvdLines(this.model,()=>this.settings,()=>this.visibleRange(),()=>getComputedStyle(this.pane).getPropertyValue('--text').trim()||'#c7c7c7');chart.addPrimitive(this.primitive,index);chart.panes()[index]?.bindPrimitiveScale(this.primitive,this.assignedScaleId);
    this.controlRow.className='cvd-controls net-positioning-legend';
    this.toolbar.className='cvd-toolbar';this.toolbar.setAttribute('role','group');this.toolbar.setAttribute('aria-label','CVD presentation');
    for(const [value,label]of [['venues','Venues'],['aggregations','Aggregations']]as const){
      const button=document.createElement('button');button.type='button';button.className='net-positioning-source';button.dataset.mode=value;button.textContent=label;button.title='Presentation only; preserves included sources and anchor';
      button.addEventListener('click',event=>{event.stopPropagation();this.change({...this.settings,mode:value});},{signal:this.abort.signal});this.toolbar.append(button);this.modeButtons.push(button);
    }
    this.sourcesButton.type='button';this.sourcesButton.className='net-positioning-source';this.sourcesButton.textContent='Sources';this.sourcesButton.setAttribute('aria-label','Select included CVD sources and aggregations');this.sourcesButton.title='Change the underlying markets included in the combined total';
    this.toolbar.append(this.sourcesButton);this.legend.className='cvd-legend';this.legend.setAttribute('role','group');this.legend.setAttribute('aria-label','CVD line visibility');
    this.status.className='cvd-status';this.status.setAttribute('role','status');this.tooltip.className='cvd-tooltip net-positioning-tooltip';this.tooltip.hidden=true;this.tooltip.setAttribute('role','tooltip');
    this.hoverDot.className='cvd-hover-dot';this.hoverDot.hidden=true;this.hoverDot.setAttribute('aria-hidden','true');
    const separator=document.createElement('span');separator.className='cvd-control-separator';separator.setAttribute('role','separator');separator.setAttribute('aria-orientation','vertical');
    this.controlRow.append(this.toolbar,separator,this.legend);this.pane.append(this.controlRow,this.status);this.tooltipHost.append(this.hoverDot,this.tooltip);
    this.bindPaneHoverEvents(this.pane);
    for(const element of [this.controlRow])for(const type of ['pointerdown','pointerup','mousedown','mouseup','dblclick','wheel','keydown'])element.addEventListener(type,event=>event.stopPropagation(),{signal:this.abort.signal});
    this.controls=new CvdControls(settings=>this.change(settings),this.abort.signal);const controlHost=this.pane.closest<HTMLElement>('.candle-panel')??document.body;controlHost.append(this.controls.dialog);this.picker=new MarketPicker(controlHost);
    this.legend.addEventListener('click',event=>{
      event.stopPropagation();
      const id=(event.target as Element).closest<HTMLElement>('[data-line]')?.dataset.line;if(!id)return;
      this.change({...this.settings,hidden:this.settings.hidden.includes(id)?this.settings.hidden.filter(key=>key!==id):[...this.settings.hidden,id]});
    },{signal:this.abort.signal});
    this.sourcesButton.addEventListener('click',event=>{
      event.stopPropagation();
      let sources=[...this.settings.sources];
      this.picker.open(this.settings.sources,{multiple:true,capability:'executions',allowed:instrumentOf(this.series).base==='BTC'?['binance:spot','binance:perpetual','bybit:perpetual']:[],
        groups:this.settings.groups,apply:ids=>{sources=ids as typeof sources;},applyGroups:groups=>this.change(cvdSettings({...this.settings,sources,groups}))});
    },{signal:this.abort.signal});
    this.releaseDataListener=data.subscribe(()=>this.invalidate());
    this.listeners.push(chart.subscribeCrosshairMove(event=>{
      this.hoverTime=event.time==null?undefined:event.time*1000;this.hoverPoint=event.point??undefined;this.hoverPaneIndex=event.paneIndex??undefined;
      if(event.pointerType)this.hoverPointerType=event.pointerType;
      if(!this.visible||this.combinedChrome||document.hidden||!this.hoverPoint||this.hoverPaneIndex!==this.paneIndex()||this.hoverTime===undefined||event.pressed||this.hoverPointerType==='touch'||this.hoverPointerDown||this.tooltipBlockedUntilMove)this.cancelTooltip();
      else{
        const ready=this.tooltipDwell.request('cvd',()=>{
          if(this.dead||!this.visible||this.combinedChrome||document.hidden||!this.hoverPoint||this.hoverPaneIndex!==this.paneIndex()||this.hoverTime===undefined||this.hoverPointerType==='touch'||this.hoverPointerDown||this.tooltipBlockedUntilMove)return;
          this.tooltip.hidden=false;this.scheduler.invalidate(this);
        });
        this.tooltip.hidden=!ready;
      }
      this.scheduler.invalidate(this);
    }),chart.on('pan',()=>this.invalidate()),chart.on('zoom',()=>this.invalidate()),chart.on('resize',()=>this.invalidate()),chart.on('paneResized',event=>{
      if(!this.ownsPaneWeight||event.paneIndex!==this.paneIndex())return;const paneWeight=this.chart.paneWeight(this.paneIndex());
      if(Math.abs(paneWeight-this.settings.paneWeight)>.001)this.change({...this.settings,paneWeight});
    }),chart.on('paneCollapsed',event=>{if(event.paneIndex===this.paneIndex()&&event.collapsed)this.cancelTooltip();this.invalidate();}),chart.on('paneMaximized',event=>{if(event.paneIndex!==this.paneIndex())this.cancelTooltip();this.invalidate();}),chart.on('paneMoved',()=>{this.cancelTooltip();this.invalidate();}));
    window.addEventListener(CURRENCY_EVENT,()=>{this.lastLegendKey='';this.invalidate();},{signal:this.abort.signal});
    window.addEventListener('basis-theme-change',()=>{this.lastLegendKey='';this.invalidate();},{signal:this.abort.signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.hoverPoint=undefined;this.cancelTooltip();}},{signal:this.abort.signal});
    anchorTimeAxisToPrimary(chart);
  }
  paneIndex(){return this.chart.panes().findIndex(p=>p.element===this.pane);}
  paneElement(){return this.pane;}
  paneControlElement(){return this.controlRow;}
  /** Reuse the native controls inside the indicator header at every pane width. */
  setPaneControlHost(home:HTMLElement|null){
    if(home===this.paneControlHome&&this.controlRow.parentElement===home)return;
    if(home){
      this.paneControlHome=home;this.controlRow.dataset.paneHeader='true';home.append(this.controlRow);
      for(const property of ['left','top','right','max-width'])this.controlRow.style.removeProperty(property);
    }else if(this.paneControlHome){
      delete this.controlRow.dataset.paneHeader;this.pane.append(this.controlRow);this.paneControlHome=undefined;this.invalidate();
    }
  }
  /** Rehome this view's private anchor and primitive while preserving its model and controls. */
  moveToPaneIndex(paneIndex:number){
    if(this.dead)return false;
    const oldIndex=this.paneIndex(),panes=this.chart.panes();
    if(oldIndex<0||paneIndex<0||paneIndex>panes.length)return false;
    if(oldIndex===paneIndex)return true;
    this.cancelTooltip();
    const targetElement=panes[paneIndex]?.element;
    const previousPane=this.pane;
    this.chart.removePrimitive(this.primitive);
    this.anchor.remove();
    previousPane.removeAttribute('data-cvd');
    const existingTargetIndex=targetElement?this.chart.panes().findIndex(pane=>pane.element===targetElement):-1;
    const targetIndex=existingTargetIndex>=0?existingTargetIndex:this.chart.panes().length;
    this.anchor=this.createAnchor(targetIndex,this.hostCandles);
    const actualIndex=existingTargetIndex>=0?this.chart.panes().findIndex(pane=>pane.element===targetElement):this.chart.panes().length-1;
    this.pane=this.chart.panes()[actualIndex]!.element;
    this.bindPaneHoverEvents(this.pane);
    this.ownsPaneWeight=!targetElement;
    if(this.ownsPaneWeight)this.chart.setPaneWeight(actualIndex,this.settings.paneWeight);
    this.pane.dataset.cvd='true';
    this.chart.addPrimitive(this.primitive,actualIndex);
    this.chart.panes()[actualIndex]?.bindPrimitiveScale(this.primitive,this.assignedScaleId);
    this.pane.append(this.controlRow,this.status);
    this.syncPriceAxisPlacements();anchorTimeAxisToPrimary(this.chart);
    this.invalidate();
    return true;
  }
  private createAnchor(paneIndex:number,candles:readonly Candle[]){
    const anchor=this.chart.addSeries('line',{paneIndex,priceScaleId:this.assignedScaleId,style:{visible:false}});
    anchor.setData(candles.map(c=>({time:c.t/1000,open:0,high:0,low:0,close:0,volume:0})));
    anchor.priceScale().setOptions({marginTop:this.scaleTop,marginBottom:.12,minMove:0,minPrecision:2});
    return anchor;
  }
  private visibleRange(){const range=this.chart.timeScale.visibleRange();return{from:this.chart.dataLayer.indexToTimeFloat(range.from-1)*1000,to:this.chart.dataLayer.indexToTimeFloat(range.to+1)*1000};}
  configure(value:unknown,series:Series){
    const previous=this.settings,previousSeries=this.series;this.settings=cvdSettings(value);this.series=series;
    if(JSON.stringify(previous)!==JSON.stringify(this.settings)||previousSeries.venue!==series.venue||previousSeries.market!==series.market||previousSeries.interval!==series.interval)this.cancelTooltip();
    const unit=effectiveCurrency(this.settings.units);
    const assigned=this.scaleIdForUnit(this.settings.units.toUpperCase() as 'BTC'|'USDT');
    const index=this.paneIndex();
    if(this.assignedScaleId!==assigned){this.chart.setSeriesPriceScale(this.anchor,assigned);if(index>=0)this.chart.panes()[index]?.bindPrimitiveScale(this.primitive,assigned);this.assignedScaleId=assigned;this.cvdScaleIds.add(assigned);}
    this.syncPriceAxisPlacements();
    this.anchor.priceScale().setPriceFormatter(v=>`${compactCvd(v)} ${unit.toUpperCase()}`);
    this.anchor.priceScale().setAutoScale(true);
    for(const button of this.modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===this.settings.mode));
    if(this.ownsPaneWeight&&index>=0&&Math.abs(this.chart.paneWeight(index)-this.settings.paneWeight)>.001)this.chart.setPaneWeight(index,this.settings.paneWeight);
    if(previous.mode!==this.settings.mode)this.cancelTooltip();
    this.model.derive(this.settings,this.settings.units);this.lastLegendKey='';this.invalidate();
  }
  setHostCandles(candles:readonly Candle[]){
    const key=`${candles.length}:${candles[0]?.t}:${candles.at(-1)?.t}`;
    if(key===this.lastHostTimes)return;this.lastHostTimes=key;
    this.hostCandles=candles;
    // Reuse host timestamps only. Minute execution samples never expand the host chart timeline.
    this.anchor.setData(candles.map(c=>({time:c.t/1000,open:0,high:0,low:0,close:0,volume:0})));
    this.invalidate();
  }
  setVisible(value:boolean){this.visible=value;if(!value)this.cancelTooltip();if(value)this.invalidate();}
  /** Let the managed Order Flow pane own shared chrome while leaving this view's settings available. */
  setCombinedChrome(value:boolean){
    this.combinedChrome=value;this.syncPriceAxisPlacements();this.controlRow.hidden=value;this.status.hidden=value;this.cancelTooltip();
    if(!value)this.invalidate();
  }
  /** Standalone CVD uses the right side; only the managed CVD/Open Interest pane owns a left CVD axis. */
  private syncPriceAxisPlacements(){
    const currentPane=this.paneIndex();
    for(let paneIndex=0;paneIndex<this.chart.panes().length;paneIndex++)for(const scaleId of this.cvdScaleIds){
      const state=this.chart.priceAxisState(paneIndex,scaleId),placement=this.chart.priceAxisPlacement(paneIndex,scaleId);
      if(!state&&!placement)continue;
      // Keep inactive CVD scales on their intended side: a hidden linked SMA
      // may reactivate one later, after the CVD view itself has been removed.
      const side=this.combinedChrome&&paneIndex===currentPane?'left':'right';
      if(placement?.side!==side)this.chart.setPriceAxisPlacement(paneIndex,scaleId,side);
    }
  }
  private invalidate(){if(!this.dead){this.primitive.update();this.scheduler.invalidate(this);}}
  private cancelTooltip(){this.tooltipDwell.clear();this.tooltip.hidden=true;this.hoverDot.hidden=true;this.lastTooltipLineKey='';}
  private bindPaneHoverEvents(pane:HTMLElement){
    this.paneHoverAbort?.abort();const hoverAbort=this.paneHoverAbort=new AbortController(),signal=hoverAbort.signal;
    pane.addEventListener('pointermove',event=>{this.hoverPointerType=event.pointerType;if(!this.hoverPointerDown)this.tooltipBlockedUntilMove=false;},{signal});
    pane.addEventListener('pointerleave',()=>{this.hoverPointerType=undefined;this.hoverPoint=undefined;this.hoverTime=undefined;this.cancelTooltip();},{signal});
    pane.addEventListener('pointerdown',()=>{this.hoverPointerDown=true;this.tooltipBlockedUntilMove=true;this.cancelTooltip();},{capture:true,signal});
    pane.addEventListener('pointerup',()=>{this.hoverPointerDown=false;},{capture:true,signal});
    // A chart drag can release on a captured canvas or outside the pane. Clear
    // the gesture latch at the window boundary, then wait for a fresh move
    // before starting the normal 500 ms hover dwell again.
    window.addEventListener('pointerup',()=>{this.hoverPointerDown=false;},{capture:true,signal});
    window.addEventListener('pointercancel',()=>{this.hoverPointerDown=false;this.tooltipBlockedUntilMove=true;this.cancelTooltip();},{capture:true,signal});
    pane.addEventListener('wheel',()=>{this.tooltipBlockedUntilMove=true;this.cancelTooltip();},{capture:true,passive:true,signal});
    pane.addEventListener('click',()=>this.cancelTooltip(),{capture:true,signal});
  }
  openSettings(){this.cancelTooltip();this.controls.open(this.settings,[{id:'total',name:'Total',color:this.settings.colors.total??getComputedStyle(this.pane).getPropertyValue('--text').trim()},...this.settings.sources.map(id=>({id,name:id,color:this.settings.colors[id]??cvdDefaultColor(id)})),...this.settings.groups.map(g=>({id:g.id,name:g.name,color:this.settings.colors[g.id]??cvdDefaultColor(g.id)}))]);}
  private coverage(){
    if(!this.settings.sources.length)return 'No sources selected';
    const sources=this.settings.sources.map(id=>this.model.sources.get(id));
    if(sources.every(source=>!source?.points.at(-1)?.available))return sources.some(source=>source?.status==='unavailable')?'Historical data unavailable':'Awaiting data';
    if(sources.some(source=>source?.status==='stale'))return 'Source stale · total incomplete';
    if(sources.some(source=>source?.status==='unavailable'||!source))return 'Awaiting source · total incomplete';
    return sources.some(source=>source?.points.at(-1)?.partial)?'Partial history':'Complete through observed watermark';
  }
  private coverageDetail(){
    const quality=this.coverage();
    if(!/Partial|incomplete|stale/.test(quality))return quality;
    const starts=this.settings.sources.map(id=>this.model.sources.get(id)?.coverage.from).filter((v):v is number=>v!==undefined&&Number.isFinite(v));
    return starts.length?`${quality} · available since ${new Date(Math.max(...starts)).toISOString().slice(0,16).replace('T',' ')} UTC`:quality;
  }
  private conciseCoverageStatus(){
    if(!this.settings.sources.length)return 'Choose at least one exchange.';
    if(this.settings.mode==='aggregations'&&!this.settings.groups.length)return 'Choose an exchange group in Sources.';
    const sources=this.settings.sources.map(id=>this.model.sources.get(id));
    if(sources.every(source=>!source?.points.at(-1)?.available))return sources.some(source=>source?.status==='unavailable')?'Data unavailable.':'Waiting for data…';
    if(sources.some(source=>source?.status==='stale'))return 'Some exchange data is delayed.';
    if(sources.some(source=>source?.status==='unavailable'||!source)||sources.some(source=>source?.points.at(-1)?.partial))return 'Some data is missing.';
    return '';
  }
  private lineSampleAtPointer(line:CvdLine,time:number,x:number){
    const points=line.points,insertion=cvdLowerBound(points,time,point=>point.time),period=cvdAnchorAt(time-1,this.settings),scale=this.anchor.priceScale();
    for(const start of [insertion-1,insertion]){
      const first=points[start],last=points[start+1];
      if(!first||!last||first.value==null||last.value==null||!Number.isFinite(first.value)||!Number.isFinite(last.value)||first.period!==period||last.period!==period)continue;
      const span=last.time-first.time;if(span<=0||span>CVD_STEP||time<first.time||time>last.time)continue;
      const firstX=this.chart.timeScale.indexToX(this.chart.dataLayer.timeToIndexFloat(first.time/1000));
      const lastX=this.chart.timeScale.indexToX(this.chart.dataLayer.timeToIndexFloat(last.time/1000));
      if(!Number.isFinite(firstX+lastX)||lastX<=firstX||x<firstX-1||x>lastX+1)continue;
      const fraction=Math.max(0,Math.min(1,(x-firstX)/(lastX-firstX)));
      return {value:first.value+(last.value-first.value)*fraction,partial:first.partial||last.partial};
    }
    return undefined;
  }
  private lineColor(line:CvdLine){return this.settings.colors[line.id]??(line.id==='total'?getComputedStyle(this.pane).getPropertyValue('--text').trim()||'#c7c7c7':cvdDefaultColor(line.id));}
  private renderHoverTooltip(target:CvdHoverTarget,values:readonly {line:CvdLine;sample?:{value:number;partial:boolean}}[],unit:string){
    const structureKey=JSON.stringify(values.map(item=>item.line.id));
    if(structureKey!==this.lastTooltipLineKey){
      const stamp=document.createElement('div');stamp.className='positioning-tooltip-header';stamp.append(document.createElement('span'),document.createElement('span'));
      stamp.lastElementChild!.className='positioning-tooltip-muted';
      const heading=document.createElement('div');heading.className='positioning-tooltip-heading';heading.append(document.createElement('strong'),document.createElement('span'));
      heading.lastElementChild!.className='positioning-tooltip-muted';
      const rows=document.createElement('div');rows.className='positioning-tooltip-sources';
      for(const {line} of values){
        const row=document.createElement('div');row.className='market-tooltip-metric';row.dataset.lineId=line.id;
        row.append(document.createElement('span'),document.createElement('span'));rows.append(row);
      }
      const quality=document.createElement('small');quality.className='positioning-tooltip-muted';
      this.tooltip.replaceChildren(stamp,heading,rows,quality);this.lastTooltipLineKey=structureKey;
    }
    const stamp=this.tooltip.querySelector<HTMLElement>('.positioning-tooltip-header')!;
    stamp.firstElementChild!.textContent=new Date(target.time).toLocaleString('en-GB',{timeZone:getDisplayTimezone()});
    stamp.lastElementChild!.textContent=`${this.series.interval} · ${unit.toUpperCase()}`;
    const heading=this.tooltip.querySelector<HTMLElement>('.positioning-tooltip-heading')!;
    heading.firstElementChild!.textContent='Multi-Venue CVD';
    heading.lastElementChild!.textContent=target.name;
    const rows=[...this.tooltip.querySelectorAll<HTMLElement>('.market-tooltip-metric[data-line-id]')];
    values.forEach(({line,sample},index)=>{
      const row=rows[index]!;row.dataset.hovered=String(line.id===target.id);row.dataset.partial=String(sample?.partial??false);
      row.firstElementChild!.textContent=`${line.name}${line.filtered?' [filtered]':''}`;
      const amount=row.lastElementChild as HTMLElement;amount.className='positioning-tooltip-value';
      amount.textContent=`${sample?compactCvd(sample.value):'—'} ${unit.toUpperCase()}`;
    });
    const quality=this.tooltip.querySelector<HTMLElement>('.positioning-tooltip-sources + small')!;
    const coverage=this.coverageDetail();
    quality.textContent=`${coverage==='Complete through observed watermark'?'Available history complete':coverage}${target.partial?' · partial sample':''}`;
    this.tooltip.dataset.hoverLine=target.id;this.tooltip.dataset.hoverTime=String(target.time);
  }
  private updateHoverOverlay(plot:NonNullable<ReturnType<Chart['plotRect']>>,unit:string){
    const pointer=this.hoverPoint;
    if(!this.tooltipDwell.isActive('cvd')||!pointer||this.dead||!this.visible||this.combinedChrome||document.hidden||this.hoverPointerType==='touch'||this.hoverPointerDown||this.tooltipBlockedUntilMove
      ||this.hoverPaneIndex!==this.paneIndex()||pointer.x<plot.left||pointer.x>plot.left+plot.width||pointer.y<plot.top||pointer.y>plot.top+plot.height){
      this.tooltip.hidden=true;this.hoverDot.hidden=true;return;
    }
    const localX=pointer.x-plot.left;
    const logicalIndex=this.chart.timeScale.xToIndex(localX);
    const time=this.chart.dataLayer.indexToTimeFloat(logicalIndex)*1000;
    if(!Number.isFinite(time)){this.tooltip.hidden=true;this.hoverDot.hidden=true;return;}
    const lines=[...this.model.lines.values()].filter(line=>!this.settings.hidden.includes(line.id))
      .sort((a,b)=>Number(a.id==='total')-Number(b.id==='total'));
    let target:CvdHoverTarget|undefined,bestDistance=Infinity;
    for(const line of lines){
      const sample=this.lineSampleAtPointer(line,time,localX);if(!sample)continue;
      const y=this.anchor.priceScale().priceToY(sample.value);if(!Number.isFinite(y)||y<0||y>plot.height)continue;
      const screenY=plot.top+y,distance=Math.abs(screenY-pointer.y);
      if(distance<=bestDistance){bestDistance=distance;target={id:line.id,name:line.name,time,value:sample.value,partial:sample.partial,x:pointer.x,y:screenY};}
    }
    if(!target){this.tooltip.hidden=true;this.hoverDot.hidden=true;return;}
    const values=lines.map(line=>({line,sample:this.lineSampleAtPointer(line,time,localX)}));
    this.hoverDot.dataset.lineId=target.id;this.hoverDot.dataset.hoverTime=String(target.time);
    this.hoverDot.style.setProperty('--cvd-hover-x',`${target.x}px`);this.hoverDot.style.setProperty('--cvd-hover-y',`${target.y}px`);
    this.hoverDot.style.setProperty('--cvd-hover-color',this.lineColor(lines.find(line=>line.id===target.id)!));
    this.renderHoverTooltip(target,values,unit);this.tooltip.hidden=false;this.hoverDot.hidden=false;
    const width=this.tooltip.offsetWidth,height=this.tooltip.offsetHeight,hostWidth=this.tooltipHost.clientWidth,hostHeight=this.tooltipHost.clientHeight,gap=12;
    let left=target.x+gap;if(left+width>hostWidth-4)left=target.x-gap-width;
    let top=target.y+gap;if(top+height>hostHeight-4)top=target.y-gap-height;
    left=Math.max(4,Math.min(hostWidth-width-4,left));top=Math.max(4,Math.min(hostHeight-height-4,top));
    this.tooltip.style.setProperty('--cvd-tooltip-x',`${left}px`);this.tooltip.style.setProperty('--cvd-tooltip-y',`${top}px`);
  }
  draw(){
    if(this.dead||!this.visible)return;
    const unit=effectiveCurrency(this.settings.units);this.model.derive(this.settings,unit);
    const range=this.visibleRange();this.anchor.priceScale().setPriceFormatter(v=>`${compactCvd(v)} ${unit.toUpperCase()}`);
    const latest=Math.max(0,...[...this.model.lines.values()].map(line=>line.points.at(-1)?.time??0)),time=this.hoverTime??latest;
    const keys=JSON.stringify([this.settings.mode,[...this.model.lines.keys()],this.settings.hidden,unit]);
    if(keys!==this.lastLegendKey){this.legend.replaceChildren();this.lineButtons.clear();
      for(const line of this.model.lines.values()){
        const button=document.createElement('button');button.type='button';button.className='net-positioning-source';button.dataset.line=line.id;
        if(line.id.startsWith('binance:')||line.id.startsWith('bybit:')){const image=document.createElement('img');image.src=line.id.startsWith('bybit:')?'/venues/bybit.svg':'/venues/binance.ico';image.alt='';image.width=12;image.height=12;button.append(image);}
        button.append(document.createElement('span'));
        this.legend.append(button);this.lineButtons.set(line.id,button);
      }this.lastLegendKey=keys;
    }
    for(const line of this.model.lines.values()){
      const button=this.lineButtons.get(line.id)!;const point=this.model.value(line.id,time);
      const value=point?.period===cvdAnchorAt(time-1,this.settings)?point.value:null;
      button.querySelector('span')!.textContent=`${line.name}${line.filtered?' [filtered]':''} ${compactCvd(value)}${line.id==='total'?' '+unit.toUpperCase():''}`;
      button.style.setProperty('--source-color',this.settings.colors[line.id]??(line.id==='total'?'var(--text)':cvdDefaultColor(line.id)));
      button.setAttribute('aria-pressed',String(!this.settings.hidden.includes(line.id)));
      button.setAttribute('aria-label',`${this.settings.hidden.includes(line.id)?'Show':'Hide'} line: ${line.name}`);
      button.title=`${line.name}${line.filtered?' · filtered to included markets':''} · ${compactCvd(value)} ${unit.toUpperCase()} · Line visibility only; contribution remains included`;
    }
    const plot=this.chart.plotRect(this.paneIndex());
    if(plot&&this.controlRow.dataset.paneHeader!=='true')for(const controls of [this.controlRow]){
      controls.style.right=`${Math.max(6,this.pane.clientWidth-plot.left-plot.width+PANE_HEADER_ACTION_SPACE)}px`;
      controls.style.maxWidth=`${paneHeaderSlots(plot.width,620).optionsWidth}px`;
    }
    if(plot){const top=Math.min(.6,Math.max(.16,Math.max(38,this.controlRow.offsetTop+this.controlRow.offsetHeight+8)/plot.height));if(Math.abs(top-this.scaleTop)>.001){this.scaleTop=top;this.anchor.priceScale().setOptions({marginTop:top});}}
    const coverageStatus=this.conciseCoverageStatus();
    this.status.textContent=coverageStatus;this.status.hidden=!coverageStatus;
    this.status.dataset.coverage=this.coverage();this.status.title=coverageStatus;this.status.setAttribute('aria-label',coverageStatus||'CVD data is current');
    if(plot)this.updateHoverOverlay(plot,unit);else this.cancelTooltip();
    this.chart.invalidate(mask=>mask.invalidatePane(this.paneIndex(),{level:InvalidationLevel.Full,autoScale:true}));
  }
  diagnostics(){return {paneIndex:this.paneIndex(),settings:this.settings,coverage:this.coverage(),sources:[...this.model.sources.values()].map(s=>({source:s.source,points:s.points.length,status:s.status,coverage:s.coverage,message:s.message,asOf:s.asOf,latest:s.points.at(-1)})),lines:[...this.model.lines.values()].map(l=>({id:l.id,filtered:l.filtered,latest:l.points.at(-1)})),draws:this.primitive.draws,segments:this.primitive.segments};}
  dispose(){if(this.dead)return;this.tooltipDwell.dispose();this.paneHoverAbort?.abort();this.dead=true;this.releaseDataListener?.();this.abort.abort();this.listeners.forEach(release=>release());this.controls.dispose();this.picker.dispose();this.scheduler.remove(this);this.chart.removePrimitive(this.primitive);this.controlRow.remove();this.status.remove();this.hoverDot.remove();this.tooltip.remove();this.anchor.remove();this.syncPriceAxisPlacements();this.pane.removeAttribute('data-cvd');anchorTimeAxisToPrimary(this.chart);}
}
