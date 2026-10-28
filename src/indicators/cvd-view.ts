import {paneHeaderSlots,PANE_HEADER_ACTION_SPACE}from '../chart/pane-header';
import type {Chart,IPrimitive,PrimitiveHost,PrimitiveRenderContext,SeriesApi}from 'openalgo-charts';
import {InvalidationLevel}from 'openalgo-charts';
import {CURRENCY_EVENT,effectiveCurrency}from '../currency-display';
import {MarketPicker}from '../market-picker';
import {instrumentOf,type Candle,type Series}from '../feed/protocol';
import {cvdSettings,cvdDefaultColor,cvdAnchorAt,CVD_STEP,type CvdSettings,type CvdSeries,type CvdRequest}from '../feed/cvd';
import {CvdPlotModel,compactCvd,cvdLowerBound}from '../chart/cvd-model';
import type {FeedClient}from '../feed/client';
import type {Scheduler,Drawable}from '../chart/scheduler';
import {CvdControls}from './cvd-controls';
import {anchorTimeAxisToPrimary}from '../chart/primary-time-axis';
import {getDisplayTimezone}from '../timezone';

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
export class CvdView implements Drawable {
  visible=true;private dead=false;private settings=cvdSettings(undefined);private series:Series;private abort=new AbortController();
  private anchor:SeriesApi;private pane:HTMLElement;private controls:CvdControls;private picker:MarketPicker;
  readonly model=new CvdPlotModel();private primitive:CvdLines;private toolbar=document.createElement('div');private legend=document.createElement('div');private status=document.createElement('div');
  private controlRow=document.createElement('div');private tooltip=document.createElement('div');private sourcesButton=document.createElement('button');private modeButtons:HTMLButtonElement[]=[];
  private release?:()=>void;private requestKey='';private listeners:(()=>void)[]=[];private hoverTime?:number;private lastLegendKey='';private pending:CvdSeries[]=[];
  private scaleTop=.16;private lastHostTimes='';private lineButtons=new Map<string,HTMLButtonElement>();
  constructor(private chart:Chart,private feed:FeedClient,private scheduler:Scheduler,series:Series,private change:(settings:CvdSettings)=>void){
    this.series=series;const index=chart.panes().length;
    this.anchor=chart.addSeries('line',{paneIndex:index,priceScaleId:'right',style:{visible:false}});this.anchor.setData([]);
    this.pane=chart.panes()[index]!.element;this.pane.dataset.cvd='true';chart.setPaneWeight(index,.28);
    this.anchor.priceScale().setOptions({marginTop:.16,marginBottom:.12,minMove:0,minPrecision:2});
    this.primitive=new CvdLines(this.model,()=>this.settings,()=>this.visibleRange(),()=>getComputedStyle(this.pane).getPropertyValue('--text').trim()||'#c7c7c7');chart.addPrimitive(this.primitive,index);
    this.controlRow.className='cvd-controls net-positioning-legend';
    this.toolbar.className='cvd-toolbar';this.toolbar.setAttribute('role','group');this.toolbar.setAttribute('aria-label','CVD presentation');
    for(const [value,label]of [['venues','Venues'],['aggregations','Aggregations']]as const){
      const button=document.createElement('button');button.type='button';button.className='net-positioning-source';button.dataset.mode=value;button.textContent=label;button.title='Presentation only; preserves included sources and anchor';
      button.addEventListener('click',event=>{event.stopPropagation();this.change({...this.settings,mode:value});},{signal:this.abort.signal});this.toolbar.append(button);this.modeButtons.push(button);
    }
    this.sourcesButton.type='button';this.sourcesButton.className='net-positioning-source';this.sourcesButton.textContent='Sources';this.sourcesButton.setAttribute('aria-label','Select included CVD sources and aggregations');this.sourcesButton.title='Change the underlying markets included in the combined total';
    this.toolbar.append(this.sourcesButton);this.legend.className='cvd-legend';this.legend.setAttribute('role','group');this.legend.setAttribute('aria-label','CVD line visibility');
    this.status.className='cvd-status';this.status.setAttribute('role','status');this.tooltip.className='cvd-tooltip net-positioning-tooltip';this.tooltip.hidden=true;this.tooltip.setAttribute('role','tooltip');
    const separator=document.createElement('span');separator.className='cvd-control-separator';separator.setAttribute('role','separator');separator.setAttribute('aria-orientation','vertical');
    this.controlRow.append(this.toolbar,separator,this.legend);this.pane.append(this.controlRow,this.status,this.tooltip);
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
    this.listeners.push(chart.subscribeCrosshairMove(event=>{
      this.hoverTime=event.time==null?undefined:event.time*1000;this.tooltip.hidden=event.paneIndex!==this.paneIndex()||this.hoverTime===undefined;
      this.scheduler.invalidate(this);
    }),chart.on('pan',()=>this.invalidate()),chart.on('zoom',()=>this.invalidate()),chart.on('resize',()=>this.invalidate()),chart.on('paneResized',event=>{
      if(event.paneIndex!==this.paneIndex())return;const paneWeight=this.chart.paneWeight(this.paneIndex());
      if(Math.abs(paneWeight-this.settings.paneWeight)>.001)this.change({...this.settings,paneWeight});
    }));
    window.addEventListener(CURRENCY_EVENT,()=>{this.lastLegendKey='';this.invalidate();},{signal:this.abort.signal});
    window.addEventListener('basis-theme-change',()=>{this.lastLegendKey='';this.invalidate();},{signal:this.abort.signal});
    document.addEventListener('visibilitychange',()=>this.subscribe(),{signal:this.abort.signal});
    anchorTimeAxisToPrimary(chart);
  }
  paneIndex(){return this.chart.panes().findIndex(p=>p.element===this.pane);}
  private visibleRange(){const range=this.chart.timeScale.visibleRange();return{from:this.chart.dataLayer.indexToTimeFloat(range.from-1)*1000,to:this.chart.dataLayer.indexToTimeFloat(range.to+1)*1000};}
  configure(value:unknown,series:Series){
    const previous=this.settings;this.settings=cvdSettings(value);this.series=series;
    const unit=effectiveCurrency(this.settings.units);
    this.anchor.priceScale().setPriceFormatter(v=>`${compactCvd(v)} ${unit.toUpperCase()}`);
    this.anchor.priceScale().setAutoScale(true);
    for(const button of this.modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===this.settings.mode));
    const index=this.paneIndex();
    if(Math.abs(this.chart.paneWeight(index)-this.settings.paneWeight)>.001)this.chart.setPaneWeight(index,this.settings.paneWeight);
    if(previous.mode!==this.settings.mode)this.tooltip.hidden=true;
    this.lastLegendKey='';this.subscribe();this.invalidate();
  }
  setHostCandles(candles:readonly Candle[]){
    const key=`${candles.length}:${candles[0]?.t}:${candles.at(-1)?.t}`;
    if(key===this.lastHostTimes)return;this.lastHostTimes=key;
    // Reuse host timestamps only. Minute execution samples never expand the host chart timeline.
    this.anchor.setData(candles.map(c=>({time:c.t/1000,open:0,high:0,low:0,close:0,volume:0})));
    this.invalidate();
  }
  private subscribe(){
    const supported=instrumentOf(this.series).base==='BTC',key=this.visible&&!document.hidden&&supported?JSON.stringify([this.settings.sources,this.settings.anchor,this.settings.origin,this.settings.custom]):'';
    if(key===this.requestKey)return;
    this.release?.();this.release=undefined;this.requestKey=key;this.pending=[];
    if(!key||!this.settings.sources.length){this.model.sources.clear();this.model.lines.clear();this.invalidate();return;}
    this.model.sources.clear();this.model.lines.clear();this.pending=[];this.lastLegendKey='';
    const request:CvdRequest={sources:this.settings.sources,anchor:this.settings.anchor,origin:this.settings.origin,custom:this.settings.custom};
    this.release=this.feed.subscribeCvd(`pane-${this.pane.dataset.cvdId??=crypto.randomUUID()}`,request,event=>{
      if(this.dead||this.requestKey!==key)return;this.pending.push(...event.series);this.scheduler.invalidate(this);
    });
  }
  setVisible(value:boolean){this.visible=value;this.subscribe();if(value)this.invalidate();}
  private invalidate(){if(!this.dead){this.primitive.update();this.scheduler.invalidate(this);}}
  openSettings(){this.controls.open(this.settings,[{id:'total',name:'Total',color:this.settings.colors.total??getComputedStyle(this.pane).getPropertyValue('--text').trim()},...this.settings.sources.map(id=>({id,name:id,color:this.settings.colors[id]??cvdDefaultColor(id)})),...this.settings.groups.map(g=>({id:g.id,name:g.name,color:this.settings.colors[g.id]??cvdDefaultColor(g.id)}))]);}
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
  draw(){
    if(this.dead||!this.visible)return;
    for(const series of this.pending)this.model.update(series);this.pending=[];
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
    if(plot)for(const controls of [this.controlRow]){
      controls.style.right=`${Math.max(6,this.pane.clientWidth-plot.left-plot.width+PANE_HEADER_ACTION_SPACE)}px`;
      controls.style.maxWidth=`${paneHeaderSlots(plot.width,620).optionsWidth}px`;
    }
    if(plot){const top=Math.min(.6,Math.max(.16,Math.max(38,this.controlRow.offsetTop+this.controlRow.offsetHeight+8)/plot.height));if(Math.abs(top-this.scaleTop)>.001){this.scaleTop=top;this.anchor.priceScale().setOptions({marginTop:top});}}
    this.status.textContent=!this.settings.sources.length?'No sources selected':this.settings.mode==='aggregations'&&!this.settings.groups.length?'No aggregations selected · use Sources':this.coverageDetail();
    this.status.dataset.coverage=this.coverage();this.status.title=this.coverageDetail();this.status.setAttribute('aria-label',this.coverageDetail());
    if(!this.tooltip.hidden){
      const lines=[...this.model.lines.values()].filter(line=>!this.settings.hidden.includes(line.id));
      this.tooltip.replaceChildren();const stamp=document.createElement('div');stamp.className='positioning-tooltip-header';stamp.textContent=new Date(time).toLocaleString('en-GB',{timeZone:getDisplayTimezone()});this.tooltip.append(stamp);
      for(const line of lines){const row=document.createElement('div');row.className='market-tooltip-metric';const label=document.createElement('span'),value=document.createElement('span');label.textContent=line.name+(line.filtered?' [filtered]':'');const point=this.model.value(line.id,time);value.textContent=`${compactCvd(point?.period===cvdAnchorAt(time-1,this.settings)?point.value:null)} ${unit.toUpperCase()}`;row.append(label,value);this.tooltip.append(row);}
      const quality=document.createElement('small');quality.className='positioning-tooltip-muted';quality.textContent=this.coverageDetail();this.tooltip.append(quality);
    }
    this.chart.invalidate(mask=>mask.invalidatePane(this.paneIndex(),{level:InvalidationLevel.Full,autoScale:true}));
  }
  diagnostics(){return {paneIndex:this.paneIndex(),settings:this.settings,requestKey:this.requestKey,coverage:this.coverage(),sources:[...this.model.sources.values()].map(s=>({source:s.source,points:s.points.length,status:s.status,coverage:s.coverage,message:s.message,asOf:s.asOf,latest:s.points.at(-1)})),lines:[...this.model.lines.values()].map(l=>({id:l.id,filtered:l.filtered,latest:l.points.at(-1)})),draws:this.primitive.draws,segments:this.primitive.segments};}
  dispose(){if(this.dead)return;this.dead=true;this.release?.();this.abort.abort();this.listeners.forEach(release=>release());this.controls.dispose();this.picker.dispose();this.scheduler.remove(this);this.chart.removePrimitive(this.primitive);this.controlRow.remove();this.status.remove();this.tooltip.remove();const index=this.paneIndex();if(index>=0)this.chart.removePane(index);anchorTimeAxisToPrimary(this.chart);}
}
