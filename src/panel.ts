import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import { FeedClient } from './feed/client';
import { instruments, intervals, type Series, type Status, validSeries } from './feed/protocol';
import { CandleStore, Viewport } from './chart/model';
import { Renderer } from './chart/renderer';
import { InputController } from './chart/controller';
import { Scheduler } from './chart/scheduler';
export interface PanelConfig extends Series { type:'candle' }
export function config(value:unknown):PanelConfig {return validSeries(value)?{...value,type:'candle'}:{type:'candle',venue:'binance',interval:'1m'};}
export class CandlePanel implements IContentRenderer {
  readonly element=document.createElement('section');readonly store=new CandleStore();readonly viewport=new Viewport();
  private chart=document.createElement('div');private toolbar=document.createElement('div');private readout=document.createElement('div');private statusNode=document.createElement('div');
  private instrument=document.createElement('select');private interval=document.createElement('select');private metadata=document.createElement('span');private retry=document.createElement('button');private latest=document.createElement('button');
  private renderer?:Renderer;private input?:InputController;private observer?:ResizeObserver;private subscriptions:{dispose():void}[]=[];private release?:()=>void;
  private params!:IDockviewPanelProps;private selection!:PanelConfig;private status:Status={state:'loading',message:'Loading…',lastUpdate:0};private capability='';private width=1;private height=1;private lastDpr=window.devicePixelRatio;private geometryDirty=true;private sized=false;private dead=false;private timer?:ReturnType<typeof setInterval>;private abort=new AbortController();
  visible=false;
  constructor(private feed:FeedClient,private scheduler:Scheduler,private save:()=>void,private register:(id:string,p:CandlePanel|null)=>void) {
    this.element.className='candle-panel';this.toolbar.className='chart-toolbar';this.chart.className='chart-stage';this.readout.className='ohlc';this.statusNode.className='panel-status';this.statusNode.setAttribute('role','status');this.metadata.className='instrument-meta';
    this.instrument.setAttribute('aria-label','Instrument');for(const [value,info] of Object.entries(instruments))this.instrument.add(new Option(info.label,value));
    this.interval.setAttribute('aria-label','Timeframe');for(const t of intervals)this.interval.add(new Option(t,t));
    this.latest.textContent='Latest';this.latest.title='Return to latest candle (Home or double click)';this.retry.textContent='Retry';this.retry.setAttribute('aria-label','Retry market data');
    this.toolbar.append(this.instrument,this.interval,this.latest,this.metadata);this.chart.append(this.readout,this.statusNode);this.element.append(this.toolbar,this.chart);
  }
  init(params:IDockviewPanelProps) {
    this.params=params;this.element.dataset.panelId=params.api.id;this.selection=config(params.params);this.instrument.value=this.selection.venue;this.interval.value=this.selection.interval;
    const options={signal:this.abort.signal};
    this.instrument.addEventListener('change',()=>this.select(),options);this.interval.addEventListener('change',()=>this.select(),options);
    this.latest.addEventListener('click',()=>{this.viewport.latest(this.store.length);this.invalidate(true);},options);this.retry.addEventListener('click',()=>this.feed.retry(params.api.id),options);
    try {this.renderer=new Renderer(this.store,this.viewport,message=>{this.capability=message;this.updateStatus();},()=>this.invalidate(true));this.chart.prepend(this.renderer.canvas,this.renderer.overlay);this.input=new InputController(this.renderer.overlay,this.viewport,this.store,g=>this.invalidate(g),p=>{if(this.renderer)this.renderer.crosshair=p;});}
    catch(e){this.capability=e instanceof Error?e.message:'Chart unavailable';}
    this.observer=new ResizeObserver(()=>{if(this.visible)this.measure();});this.observer.observe(this.chart);
    this.subscriptions.push(params.api.onDidVisibilityChange(()=>this.visibility()));
    window.addEventListener('resize',()=>{if(this.visible)this.measure();},options);
    this.register(params.api.id,this);this.subscribe();queueMicrotask(()=>{if(!this.dead)this.params.api.setTitle(`${this.selection.venue==='binance'?'Binance · BTCUSDT':'Hyperliquid · BTC'} · ${this.selection.interval}`);});this.visibility();this.timer=setInterval(()=>{if(this.visible&&!document.hidden){if(this.lastDpr!==window.devicePixelRatio){this.lastDpr=window.devicePixelRatio;this.measure();}this.updateStatus();}},1000);
  }
  private select(){this.selection=config({venue:this.instrument.value,interval:this.interval.value});this.params.api.updateParameters(this.selection);this.store.length=0;this.viewport.latest(0);this.sized=false;this.subscribe();this.invalidate(true);this.save();}
  private subscribe(){this.release?.();const s=this.selection;this.params.api.setTitle(`${s.venue==='binance'?'Binance':'Hyperliquid'} · ${s.venue==='binance'?'BTCUSDT':'BTC'} · ${s.interval}`);const info=instruments[s.venue];this.metadata.textContent=`${info.quote} · UTC`;this.instrument.title=`${info.kind}; price ${info.quote}; settlement/collateral ${info.collateral}`;this.status={state:'loading',message:'Loading native candles…',lastUpdate:0};
    this.release=this.feed.subscribe(this.params.api.id,s,e=>{if(this.dead)return;if(e.type==='status'){this.status=e.status;if(this.visible&&!document.hidden)this.updateStatus();}else if(e.type==='snapshot'||e.type==='patch'){if(e.type==='patch')this.status={...this.status,lastUpdate:Date.now()};const anchorIndex=Math.min(this.store.length-1,Math.max(0,Math.floor(this.viewport.right))),anchor=this.store.length?this.store.time[anchorIndex]:null,offset=this.viewport.right-anchorIndex;const change=e.type==='snapshot'?this.store.reset(e.candles):this.store.patch(e.candles);if(!this.sized||this.viewport.following){this.viewport.latest(this.store.length);this.sized=true;}else if(e.type==='snapshot'&&anchor!==null)this.viewport.right=this.store.find(anchor)+offset;else this.viewport.right-=change.removed;this.renderer?.invalidate(change);this.geometryDirty=true;this.scheduler.invalidate(this);}});
    this.updateStatus();
  }
  private visibility(){this.visible=this.params.api.isVisible;if(this.visible){this.measure();this.invalidate(true);this.updateStatus();}}
  private measure(){const r=this.chart.getBoundingClientRect();if(r.width<1||r.height<1)return;this.width=r.width;this.height=Math.max(1,r.height-18);this.invalidate(true);}
  private invalidate(geometry:boolean){if(this.dead)return;if(geometry){this.geometryDirty=true;this.renderer?.invalidate();}this.scheduler.invalidate(this);}
  draw(){if(!this.visible||document.hidden||this.dead)return;this.renderer?.resize(this.width,this.height);this.renderer?.render(this.geometryDirty);this.geometryDirty=false;this.updateReadout();}
  private updateReadout(){if(!this.store.length){this.readout.textContent='';return;}const cross=this.renderer?.crosshair;const i=cross?Math.max(0,Math.min(this.store.length-1,Math.round(this.viewport.index(cross.x)))):this.store.length-1;const s=this.store;this.readout.textContent=`O ${s.open[i].toFixed(1)}  H ${s.high[i].toFixed(1)}  L ${s.low[i].toFixed(1)}  C ${s.close[i].toFixed(1)}  V ${s.volume[i].toFixed(3)} BTC`;}
  private updateStatus(){if(!this.visible||document.hidden)return;const age=this.status.lastUpdate?`${Math.max(0,Math.floor((Date.now()-this.status.lastUpdate)/1000))}s ago`:'no live update';this.statusNode.replaceChildren();this.statusNode.dataset.state=this.status.state;const text=document.createElement('span');text.textContent=this.capability||`${this.status.state} · ${this.status.message} · ${age}`;this.statusNode.append(text);if(this.status.state==='failed'||this.status.state==='stale')this.statusNode.append(this.retry);this.statusNode.classList.toggle('no-data',!this.store.length||!!this.capability);}
  diagnostics(){return {id:this.params.api.id,visible:this.visible,bars:this.store.length,right:this.viewport.right,spacing:this.viewport.spacing,renderer:this.renderer?{...this.renderer.stats,gpu:this.renderer.gpu}:null,status:this.status,series:this.selection,last:this.store.length?this.store.at(this.store.length-1):null};}
  contextLoss(restore:boolean){this.renderer?.contextLoss(restore);}
  dispose(){this.dead=true;clearInterval(this.timer);this.abort.abort();this.release?.();this.observer?.disconnect();this.input?.dispose();this.subscriptions.forEach(s=>s.dispose());this.scheduler.remove(this);this.renderer?.dispose();this.register(this.params.api.id,null);}
}
export const panelRegistry = {candle: CandlePanel} as const;
