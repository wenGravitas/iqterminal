import type { Chart } from 'openalgo-charts';
import type { Drawable, Scheduler } from '../chart/scheduler';
import { getDisplayTimezone } from '../timezone';
import { TooltipDwell } from '../tooltip-dwell';
import { CVD_ID } from '../feed/cvd';
import { OPEN_INTEREST_ID } from './open-interest-data';

export type OrderFlowSource = 'cvd' | 'open-interest' | 'volume' | 'sma';
export interface OrderFlowRow {
  key: string;
  source: OrderFlowSource;
  id: string;
  name: string;
  value: number | null;
  unit: string | null;
  color: string;
  scale: 'L' | 'R' | 'V';
  hidden?: boolean;
  canToggle?: boolean;
  detail?: string;
  quality?: string;
}
export interface OrderFlowPaneState {
  paneIndex: number;
  rows: OrderFlowRow[];
  summary: string;
  cvdMode?: 'venues' | 'aggregations';
  hasCvd?: boolean;
  hasOpenInterest?: boolean;
  hasVolume?: boolean;
  volumeBandHeightPercent?: number;
}
export interface OrderFlowPaneActions {
  setCvdMode(mode: 'venues' | 'aggregations'): void;
  openCvdSettings(): void;
  openOpenInterestSettings(): void;
  toggleLine(row: OrderFlowRow): void;
  paneAction(action: string, paneIndex: number): void;
  indicatorAction(event: MouseEvent): void;
  indicatorContextMenu(event: MouseEvent): void;
}

/** One compact DOM chrome layer for a managed CVD/Open Interest/Volume pane. */
export class OrderFlowPaneView implements Drawable {
  visible = true;
  private dead = false;
  private pane?: HTMLElement;
  private paneIndex = -1;
  private hoverTime?: number;
  private hoverPaneIndex?: number;
  private hoverPointerType?: string;
  private hoverPointerDown = false;
  private tooltipBlockedUntilMove = false;
  private paneHoverAbort?: AbortController;
  private tooltipDwell = new TooltipDwell();
  private abort = new AbortController();
  private releases: (() => void)[] = [];
  private root = document.createElement('div');
  private header = document.createElement('div');
  private paneControls = document.createElement('span');
  private title = document.createElement('strong');
  private indicatorActions = document.createElement('div');
  private modeGroup = document.createElement('span');
  private cvdSettings = document.createElement('button');
  private oiSettings = document.createElement('button');
  private legend = document.createElement('div');
  private status = document.createElement('div');
  private tooltip = document.createElement('div');
  private lineButtons = new Map<string, HTMLButtonElement>();
  private paneControlHome?: HTMLElement;
  private paneControlButtons: HTMLButtonElement[] = [];
  private indicatorActionDefinitions = new Set<string>();

  constructor(private readonly chart: Chart, private readonly container: HTMLElement, private readonly scheduler: Scheduler,
    private readonly state: (time?: number) => OrderFlowPaneState, private readonly actions: OrderFlowPaneActions) {
    this.root.className = 'order-flow-chrome';
    this.root.dataset.orderFlowChrome = 'true';
    this.header.className = 'order-flow-header';
    this.header.setAttribute('role', 'group');
    this.header.setAttribute('aria-label', 'Order Flow pane');
    this.title.textContent = 'Order Flow';
    this.paneControls.className = 'order-flow-pane-controls';
    this.indicatorActions.className = 'order-flow-indicator-actions';
    this.indicatorActions.setAttribute('role', 'group'); this.indicatorActions.setAttribute('aria-label', 'Order Flow indicators');
    this.modeGroup.className = 'order-flow-modes';
    for (const [mode, short, label] of [['venues', 'V', 'CVD venue lines'], ['aggregations', 'A', 'CVD aggregation lines']] as const) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'order-flow-action'; button.dataset.cvdMode = mode;
      button.textContent = short; button.title = label; button.setAttribute('aria-label', label);
      button.addEventListener('click', event => { event.stopPropagation(); this.actions.setCvdMode(mode); }, { signal: this.abort.signal });
      this.modeGroup.append(button);
    }
    this.cvdSettings.type = 'button'; this.cvdSettings.className = 'order-flow-action'; this.cvdSettings.textContent = 'CVD';
    this.cvdSettings.setAttribute('aria-label', 'Multi-Venue CVD settings'); this.cvdSettings.title = 'CVD sources and anchor';
    this.cvdSettings.addEventListener('click', event => { event.stopPropagation(); this.cancelTooltip(); this.actions.openCvdSettings(); }, { signal: this.abort.signal });
    this.oiSettings.type = 'button'; this.oiSettings.className = 'order-flow-action'; this.oiSettings.textContent = 'OI';
    this.oiSettings.setAttribute('aria-label', 'Open Interest settings'); this.oiSettings.title = 'Open Interest sources and unit provenance';
    this.oiSettings.addEventListener('click', event => { event.stopPropagation(); this.cancelTooltip(); this.actions.openOpenInterestSettings(); }, { signal: this.abort.signal });
    this.legend.className = 'order-flow-legend'; this.legend.setAttribute('role', 'group'); this.legend.setAttribute('aria-label', 'Order Flow values');
    this.status.className = 'order-flow-status'; this.status.setAttribute('role', 'status');
    this.tooltip.className = 'order-flow-tooltip'; this.tooltip.hidden = true; this.tooltip.setAttribute('role', 'tooltip');
    this.header.append(this.title, this.paneControls, this.modeGroup, this.indicatorActions, this.cvdSettings, this.oiSettings, this.legend);
    this.root.append(this.header, this.status, this.tooltip);
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'keydown']) {
      this.root.addEventListener(type, event => event.stopPropagation(), { signal: this.abort.signal });
    }
    this.header.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-pane-action]');
      if (button) {
        event.stopPropagation();
        if (!button.disabled) this.actions.paneAction(button.dataset.paneAction ?? '', this.paneIndex);
        return;
      }
      if ((event.target as Element).closest('button[data-indicator-action]')) {
        event.stopPropagation(); this.actions.indicatorAction(event);
      }
    }, { signal: this.abort.signal });
    this.header.addEventListener('contextmenu', event => {
      if ((event.target as Element).closest('.active-indicator')) this.actions.indicatorContextMenu(event);
    }, { signal: this.abort.signal });
    this.legend.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-order-flow-row]');
      const key = button?.dataset.orderFlowRow;
      const row = key ? this.rowsForLastDraw.find(item => item.key === key) : undefined;
      if (!row?.canToggle) return;
      event.stopPropagation(); this.actions.toggleLine(row);
    }, { signal: this.abort.signal });
    this.releases.push(chart.subscribeCrosshairMove(event => {
      this.hoverPaneIndex = event.paneIndex ?? undefined;
      this.hoverTime = event.time == null ? undefined : event.time * 1000;
      if (!this.visible || this.hoverPaneIndex !== this.paneIndex || this.hoverTime === undefined || this.hoverPointerType === 'touch' || this.hoverPointerDown || this.tooltipBlockedUntilMove) this.cancelTooltip();
      else {
        const ready = this.tooltipDwell.request('order-flow', () => {
          if (this.dead || !this.visible || this.hoverPaneIndex !== this.paneIndex || this.hoverTime === undefined || this.hoverPointerType === 'touch' || this.hoverPointerDown || this.tooltipBlockedUntilMove) return;
          this.invalidate();
        });
        this.tooltip.hidden = !ready;
      }
      this.invalidate();
    }), chart.on('resize', () => this.invalidate()), chart.on('paneResized', () => this.invalidate()),
    chart.on('pan', () => this.invalidate()), chart.on('zoom', () => this.invalidate()));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancelTooltip(); }, { signal: this.abort.signal });
  }

  private rowsForLastDraw: OrderFlowRow[] = [];

  setPane(paneIndex: number) {
    if (this.dead) return false;
    const pane = this.chart.panes()[paneIndex]?.element;
    if (!pane || paneIndex < 0) return false;
    if (this.pane !== pane) this.cancelTooltip();
    this.paneIndex = paneIndex;
    if (this.pane !== pane) {
      this.paneHoverAbort?.abort(); const hoverAbort = this.paneHoverAbort = new AbortController(), signal = hoverAbort.signal;
      this.pane = pane;
      pane.addEventListener('pointermove', event => { this.hoverPointerType = event.pointerType; if (!this.hoverPointerDown) this.tooltipBlockedUntilMove = false; }, { signal });
      pane.addEventListener('pointerleave', () => { this.hoverPointerType = undefined; this.cancelTooltip(); }, { signal });
      pane.addEventListener('pointerdown', () => { this.hoverPointerDown = true; this.tooltipBlockedUntilMove = true; this.cancelTooltip(); }, { capture: true, signal });
      pane.addEventListener('pointerup', () => { this.hoverPointerDown = false; }, { capture: true, signal });
      pane.addEventListener('wheel', () => { this.tooltipBlockedUntilMove = true; this.cancelTooltip(); }, { capture: true, passive: true, signal });
      pane.addEventListener('click', () => this.cancelTooltip(), { capture: true, signal });
      pane.append(this.root);
    }
    this.invalidate(); return true;
  }

  /** Reuse the chart's existing pane action buttons inside this single header. */
  setPaneControlHost(home: HTMLElement, buttons: Iterable<HTMLButtonElement>) {
    if (this.paneControlHome && this.paneControlHome !== home) this.restorePaneControls();
    this.paneControlHome = home; this.paneControlButtons = [...buttons];
    home.classList.add('is-order-flow-host'); home.hidden = true;
    this.paneControls.replaceChildren(...this.paneControlButtons);
  }

  restorePaneControls(home?: HTMLElement) {
    if (!this.paneControlHome || home && home !== this.paneControlHome) return;
    const host = this.paneControlHome;
    host.append(...this.paneControlButtons); host.classList.remove('is-order-flow-host'); host.hidden = false;
    this.paneControls.replaceChildren(); this.paneControlHome = undefined; this.paneControlButtons = [];
  }

  /** Keep the existing stable member rows in the shared pane's single header. */
  setIndicatorActionRows(rows: readonly HTMLElement[]) {
    this.indicatorActionDefinitions = new Set(rows.map(row => row.dataset.definitionId ?? ''));
    for (const row of this.indicatorActions.children) row.querySelector<HTMLButtonElement>('button[data-indicator-action="settings"]')?.removeAttribute('hidden');
    this.indicatorActions.replaceChildren(...rows);
    for (const row of rows) {
      const definition = (row as HTMLElement).dataset.definitionId;
      if (definition === CVD_ID || definition === OPEN_INTEREST_ID) row.querySelector<HTMLButtonElement>('button[data-indicator-action="settings"]')?.setAttribute('hidden', '');
    }
    this.indicatorActions.hidden = rows.length === 0;
    this.invalidate();
  }

  setVisible(value: boolean) { this.visible = value; this.root.hidden = !value; if (!value) this.cancelTooltip(); if (value) this.invalidate(); }
  invalidate() { if (!this.dead && this.visible) this.scheduler.invalidate(this); }
  private cancelTooltip() { this.tooltipDwell.clear(); this.tooltip.hidden = true; }

  draw() {
    if (this.dead || !this.visible || !this.pane) return;
    const state = this.state(this.hoverTime);
    if (state.paneIndex !== this.paneIndex) return;
    const collapsed = this.chart.paneCollapsed(this.paneIndex);
    this.root.dataset.collapsed = String(collapsed);
    this.rowsForLastDraw = state.rows;
    const mode = state.cvdMode;
    this.modeGroup.hidden = !mode;
    this.cvdSettings.hidden = state.hasCvd === false || this.indicatorActionDefinitions.has(CVD_ID);
    this.oiSettings.hidden = state.hasOpenInterest === false || this.indicatorActionDefinitions.has(OPEN_INTEREST_ID);
    for (const button of this.modeGroup.querySelectorAll<HTMLButtonElement>('[data-cvd-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.cvdMode === mode));
    }
    const currentKeys = new Set(state.rows.map(row => row.key));
    for (const [key, button] of this.lineButtons) {
      if (currentKeys.has(key)) continue;
      button.remove(); this.lineButtons.delete(key);
    }
    state.rows.forEach((row, index) => {
      let button = this.lineButtons.get(row.key);
      if (!button) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'order-flow-value';
        button.dataset.orderFlowRow = row.key;
        this.lineButtons.set(row.key, button);
      }
      button = this.lineButtons.get(row.key)!;
      const position = this.legend.children.item(index);
      if (position !== button) this.legend.insertBefore(button, position);
      button.textContent = `${row.scale} ${row.name} ${formatValue(row.value, row.source)}${row.unit ? ` ${row.unit}` : ''}`;
      button.style.setProperty('--source-color', row.color || 'var(--text)');
      button.setAttribute('aria-pressed', String(!row.hidden));
      button.setAttribute('aria-label', `${row.hidden ? 'Show' : 'Hide'} ${row.source === 'open-interest' ? 'Open Interest' : row.source.toUpperCase()} ${row.name}: ${formatValue(row.value, row.source)} ${row.unit ?? ''}`.trim());
      button.dataset.quality = row.quality ?? '';
      button.classList.toggle('is-muted', Boolean(row.hidden));
      button.title = [row.detail, row.quality].filter(Boolean).join(' · ') || `${row.name} · ${row.scale} scale`;
    });
    this.status.textContent = state.summary;
    this.status.hidden = !state.summary;
    const plot = this.chart.plotRect(this.paneIndex);
    if (plot) {
      const paneRect = this.pane.getBoundingClientRect(), containerRect = this.container.getBoundingClientRect();
      const paneLeft = paneRect.left - containerRect.left, paneTop = paneRect.top - containerRect.top;
      const plotLeft = plot.left - paneLeft, plotTop = plot.top - paneTop;
      const rightAxis = Math.max(6, this.pane.clientWidth - plotLeft - plot.width + 6);
      this.header.style.left = `${collapsed ? Math.max(0, plotLeft) : Math.max(6, plotLeft + 6)}px`;
      this.header.style.right = `${rightAxis}px`;
      this.header.style.top = collapsed ? '0px' : '4px';
      this.header.style.height = collapsed ? '22px' : '';
      this.header.style.maxWidth = '';
      this.status.style.left = `${Math.max(6, plotLeft + 6)}px`;
      this.status.style.right = `${rightAxis}px`;
      const bandHeight = state.volumeBandHeightPercent;
      if (collapsed) {
        this.status.hidden = true;
      } else if (state.hasVolume && bandHeight !== undefined && bandHeight > 0) {
        const bandTop = plotTop + plot.height * (1 - Math.min(100, bandHeight) / 100);
        const headerBottom = 4 + this.header.offsetHeight;
        const statusTop = bandTop - 12;
        this.status.style.top = `${statusTop >= headerBottom + 2 ? statusTop : headerBottom + 2}px`;
        this.status.style.bottom = 'auto';
        this.status.hidden = statusTop < headerBottom + 2;
      } else if (state.hasVolume) {
        this.status.style.top = 'auto';
        this.status.style.bottom = '4px';
        this.status.hidden = true;
      } else {
        this.status.style.top = 'auto';
        this.status.style.bottom = '4px';
        this.status.hidden = false;
      }
    } else if (collapsed) {
      this.header.style.left = '0px'; this.header.style.right = '80px'; this.header.style.top = '0px'; this.header.style.height = '22px';
      this.status.hidden = true;
    }
    const shouldShowTooltip = this.tooltipDwell.isActive('order-flow') && this.hoverTime !== undefined && this.hoverPaneIndex === this.paneIndex;
    this.tooltip.hidden = !shouldShowTooltip;
    if (shouldShowTooltip) {
      const time = this.hoverTime!;
      this.tooltip.replaceChildren();
      const stamp = document.createElement('div'); stamp.className = 'order-flow-tooltip-header';
      stamp.textContent = new Date(time).toLocaleString('en-GB', { timeZone: getDisplayTimezone() }); this.tooltip.append(stamp);
      for (const row of state.rows.filter(item => !item.hidden)) {
        const node = document.createElement('div'); node.className = 'order-flow-tooltip-row';
        const label = document.createElement('span'), value = document.createElement('span');
        label.textContent = `${row.scale} ${row.name}`;
        value.textContent = `${formatValue(row.value, row.source)}${row.unit ? ` ${row.unit}` : ''}${row.detail ? ` · ${row.detail}` : ''}`;
        node.append(label, value); this.tooltip.append(node);
      }
      const quality = document.createElement('small'); quality.textContent = state.summary; this.tooltip.append(quality);
    }
  }

  dispose() {
    if (this.dead) return;
    this.tooltipDwell.dispose(); this.paneHoverAbort?.abort(); this.dead = true; this.restorePaneControls(); this.abort.abort(); this.releases.forEach(release => release()); this.scheduler.remove(this); this.root.remove();
    this.lineButtons.clear(); this.rowsForLastDraw = [];
  }
}

function formatValue(value: number | null, source: OrderFlowSource) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (source === 'cvd') {
    const absolute = Math.abs(value), sign = value < 0 ? '−' : value > 0 ? '+' : '';
    const [scale, suffix] = absolute >= 1e9 ? [1e9, 'B'] : absolute >= 1e6 ? [1e6, 'M'] : absolute >= 1e3 ? [1e3, 'K'] : [1, ''];
    return `${sign}${Number((absolute / scale).toPrecision(3))}${suffix}`;
  }
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
