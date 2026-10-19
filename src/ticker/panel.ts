import type { IContentRenderer, IDockviewPanelProps } from 'dockview-core';
import type { FeedClient } from '../feed/client';
import type { Scheduler } from '../chart/scheduler';
import type { Notifications } from '../notifications';
import type { NormalizedExecution } from '../feed/footprint';
import { histogramScale, histogramWidth } from './histogram';
import { MarketPicker } from '../market-picker';
import { marketName } from '../markets';
import { tradeSize, TICKER_COLUMNS, parseDisplayMinimum, tickerConfig, TickerTape, type TickerConfig } from './model';
import { TickerSettings } from './settings';
import { showTradeColumns, updateTradeRow, tradeRow, tradeText, compactSize } from './presentation';
import { indicatorIcon } from '../indicators/icons';
export class TradeTickerPanel implements IContentRenderer {
  readonly element=document.createElement('section'); visible=false; private dead=false; private params!:IDockviewPanelProps;
  private selection!:TickerConfig; private minimum=document.createElement('input');private unit=document.createElement('select');private presets=document.createElement('datalist');private table=document.createElement('table'); private tape=new TickerTape(); private release?:()=>void;private generation=0;
  private tbody=document.createElement('tbody');private toolbar=document.createElement('header');private markets=document.createElement('button');private pause=document.createElement('button');private status=document.createElement('footer');private viewport=document.createElement('div');
  private picker:MarketPicker;private settings:TickerSettings;private listeners:{dispose():void}[]=[];private abort=new AbortController();private timer?:ReturnType<typeof setInterval>;private dirty=false;private pulsed=new Set<string>();private rowPool:HTMLTableRowElement[]=[];private rowRecords=new WeakMap<HTMLTableRowElement,import('./model').ClassifiedTrade>();private pointerHover:NormalizedExecution|null=null;private focusHover:NormalizedExecution|null=null;private activeHoverId:string|null=null;private drawCount=0;private histogramClock=0;private statusText='Collecting reported prints…';
  constructor(private feed:FeedClient,private scheduler:Scheduler,private notifications:Notifications,private save:()=>void,private register:(id:string,panel:TradeTickerPanel|null)=>void,private onHover:(sourceId:string,execution:NormalizedExecution|null)=>void,private onAddExecutionRay:(execution:NormalizedExecution)=>number){
    this.element.className='trade-ticker';this.toolbar.className='ticker-toolbar';this.markets.setAttribute('aria-label','Ticker markets');this.pause.className='ticker-icon-button';this.pause.append(indicatorIcon('pause'));this.pause.setAttribute('aria-label','Pause');this.pause.title='Pause';this.pause.setAttribute('aria-pressed','false');const settings=document.createElement('button');settings.className='ticker-icon-button';settings.append(indicatorIcon('settings'));settings.setAttribute('aria-label','Trade Ticker settings');settings.title='Trade Ticker settings';const audio=document.createElement('button');audio.className='ticker-icon-button';const syncAudio=()=>{const enabled=this.notifications.diagnostics().audio==='running';audio.replaceChildren(indicatorIcon(enabled?'audio':'audio-off'));audio.setAttribute('aria-label',enabled?'Audio enabled':'Enable audio');audio.title=enabled?'Audio enabled':'Enable audio';};syncAudio();const clear=document.createElement('button');clear.type='button';clear.className='ticker-icon-button';clear.append(indicatorIcon('clear'));clear.setAttribute('aria-label','Clear trades');clear.title='Clear trades';
    const filter=document.createElement('div');filter.className='ticker-quick-filter';const label=document.createElement('span');label.textContent='≥';label.setAttribute('aria-hidden','true');this.minimum.type='text';this.minimum.inputMode='decimal';this.minimum.maxLength=24;this.minimum.setAttribute('aria-label','Minimum trade size');this.minimum.title='Minimum displayed trade size · numbers or K/M · does not filter notifications';this.presets.id=`ticker-size-${crypto.randomUUID()}`;this.minimum.setAttribute('list',this.presets.id);this.unit.setAttribute('aria-label','Trade size filter unit');for(const value of ['USDT','BTC'])this.unit.add(new Option(value,value));filter.append(label,this.minimum,this.unit,this.presets);
    this.toolbar.append(this.markets,filter,this.pause,settings,audio,clear);this.viewport.className='ticker-viewport';const table=this.table;table.className='ticker-table';const thead=document.createElement('thead'),tr=document.createElement('tr');for(const col of [{id:'time',title:'Time UTC',label:'Time UTC',width:105},...TICKER_COLUMNS]){const th=document.createElement('th');th.scope='col';th.dataset.column=col.id;th.textContent=col.title;th.title=col.label;th.style.width=`${col.width}px`;tr.append(th);}thead.append(tr);table.append(thead,this.tbody);this.viewport.append(table);
    this.status.className='ticker-status';this.status.setAttribute('role','status');this.element.append(this.toolbar,this.viewport,this.status);this.picker=new MarketPicker(this.element);this.settings=new TickerSettings(this.element,this.notifications,()=>this.params.api.id,c=>this.apply(c));
    const opt={signal:this.abort.signal};
    this.minimum.addEventListener('change',()=>{const value=parseDisplayMinimum(this.minimum.value);this.minimum.setCustomValidity(value===null?'Enter a size from 0 to 1 trillion, optionally using K or M.':'');if(value===null){this.minimum.reportValidity();return;}this.apply({...this.selection,displayMinimum:value});},opt);
    this.unit.addEventListener('change',()=>this.apply({...this.selection,displayUnit:this.unit.value as TickerConfig['displayUnit']}),opt);this.markets.addEventListener('click',()=>this.picker.open(this.selection.markets,{multiple:true,capability:'executions',apply:ids=>this.apply({...this.selection,markets:ids})}),opt);
    settings.addEventListener('click',()=>this.settings.open(this.selection),opt);audio.addEventListener('click',()=>void this.notifications.enable().then(syncAudio),opt);
    clear.addEventListener('click',()=>this.clearTrades(),opt);this.pause.addEventListener('click',()=>this.setPause(!this.tape.paused),opt);
    this.viewport.addEventListener('pointermove',event=>{const row=this.rowFromEvent(event);this.pointerHover=row?this.rowRecords.get(row)?.execution??null:null;this.syncHover();},opt);
    this.viewport.addEventListener('pointerleave',()=>{this.pointerHover=null;this.syncHover();},opt);
    this.tbody.addEventListener('focusin',event=>{const row=this.rowFromEvent(event);if(!row)return;this.focusHover=this.rowRecords.get(row)?.execution??null;for(const item of this.tbody.querySelectorAll<HTMLTableRowElement>('.ticker-row'))item.tabIndex=item===row?0:-1;this.syncHover();},opt);
    this.tbody.addEventListener('focusout',event=>{const row=this.rowFromEvent(event);if(!row)return;const next=event.relatedTarget instanceof Element?event.relatedTarget.closest<HTMLTableRowElement>('.ticker-row'):null;this.focusHover=next&&this.tbody.contains(next)?this.rowRecords.get(next)?.execution??null:null;row.tabIndex=-1;if(next)next.tabIndex=0;this.syncHover();},opt);
    this.tbody.addEventListener('dblclick',event=>{const row=this.rowFromEvent(event),execution=row?this.rowRecords.get(row)?.execution:null;if(!execution)return;event.preventDefault();event.stopPropagation();this.onAddExecutionRay(execution);},opt);
    this.tbody.addEventListener('keydown',event=>{const row=this.rowFromEvent(event);if(!row)return;if(event.key==='Enter'){const execution=this.rowRecords.get(row)?.execution;if(execution){event.preventDefault();this.onAddExecutionRay(execution);}return;}if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;const rows=[...this.tbody.querySelectorAll<HTMLTableRowElement>('.ticker-row')],index=rows.indexOf(row),next=rows[index+(event.key==='ArrowDown'?1:-1)];if(!next)return;event.preventDefault();next.tabIndex=0;next.focus();},opt);
    this.viewport.addEventListener('scroll',()=>{this.pointerHover=null;this.syncHover();if(this.viewport.scrollTop>4&&!this.tape.paused)this.setPause(true);else this.scheduler.invalidate(this);},opt);
  }
  init(params:IDockviewPanelProps){this.params=params;this.selection=tickerConfig(params.params);this.tape.configure(this.selection);params.api.updateParameters(this.selection);params.api.setTitle('Trade Ticker · BTC');this.register(params.api.id,this);this.syncControls();this.listeners.push(params.api.onDidVisibilityChange(()=>{this.visible=params.api.isVisible;if(this.visible)this.scheduler.invalidate(this);}),params.api.onDidDimensionsChange(()=>this.scheduler.invalidate(this)));this.visible=params.api.isVisible;this.subscribe();this.timer=setInterval(()=>{if(this.dirty||(this.visible&&this.selection.histogram&&!this.tape.paused&&this.tape.rows.length&&Date.now()-this.histogramClock>=1000)){this.dirty=false;this.scheduler.invalidate(this);}},200);}
  private apply(value:TickerConfig){const next=tickerConfig(value), subscriptions=JSON.stringify([next.markets,next.scope,next.tiers])!==JSON.stringify([this.selection.markets,this.selection.scope,this.selection.tiers]);this.selection=next;this.tape.configure(next);this.syncControls();this.params.api.updateParameters(next);this.save();if(subscriptions){this.feed.updateTicker(this.params.api.id,next);this.markets.textContent=next.markets.map(marketName).join(' + ')||'Select markets';}this.dirty=true;this.scheduler.invalidate(this);}
  private syncControls(){
    this.table.style.setProperty('--ticker-bar-opacity',String(this.selection.histogramOpacity));
    this.minimum.value=String(this.selection.displayMinimum);this.minimum.setCustomValidity('');this.unit.value=this.selection.displayUnit;
    this.presets.replaceChildren(...(this.selection.displayUnit==='BTC'?['0','.01','.1','1','5','10','25','100']:['0','10K','50K','100K','250K','500K','1M','5M']).map(value=>new Option(value,value)));
    for(const th of this.table.querySelectorAll<HTMLElement>('th'))th.hidden=th.dataset.column!=='time'&&!this.selection.columns.includes(th.dataset.column as TickerConfig['columns'][number]);
    this.table.style.minWidth=`${105+TICKER_COLUMNS.filter(col=>this.selection.columns.includes(col.id)).reduce((sum,col)=>sum+col.width,0)}px`;
    const empty=this.tbody.querySelector<HTMLTableCellElement>('.ticker-empty');if(empty)empty.colSpan=1+this.selection.columns.length;
  }
  private subscribe(){this.release?.();const generation=++this.generation;this.markets.textContent=this.selection.markets.map(marketName).join(' + ')||'Select markets';this.release=this.feed.subscribeTicker(this.params.api.id,this.selection,e=>{if(this.dead||generation!==this.generation)return;this.tape.ingest(e.records);for(const r of e.records){if(!r.tier||!r.notify||(r.tier.sound==='silent'&&!r.tier.toast))continue;this.notifications.deliver({eventId:r.execution.executionId,ruleId:`${this.params.api.id}:${r.tier.id}`,owner:this.params.api.id,timeMs:r.execution.timeMs,fresh:r.notify,muted:this.selection.muted,title:r.tier.name,text:tradeText(r),sound:r.tier.sound,volume:r.tier.volume,toast:r.tier.toast});}this.statusText=`${this.selection.markets.map(marketName).join(' · ')||'No markets'} · ${e.status.state} · ${e.status.message} · reported aggregate prints${e.dropped?` · ${e.dropped} rows dropped at transport cap`:''}`;this.dirty=true;});}
  private setPause(paused:boolean){if(paused)this.tape.pause();else{this.tape.live();this.viewport.scrollTop=0;}const label=paused?'Return to live':'Pause';this.pause.replaceChildren(indicatorIcon(paused?'play':'pause'));this.pause.setAttribute('aria-label',label);this.pause.title=label;this.pause.setAttribute('aria-pressed',String(paused));this.scheduler.invalidate(this);}
  private rowFromEvent(event:Event){const target=event.target instanceof Element?event.target.closest<HTMLTableRowElement>('.ticker-row'):null;return target&&this.tbody.contains(target)?target:null;}
  private syncHover(){const execution=this.pointerHover??this.focusHover,id=execution?.executionId??null;if(this.activeHoverId===id)return;this.activeHoverId=id;if(this.params)this.onHover(this.params.api.id,execution);}
  private pruneHover(rendered:readonly import('./model').ClassifiedTrade[]){const ids=new Set(rendered.map(record=>record.execution.executionId));if(this.pointerHover&&!ids.has(this.pointerHover.executionId))this.pointerHover=null;if(this.focusHover&&!ids.has(this.focusHover.executionId))this.focusHover=null;this.syncHover();}
  private clearTrades(){this.pointerHover=null;this.focusHover=null;this.syncHover();this.tape.clear();this.pulsed.clear();this.viewport.scrollTop=0;this.dirty=true;this.scheduler.invalidate(this);}
  draw(){
    if(this.dead||!this.visible)return;this.drawCount++;this.histogramClock=Date.now();
    const snapshot=this.tape.snapshot(this.histogramClock),records=this.tape.visible(this.selection),scaleRecords=snapshot.records.slice();
    const scaleIds=new Set(scaleRecords.map(record=>record.execution.executionId));
    for(const record of records)if(!scaleIds.has(record.execution.executionId)){scaleIds.add(record.execution.executionId);scaleRecords.push(record);}
    const scale=histogramScale(scaleRecords,this.selection,snapshot.now,records);
    const barStatus=this.selection.histogram?` · bars: ${this.selection.histogramSeconds}s + visible / ≤600 retained prints · max ${compactSize(scale.maximum)} ${this.selection.displayUnit}${this.tape.paused?' · frozen':''}`:'';
    const retention=` · ${this.tape.rows.length}/500 raw · ${records.length}/100 matching retained`;
    this.status.textContent=this.statusText+retention+barStatus;this.status.title=this.statusText+retention+barStatus+' · sell bars enter from left, buy bars from right; scale uses recent raw prints plus every visible matching row';
    let pulses=0;
    if(!records.length){
      this.pruneHover([]);
      if(!this.tbody.querySelector('.ticker-empty')){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=1+this.selection.columns.length;td.className='ticker-empty';tr.append(td);this.tbody.replaceChildren(tr);}
      this.tbody.querySelector('.ticker-empty')!.textContent=this.selection.markets.length?'No prints match the display filter · collecting live':'Select a supported market';return;
    }
    // Virtualize the 100-row tape; offscreen records remain available on scroll.
    const start=Math.max(0,Math.min(records.length-1,Math.floor(Math.max(0,this.viewport.scrollTop-28)/27)));
    const end=Math.min(records.length,start+Math.ceil(this.viewport.clientHeight/27)+3),fragment=document.createDocumentFragment();
    const spacer=(height:number)=>{const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=1+this.selection.columns.length;td.style.height=`${height}px`;td.style.padding='0';td.style.border='0';tr.setAttribute('aria-hidden','true');tr.append(td);return tr;};
    if(start)fragment.append(spacer(start*27));
    records.slice(start,end).forEach((r,index)=>{
      const fresh=!this.tape.paused&&Date.now()-r.receivedAt<500&&!this.pulsed.has(r.execution.executionId)&&pulses<2;
      let row=this.rowPool[index];if(row)updateTradeRow(row,r,fresh);else{row=tradeRow(r,fresh);this.rowPool[index]=row;}this.rowRecords.set(row,r);row.tabIndex=this.focusHover?.executionId===r.execution.executionId||(!this.focusHover&&index===0)?0:-1;showTradeColumns(row,this.selection.columns);
      const width=histogramWidth(r,scale.maximum,this.selection);row.style.setProperty('--ticker-bar-width',`${width}%`);
      row.title=`${tradeText(r)} · ${r.execution.granularity} (reported print)${r.tier?` · ${r.tier.name}`:''}${this.selection.histogram?` · bar: ${compactSize(tradeSize(r.execution,this.selection.displayUnit))} ${this.selection.displayUnit} / ${compactSize(scale.maximum)} ${this.selection.displayUnit} rolling maximum · ${this.selection.histogramSeconds}s + visible rows, ≤600 retained prints${r.execution.timeMs<scale.start?' · older than window, included while visible':''}`:''} · Hover to preview a ray · double-click or press Enter to add a saved ray with execution details`;
      row.setAttribute('aria-description','Hover to preview this execution on matching charts. Double-click or press Enter to add a saved native horizontal ray with execution details.');
      fragment.append(row);
      if(fresh){this.pulsed.add(r.execution.executionId);pulses++;}
    });
    if(end<records.length)fragment.append(spacer((records.length-end)*27));
    this.tbody.replaceChildren(fragment);
    this.pruneHover(records.slice(start,end));
    while(this.pulsed.size>500)this.pulsed.delete(this.pulsed.values().next().value!);
  }
  diagnostics(){return{settings:this.selection,retained:this.tape.rows.length,paused:this.tape.paused,visible:this.visible,draws:this.drawCount,generation:this.generation};}
  dispose(){if(this.dead)return;this.pointerHover=null;this.focusHover=null;this.syncHover();this.dead=true;this.generation++;this.release?.();clearInterval(this.timer);this.abort.abort();this.listeners.forEach(l=>l.dispose());this.picker.dispose();this.settings.dispose();this.rowPool=[];this.scheduler.remove(this);this.notifications.release(this.params.api.id);this.register(this.params.api.id,null);}
}
