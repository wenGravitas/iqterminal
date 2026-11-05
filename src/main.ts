import {startVisibleChartFeeds} from './feed/restore-bootstrap';
import { WorkspaceManager, browserWorkspaceStorage } from './workspaces/manager';
import { bindWorkspacePanelStorage } from './workspaces/panel-storage';
import { TerminalFooter } from './workspaces/footer';
import { widgetRegistry } from './widgets/registry';
import { JournalController, type JournalOpenOptions } from './journal/controller';
import { GlobalJournalPanel } from './journal/panel';
import type { ChartSnapshot } from './journal/model';
import { prepareRestore } from './journal/restore';
import { LiquidationTickerPanel } from './liquidations/panel';
import { CurrencyDisplaySettings } from './currency-display';
import { LevelWatchPanel } from './level-watch/panel';
import type {WatchSnapshot,LevelWatch} from './level-watch/types';
import './vendor/dockview-8.4.1.css';
import { createDockview, type DockviewApi } from 'dockview-core';
import './style.css';
import { ThemeController, THEME_EVENT, dockviewColorScheme } from './theme';
import { Notifications } from './notifications';
import { TradeTickerPanel } from './ticker/panel';
import { TickerExecutionHoverCoordinator } from './ticker/hover';
import { FeedClient } from './feed/client';
import { Scheduler } from './chart/scheduler';
import { CandlePanel, config as chartConfig, panelRegistry, type CandlePanel as CandlePanelInstance } from './panel';
import { LazyScriptEditorPanel } from './scripts/editor-loader';
import { ScriptLibrary } from './scripts/library';
import { TabCycleHeaderAction } from './tab-cycler';
import { CompactChartTab, activateNumberedTab } from './chart-tab';
import { instrumentKey, type Series } from './feed/protocol';
import { PANEL_BUDGET } from './layout';
import { MarketPulseController } from './market-pulse';
import { ConnectionStatusController } from './connection-status';
import { DepthMatrixPanel } from './depth-matrix-panel';
import { DEFAULT_DEPTH_MATRIX_SETTINGS } from './feed/depth-matrix';
import { MarketComparisonPanel } from './market-comparison/panel';
import { defaultMarketComparisonConfig } from './market-comparison/model';
import { TradingController } from './trading/controller';
import { TradingPanel, type TradingPanelView } from './trading/panel';
import { TRADING_PANEL_ID } from './trading/model';

const diagnosticsEnabled = import.meta.env.DEV || import.meta.env.VITE_DIAGNOSTICS === '1';
const query = new URL(location.href).searchParams;
const fixture = diagnosticsEnabled && query.get('fixture') === '1';
const alignFixtureToNow = fixture && query.get('fixtureTime') === 'now';
if (fixture) document.querySelector('.brand')!.textContent = 'BASIS · FIXTURE';
const feed = new FeedClient(fixture, alignFixtureToNow);
const scheduler = new Scheduler();
const notifications = new Notifications();
const trading = new TradingController({ fixtureMode: fixture });
const tickers = new Map<string,TradeTickerPanel>();
const library = new ScriptLibrary();
const journal = JournalController.create(library);
const panels = new Map<string, CandlePanelInstance>();
const journalPanels = new Map<string, GlobalJournalPanel>();
const marketComparisons = new Map<string, MarketComparisonPanel>();
const executionHover = new TickerExecutionHoverCoordinator();
const root = document.querySelector<HTMLElement>('#workspace')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const tradingStatusButton = document.querySelector<HTMLButtonElement>('#trading-status')!;
const currencySettings = new CurrencyDisplaySettings(document.querySelector<HTMLButtonElement>('#global-settings')!);
const appearance = new ThemeController(document.querySelector<HTMLSelectElement>('#theme')!);
const marketPulse = new MarketPulseController();
const connectionStatus = new ConnectionStatusController(feed, fixture, () => marketPulse.dismissForOtherPopup());
marketPulse.setExternalPopoverDismiss(() => connectionStatus.dismissForOtherPopup());
let dock: DockviewApi;
let editor: LazyScriptEditorPanel | undefined;
let watchPanel:LevelWatchPanel|undefined;let watchSnapshot:WatchSnapshot|undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let restoring = true;
let workspaceManager: WorkspaceManager | undefined;
let disposed = false;

function chartContextCount() { return dock.panels.filter(panel => ['candle', 'market-comparison'].includes(panel.view.contentComponent)).length; }
function depthMatrixCount() { return dock.panels.filter(panel => panel.view.contentComponent === 'depth-matrix').length; }
const save = () => {
  if (restoring || workspaceManager?.transitioning || disposed) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushLayoutSave, 250);
};

function flushLayoutSave() {
  if (!saveTimer || restoring || disposed) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  workspaceManager?.saveCurrent();
}

function addChart(series: Series = { venue: 'binance', market: 'perpetual', interval: '1m' }) {
  if (chartContextCount() >= PANEL_BUDGET) return;
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

function addMarketComparison() {
  if (chartContextCount() >= PANEL_BUDGET) return;
  dock.addPanel({
    id: `market-comparison-${crypto.randomUUID()}`,
    component: 'market-comparison',
    title: 'Market Comparison',
    params: defaultMarketComparisonConfig(),
    position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'right' } : undefined,
    initialWidth: Math.round(root.clientWidth / 3),
    minimumWidth: 240,
    minimumHeight: 160,
  });
  save();
}

function addTicker() {
  if (dock.panels.filter(p => p.view.contentComponent === 'trade-ticker').length >= 8) return;
  dock.addPanel({ id: `ticker-${crypto.randomUUID()}`, component: 'trade-ticker', title: 'Trade Ticker · BTC', params: {}, position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'right' } : undefined, initialWidth: Math.round(root.clientWidth / 4), minimumWidth: 240, minimumHeight: 160 });
  save();
}

function addLiquidationTicker(){if(dock.panels.filter(p=>p.view.contentComponent==='liquidation-ticker').length>=8)return;dock.addPanel({id:`liquidation-${crypto.randomUUID()}`,component:'liquidation-ticker',title:'Liquidation Ticker',params:{},position:dock.activePanel?{referencePanel:dock.activePanel,direction:'right'}:undefined,initialWidth:Math.max(300,Math.round(root.clientWidth/4)),minimumWidth:240,minimumHeight:180});save();}
function focusLiquidation(event:import('./liquidations/model').LiquidationEvent){for(const p of panels.values())if(p.focusLiquidation(event))return true;return false;}

function addDepthMatrix() {
  if (depthMatrixCount() >= 8) return;
  dock.addPanel({ id: `depth-matrix-${crypto.randomUUID()}`, component: 'depth-matrix', title: 'Depth Matrix',
    params: { ...DEFAULT_DEPTH_MATRIX_SETTINGS }, position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'right' } : undefined,
    initialWidth: Math.round(root.clientWidth / 4), minimumWidth: 300, minimumHeight: 180 });
  save();
}

function addHyperliquidTrading() {
  const existing = dock.getPanel(TRADING_PANEL_ID);
  if (existing) { existing.api.setActive(); return; }
  dock.addPanel({ id: TRADING_PANEL_ID, component: 'hyperliquid-trading', title: 'Trading · HL BTC', params: {},
    position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'right' } : undefined,
    initialWidth: Math.min(360, Math.max(300, Math.round(root.clientWidth / 3))), minimumWidth: 280, minimumHeight: 220 });
  save();
}

const tradingWidgetSpecs: Record<Exclude<TradingPanelView, 'trade'>, { id: string; title: string }> = {
  positions: { id: 'hyperliquid-positions', title: 'Positions · HL BTC' },
  'open-orders': { id: 'hyperliquid-open-orders', title: 'Open Orders · HL BTC' },
  'order-history': { id: 'hyperliquid-order-history', title: 'Order History · local' },
  'trade-history': { id: 'hyperliquid-trade-history', title: 'Trade History · recent fills' },
};

function addHyperliquidTradingWidget(view: Exclude<TradingPanelView, 'trade'>) {
  const spec = tradingWidgetSpecs[view];
  const existing = dock.getPanel(spec.id);
  if (existing) { existing.api.setActive(); return; }
  dock.addPanel({ id: spec.id, component: `hyperliquid-trading-${view}`, title: spec.title, params: {},
    position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'right' } : undefined,
    initialWidth: Math.min(420, Math.max(300, Math.round(root.clientWidth / 3))), minimumWidth: 280, minimumHeight: 180 });
  save();
}

let tradingPanel: TradingPanel | undefined;
function openTradingSettings() {
  addHyperliquidTrading();
  tradingPanel?.openSettings();
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

async function restoreJournalSnapshot(snapshot: ChartSnapshot) {
  if (chartContextCount() >= PANEL_BUDGET) throw new Error(`All ${PANEL_BUDGET} chart slots are in use. Close a chart or comparison before opening saved settings.`);
  const workspaceId = workspaceManager?.active.id;
  const restored = await prepareRestore(snapshot, library);
  if (workspaceId !== workspaceManager?.active.id) throw new Error('Workspace changed while preparing the saved chart. Retry in the intended workspace.');
  if (chartContextCount() >= PANEL_BUDGET) throw new Error('A chart slot was filled while preparing settings. Free a slot and retry.');
  const id = `chart-${crypto.randomUUID()}`;
  dock.addPanel({ id, component: 'candle', title: 'Restored settings', params: { ...restored.config, journalRestored: { capturedAt: snapshot.capturedAt } },
    position: dock.activePanel ? { referencePanel: dock.activePanel, direction: 'right' } : undefined, minimumWidth: 220, minimumHeight: 140 });
  save();
  const panel = panels.get(id);
  if (!panel) throw new Error('The new chart could not be created');
  return panel.applyJournalRestore(restored);
}

function openJournal(options?: JournalOpenOptions) {
  const id = 'global-journal', existing = dock.getPanel(id);
  if (existing) {
    existing.api.setActive();
    queueMicrotask(() => journalPanels.get(id)?.open(options));
    return;
  }
  const narrowWorkspace = root.clientWidth < 640;
  dock.addPanel({ id, component: 'global-journal', title: 'Journal', params: {},
    position: dock.activePanel ? { referencePanel: dock.activePanel, direction: narrowWorkspace ? 'below' : 'right' } : undefined,
    ...(narrowWorkspace ? { initialHeight: Math.max(300, Math.round(root.clientHeight * .6)) } : { initialWidth: Math.max(360, Math.round(root.clientWidth * .38)) }),
    minimumWidth: 300, minimumHeight: 220 });
  save();
  queueMicrotask(() => journalPanels.get(id)?.open(options));
}


dock = createDockview(root, {
  theme: { name: 'basis', className: 'dockview-theme-basis', colorScheme: dockviewColorScheme(), gap: 4, dndTabIndicator: 'line' },
  disableFloatingGroups: true,
  // Avoid native drag-image capture stalls on Linux Chromium. Dockview keeps
  // tab/group docking and hit testing on its supported pointer backend.
  dndStrategy: 'pointer',
  defaultRenderer: 'always',
  defaultTabComponent: 'compact-chart',
  createTabComponent: () => new CompactChartTab(),
  createPrefixHeaderActionComponent: group => new TabCycleHeaderAction(group),
  createComponent: options => {
    if (options.name === 'global-journal') {
      const panel = new GlobalJournalPanel(journal.repository, { restore: restoreJournalSnapshot, onPublished: entry => journal.published(entry) });
      journalPanels.set(options.id, panel);
      return {
        element: panel.element,
        init: panel.init.bind(panel),
        dispose: () => { if (journalPanels.get(options.id) === panel) journalPanels.delete(options.id); panel.dispose(); },
      };
    }
    if (options.name === 'market-comparison') return new MarketComparisonPanel(feed, scheduler, save, (id, panel) => {
      if (panel) marketComparisons.set(id, panel); else marketComparisons.delete(id);
    });
    if(options.name==='liquidation-ticker')return new LiquidationTickerPanel(feed,scheduler,notifications,save,focusLiquidation);
    if(options.name==='level-watch'){watchPanel=new LevelWatchPanel(feed,save,focusWatch);return watchPanel;}
    if(options.name==='depth-matrix') return new DepthMatrixPanel(feed,save);
    if (options.name === 'hyperliquid-trading' || options.name.startsWith('hyperliquid-trading-')) {
      const view = options.name === 'hyperliquid-trading' ? 'trade' : options.name.slice('hyperliquid-trading-'.length) as TradingPanelView;
      if (!(view in { trade: true, positions: true, 'open-orders': true, 'order-history': true, 'trade-history': true })) throw new Error('Unknown trading widget type');
      const panel = new TradingPanel(trading, {
        view,
        openWidget: widget => addHyperliquidTradingWidget(widget),
        openTrade: () => addHyperliquidTrading(),
        openSettings: () => openTradingSettings(),
      });
      if (view === 'trade') tradingPanel = panel;
      return panel;
    }
    if (options.name === 'trade-ticker') return new TradeTickerPanel(feed,scheduler,notifications,save,(id,panel)=>{if(panel)tickers.set(id,panel);else tickers.delete(id);},(sourceId,execution)=>executionHover.publish(sourceId,execution),execution=>executionHover.addExecutionRay(execution));
    if (options.name === 'candle') {
      return new CandlePanel(feed, scheduler, library, save, (id, panel) => {
        if (panel) {panels.set(id, panel);executionHover.registerChart(id,{series:()=>panel.series,setExecutionHoverRay:execution=>panel.setExecutionHoverRay(execution),addExecutionRay:execution=>panel.addExecutionRay(execution)});panel.setWatchZones(watchSnapshot?.watches??[]);}
        else {executionHover.registerChart(id,null);panels.delete(id);}
        editor?.refreshTargets();
      }, openEditor, id => executionHover.refreshChart(id), notifications,
      () => [...tickers.values()].map(panel => panel.tierSnapshot()), trading, journal);
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

workspaceManager = new WorkspaceManager(browserWorkspaceStorage(), {
  capture: () => dock.toJSON(),
  cancelPending: () => { clearTimeout(saveTimer); saveTimer = undefined; },
  restore: layout => { const release=import.meta.env.VITE_DATA_MODE==='staging'&&!fixture?startVisibleChartFeeds(feed,layout,chartConfig):()=>{};try{dock.clear();editor=undefined;watchPanel=undefined;tradingPanel=undefined;dock.fromJSON(layout);}finally{release();} },
});
const releaseWorkspaceStorage = bindWorkspacePanelStorage(workspaceManager);
let releaseInitial=()=>{};
if(import.meta.env.VITE_DATA_MODE==='staging'&&!fixture){try{releaseInitial=startVisibleChartFeeds(feed,workspaceManager.active.layout,chartConfig);}catch{/* WorkspaceManager retains the authoritative fallback/error path. */}}
try {
  // Let worker creation and its queued reads begin before synchronous chart DOM.
  if(import.meta.env.VITE_DATA_MODE==='staging'&&!fixture)await new Promise<void>(resolve=>setTimeout(resolve,0));
  workspaceManager.start();
} finally {releaseInitial();}
 journal.setOpenJournal(openJournal);
restoring = false;
const listeners: { dispose(): void }[] = [dock.onDidLayoutChange(() => save())];
const abort = new AbortController();
window.addEventListener('keydown', event => { if (!marketPulse.isOpen() && !connectionStatus.isOpen()) activateNumberedTab(dock, event); }, { signal: abort.signal, capture: true });
window.addEventListener('iqterminal-watch-zone',event=>openWatches((event as CustomEvent).detail),{signal:abort.signal});
const releaseWatches=import.meta.env.VITE_DATA_MODE==='staging'&&!fixture?feed.subscribeWatches((snapshot,error)=>{if(snapshot){watchSnapshot=snapshot;for(const panel of panels.values())panel.setWatchZones(error?snapshot.watches.map(w=>({...w,quality:'stale'})):snapshot.watches);if(!error&&!document.hidden)for(const e of snapshot.events??[]){if(e.kind!=='confirmed'||!e.value.fresh||Date.now()-e.at>3000)continue;void feed.watchRequest<{claimed:boolean}>('/claim',{eventId:e.id}).then(result=>{if(result.claimed)notifications.deliver({eventId:String(e.id),ruleId:'level-watch:'+e.watchId,owner:'level-watch',timeMs:e.at,fresh:true,title:`${e.value.encounter?.definition.name??'Level Watch'} — reclaim confirmed`,text:e.value.reason??'Experimental rule gates met',sound:'chime',volume:.5,toast:true});}).catch(()=>{});}}}):undefined;
tradingStatusButton.addEventListener('click', () => addHyperliquidTrading(), { signal: abort.signal });
document.querySelector('#notifications')!.addEventListener('click', () => notifications.open(), { signal: abort.signal });
const journalButton = document.createElement('button'); journalButton.id = 'open-journal'; journalButton.textContent = 'Journal'; journalButton.title = 'Open the daily trading journal'; journalButton.addEventListener('click', () => journal.open()); document.querySelector('#commands')?.append(journalButton);
window.addEventListener(THEME_EVENT, () => dock.updateOptions({ theme: { name: 'basis', className: 'dockview-theme-basis', colorScheme: dockviewColorScheme(), gap: 4, dndTabIndicator: 'line' } }), { signal: abort.signal });
reset.addEventListener('click', () => { if (confirm('Reset Current Workspace? Its widget layout will be replaced with a starting chart. Other workspaces are unchanged.')) { try { workspaceManager!.reset(); } catch { /* The manager exposes its recovery error in the footer. */ } } }, { signal: abort.signal });
window.addEventListener('online', () => feed.send({ type: 'online', online: true }), { signal: abort.signal });
window.addEventListener('offline', () => feed.send({ type: 'online', online: false }), { signal: abort.signal });

const registry = widgetRegistry({ chart: addChart, comparison: addMarketComparison, ticker: addTicker, liquidations: addLiquidationTicker, depth: addDepthMatrix,
 trading: addHyperliquidTrading, positions: () => addHyperliquidTradingWidget('positions'), orders: () => addHyperliquidTradingWidget('open-orders'),
 orderHistory: () => addHyperliquidTradingWidget('order-history'), tradeHistory: () => addHyperliquidTradingWidget('trade-history'), watches: openWatches,
 editor: () => { const existing = dock.getPanel('script-editor'); if (existing) { existing.api.setActive(); return; } const panel = dock.activePanel && panels.get(dock.activePanel.id) || panels.values().next().value; if (panel) openEditor([...panels].find(([,value]) => value === panel)![0]); },
 journal: () => journal.open(),
 count: component => dock.panels.filter(panel => panel.view.contentComponent === component).length, has: id => Boolean(dock.getPanel(id)),
});
const footer = new TerminalFooter(workspaceManager, registry, diagnosticsEnabled ? () => ({ workspace: workspaceManager!.active.id, panels: dock.panels.length, feeds: feed.protocolDiagnostics() }) : undefined);

let tradingStatusInitialized = false;
const previousTradingAttempts = new Map<string, string>();
const releaseTradingStatus = trading.subscribe(state => {
  const network = state.config.network.toUpperCase();
  const feed = state.snapshot.feedState.toUpperCase();
  const signing = state.vault.unlocked && state.owner.owned ? 'SIGNING' : state.owner.otherOwner ? 'OTHER TAB' : 'LOCKED';
  tradingStatusButton.textContent = state.config.principal ? `HL · ${network} · ${feed} · ${signing}` : 'HL · disconnected';
  tradingStatusButton.dataset.compact = state.config.principal ? `${network === 'MAINNET' ? 'HL' : 'HL T'} · ${feed} · ${signing}` : 'HL · off';
  tradingStatusButton.dataset.state = !state.config.principal ? 'disconnected' : state.snapshot.feedState;
  tradingStatusButton.title = state.snapshot.error ?? (state.config.principal ? `${network} · ${state.config.principal} · ${signing} · Open Hyperliquid BTC trading` : 'Select a Hyperliquid principal in the trading panel');
  if (tradingStatusInitialized) for (const attempt of state.attempts) {
    const key = attempt.cloid.toLowerCase(), previous = previousTradingAttempts.get(key);
    if (previous && previous !== attempt.phase && ['filled', 'rejected', 'canceled'].includes(attempt.phase)) {
      notifications.deliver({ eventId: `${key}:${attempt.phase}:${attempt.updatedAt}`, ruleId: 'hyperliquid-order-status', owner: 'hyperliquid-trading',
        timeMs: attempt.updatedAt, fresh: Date.now() - attempt.updatedAt <= 3_000, title: `Hyperliquid order ${attempt.phase}`,
        text: `${attempt.intent.side.toUpperCase()} ${attempt.intent.size} BTC · ${attempt.message}`, sound: 'silent', volume: 0, toast: true });
    }
    previousTradingAttempts.set(key, attempt.phase);
  }
  if (!tradingStatusInitialized) {
    for (const attempt of state.attempts) previousTradingAttempts.set(attempt.cloid.toLowerCase(), attempt.phase);
    tradingStatusInitialized = true;
  }
});

const timer = setInterval(() => {
  if (document.hidden) return;
  connectionStatus.refreshAges();
}, 1000);

const longTasks: number[] = [];
let perf: PerformanceObserver | undefined;
if (diagnosticsEnabled) {
  try { perf = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration); }); perf.observe({ entryTypes: ['longtask'] }); } catch { /* long-task API is optional */ }
  const debug = {
    dock, dispose, addChart, addMarketComparison, addTicker, addLiquidationTicker, addHyperliquidTrading, openWatches, tickers, notifications, openEditor, feed, panels, marketComparisons, library, fixture, trading,
    marketPulse, connectionStatus, journal, workspaces: workspaceManager, widgetRegistry: registry,
    stats: () => ({ panels: [...panels.values()].map(panel => panel.diagnostics()), marketComparisons: [...marketComparisons.values()].map(panel => panel.diagnostics()), feed: feed.diagnostics, feedProtocol: feed.protocolDiagnostics(), frameIntervals: scheduler.intervals, longTasks, domPanels: document.querySelectorAll('.candle-panel').length, marketPulse: marketPulse.diagnostics() }),
    resetMetrics: () => { scheduler.intervals.length = 0; longTasks.length = 0; feed.resetProtocolDiagnostics(); for (const panel of panels.values()) panel.resetCompositionDiagnostics(); },
  };
  Object.assign(window, { __terminal: debug });
}

function dispose() {
  if (disposed) return;
  journal.dispose();
  // HMR also tears down the app, without necessarily firing pagehide first.
  // Flush while Dockview still owns the user's panels and parameters.
  flushLayoutSave();
  disposed = true;
  clearTimeout(saveTimer);
  clearInterval(timer);
  abort.abort();
  footer.dispose();
  appearance.dispose(); currencySettings.dispose();
  connectionStatus.dispose();
  releaseTradingStatus();
  marketPulse.dispose();
  listeners.forEach(listener => listener.dispose());
  dock.dispose();
  releaseWorkspaceStorage();
  scheduler.dispose(); notifications.dispose();
  trading.dispose();
  releaseWatches?.();feed.dispose();
  perf?.disconnect();
}

if (import.meta.hot) import.meta.hot.dispose(dispose);
window.addEventListener('pagehide', event => {
  flushLayoutSave();
  if (!event.persisted) dispose();
}, { signal: abort.signal });

const appShell = document.querySelector<HTMLElement>('#app-shell')!;
const startupSplash = document.querySelector<HTMLElement>('#startup-splash')!;
requestAnimationFrame(() => requestAnimationFrame(() => {
  appShell.inert = false;
  appShell.removeAttribute('aria-hidden');
  startupSplash.setAttribute('aria-hidden', 'true');
  document.documentElement.dataset.appState = 'ready';
}));
