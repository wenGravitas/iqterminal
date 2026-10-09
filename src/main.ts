import './vendor/dockview-8.4.1.css';
import { createDockview, type DockviewApi } from 'dockview-core';
import './style.css';
import { FeedClient } from './feed/client';
import { Scheduler } from './chart/scheduler';
import { CandlePanel, panelRegistry } from './panel';
import { instruments, type Series } from './feed/protocol';
import { STORAGE_KEY, PANEL_BUDGET, restoreValue } from './layout';
const diagnosticsEnabled=import.meta.env.DEV || import.meta.env.VITE_DIAGNOSTICS==='1';
const fixture=diagnosticsEnabled&&new URL(location.href).searchParams.get('fixture')==='1';
if(fixture)document.querySelector('.brand')!.textContent='BASIS · FIXTURE';
const feed=new FeedClient(fixture);const scheduler=new Scheduler();const panels=new Map<string,CandlePanel>();
const root=document.querySelector<HTMLElement>('#workspace')!;const add=document.querySelector<HTMLButtonElement>('#add')!;const reset=document.querySelector<HTMLButtonElement>('#reset')!;
let dock:DockviewApi;let saveTimer:ReturnType<typeof setTimeout>|undefined;let restoring=true;let disposed=false;
const save=()=>{if(restoring||disposed)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=undefined;try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,layout:dock.toJSON()}));}catch{document.querySelector('#venue-states')!.textContent='Layout storage unavailable';}},250);};
function addChart(series:Series={venue:'binance',interval:'1m'}) {if(dock.totalPanels>=PANEL_BUDGET)return;dock.addPanel({id:`chart-${crypto.randomUUID()}`,component:'candle',title:'Candles',params:{...series,type:'candle'},position:dock.activePanel?{referencePanel:dock.activePanel,direction:'right'}:undefined,minimumWidth:220,minimumHeight:140});save();}
function defaults(){dock.clear();addChart({venue:'binance',interval:'1m'});addChart({venue:'hyperliquid',interval:'1m'});}
dock=createDockview(root,{
  theme:{name:'basis',className:'dockview-theme-basis',colorScheme:'dark',gap:4,dndTabIndicator:'line'},disableFloatingGroups:true,defaultRenderer:'always',
  createComponent:options=>{if(!(options.name in panelRegistry))throw new Error('Unknown panel type');return new CandlePanel(feed,scheduler,save,(id,p)=>{if(p)panels.set(id,p);else panels.delete(id);});},
  createWatermarkComponent:()=>{const element=document.createElement('div');element.className='empty-workspace';const text=document.createElement('p');text.textContent='No charts open';const button=document.createElement('button');button.textContent='Add chart';button.onclick=()=>addChart();element.append(text,button);return {element,init(){},dispose(){button.onclick=null;}};},
  getTabContextMenuItems:()=>['close','closeOthers','closeAll'],
});
let restored=false;try{const l=restoreValue(localStorage.getItem(STORAGE_KEY));if(l){dock.fromJSON(l);restored=true;}}catch{dock.clear();}
if(!restored)defaults();restoring=false;
const listeners:{dispose():void}[]=[dock.onDidLayoutChange(()=>{save();add.disabled=dock.totalPanels>=PANEL_BUDGET;add.title=add.disabled?`Maximum ${PANEL_BUDGET} charts / WebGL contexts`:'Add a chart to the right of the active group';})];
const abort=new AbortController();add.addEventListener('click',()=>addChart(),{signal:abort.signal});reset.addEventListener('click',()=>{defaults();save();},{signal:abort.signal});
window.addEventListener('online',()=>feed.send({type:'online',online:true}),{signal:abort.signal});window.addEventListener('offline',()=>feed.send({type:'online',online:false}),{signal:abort.signal});
const timer=setInterval(()=>{if(document.hidden)return;document.querySelector('#clock')!.textContent=new Date().toISOString().slice(11,19);const states=(['binance','hyperliquid'] as const).map(v=>{const statuses=[...panels.values()].map(p=>p.diagnostics()).filter(p=>p.series.venue===v).map(p=>p.status);const s=statuses.find(s=>s.state!=='live')??statuses[0];return `${v==='binance'?'Binance':'Hyperliquid'}: ${s?.state??'idle'}`;});document.querySelector('#venue-states')!.textContent=states.join('  ·  ');},1000);
const longTasks:number[]=[];let perf:PerformanceObserver|undefined;
if(diagnosticsEnabled){try{perf=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push(e.duration);});perf.observe({entryTypes:['longtask']});}catch{}
  const debug={dock,addChart,feed,panels,fixture,stats:()=>({panels:[...panels.values()].map(p=>p.diagnostics()),feed:feed.diagnostics,frameIntervals:scheduler.intervals,longTasks,domPanels:document.querySelectorAll('.candle-panel').length}),resetMetrics:()=>{scheduler.intervals.length=0;longTasks.length=0;}};
  Object.assign(window,{__terminal:debug});
}
function dispose(){if(disposed)return;disposed=true;clearTimeout(saveTimer);clearInterval(timer);abort.abort();listeners.forEach(l=>l.dispose());dock.dispose();scheduler.dispose();feed.dispose();perf?.disconnect();}
if(import.meta.hot)import.meta.hot.dispose(dispose);
window.addEventListener('pagehide',event=>{if(saveTimer){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,layout:dock.toJSON()}));}catch{}}if(!event.persisted)dispose();},{signal:abort.signal});
