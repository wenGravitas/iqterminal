import { LevelWatchPanel } from './level-watch/panel';
import type {WatchSnapshot,LevelWatch} from './level-watch/types';
import './vendor/dockview-8.4.1.css';
import { createDockview, type DockviewApi } from 'dockview-core';
import './style.css';
import { ThemeController, THEME_EVENT, currentTheme } from './theme';
import { Notifications } from './notifications';
import { TradeTickerPanel } from './ticker/panel';
import { TickerExecutionHoverCoordinator } from './ticker/hover';
import { FeedClient } from './feed/client';
import { Scheduler } from './chart/scheduler';
import { CandlePanel, panelRegistry, type CandlePanel as CandlePanelInstance } from './panel';
import { LazyScriptEditorPanel } from './scripts/editor-loader';
import { ScriptLibrary } from './scripts/library';
import { TabCycleHeaderAction } from './tab-cycler';
import { CompactChartTab, activateNumberedTab } from './chart-tab';
import { instrumentKey, type Series } from './feed/protocol';
import { STORAGE_KEY, PANEL_BUDGET, restoreValue } from './layout';

const diagnosticsEnabled = import.meta.env.DEV || import.meta.env.VITE_DIAGNOSTICS === '1';
const query = new URL(location.href).searchParams;
const fixture = diagnosticsEnabled && query.get('fixture') === '1';
const alignFixtureToNow = fixture && query.get('fixtureTime') === 'now';
if (fixture) document.querySelector('.brand')!.textContent = 'BASIS · FIXTURE';
const feed = new FeedClient(fixture, alignFixtureToNow);
const scheduler = new Scheduler();
const notifications = new Notifications();
const tickers = new Map<string,TradeTickerPanel>();
const library = new ScriptLibrary();
const panels = new Map<string, CandlePanelInstance>();
const executionHover = new TickerExecutionHoverCoordinator();
const root = document.querySelector<HTMLElement>('#workspace')!;
const add = document.querySelector<HTMLButtonElement>('#add')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const appearance = new ThemeController(document.querySelector<HTMLSelectElement>('#theme')!);
let dock: DockviewApi;
let editor: LazyScriptEditorPanel | undefined;
let watchPanel:LevelWatchPanel|undefined;let watchSnapshot:WatchSnapshot|undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let restoring = true;
let disposed = false;

function chartCount() { return dock.panels.filter(panel => panel.view.contentComponent === 'candle').length; }
const save = () => {
  if (restoring || disposed) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, layout: dock.toJSON() })); }
    catch { document.querySelector('#venue-states')!.textContent = 'Layout storage unavailable'; }
  }, 250);
};

function addChart(series: Series = { venue: 'binance', market: 'perpetual', interval: '1m' }) {
  if (chartCount() >= PANEL_BUDGET) return;
  dock.addPanel({
    id: `chart-${crypto.randomUUID()}`,
    component: 'candle',
    title: 'Candles',
    params: { ...series, type: 'candle', studies: [] },
    position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'right' } : undefined,
    minimumWidth: 220,
    minimumHeight: 140,
  });
  save();
}

function addTicker() {
  if (dock.panels.filter(p => p.view.contentComponent === 'trade-ticker').length >= 8) return;
  dock.addPanel({ id: `ticker-${crypto.randomUUID()}`, component: 'trade-ticker', title: 'Trade Ticker · BTC', params: {}, position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'right' } : undefined, minimumWidth: 240, minimumHeight: 160 });
  save();
}

function openWatches(bounds?:{lower:number;upper:number}){const existing=dock.getPanel('level-watch');if(existing)existing.api.setActive();else dock.addPanel({id:'level-watch',component:'level-watch',title:'Level Watch',params:{},position:dock.activePanel?{referencePanel:dock.activePanel,direction:'right'}:undefined,minimumWidth:280,minimumHeight:180});if(bounds)watchPanel?.openDraft(bounds);save();}
function focusWatch(w:LevelWatch){const panel=[...panels.values()].find(p=>instrumentKey(p.diagnostics().series)==='binance:perpetual');if(panel)panel.focusWatch(w);else {addChart();queueMicrotask(()=>[...panels.values()].find(p=>instrumentKey(p.diagnostics().series)==='binance:perpetual')?.focusWatch(w));}}
function openEditor(targetChartId: string, attachmentId?: string) {
  const existing = dock.getPanel('script-editor');
  if (existing) {
    existing.api.updateParameters({ targetChartId, attachmentId: attachmentId ?? '' });
    existing.api.setActive();
    return;
  }
  dock.addPanel({
    id: 'script-editor', component: 'script-editor', title: 'OpenScript', params: { targetChartId, attachmentId: attachmentId ?? '' },
    position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'within' } : undefined,
    minimumWidth: 360, minimumHeight: 260,
  });
  save();
}

function defaults() {
  dock.clear();
  addChart({ venue: 'binance', market: 'perpetual', interval: '1m' });
  addChart({ venue: 'hyperliquid', market: 'perpetual', interval: '1m' });
}

dock = createDockview(root, {
  theme: { name: 'basis', className: 'dockview-theme-basis', colorScheme: currentTheme(), gap: 4, dndTabIndicator: 'line' },
  disableFloatingGroups: true,
  defaultRenderer: 'always',
  defaultTabComponent: 'compact-chart',
  createTabComponent: () => new CompactChartTab(),
  createPrefixHeaderActionComponent: group => new TabCycleHeaderAction(group),
  createComponent: options => {
    if(options.name==='level-watch'){watchPanel=new LevelWatchPanel(feed,save,focusWatch);return watchPanel;}
    if (options.name === 'trade-ticker') return new TradeTickerPanel(feed,scheduler,notifications,save,(id,panel)=>{if(panel)tickers.set(id,panel);else tickers.delete(id);},(sourceId,execution)=>executionHover.publish(sourceId,execution),execution=>executionHover.addExecutionRay(execution));
    if (options.name === 'candle') {
      return new CandlePanel(feed, scheduler, library, save, (id, panel) => {
        if (panel) {panels.set(id, panel);executionHover.registerChart(id,{series:()=>panel.series,setExecutionHoverRay:execution=>panel.setExecutionHoverRay(execution),addExecutionRay:execution=>panel.addExecutionRay(execution)});panel.setWatchZones(watchSnapshot?.watches??[]);}
        else {executionHover.registerChart(id,null);panels.delete(id);}
        editor?.refreshTargets();
      }, openEditor, id => executionHover.refreshChart(id));
    }
    if (options.name === 'script-editor') {
      editor = new LazyScriptEditorPanel(library, () => [...panels].map(([id, panel]) => ({ id, panel })), save);
      return editor;
    }
    if (!(options.name in panelRegistry)) throw new Error('Unknown panel type');
    throw new Error('Panel component is unavailable');
  },
  createWatermarkComponent: () => {
    const element = document.createElement('div');
    element.className = 'empty-workspace';
    const text = document.createElement('p'); text.textContent = 'No charts open';
    const button = document.createElement('button'); button.textContent = 'Add chart'; button.onclick = () => addChart();
    element.append(text, button);
    return { element, init() {}, dispose() { button.onclick = null; } };
  },
  getTabContextMenuItems: () => ['close', 'closeOthers', 'closeAll'],
});

let restored = false;
try {
  const saved = restoreValue(localStorage.getItem(STORAGE_KEY));
  if (saved) { dock.fromJSON(saved); restored = true; }
} catch { dock.clear(); }
if (!restored) defaults();
restoring = false;

const listeners: { dispose(): void }[] = [dock.onDidLayoutChange(() => {
  save();
  add.disabled = chartCount() >= PANEL_BUDGET;
  const tickerAdd = document.querySelector<HTMLButtonElement>('#add-ticker')!; tickerAdd.disabled = tickers.size >= 8; tickerAdd.title = tickerAdd.disabled ? 'Maximum 8 tickers' : 'Add a dockable Trade Ticker';
  add.title = add.disabled ? `Maximum ${PANEL_BUDGET} charts` : 'Add a chart to the right of the active group';
})];
const abort = new AbortController();
window.addEventListener('keydown', event => activateNumberedTab(dock, event), { signal: abort.signal, capture: true });
document.querySelector('#level-watch')!.addEventListener('click',()=>openWatches(),{signal:abort.signal});
window.addEventListener('iqterminal-watch-zone',event=>openWatches((event as CustomEvent).detail),{signal:abort.signal});
const releaseWatches=import.meta.env.VITE_DATA_MODE==='staging'&&!fixture?feed.subscribeWatches((snapshot,error)=>{if(snapshot){watchSnapshot=snapshot;for(const panel of panels.values())panel.setWatchZones(error?snapshot.watches.map(w=>({...w,quality:'stale'})):snapshot.watches);if(!error&&!document.hidden)for(const e of snapshot.events??[]){if(e.kind!=='confirmed'||!e.value.fresh||Date.now()-e.at>3000)continue;void feed.watchRequest<{claimed:boolean}>('/claim',{eventId:e.id}).then(result=>{if(result.claimed)notifications.deliver({eventId:String(e.id),ruleId:'level-watch:'+e.watchId,owner:'level-watch',timeMs:e.at,fresh:true,title:`${e.value.encounter?.definition.name??'Level Watch'} — reclaim confirmed`,text:e.value.reason??'Experimental rule gates met',sound:'chime',volume:.5,toast:true});}).catch(()=>{});}}}):undefined;
document.querySelector('#add-ticker')!.addEventListener('click', () => addTicker(), { signal: abort.signal });
document.querySelector('#notifications')!.addEventListener('click', () => notifications.open(), { signal: abort.signal });
add.addEventListener('click', () => addChart(), { signal: abort.signal });
window.addEventListener(THEME_EVENT, () => dock.updateOptions({ theme: { name: 'basis', className: 'dockview-theme-basis', colorScheme: currentTheme(), gap: 4, dndTabIndicator: 'line' } }), { signal: abort.signal });
reset.addEventListener('click', () => { defaults(); save(); }, { signal: abort.signal });
window.addEventListener('online', () => feed.send({ type: 'online', online: true }), { signal: abort.signal });
window.addEventListener('offline', () => feed.send({ type: 'online', online: false }), { signal: abort.signal });

const timer = setInterval(() => {
  if (document.hidden) return;
  document.querySelector('#clock')!.textContent = new Date().toISOString().slice(11, 19);
  const markets = [
    { key: 'binance:spot', label: 'Binance Spot' },
    { key: 'binance:perpetual', label: 'Binance USD-M Perp' },
    { key: 'hyperliquid:perpetual', label: 'Hyperliquid Perp' },
  ] as const;
  const states = markets.map(({ key, label }) => {
    const statuses = [...panels.values()].map(panel => panel.diagnostics()).filter(panel => instrumentKey(panel.series) === key).map(panel => panel.status);
    const status = statuses.find(value => value.state !== 'live') ?? statuses[0];
    return `${label}: ${status?.state ?? 'idle'}`;
  });
  document.querySelector('#venue-states')!.textContent = states.join('  ·  ');
}, 1000);

const longTasks: number[] = [];
let perf: PerformanceObserver | undefined;
if (diagnosticsEnabled) {
  try { perf = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration); }); perf.observe({ entryTypes: ['longtask'] }); } catch { /* long-task API is optional */ }
  const debug = {
    dock, addChart, addTicker, openWatches, tickers, notifications, openEditor, feed, panels, library, fixture,
    stats: () => ({ panels: [...panels.values()].map(panel => panel.diagnostics()), feed: feed.diagnostics, frameIntervals: scheduler.intervals, longTasks, domPanels: document.querySelectorAll('.candle-panel').length }),
    resetMetrics: () => { scheduler.intervals.length = 0; longTasks.length = 0; },
  };
  Object.assign(window, { __terminal: debug });
}

function dispose() {
  if (disposed) return;
  disposed = true;
  clearTimeout(saveTimer);
  clearInterval(timer);
  abort.abort();
  appearance.dispose();
  listeners.forEach(listener => listener.dispose());
  dock.dispose();
  scheduler.dispose(); notifications.dispose();
  releaseWatches?.();feed.dispose();
  perf?.disconnect();
}

if (import.meta.hot) import.meta.hot.dispose(dispose);
window.addEventListener('pagehide', event => {
  if (saveTimer) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, layout: dock.toJSON() })); } catch { /* storage may be unavailable */ }
  }
  if (!event.persisted) dispose();
}, { signal: abort.signal });
