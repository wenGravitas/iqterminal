import { PaneLoading } from '../pane-loading';
import type { Chart, IPrimitive, PrimitiveHost, PrimitiveRenderContext, SeriesApi } from 'openalgo-charts';
import type { Series, Interval } from '../feed/protocol';
import { duration, instrumentLabel, keyOf, seriesForInstrument } from '../feed/protocol';
import type { FeedClient } from '../feed/client';
import type { Scheduler, Drawable } from '../chart/scheduler';
import type { Notifications } from '../notifications';
import { ConditionsAlerts } from './alerts';
import { ConditionsControls } from './controls';
import { conditionsService, type ConditionsUpdate } from './service';
import { calculationKey, conditionsSettings, warmupBars, type ConditionsSettings } from './settings';
import type { ConditionsPoint } from './engine';
const number=(v:number|null|undefined,digits=0)=>v===null||v===undefined?'—':v.toFixed(digits);
const regColor=(p:ConditionsPoint,s:ConditionsSettings)=>s[`${(p.regime??'NORMAL').toLowerCase()}Color` as 'normalColor'];
function explanation(p:ConditionsPoint){return `ATR ${number(p.atr,2)} quote · ATR ${number(p.atrPercent,3)}% · ATR rank ${number(p.atrRank,1)} · BBW ${number(p.bbw,3)}% · BBW rank ${number(p.bbwRank,1)} · ER ${number(p.er,3)} · CHOP ${number(p.chop,1)}${Object.entries(p.hv).map(([n,v])=>` · HV(${n}) ${v.toFixed(2)}% annualized`).join('')} · ${new Date(p.t).toISOString()} UTC candle open${p.warning?' · EXCESSIVE VOLATILITY':''}`;}
class RegimeShading implements IPrimitive {
  readonly id=`conditions-shading-${crypto.randomUUID()}`;points:readonly ConditionsPoint[]=[];settings=conditionsSettings({});private host?:PrimitiveHost;
  zOrder(){return 'bottom' as const;}attached(host:PrimitiveHost){this.host=host;}detached(){this.host=undefined;}
  draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){
    if(!this.settings.shading||this.settings.mode!=='detailed')return;
    ctx.save();ctx.globalAlpha=.055;
    for(const p of this.points){if(!p.regime)continue;const i=rc.dataLayer.timeToIndex(p.t/1000);if(i===undefined)continue;const x=rc.timeScale.indexToX(i)*rc.dpr,w=rc.timeScale.barSpacing*rc.dpr;if(x+w<0||x-w>rc.plotWidth*rc.dpr)continue;ctx.fillStyle=regColor(p,this.settings);ctx.fillRect(x-w/2,0,w,rc.plotHeight*rc.dpr);}
    ctx.restore();
  }
}
/** Native pane, native line series and the existing dirty-visible scheduler; no private render loop. */
export class ConditionsView implements Drawable {
  visible=true;readonly controls:ConditionsControls;
  private anchor:SeriesApi;private pane:HTMLElement;private surface=document.createElement('div');private summary=document.createElement('div');private table=document.createElement('table');private detail=document.createElement('p');
  private select=document.createElement('select');private component=document.createElement('select');
  private series=new Map<string,SeriesApi>();private references:ReturnType<Chart['addPriceLine']>[]=[];private shading=new RegimeShading();
  private releases:(()=>void)[]=[];private subscriptions:(()=>void)[]=[];private snapshots=new Map<Interval,ConditionsUpdate>();private alerts=new Map<Interval,ConditionsAlerts>();
  private settings=conditionsSettings({});private source:Series;private subscriptionKey='';private selected:Interval;private dirty=new Map<Interval,ConditionsUpdate>();private disposed=false;
  constructor(private chart:Chart,private feed:FeedClient,private scheduler:Scheduler,private notifications:Notifications,source:Series,private change:(settings:ConditionsSettings)=>void){
    this.source=source;this.selected=source.interval;
    const index=chart.panes().length;this.anchor=chart.addSeries('line',{paneIndex:index,priceScaleId:'right',style:{visible:false}});this.anchor.setData([]);
    this.pane=chart.panes()[index].element;this.pane.dataset.marketConditions='true';chart.setPaneWeight(index,.18);chart.addPrimitive(this.shading,index);
    this.surface.className='market-conditions-surface';
    // Keep native controls out of the chart's pan/drawing pointer capture, as the existing pane headers do.
    for(const name of ['pointerdown','mousedown','wheel','dblclick','keydown'])this.surface.addEventListener(name,event=>event.stopPropagation());this.summary.className='market-conditions-summary';this.table.className='market-conditions-table';this.detail.className='market-conditions-detail';
    const toolbar=document.createElement('div');toolbar.className='market-conditions-toolbar';
    for(const [value,label] of [['compact','Compact'],['detailed','Detailed'],['dashboard','Multi-Timeframe Dashboard']])this.select.add(new Option(label,value));this.select.setAttribute('aria-label','Market Conditions display mode');
    for(const [value,label] of [['both','Both components'],['volatility','Volatility Regime'],['tradeability','Market Tradeability']])this.component.add(new Option(label,value));this.component.setAttribute('aria-label','Market Conditions component');
    this.select.onchange=()=>this.change({...this.settings,mode:this.select.value as ConditionsSettings['mode']});this.component.onchange=()=>this.change({...this.settings,component:this.component.value as ConditionsSettings['component']});
    const settings=document.createElement('button');settings.textContent='SET';settings.setAttribute('aria-label','Market Conditions settings');settings.onclick=()=>this.openSettings();toolbar.append(this.select,this.component,settings);
    this.summary.setAttribute('role','status');this.surface.append(toolbar,this.summary,this.table,this.detail);this.pane.append(this.surface);
    this.controls=new ConditionsControls(s=>this.change(s));document.body.append(this.controls.dialog);
    this.subscriptions.push(chart.on('resize',()=>this.invalidate()),chart.on('paneResized',()=>this.invalidate()));
  }
  paneIndex(){return this.chart.panes().findIndex(p=>p.element===this.pane);}
  openSettings(){this.controls.open(this.settings);}
  configure(raw:unknown,source:Series){
    const previous=this.settings;const previousSource=this.source;this.settings=conditionsSettings(raw);this.source=source;this.select.value=this.settings.mode;this.component.value=this.settings.component;
    this.surface.dataset.mode=this.settings.mode;this.surface.dataset.density=this.settings.density;
    this.shading.settings=this.settings;
    if(previous.mode!==this.settings.mode)this.chart.setPaneWeight(this.paneIndex(),this.settings.mode==='dashboard'?.85:this.settings.mode==='detailed'?.55:.18);
    const bound=this.settings.source==='chart'?source:seriesForInstrument(this.settings.source,source.interval)??source;
    const requested=[...new Set([source.interval,...(this.settings.mode==='dashboard'?this.settings.timeframes:[])])];
    const subscriptionKey=JSON.stringify([keyOf(bound),calculationKey(this.settings),requested,this.settings.alertEvents,this.settings.alertAbove,this.settings.alertBelow,this.settings.combinedThreshold,this.settings.alertConfirmation,this.settings.alertHysteresis,this.settings.alertSound]);
    if(subscriptionKey!==this.subscriptionKey){
      this.subscriptionKey=subscriptionKey;const previousReleases=this.releases;this.releases=[];this.snapshots.clear();this.alerts.clear();this.dirty.clear();this.selected=source.interval;this.shading.points=[];for(const series of this.series.values())series.setData([]);
      for(const interval of requested){const series={venue:bound.venue,market:bound.market,interval};const detector=new ConditionsAlerts(this.settings);this.alerts.set(interval,detector);
        this.releases.push(conditionsService(this.feed).subscribe(series,this.settings,update=>{
          if(this.disposed)return;this.snapshots.set(interval,update);
          if(update.initial||update.corrected)detector.seed(update.points.at(-1));
          else for(const p of update.changed)for(const event of detector.next(p)){
            const timeMs=p.t+duration[interval];const text=`${instrumentLabel(series)} · ${interval} · ${event} · tradeability ${number(p.score)} · ${p.regime} · ${new Date(timeMs).toISOString()}`;
            this.notifications.deliver({owner:'market-conditions',ruleId:`market-conditions:${keyOf(series)}:${event}:${this.settings.alertAbove}:${this.settings.alertBelow}:${this.settings.combinedThreshold}`,eventId:`${p.t}:${event}`,timeMs,fresh:true,title:'Market Conditions',text,sound:this.settings.alertSound?'chime':'silent',volume:.5,toast:true});
          }
          if (update.initial || update.reset || update.changed.length) {
            const pending = this.dirty.get(interval);
            this.dirty.set(interval, pending ? { ...update, reset: pending.reset || update.reset, initial: pending.initial || update.initial,
              changed: update.reset ? update.changed : [...pending.changed, ...update.changed] } : update);
          }
          this.invalidate();
        }));
      }
      for(const release of previousReleases)release();
    }
    if(JSON.stringify(previous)!==JSON.stringify(this.settings)||keyOf(previousSource)!==keyOf(source)||!this.series.size)this.syncPlots();
    if(JSON.stringify(previous)!==JSON.stringify(this.settings))for(const [interval,update]of this.snapshots)this.dirty.set(interval,{...update,reset:true});
    this.invalidate();
  }
  private invalidate(){if(!this.disposed)this.scheduler.invalidate(this);}
  setVisible(value:boolean){this.visible=value;if(value)this.invalidate();}
  private syncPlots(){
    const s=this.settings,detailed=s.mode==='detailed',trade=s.component!=='volatility',vol=s.component!=='tradeability';
    const fields:Record<string,[boolean,string]>={score:[detailed&&trade,s.scoreColor],atrRank:[detailed&&vol&&(s.plotAtr||s.component==='volatility'),s.atrColor],bbwRank:[detailed&&vol&&s.plotBbw,s.bbwColor],er:[detailed&&trade&&s.plotEr,s.erColor],chop:[detailed&&trade&&s.plotChop,s.chopColor]};
    for(const period of s.hvPeriods)fields[`hv:${period}`]=[detailed&&vol&&s.hvEnabled&&s.plotHv,s.hvColor];
    for(const [key,series]of this.series)if(!(key in fields)){series.remove();this.series.delete(key);}
    for(const [key,[shown,color]]of Object.entries(fields)){
      let series=this.series.get(key);if(shown&&!series){series=this.chart.addSeries('line',{paneIndex:this.paneIndex(),priceScaleId:key.startsWith('hv:')?'left':'right',style:{color,lineWidth:key==='score'?2:1,lineStyle:key.startsWith('hv:')?'dotted':'solid'}});series.setData([]);this.series.set(key,series);const update=this.snapshots.get(this.source.interval);if(update)this.dirty.set(this.source.interval,{...update,reset:true});}
      series?.applyOptions({visible:shown,color});if(series&&key.startsWith('hv:')){series.priceScale().setAutoScale(true);series.priceScale().setPriceFormatter(v=>`${v.toFixed(1)}% HV`);}
    }
    this.anchor.priceScale().setAutoScale(false);this.anchor.priceScale().setPriceRange({min:0,max:100});this.anchor.priceScale().setPriceFormatter(v=>v.toFixed(0));
    for(const ref of this.references)this.chart.removePrimitive(ref);this.references=[];
    if(detailed)for(const level of s.referenceLines)this.references.push(this.chart.addPriceLine({id:`conditions-ref-${level}`,price:level,color:`${s.normalColor}55`,lineWidth:1,lineStyle:'dotted',label:String(level)},this.paneIndex()));
  }
  private loading = new PaneLoading();
  draw(){
    if(this.disposed||!this.visible)return;
    const s=this.settings,update=this.snapshots.get(this.source.interval),last=update?.points.at(-1),prior=update?.points.at(-2);
    if (!this.loading.element.parentElement) this.surface.append(this.loading.element);
    const failed = update?.status?.state === 'failed' || update?.status?.state === 'stale';
    this.loading.update(!last ? { kind: failed ? 'error' : 'loading', title: failed ? 'Market Conditions unavailable' : 'Loading Market Conditions…', detail: update?.status?.message ?? 'Preparing candle history' } : !last.ready ? { kind: 'empty', title: 'Collecting warm-up candles', detail: `${last.count}/${warmupBars(s)} candles` } : null);
    Object.assign(this.loading.element.style, { inset: '36px 0 0' });
    this.surface.dataset.mode=s.mode;
    this.summary.replaceChildren();
    const bound=s.source==='chart'?this.source:seriesForInstrument(s.source,this.source.interval)??this.source;
    this.surface.setAttribute('aria-label',`Market Conditions · ${instrumentLabel(bound)} · ${this.source.interval}`);
    const text=(value:string,color?:string)=>{const span=document.createElement('span');span.textContent=value;if(color)span.style.color=color;this.summary.append(span);};
    if(s.component!=='tradeability')text(`VOL: ${last?.regime??'WARMING'}`,last?regColor(last,s):undefined);
    if(s.component!=='volatility'){const delta=last?.score!==null&&last?.score!==undefined&&prior?.score!==null&&prior?.score!==undefined?last.score-prior.score:0;text(`TRADEABILITY: ${number(last?.score)} ${delta>0?'↑':delta<0?'↓':'→'}`);text(last?.band??'WARMING',last?.band?s[`${last.band.toLowerCase()}Color` as 'deadColor']:undefined);}
    if(!last?.ready)text(` · ${last?.count??0}/${warmupBars(s)} candles`);
    if(last?.warning)text('EXCESSIVE VOLATILITY',s.extremeColor);
    if(update?.status&&update.status.state!=='live')text(` · ${update.status.message}`);
    if(last)this.summary.title=`${instrumentLabel(bound)} · ${this.source.interval} · ${explanation(last)}`;
    this.table.hidden=s.mode!=='dashboard';this.detail.hidden=s.mode!=='dashboard';
    if(s.mode==='dashboard')this.renderTable();
    const pending=this.dirty.get(this.source.interval);
    if(pending){
      const points=pending.reset||pending.initial?pending.points:pending.changed;
      for(const [key,series]of this.series){const data=points.map(p=>{const value=key.startsWith('hv:')?p.hv[key.slice(3)]??null:key==='er'?p.er===null?null:100*p.er:key==='chop'?p.chop===null?null:100-p.chop:p[key as 'score'|'atrRank'|'bbwRank'];return value===null||!Number.isFinite(value)?{time:p.t/1000}:{time:p.t/1000,value};});
        if(pending.reset||pending.initial)series.setData(data);else for(const point of data)series.update(point);
      }
      this.shading.points=pending.points;
    }
    this.dirty.clear();
  }
  private renderTable(){
    const s=this.settings,vol=s.component!=='tradeability',trade=s.component!=='volatility';
    this.table.replaceChildren();const head=this.table.createTHead().insertRow();for(const title of ['TF',...(vol?['VOL','ATR %ile']:[]),...(trade?['ER','CHOP','SCORE','CLASS']:[])]){const th=document.createElement('th');th.textContent=title;head.append(th);}
    const body=this.table.createTBody();
    for(const interval of s.timeframes){const update=this.snapshots.get(interval),p=update?.points.at(-1),row=body.insertRow();row.dataset.timeframe=interval;row.dataset.selected=String(interval===this.selected);
      const button=document.createElement('button');button.textContent=interval;button.setAttribute('aria-label',`Inspect ${interval} Market Conditions`);button.onclick=()=>{this.selected=interval;this.invalidate();};const cell=row.insertCell();cell.append(button);if(update?.status&&update.status.state!=='live'){const state=document.createElement('small');state.textContent=` ${update.status.state.toUpperCase()}`;state.title=update.status.message;cell.append(state);}
      for(const value of [...(vol?[p?.regime??'WARMING',number(p?.atrRank)]:[]),...(trade?[number(p?.er,2),number(p?.chop),number(p?.score),p?.band??'WARMING']:[])])row.insertCell().textContent=value;
      row.title=p?explanation(p)+(update?.status?.state!=='live'?` · ${update?.status?.message??'Loading'}`:''):(update?.status?.message??'Loading native candle history');
      if(p?.regime&&vol)row.cells[1].style.color=regColor(p,s);
    }
    const selected=this.snapshots.get(this.selected),point=selected?.points.at(-1);this.detail.textContent=`${this.selected} · ${point?explanation(point):(selected?.status?.message??'Loading candles…')}`;
  }
  diagnostics(){return {pane:this.paneIndex(),mode:this.settings.mode,timeframes:[...this.snapshots].map(([interval,u])=>({interval,latest:u.points.at(-1),status:u.status})),calculations:conditionsService(this.feed).diagnostics()};}
  dispose(){this.disposed=true;this.scheduler.remove(this);for(const release of this.releases)release();for(const release of this.subscriptions)release();this.controls.dispose();this.surface.remove();const index=this.paneIndex();if(index>=0)this.chart.removePane(index);}
}
