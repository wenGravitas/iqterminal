import { currentTheme, THEME_EVENT } from '../theme';
import type { IContentRenderer, IDockviewPanelProps } from 'dockview-core';
import type { FeedClient } from '../feed/client';
import type { Scheduler } from '../chart/scheduler';
import type { Notifications } from '../notifications';
import { MarketPicker } from '../market-picker';
import { indicatorIcon } from '../indicators/icons';
import { button } from '../ticker/ui';
import { parseDisplayMinimum } from '../ticker/model';
import { compactSize } from '../ticker/presentation';
import { liquidationSettings, type LiquidationSettings } from './settings';
import { LiquidationControls } from './controls';
import { liquidationCoverageText } from './coverage';
import { deliverLiquidationAlerts, liquidationColour, liquidationText, liquidationTime } from './presentation';
import { liquidationValue, type LiquidationEvent, type LiquidatedSide } from './model';
import { liquidationInk } from './colors';
import type { LiquidationBatch } from './protocol';
import { positionMarketCard } from '../market-hover-card';
import { getDisplayTimezone, getTimezonePreference, TIMEZONE_EVENT, timezoneName, formatDateTime, type TimezonePreference } from '../timezone';
import { createBurstCard, updateBurstCard, renderBurstHoverCard, formatLiquidationExactTime, type BurstCardParts } from './burst-ui';
import type { LiquidationBurst } from './engine';
import { TooltipDwell } from '../tooltip-dwell';

type VenueId = 'bybit' | 'binance';
type TapeRow = { key: string; time: number; id: string; kind: 'report' | 'burst'; event?: LiquidationEvent; burst?: LiquidationBurst };
type BurstTableRow = { row: HTMLTableRowElement; parts: BurstCardParts };
const REPORT_ROW_ESTIMATE = 27, BURST_ROW_ESTIMATE = 54, REPORT_RENDER_LIMIT = 100, TAPE_HEADER_HEIGHT = 25;

const columns = [
  { id: 'time', label: 'Time', width: 102 }, { id: 'venue', label: 'Venue', width: 62 },
  { id: 'side', label: 'Position', width: 58 }, { id: 'notional', label: 'Reported', width: 96 },
  { id: 'price', label: 'Price', width: 84 }, { id: 'quantity', label: 'Quantity', width: 76 },
] as const;

export class LiquidationTickerPanel implements IContentRenderer {
  readonly element = document.createElement('section');
  visible = true;
  private dead = false;
  private props!: IDockviewPanelProps;
  private settings = liquidationSettings(undefined);
  private release?: () => void;
  private picker: MarketPicker;
  private controls: LiquidationControls;
  private toolbar = document.createElement('header');
  private summary = document.createElement('div');
  private activeBursts = document.createElement('section');
  private table = document.createElement('table');
  private thead = document.createElement('thead');
  private tbody = document.createElement('tbody');
  private viewport = document.createElement('div');
  private status = document.createElement('footer');
  private hoverCard = document.createElement('div');
  private inspector = document.createElement('dialog');
  private inspectorForm = document.createElement('form');
  private inspectorTitle = document.createElement('h2');
  private inspectorSummary = document.createElement('div');
  private inspectorNote = document.createElement('p');
  private inspectorViewport = document.createElement('div');
  private inspectorBody = document.createElement('tbody');
  private latest?: LiquidationBatch;
  private frozen?: LiquidationBatch;
  private frozenClock?: number;
  private currentBatch?: LiquidationBatch;
  private abort = new AbortController();
  private listeners: { dispose(): void }[] = [];
  private refreshTimer?: ReturnType<typeof setInterval>;
  private replayTimer?: ReturnType<typeof setInterval>;
  private range?: { from: number; to: number };
  private replayAt = 0;
  private paused = false;
  private pulsed = new Set<string>();
  private tooltipDwell = new TooltipDwell();
  private eventRows = new Map<string, HTMLTableRowElement>();
  private burstRows = new Map<string, BurstTableRow>();
  private reportRowPool: HTMLTableRowElement[] = [];
  private burstRowPool: BurstTableRow[] = [];
  private inspectorRows = new Map<string, HTMLTableRowElement>();
  private tapeHeights = new Map<string, number>();
  private inspectorEvidence = document.createElement('div');
  private inspectorMode: 'constituents' | 'quality' = 'constituents';
  private inspectorModeButtons = new Map<'constituents' | 'quality', HTMLButtonElement>();
  private inspectorReturnFocus?: HTMLElement;
  private pinned = new Map<LiquidatedSide, { slot: HTMLDivElement; parts: BurstCardParts }>();
  private burstAnchors = new Map<string, HTMLElement>();
  private pointerBurstId: string | null = null;
  private focusBurstId: string | null = null;
  private hoverPointerType?: string;
  private inspectorBurstId: string | null = null;
  private displayZone = getDisplayTimezone();

  constructor(private feed: FeedClient, private scheduler: Scheduler, private notifications: Notifications, private save: () => void, private focusChart: (event: LiquidationEvent) => boolean) {
    this.element.className = 'trade-ticker liquidation-ticker';
    this.element.setAttribute('aria-label', 'Liquidation Ticker');
    this.toolbar.className = 'ticker-toolbar';
    this.summary.className = 'liquidation-summary';
    this.summary.setAttribute('aria-label', 'Reported liquidation activity · USDT');
    this.activeBursts.className = 'liquidation-active-bursts';
    this.activeBursts.setAttribute('aria-label', 'Active liquidation bursts');
    this.viewport.className = 'ticker-viewport liquidation-tape-viewport';
    this.table.className = 'ticker-table liquidation-tape-table';
    this.thead.className = 'liquidation-tape-head';
    this.status.className = 'ticker-status liquidation-status';
    this.status.setAttribute('role', 'status');
    this.hoverCard.className = 'liquidation-burst-hover market-hover-card';
    this.hoverCard.hidden = true;
    this.hoverCard.setAttribute('role', 'tooltip');
    this.buildTableHeader();
    this.table.append(this.thead, this.tbody);
    this.viewport.append(this.table);
    this.element.append(this.toolbar, this.summary, this.activeBursts, this.viewport, this.status, this.hoverCard);
    this.buildPinnedSlots();
    this.buildInspector();
    this.picker = new MarketPicker(this.element);
    this.controls = new LiquidationControls(this.element, settings => this.configure(settings), 'ticker');
    const options = { signal: this.abort.signal };
    window.addEventListener(THEME_EVENT, () => this.scheduler.invalidate(this), options);
    window.addEventListener(TIMEZONE_EVENT, event => {
      const detail = (event as CustomEvent<{ zone?: string; preference?: TimezonePreference }>).detail;
      this.displayZone = detail?.zone ?? getDisplayTimezone();
      this.syncTimeHeader();
      this.scheduler.invalidate(this);
    }, options);
    this.viewport.addEventListener('scroll', () => { this.tooltipDwell.clear(); this.hoverCard.hidden = true; this.pointerBurstId = null; if (this.viewport.scrollTop > 8 && !this.paused) this.setPaused(true); else this.scheduler.invalidate(this); }, options);
    this.element.addEventListener('pointermove', event => {
      if (event instanceof PointerEvent) this.hoverPointerType = event.pointerType;
      const id = this.burstIdFromTarget(event.target);
      if (this.hoverPointerType === 'touch') { this.pointerBurstId = null; this.tooltipDwell.clear(); this.hoverCard.hidden = true; return; }
      if (id !== this.pointerBurstId) { this.pointerBurstId = id; this.syncBurstHover(); }
    }, options);
    this.element.addEventListener('pointerleave', () => { this.pointerBurstId = null; this.hoverPointerType = undefined; this.syncBurstHover(); }, options);
    this.element.addEventListener('focusin', event => {
      const id = this.burstIdFromTarget(event.target);
      if (id !== this.focusBurstId) { this.focusBurstId = id; this.syncBurstHover(); }
    }, options);
    this.element.addEventListener('focusout', event => {
      const next = event.relatedTarget instanceof Element ? this.burstIdFromTarget(event.relatedTarget) : null;
      queueMicrotask(() => { this.focusBurstId = next; this.syncBurstHover(); });
    }, options);
    this.element.addEventListener('animationend', event => {
      const target = event.target;
      if (target instanceof HTMLElement) target.classList.remove('liquidation-burst-pulse', 'trade-pulse');
    }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.tooltipDwell.clear(); this.hoverCard.hidden = true; } }, options);
    this.tbody.addEventListener('dblclick', event => {
      const row = this.reportRowFromEvent(event); const report = row ? this.eventForRow(row) : undefined;
      if (!report) return; event.preventDefault(); event.stopPropagation(); this.focusChart(report);
    }, options);
    this.tbody.addEventListener('keydown', event => this.onTapeKeydown(event), options);
  }

  init(props: IDockviewPanelProps) {
    this.props = props;
    this.settings = liquidationSettings(props.params);
    this.listeners.push(props.api.onDidVisibilityChange(event => { this.visible = event.isVisible; if (this.visible) this.scheduler.invalidate(this); else { this.tooltipDwell.clear(); this.hoverCard.hidden = true; } }), props.api.onDidDimensionsChange(() => this.scheduler.invalidate(this)));
    this.syncColumns(); this.renderToolbar();
    this.release = this.feed.subscribeLiquidations(props.api.id, this.request(), batch => {
      if (this.dead) return;
      this.latest = batch;
      if (this.paused) {
        for (const alert of Array.isArray(batch.alerts) ? batch.alerts : []) this.pulsed.add(alert.event.id);
        for (const burst of Array.isArray(batch.burstAlerts) ? batch.burstAlerts : []) this.pulsed.add(`burst:${burst.id}`);
        this.limitPulses();
      }
      deliverLiquidationAlerts(batch, this.settings, this.notifications, props.api.id);
      this.scheduler.invalidate(this);
    });
    this.refreshTimer = setInterval(() => { if (!this.range) this.feed.updateLiquidations(this.props.api.id, this.request()); }, 30000);
  }

  private request() {
    const now = Date.now();
    return { settings: this.settings, from: this.range?.from ?? now - 900000, to: this.range?.to ?? now + 1000, intervalMs: 60000,
      kind: 'ticker' as const, replay: !!this.range, asOf: this.range ? this.replayAt : undefined };
  }

  private configure(settings: LiquidationSettings) {
    this.settings = settings;
    this.props.api.updateParameters({ ...settings });
    this.feed.updateLiquidations(this.props.api.id, this.request());
    this.syncColumns(); this.renderToolbar(); this.save(); this.scheduler.invalidate(this);
  }

  private icon(name: string, icon: Parameters<typeof indicatorIcon>[0], action: () => void) {
    const result = button('', action); result.className = 'ticker-icon-button'; result.append(indicatorIcon(icon));
    result.title = name; result.setAttribute('aria-label', name); return result;
  }

  private renderToolbar() {
    this.toolbar.replaceChildren();
    const venues = button(this.settings.venues.map(venue => venue.toUpperCase()).join(' + ') || 'Venues', () => this.picker.open(this.settings.venues.map(venue => `${venue}:perpetual` as const), {
      multiple: true, capability: 'liquidations', apply: ids => this.configure({ ...this.settings, venues: ids.filter(id => id === 'bybit:perpetual' || id === 'binance:perpetual').map(id => id.startsWith('bybit') ? 'bybit' : 'binance') }),
    }));
    venues.setAttribute('aria-label', 'Liquidation venues');
    const minimum = document.createElement('input'); minimum.type = 'text'; minimum.inputMode = 'decimal'; minimum.maxLength = 24;
    minimum.value = String(this.settings.minimum); minimum.setAttribute('aria-label', 'Minimum liquidation size'); minimum.title = 'Display filter only · numbers or K/M';
    minimum.onchange = () => { const value = parseDisplayMinimum(minimum.value); minimum.setCustomValidity(value === null ? 'Enter a number or K/M value' : ''); if (value === null) minimum.reportValidity(); else this.configure({ ...this.settings, minimum: value }); };
    const side = document.createElement('select'); side.setAttribute('aria-label', 'Liquidation side');
    for (const value of ['BOTH', 'LONG', 'SHORT']) side.add(new Option(value, value)); side.value = this.settings.side;
    side.onchange = () => this.configure({ ...this.settings, side: side.value as typeof this.settings.side });
    const pause = this.icon(this.paused ? 'Resume liquidation tape' : 'Pause liquidation tape', this.paused ? 'play' : 'pause', () => this.setPaused(!this.paused));
    pause.setAttribute('aria-pressed', String(this.paused));
    const settings = this.icon('Liquidation Ticker settings', 'settings', () => this.controls.open(this.settings));
    this.toolbar.append(venues, minimum, side, pause, settings, button('History', () => this.openHistory()));
    if (this.range) {
      const play = button(this.replayTimer ? 'Pause replay' : 'Play replay', () => this.playReplay());
      play.setAttribute('aria-pressed', String(!!this.replayTimer));
      this.toolbar.append(play, button('Return to live', () => this.returnToLive()));
    }
  }

  private syncTimeHeader() {
    const header = this.thead.querySelector<HTMLElement>('[data-column="time"]');
    if (header) { header.textContent = `Time · ${getTimezonePreference() === 'UTC' ? 'UTC' : 'Local'}`; header.title = timezoneName(getTimezonePreference(), this.displayZone); }
  }

  private buildTableHeader() {
    const row = document.createElement('tr');
    for (const column of columns) {
      const header = document.createElement('th'); header.scope = 'col'; header.dataset.column = column.id;
      header.textContent = column.id === 'notional' ? this.settings.units === 'USDT' ? 'Reported USDT' : 'Size BTC' : column.label;
      header.title = column.id === 'notional' ? this.settings.units === 'USDT' ? 'Reported notional · USDT' : 'Reported base quantity · BTC' : column.label;
      header.style.width = `${column.width}px`; row.append(header);
    }
    this.thead.append(row); this.syncTimeHeader();
  }

  private syncColumns() {
    const notionalHeader = this.thead.querySelector<HTMLElement>('[data-column="notional"]');
    if (notionalHeader) { notionalHeader.textContent = this.settings.units === 'USDT' ? 'Reported USDT' : 'Size BTC'; notionalHeader.title = this.settings.units === 'USDT' ? 'Reported notional · USDT' : 'Reported base quantity · BTC'; }
    for (const cell of this.thead.querySelectorAll<HTMLElement>('[data-column]')) cell.hidden = cell.dataset.column !== 'time' && !this.settings.columns.includes(cell.dataset.column as typeof columns[number]['id']);
    for (const row of this.eventRows.values()) this.syncReportColumns(row);
  }

  private syncReportColumns(row: HTMLTableRowElement) {
    for (const cell of row.querySelectorAll<HTMLElement>('[data-column]')) cell.hidden = cell.dataset.column !== 'time' && !this.settings.columns.includes(cell.dataset.column as typeof columns[number]['id']);
  }

  private buildPinnedSlots() {
    for (const side of ['LONG', 'SHORT'] as const) {
      const slot = document.createElement('div'); slot.className = 'liquidation-active-slot'; slot.dataset.side = side; slot.hidden = true;
      const parts = createBurstCard('pinned', burst => this.openInspector(burst.id, 'constituents'), burst => this.openInspector(burst.id, 'quality'));
      slot.append(parts.root); this.activeBursts.append(slot); this.pinned.set(side, { slot, parts });
    }
  }

  private setPaused(value: boolean) {
    if (this.paused === value) return;
    this.paused = value;
    if (value) {
      this.frozen = this.latest ? structuredClone(this.latest) : undefined; this.frozenClock = this.visualClock(this.frozen ?? this.latest);
      this.element.querySelectorAll<HTMLElement>('.liquidation-burst-pulse,.trade-pulse').forEach(node => node.classList.remove('liquidation-burst-pulse', 'trade-pulse'));
    }
    else { this.frozen = undefined; this.frozenClock = undefined; this.viewport.scrollTop = 0; }
    this.renderToolbar(); this.scheduler.invalidate(this);
  }

  private visualClock(batch?: LiquidationBatch) {
    if (this.range) return this.replayAt;
    return (batch as LiquidationBatch & { coverage?: LiquidationBatch['coverage'] } | undefined)?.coverage?.asOf ?? Date.now();
  }

  private openHistory() {
    const dialog = document.createElement('dialog'); dialog.className = 'indicator-settings'; dialog.setAttribute('aria-label', 'Liquidation history');
    const form = document.createElement('form'); form.className = 'indicator-settings-form'; const header = document.createElement('header');
    const title = document.createElement('h2'); title.textContent = 'Recorded liquidation history · UTC'; header.append(title, button('Close', () => dialog.close()));
    const fields = document.createElement('div'); fields.className = 'indicator-settings-fields'; const inputs: HTMLInputElement[] = [];
    for (const [label, time] of [['From UTC', Date.now() - 3600000], ['To UTC', Date.now()]] as const) {
      const item = document.createElement('label'); item.className = 'indicator-setting-field'; const name = document.createElement('span'); name.textContent = label;
      const input = document.createElement('input'); input.type = 'datetime-local'; input.required = true; input.value = new Date(time).toISOString().slice(0, 16); input.setAttribute('aria-label', label);
      item.append(name, input); fields.append(item); inputs.push(input);
    }
    const error = document.createElement('p'); error.className = 'dialog-status'; error.setAttribute('role', 'status');
    const footer = document.createElement('footer'); const apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'primary'; apply.textContent = 'Load history'; footer.append(button('Cancel', () => dialog.close()), apply);
    form.append(header, fields, error, footer); dialog.append(form); this.element.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true });
    form.onsubmit = event => {
      event.preventDefault(); const from = Date.parse(inputs[0]!.value + 'Z'), to = Date.parse(inputs[1]!.value + 'Z');
      if (!Number.isFinite(from + to) || from >= to || to - from > 7 * 86400000) { error.textContent = 'Choose a valid UTC range of at most seven days.'; return; }
      clearInterval(this.replayTimer); this.replayTimer = undefined;
      this.range = { from, to }; this.replayAt = from; this.frozen = undefined; this.paused = false;
      this.feed.updateLiquidations(this.props.api.id, this.request()); this.renderToolbar(); dialog.close(); this.scheduler.invalidate(this);
    };
    dialog.showModal();
  }

  private playReplay() {
    if (this.replayTimer) { clearInterval(this.replayTimer); this.replayTimer = undefined; }
    else if (this.range) {
      if (this.replayAt >= this.range.to) this.replayAt = this.range.from;
      this.replayTimer = setInterval(() => {
        if (!this.range) return;
        this.replayAt = Math.min(this.range.to, this.replayAt + 10000);
        this.feed.updateLiquidations(this.props.api.id, this.request()); this.scheduler.invalidate(this);
        if (this.replayAt >= this.range.to) { clearInterval(this.replayTimer); this.replayTimer = undefined; this.renderToolbar(); }
      }, 1000);
    }
    this.renderToolbar();
  }

  private returnToLive() {
    clearInterval(this.replayTimer); this.replayTimer = undefined; this.range = undefined; this.replayAt = 0;
    this.setPaused(false); this.feed.updateLiquidations(this.props.api.id, this.request()); this.renderToolbar();
  }

  draw() {
    if (this.dead || !this.visible) return;
    const batch = this.currentBatch = this.frozen ?? this.latest;
    if (!batch) { this.status.textContent = 'Loading recorded liquidation reports…'; return; }
    const light = currentTheme() === 'light';
    this.renderSummary(batch, light);
    this.renderStatus(batch);
    this.renderPinnedBursts(batch, light);
    this.renderTape(batch, light);
    this.renderInspector(batch);
    this.syncBurstHover(light);
  }

  private renderSummary(batch: LiquidationBatch, light: boolean) {
    this.summary.replaceChildren();
    const heading = document.createElement('span'); heading.className = 'liquidation-summary-heading'; heading.textContent = 'Reported notional · USDT';
    this.summary.append(heading);
    for (const window of Array.isArray(batch.summary) ? batch.summary : []) {
      const item = document.createElement('span'); item.className = 'liquidation-summary-window';
      const longs = document.createElement('strong'), shorts = document.createElement('strong');
      longs.textContent = `LONGS ${compactSize(window.longs)}`; shorts.textContent = `SHORTS ${compactSize(window.shorts)}`;
      longs.style.color = liquidationColour('LONG', light); shorts.style.color = liquidationColour('SHORT', light);
      item.append(document.createTextNode(`${window.windowMs / 60000}m `), longs, document.createTextNode(' / '), shorts);
      if (window.unknown) {
        const unknown = document.createElement('small'); unknown.className = 'liquidation-summary-unknown'; unknown.textContent = `? ${window.unknown}`;
        unknown.setAttribute('aria-label', `${window.unknown} reports have unknown notional; excluded, not zero.`); item.append(unknown);
      }
      item.setAttribute('aria-label', `${window.windowMs / 60000} minute reported notional: longs ${compactSize(window.longs)} USDT, shorts ${compactSize(window.shorts)} USDT${window.unknown ? `, ${window.unknown} unknown reports excluded` : ''}`);
      this.summary.append(item);
    }
  }

  private renderStatus(batch: LiquidationBatch) {
    const range = this.range, at = this.paused ? this.frozenClock ?? this.visualClock(batch) : this.visualClock(batch);
    const clock = this.paused ? `Paused snapshot · ${formatDateTime(at, this.displayZone, true)} ${timezoneName(getTimezonePreference(), this.displayZone)}`
      : range ? `Replay through ${formatDateTime(this.replayAt, this.displayZone, true)} ${timezoneName(getTimezonePreference(), this.displayZone)}` : '';
    const legacy = batch as LiquidationBatch & { coverage?: LiquidationBatch['coverage']; state?: LiquidationBatch['state']; message?: string; truncated?: boolean };
    const coverage = legacy.coverage ? liquidationCoverageText(legacy.coverage, this.settings.venues, range?.from ?? Date.now() - 900000, range?.to ?? Date.now(), legacy.truncated) : 'Source coverage unavailable';
    const text = [clock, legacy.state ?? 'loading', legacy.message ?? 'Liquidation batch is missing status details', coverage].filter(Boolean).join(' · ');
    this.status.textContent = text; this.status.title = text;
  }

  private renderPinnedBursts(batch: LiquidationBatch, light: boolean) {
    this.burstAnchors.clear();
    const show = this.settings.showBursts;
    this.activeBursts.hidden = !show;
    const candidates = show ? this.batchBursts(batch).filter(burst => burst.closedAt === null) : [];
    const activeBySide = new Map<LiquidatedSide, LiquidationBurst>();
    for (const burst of candidates) if (!activeBySide.has(burst.side)) activeBySide.set(burst.side, burst);
    for (const side of ['LONG', 'SHORT'] as const) {
      const slot = this.pinned.get(side)!; const burst = activeBySide.get(side);
      slot.slot.hidden = !burst;
      if (!burst) continue;
      updateBurstCard(slot.parts, burst, light); this.burstAnchors.set(burst.id, slot.parts.root); this.maybePulseBurst(burst, slot.parts.root, batch);
    }
    if (!show) for (const burst of Array.isArray(batch.burstAlerts) ? batch.burstAlerts : []) this.pulsed.add(`burst:${burst.id}`);
    this.activeBursts.hidden = !show || [...this.pinned.values()].every(item => item.slot.hidden);
  }

  private renderTape(batch: LiquidationBatch, light: boolean) {
    const reports = this.batchEvents(batch).filter(event => (!this.range || event.timeMs <= this.replayAt) && this.settings.venues.includes(event.venue)
      && (this.settings.side === 'BOTH' || this.settings.side === event.liquidatedSide));
    const completed = this.settings.showBursts ? this.batchBursts(batch).filter(burst => burst.closedAt !== null) : [];
    const merged: TapeRow[] = [
      ...reports.map(event => ({ key: `event:${event.id}`, id: event.id, time: event.timeMs, kind: 'report' as const, event })),
      ...completed.map(burst => ({ key: `burst:${burst.id}`, id: burst.id, time: burst.to, kind: 'burst' as const, burst })),
    ].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
    const reportMaximum = Math.max(0, ...reports.map(event => event.quoteNotional ?? 0));
    const prefix = new Array<number>(merged.length + 1); prefix[0] = 0;
    for (let i = 0; i < merged.length; i++) prefix[i + 1] = prefix[i]! + (this.tapeHeights.get(merged[i]!.key) ?? (merged[i]!.kind === 'burst' ? BURST_ROW_ESTIMATE : REPORT_ROW_ESTIMATE));
    const firstY = Math.max(0, this.viewport.scrollTop - TAPE_HEADER_HEIGHT), endY = firstY + Math.max(this.viewport.clientHeight, REPORT_ROW_ESTIMATE * 6);
    const locate = (y: number) => { let low = 0, high = merged.length; while (low < high) { const middle = (low + high) >>> 1; if (prefix[middle + 1]! <= y) low = middle + 1; else high = middle; } return low; };
    const start = Math.max(0, locate(firstY) - 3), stop = Math.min(merged.length, Math.max(start + 1, locate(endY) + 4), start + REPORT_RENDER_LIMIT);
    const visibleIndices = Array.from({ length: Math.max(0, stop - start) }, (_, i) => start + i);
    const activeElement = document.activeElement instanceof Element ? document.activeElement.closest<HTMLTableRowElement>('[data-tape-key]') : null;
    const focusedIndex = activeElement ? merged.findIndex(item => item.key === activeElement.dataset.tapeKey) : -1;
    if (focusedIndex >= 0 && !visibleIndices.includes(focusedIndex)) visibleIndices.push(focusedIndex);
    visibleIndices.sort((a, b) => a - b);
    const wantedReports = new Set<string>(), wantedBursts = new Set<string>();
    for (const index of visibleIndices) { const item = merged[index]; if (item?.event) wantedReports.add(item.event.id); else if (item?.burst) wantedBursts.add(item.burst.id); }
    for (const [id, row] of this.eventRows) if (!wantedReports.has(id)) {
      this.releaseReportRow(id, row); this.eventRows.delete(id);
      if (this.reportRowPool.length < REPORT_RENDER_LIMIT) this.reportRowPool.push(row);
    }
    for (const [id, entry] of this.burstRows) if (!wantedBursts.has(id)) {
      this.releaseBurstRow(id, entry); this.burstRows.delete(id);
      if (this.burstRowPool.length < REPORT_RENDER_LIMIT) this.burstRowPool.push(entry);
    }
    const desired: HTMLTableRowElement[] = [];
    const spacer = (height: number) => { const row = document.createElement('tr'), cell = document.createElement('td'); row.className = 'liquidation-tape-spacer'; row.setAttribute('aria-hidden', 'true'); cell.colSpan = columns.length; cell.style.height = `${Math.max(0, height)}px`; cell.style.padding = '0'; cell.style.border = '0'; row.append(cell); return row; };
    let consumed = 0;
    for (const index of visibleIndices) {
      if (index > consumed) desired.push(spacer(prefix[index]! - prefix[consumed]!));
      const item = merged[index]!;
      if (item.event) {
        const row = this.eventRows.get(item.event.id) ?? this.reportRowPool.pop() ?? this.createReportRow(item.event);
        row.className = 'ticker-row liquidation-report-row';
        this.eventRows.set(item.event.id, row); this.updateReportRow(row, item.event, light, batch, reportMaximum); this.maybePulseReport(item.event, row, batch); desired.push(row);
      } else if (item.burst) {
        const entry = this.burstRows.get(item.burst.id) ?? this.burstRowPool.pop() ?? this.createBurstTableRow(item.burst);
        entry.row.className = 'liquidation-completed-row';
        this.burstRows.set(item.burst.id, entry); updateBurstCard(entry.parts, item.burst, light); this.burstAnchors.set(item.burst.id, entry.parts.root);
        this.maybePulseBurst(item.burst, entry.parts.root, batch); desired.push(entry.row);
      }
      const row = desired.at(-1); if (row?.dataset.tapeKey !== item.key) row!.dataset.tapeKey = item.key;
      consumed = index + 1;
    }
    if (consumed < merged.length) desired.push(spacer(prefix[merged.length]! - prefix[consumed]!));
    const tapeKeys = new Set(merged.map(item => item.key)); for (const key of this.tapeHeights.keys()) if (!tapeKeys.has(key)) this.tapeHeights.delete(key);
    this.reconcileTableBody(desired);
    for (const index of visibleIndices) {
      const item = merged[index]!; const row = item.event ? this.eventRows.get(item.event.id) : item.burst ? this.burstRows.get(item.burst.id)?.row : undefined;
      const measured = row?.getBoundingClientRect().height; if (measured && measured > 0) this.tapeHeights.set(item.key, measured);
    }
    if (!desired.length) this.renderEmpty(batch);
    else this.tbody.querySelector('.ticker-empty')?.closest('tr')?.remove();
    this.table.style.minWidth = '0';
    this.syncColumns();
    this.setRovingReportRow();
  }

  private releaseReportRow(id: string, row: HTMLTableRowElement) {
    void id; row.classList.remove('trade-pulse'); row.remove(); delete row.dataset.tapeKey; delete row.dataset.eventId; delete row.dataset.side; delete row.dataset.forced; row.removeAttribute('title'); row.removeAttribute('aria-label'); row.removeAttribute('aria-description'); row.style.removeProperty('--liquidation-report-width'); row.style.removeProperty('--liquidation-report-color');
  }

  private releaseBurstRow(id: string, entry: BurstTableRow) {
    entry.parts.root.classList.remove('liquidation-burst-pulse'); entry.row.remove(); delete entry.row.dataset.tapeKey; delete entry.row.dataset.burstId; this.burstAnchors.delete(id);
  }

  private reconcileTableBody(desired: HTMLTableRowElement[]) {
    let cursor = this.tbody.firstElementChild;
    for (const row of desired) {
      if (row === cursor) cursor = cursor.nextElementSibling;
      else this.tbody.insertBefore(row, cursor);
    }
    while (cursor) { const next = cursor.nextElementSibling; cursor.remove(); cursor = next; }
  }

  private createReportRow(event: LiquidationEvent) {
    const row = document.createElement('tr'); row.className = 'ticker-row liquidation-report-row'; row.dataset.eventId = event.id; row.tabIndex = -1;
    for (const column of columns) { const cell = document.createElement('td'); cell.dataset.column = column.id; row.append(cell); }
    row.addEventListener('keydown', key => { if (key.key === 'Enter') { const report = this.eventForRow(row); if (report) { key.preventDefault(); this.focusChart(report); } } });
    row.addEventListener('dblclick', key => { const report = this.eventForRow(row); if (report) { key.preventDefault(); key.stopPropagation(); this.focusChart(report); } });
    return row;
  }

  private updateReportRow(row: HTMLTableRowElement, event: LiquidationEvent, light: boolean, batch: LiquidationBatch, reportMaximum: number) {
    const price = event.reportedPrice.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const notional = this.settings.units === 'USDT' ? event.quoteNotional === null ? 'Unknown' : `${compactSize(event.quoteNotional)} USDT` : `${compactSize(event.baseQuantity)} BTC`;
    const cells: Record<string, string> = { time: liquidationTime(event.timeMs, this.displayZone), venue: event.venue.toUpperCase(), side: event.liquidatedSide, notional,
      price: `${price} USDT`, quantity: `${compactSize(event.baseQuantity)} BTC` };
    for (const cell of row.cells) { const id = cell.dataset.column!; cell.textContent = cells[id] ?? ''; }
    let tier: typeof this.settings.tiers[number] | undefined;
    for (const value of this.settings.tiers) { const size = liquidationValue(event, value.unit); if (size !== null && size >= value.minimum) tier = value; }
    const color = tier ? event.liquidatedSide === 'LONG' ? tier.sellColor : tier.buyColor : liquidationColour(event.liquidatedSide, light);
    row.style.color = this.reportInk(color, light); row.dataset.side = event.liquidatedSide; row.dataset.forced = event.forcedDirection;
    row.style.setProperty('--liquidation-report-width', `${event.quoteNotional !== null && reportMaximum > 0 ? Math.min(100, event.quoteNotional / reportMaximum * 100) : 0}%`);
    row.style.setProperty('--liquidation-report-color', this.reportInk(color, light));
    row.dataset.eventId = event.id; row.title = liquidationText(event);
    row.setAttribute('aria-label', `${event.venue.toUpperCase()} ${event.liquidatedSide} liquidation · ${formatDateTime(event.timeMs, this.displayZone, true)} ${timezoneName(getTimezonePreference(), this.displayZone)} · ${event.quoteNotional === null ? 'unknown notional' : compactSize(event.quoteNotional) + ' USDT'} · press Enter to focus chart at this report time`);
    row.setAttribute('aria-description', 'Press Enter or double-click to focus the chart at this individual report time.');
    this.syncReportColumns(row);
  }

  private reportInk(color: string, light: boolean) {
    // The existing tier palette is retained; contrast correction only affects this rendered label.
    return liquidationInk(color, light);
  }

  private createBurstTableRow(burst: LiquidationBurst): BurstTableRow {
    const row = document.createElement('tr'); row.className = 'liquidation-completed-row'; row.dataset.burstId = burst.id;
    const cell = document.createElement('td'); cell.colSpan = columns.length; cell.className = 'liquidation-burst-cell';
    const parts = createBurstCard('tape', item => this.openInspector(item.id, 'constituents'), item => this.openInspector(item.id, 'quality')); cell.append(parts.root); row.append(cell); return { row, parts };
  }

  private renderEmpty(batch: LiquidationBatch) {
    let row = this.tbody.querySelector<HTMLTableRowElement>('.liquidation-empty-row');
    if (!row) { row = document.createElement('tr'); row.className = 'liquidation-empty-row'; const cell = document.createElement('td'); cell.colSpan = columns.length; cell.className = 'ticker-empty'; row.append(cell); this.tbody.append(row); }
    const cell = row.cells[0]!; cell.textContent = this.range ? `No matching reports through ${formatDateTime(this.replayAt, this.displayZone, true)}` : this.settings.venues.length ? 'No reported liquidations match the filter' : 'Select a liquidation venue';
    const legacy = batch as LiquidationBatch & { state?: LiquidationBatch['state']; message?: string };
    cell.title = legacy.state === 'loading' ? 'Loading recorded liquidation reports' : legacy.message ?? 'Status unavailable';
  }

  private setRovingReportRow() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLTableRowElement>('.liquidation-report-row') : null;
    const reports = [...this.tbody.querySelectorAll<HTMLTableRowElement>('.liquidation-report-row')];
    for (const [index, row] of reports.entries()) row.tabIndex = row === focused || !focused && index === 0 ? 0 : -1;
  }

  private onTapeKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest<HTMLTableRowElement>('.liquidation-report-row'); if (!row) return;
    const reports = [...this.tbody.querySelectorAll<HTMLTableRowElement>('.liquidation-report-row')], index = reports.indexOf(row);
    const next = reports[index + (event.key === 'ArrowDown' ? 1 : -1)]; if (!next) return;
    event.preventDefault(); next.tabIndex = 0; row.tabIndex = -1; next.focus();
  }

  private reportRowFromEvent(event: Event) { const target = event.target instanceof Element ? event.target.closest<HTMLTableRowElement>('.liquidation-report-row') : null; return target && this.tbody.contains(target) ? target : null; }
  private batchEvents(batch?: LiquidationBatch) {
    const events = (batch as LiquidationBatch & { events?: unknown[] } | undefined)?.events;
    return Array.isArray(events) ? events.filter((event): event is LiquidationEvent => !!event && typeof event === 'object' && typeof (event as LiquidationEvent).id === 'string' && Number.isFinite((event as LiquidationEvent).timeMs)) : [];
  }
  private batchBursts(batch?: LiquidationBatch) {
    const bursts = (batch as LiquidationBatch & { bursts?: unknown[] } | undefined)?.bursts;
    return Array.isArray(bursts) ? bursts.filter((burst): burst is LiquidationBurst => !!burst && typeof burst === 'object' && typeof (burst as LiquidationBurst).id === 'string' && ((burst as LiquidationBurst).side === 'LONG' || (burst as LiquidationBurst).side === 'SHORT') && Number.isFinite((burst as LiquidationBurst).from) && Number.isFinite((burst as LiquidationBurst).to)) : [];
  }
  private eventForRow(row: HTMLTableRowElement) { return this.batchEvents(this.currentBatch).find(event => event.id === row.dataset.eventId); }
  private burstIdFromTarget(target: EventTarget | null) { return target instanceof Element ? target.closest<HTMLElement>('[data-burst-id]')?.dataset.burstId ?? null : null; }

  private maybePulseBurst(burst: LiquidationBurst, root: HTMLElement, batch: LiquidationBatch) {
    const key = `burst:${burst.id}`;
    if (this.paused || matchMedia('(prefers-reduced-motion: reduce)').matches || this.pulsed.has(key) || !Array.isArray(batch.burstAlerts) || !batch.burstAlerts.some(alert => alert.id === burst.id)) return;
    this.pulsed.add(key); root.classList.add('liquidation-burst-pulse');
    this.limitPulses();
  }

  private maybePulseReport(event: LiquidationEvent, row: HTMLTableRowElement, batch: LiquidationBatch) {
    const key = `event:${event.id}`, tier = [...this.settings.tiers].reverse().find(item => { const value = liquidationValue(event, item.unit); return value !== null && value >= item.minimum; });
    if (this.paused || matchMedia('(prefers-reduced-motion: reduce)').matches || !tier?.pulse || this.pulsed.has(key) || !Array.isArray(batch.alerts) || !batch.alerts.some(alert => alert.event.id === event.id)) return;
    this.pulsed.add(key); row.classList.add('trade-pulse');
    this.limitPulses();
  }

  private limitPulses() { while (this.pulsed.size > 8192) this.pulsed.delete(this.pulsed.values().next().value!); }

  private syncBurstHover(light = currentTheme() === 'light') {
    const id = this.focusBurstId ?? this.pointerBurstId, batch = this.currentBatch;
    if (!id || !batch || this.dead || !this.visible || !this.settings.showBursts || (!this.focusBurstId && this.hoverPointerType === 'touch')) { this.tooltipDwell.clear(); this.hoverCard.hidden = true; return; }
    const render = () => {
      if (this.dead || !this.visible || (this.focusBurstId ?? this.pointerBurstId) !== id) return;
      const burst = this.batchBursts(batch).find(item => item.id === id), anchor = this.burstAnchors.get(id);
      if (!burst || !anchor?.isConnected) { this.hoverCard.hidden = true; return; }
      renderBurstHoverCard(this.hoverCard, burst, { timezone: this.displayZone, paused: this.paused, light });
      positionMarketCard(this.hoverCard, this.element, anchor.getBoundingClientRect());
    };
    if (this.focusBurstId === id) { this.tooltipDwell.clear(); render(); return; }
    const ready = this.tooltipDwell.request(id, render); this.hoverCard.hidden = !ready; if (ready) render();
  }

  private buildInspector() {
    this.inspector.className = 'indicator-settings liquidation-burst-inspector'; this.inspector.setAttribute('aria-label', 'Liquidation burst details');
    this.inspectorForm.className = 'indicator-settings-form'; this.inspectorForm.onsubmit = event => event.preventDefault();
    const header = document.createElement('header'); this.inspectorTitle.textContent = 'Burst constituents'; header.append(this.inspectorTitle, button('Close', () => this.inspector.close()));
    this.inspectorSummary.className = 'liquidation-burst-inspector-summary';
    this.inspectorNote.className = 'dialog-status liquidation-burst-inspector-note'; this.inspectorNote.setAttribute('role', 'status');
    this.inspectorEvidence.className = 'liquidation-burst-inspector-evidence'; this.inspectorEvidence.setAttribute('aria-live', 'polite');
    const modes = document.createElement('div'); modes.className = 'liquidation-burst-inspector-modes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Burst detail view');
    for (const [mode, label] of [['constituents', 'Constituents'], ['quality', 'Coverage evidence']] as const) {
      const control = button(label, () => { if (this.inspectorBurstId) this.openInspector(this.inspectorBurstId, mode); });
      control.dataset.mode = mode; control.setAttribute('aria-pressed', 'false'); this.inspectorModeButtons.set(mode, control); modes.append(control);
    }
    this.inspectorViewport.className = 'liquidation-burst-inspector-viewport';
    const table = document.createElement('table'); table.className = 'liquidation-constituent-table'; const head = document.createElement('thead'), row = document.createElement('tr');
    for (const text of ['Time', 'Venue', 'Position', 'Reported USDT', 'Price', 'Quantity', 'Chart']) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = text; row.append(cell); }
    head.append(row); table.append(head, this.inspectorBody); this.inspectorViewport.append(table);
    const footer = document.createElement('footer'); footer.append(button('Close', () => this.inspector.close()));
    this.inspectorForm.append(header, this.inspectorSummary, modes, this.inspectorNote, this.inspectorEvidence, this.inspectorViewport, footer); this.inspector.append(this.inspectorForm); this.element.append(this.inspector);
    this.inspector.addEventListener('close', () => {
      const target = this.inspectorReturnFocus; this.inspectorReturnFocus = undefined; this.inspectorBurstId = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }, { signal: this.abort.signal });
  }

  private openInspector(id: string, mode: 'constituents' | 'quality' = 'constituents') {
    this.inspectorBurstId = id; this.inspectorMode = mode; this.hoverCard.hidden = true; this.tooltipDwell.clear();
    if (!this.inspector.open) { this.inspectorReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; this.inspector.showModal(); }
    this.renderInspector(this.currentBatch ?? this.frozen ?? this.latest);
  }

  private renderInspector(batch?: LiquidationBatch) {
    if (!this.inspector.open || !this.inspectorBurstId || !batch) return;
    const burst = this.batchBursts(batch).find(item => item.id === this.inspectorBurstId);
    for (const [mode, control] of this.inspectorModeButtons) control.setAttribute('aria-pressed', String(mode === this.inspectorMode));
    if (!burst) { this.inspectorTitle.textContent = 'Burst summary no longer retained'; this.inspectorSummary.textContent = ''; this.inspectorNote.textContent = 'This summary has rolled out of the bounded tape history.'; this.inspectorEvidence.replaceChildren(); this.inspectorViewport.hidden = true; this.reconcileInspectorRows([]); return; }
    const snapshot = burst as LiquidationBurst & { state?: LiquidationBurst['state']; closedAt?: number | null; quality?: LiquidationBurst['quality']; coverageGap?: boolean; retainedEventCount?: number; events?: LiquidationEvent[] };
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const quality = snapshot.quality === 'complete' && snapshot.state === 'completed' ? 'OBSERVED' : 'PARTIAL / UNKNOWN';
    this.inspectorTitle.textContent = `${burst.side} burst · ${labelForBurst(snapshot)} · ${this.inspectorMode === 'quality' ? 'coverage evidence' : 'constituents'}`;
    const average = Number.isFinite(burst.notional) && burst.to - burst.from >= 1000 ? `${compactSize(burst.notional / ((burst.to - burst.from) / 1000))} USDT/s` : 'Unavailable (<1s span or total unavailable)';
    const total = Number.isFinite(burst.notional) ? `${compactSize(burst.notional)} USDT` : 'Reported total unavailable';
    const exactStart = formatLiquidationExactTime(burst.from, this.displayZone), exactEnd = formatLiquidationExactTime(burst.to, this.displayZone), zone = timezoneName(getTimezonePreference(), this.displayZone);
    this.inspectorSummary.textContent = `Start ${exactStart} · End ${exactEnd} · ${zone} · ${total} · ${Number.isFinite(burst.count) ? `${burst.count} priced reports` : 'report count unavailable'} · ${durationLabel(burst.to - burst.from)} · avg ${average}`;
    const retained = Number.isFinite(snapshot.retainedEventCount) ? `${snapshot.retainedEventCount} of ${burst.count}` : 'unavailable';
    this.inspectorNote.textContent = this.inspectorMode === 'constituents'
      ? `Showing ${events.length} latest constituents from this batch; detector retention ${retained}. Burst total includes the qualifying lifetime reports. Chart focus anchors one report time, not the full burst range.`
      : `${quality} · quiet window ${this.settings.burst.windowMs / 1000}s after the final report. Empty intervals outside verified coverage are unknown, not zero.`;
    this.inspectorViewport.hidden = this.inspectorMode !== 'constituents'; this.inspectorEvidence.hidden = this.inspectorMode !== 'quality';
    if (this.inspectorMode === 'quality') this.renderQualityEvidence(burst, batch, snapshot);
    else this.renderConstituentEvidence(burst, batch);
    this.reconcileInspectorRows(this.inspectorMode === 'constituents' ? [...events].sort((a, b) => b.timeMs - a.timeMs || a.id.localeCompare(b.id)) : []);
  }

  private renderQualityEvidence(burst: LiquidationBurst, batch: LiquidationBatch, snapshot: LiquidationBurst & { state?: LiquidationBurst['state']; closedAt?: number | null; quality?: LiquidationBurst['quality']; coverageGap?: boolean; retainedEventCount?: number; events?: LiquidationEvent[] }) {
    const add = (text: string, className = 'liquidation-burst-evidence-line') => { const row = document.createElement('div'); row.className = className; row.textContent = text; this.inspectorEvidence.append(row); };
    this.inspectorEvidence.replaceChildren();
    const from = burst.from, end = burst.to + this.settings.burst.windowMs;
    add(snapshot.quality === 'complete' && snapshot.state === 'completed' ? 'Observed-feed quiet proof covers the burst through its configured quiet interval.' : 'The full quiet interval is not confirmed; gaps may contain unobserved reports.', 'liquidation-burst-evidence-heading');
    add(`Burst reports ${formatLiquidationExactTime(from, this.displayZone)}–${formatLiquidationExactTime(burst.to, this.displayZone)} · quiet check through ${formatLiquidationExactTime(end, this.displayZone)} ${timezoneName(getTimezonePreference(), this.displayZone)}.`);
    const coverage = (batch as LiquidationBatch & { coverage?: LiquidationBatch['coverage'] }).coverage;
    const sources = Array.isArray(coverage?.sources) ? coverage.sources : [];
    for (const venue of this.settings.venues) {
      const source = sources.find(item => item.venue === venue);
      if (!source) { add(`${venue.toUpperCase()} · source coverage is unavailable for this batch; quiet is unverified.`); continue; }
      add(`${venue.toUpperCase()} · ${source.state.toUpperCase()} now · observed from ${formatLiquidationExactTime(source.observedFrom, this.displayZone)} · verified through ${formatLiquidationExactTime(source.verifiedThrough, this.displayZone)}.`);
      const gaps = Array.isArray(source.gaps) ? source.gaps.filter(gap => gap.from < end && gap.to > from) : [];
      if (!gaps.length) add(`${venue.toUpperCase()} · no recorded source gap overlaps the burst or quiet-check interval.`);
      for (const gap of gaps) add(`${venue.toUpperCase()} · unknown ${formatLiquidationExactTime(Math.max(from, gap.from), this.displayZone)}–${formatLiquidationExactTime(Math.min(end, gap.to), this.displayZone)} · ${gap.reason}`, 'liquidation-burst-evidence-gap');
    }
    if (snapshot.coverageGap) add('A recorded source gap overlaps this burst or its quiet-check interval.', 'liquidation-burst-evidence-gap');
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    add(`The batch carries ${events.length} latest constituents; detector retention ${Number.isFinite(snapshot.retainedEventCount) ? `${snapshot.retainedEventCount} of ${burst.count} priced reports` : 'is unavailable for this batch'}.`);
    add('Reported notional is not verified unique liquidation volume. Binance reports are sampled cumulative snapshots and may overlap. This total is reported activity, not verified unique liquidation volume.');
    if (burst.venues.bybit !== undefined) add('Bybit notional uses bankruptcy price multiplied by reported size; it is not execution proceeds.');
    add('Reports with unknown notional are excluded from the priced burst total, not treated as zero. A quiet source does not prove there were no liquidations.');
    const legacy = batch as LiquidationBatch & { truncated?: boolean; dropped?: number };
    if (legacy.truncated || legacy.dropped) add(`History/transport retention is bounded${legacy.dropped ? `; ${legacy.dropped} shared-cache events were dropped` : ''}. Earlier reports may be omitted.`, 'liquidation-burst-evidence-gap');
  }

  private renderConstituentEvidence(burst: LiquidationBurst, batch: LiquidationBatch) {
    this.inspectorEvidence.replaceChildren();
    for (const venue of ['bybit', 'binance'] as const) {
      const amount = burst.venues[venue]; if (!Number.isFinite(amount)) continue;
      const share = burst.notional > 0 ? amount! / burst.notional : null;
      const line = document.createElement('div'); line.className = 'liquidation-burst-evidence-line'; line.textContent = `${venue.toUpperCase()} · ${compactSize(amount!)} USDT · ${share === null ? 'share unavailable' : `${(share * 100).toFixed(1)}% of reported notional`}`; this.inspectorEvidence.append(line);
    }
    if (burst.venues.binance !== undefined) { const note = document.createElement('div'); note.className = 'liquidation-burst-evidence-line'; note.textContent = 'Binance reports are sampled cumulative snapshots and may overlap. This total is reported activity, not verified unique liquidation volume.'; this.inspectorEvidence.append(note); }
    if (burst.venues.bybit !== undefined) { const note = document.createElement('div'); note.className = 'liquidation-burst-evidence-line'; note.textContent = 'Bybit notional uses bankruptcy-price valuation, not execution proceeds.'; this.inspectorEvidence.append(note); }
    const legacy = batch as LiquidationBatch & { truncated?: boolean; dropped?: number };
    if (legacy.truncated || legacy.dropped) { const note = document.createElement('div'); note.className = 'liquidation-burst-evidence-gap'; note.textContent = `History/transport retention is bounded${legacy.dropped ? `; ${legacy.dropped} shared-cache events were dropped` : ''}.`; this.inspectorEvidence.append(note); }
  }

  private reconcileInspectorRows(events: LiquidationEvent[]) {
    const desired: HTMLTableRowElement[] = [], ids = new Set<string>();
    for (const event of events) {
      ids.add(event.id); let row = this.inspectorRows.get(event.id);
      if (!row) { row = document.createElement('tr'); row.dataset.eventId = event.id; for (let i = 0; i < 7; i++) row.append(document.createElement('td')); this.inspectorRows.set(event.id, row); }
      const cells = [...row.cells]; cells[0]!.textContent = formatLiquidationExactTime(event.timeMs, this.displayZone); cells[1]!.textContent = event.venue.toUpperCase(); cells[2]!.textContent = event.liquidatedSide;
      cells[3]!.textContent = event.quoteNotional === null ? 'Unknown' : `${compactSize(event.quoteNotional)} USDT`; cells[4]!.textContent = `${event.reportedPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT`; cells[5]!.textContent = `${compactSize(event.baseQuantity)} BTC`;
      let focus = cells[6]!.querySelector<HTMLButtonElement>('button');
      if (!focus) { focus = button('Focus report', () => { const report = this.eventForInspectorRow(row!); if (report) this.focusChart(report); }); cells[6]!.append(focus); }
      focus.setAttribute('aria-label', `Focus chart at ${event.venue} report time ${formatLiquidationExactTime(event.timeMs, this.displayZone)}`); row.setAttribute('aria-label', liquidationText(event)); desired.push(row);
    }
    for (const [id, row] of this.inspectorRows) if (!ids.has(id)) { row.remove(); this.inspectorRows.delete(id); }
    this.reconcileTbody(this.inspectorBody, desired);
  }

  private eventForInspectorRow(row: HTMLTableRowElement) { const burst = this.batchBursts(this.currentBatch).find(item => item.id === this.inspectorBurstId); const events = (burst as LiquidationBurst & { events?: LiquidationEvent[] } | undefined)?.events; return Array.isArray(events) ? events.find(event => event.id === row.dataset.eventId) : undefined; }

  private reconcileTbody(tbody: HTMLTableSectionElement, desired: HTMLTableRowElement[]) {
    let cursor = tbody.firstElementChild;
    for (const row of desired) { if (row === cursor) cursor = cursor.nextElementSibling; else tbody.insertBefore(row, cursor); }
    while (cursor) { const next = cursor.nextElementSibling; cursor.remove(); cursor = next; }
  }

  diagnostics() {
    return { settings: this.settings, paused: this.paused, replay: this.range, rows: this.tbody.rows.length, reportRows: this.eventRows.size, pooledRows: this.reportRowPool.length + this.burstRowPool.length,
      summaryRows: this.burstRows.size, pinnedBursts: [...this.pinned.values()].filter(slot => !slot.slot.hidden).map(slot => slot.parts.burst?.id),
      inspectorOpen: this.inspector.open, batch: this.latest };
  }

  dispose() {
    this.dead = true; this.tooltipDwell.dispose(); this.release?.(); this.abort.abort(); clearInterval(this.refreshTimer); clearInterval(this.replayTimer);
    this.listeners.forEach(listener => listener.dispose()); this.controls.dispose(); this.picker.dispose(); this.scheduler.remove(this);
    if (this.inspector.open) this.inspector.close(); this.inspector.remove(); this.hoverCard.remove(); this.notifications.release(this.props.api.id);
  }
}

function durationLabel(milliseconds: number) { return milliseconds < 1000 ? '<1s' : `${(milliseconds / 1000).toFixed(1).replace(/\.0$/, '')}s`; }
function labelForBurst(burst: LiquidationBurst) { return burst.closedAt === null ? burst.state === 'uncertain' ? 'UNCERTAIN' : 'ACTIVE' : burst.state === 'completed' ? 'COMPLETED' : 'UNCERTAIN'; }
