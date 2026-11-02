import type { ContextMenuEvent } from 'openalgo-charts';
import type { OpenAlgoCandleChart } from '../chart/openalgo';
import type { Scheduler } from '../chart/scheduler';
import type { PanelConfig } from '../panel';
import type { JournalController } from './controller';
import { JournalMarkers } from './markers';
import { JOURNAL_INDICATOR_ID, journalMarkerSettings } from './indicator';
import type { SnapshotInput } from './snapshot';
import { canonicalMarket } from './model';
import { duration } from '../feed/protocol';

export interface JournalBridgeHost {
  id: string; frame: HTMLElement; chartRoot: HTMLElement; toolbar: HTMLElement; engine: OpenAlgoCandleChart; scheduler: Scheduler;
  config(): PanelConfig; snapshotInput(): SnapshotInput; captureImage(): HTMLCanvasElement; currentMarketTime(): number | null;
  enableMarkers(): void; changeSettings(settings: Record<string, unknown>): void; visible(): boolean; active(): boolean;
}
export class JournalChartBridge {
  readonly markers: JournalMarkers; private menu = document.createElement('div'); private button = document.createElement('button'); private abort = new AbortController(); private release: () => void; private anchor?: number; private dead = false;
  constructor(private controller: JournalController, private host: JournalBridgeHost) {
    this.button.type = 'button'; this.button.className = 'journal-capture-button'; this.button.innerHTML = '<svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path d="M2.5 4.5h3l1-2h5l1 2h3v11h-13Z"/><circle cx="9" cy="9.5" r="3"/></svg>'; this.button.setAttribute('aria-label', 'Quick journal capture'); this.button.title = 'Quick capture · Alt+Shift+J · Shift-click to capture and annotate'; const latest = host.toolbar.querySelector('.chart-latest-button'); if (latest) latest.after(this.button); else host.toolbar.append(this.button);
    this.button.addEventListener('click', event => void this.capture(event.shiftKey ? 'annotate' : 'quick'), { signal: this.abort.signal });
    this.menu.className = 'journal-context-menu'; this.menu.setAttribute('role', 'menu'); this.menu.setAttribute('aria-label', 'Journal capture actions'); this.menu.hidden = true; document.body.append(this.menu);
    this.release = host.engine.chart.on('contextmenu', event => { this.anchor = event.time === null ? undefined : Math.round(event.time * 1000); if (event.target.kind === 'drawing' || event.time === null) return; event.preventDefault(); const box = host.chartRoot.getBoundingClientRect(); this.openMenu(box.left + event.point.x, box.top + event.point.y); });
    document.addEventListener('click', event => { const button = (event.target as Element).closest<HTMLButtonElement>('[data-journal-mode]'); if (button?.dataset.journalChart !== host.id) return; event.stopPropagation(); const menu = button.closest<HTMLElement>('[role=menu]'); if (menu) menu.hidden = true; const mode = button.dataset.journalMode; if (mode === 'open') controller.open(undefined, canonicalMarket(host.config())); else void this.capture(mode === 'annotate' ? 'annotate' : 'quick', this.anchor); }, { capture: true, signal: this.abort.signal });
    this.menu.addEventListener('keydown', event => { const items = [...this.menu.querySelectorAll<HTMLButtonElement>('button')], index = items.indexOf(document.activeElement as HTMLButtonElement); if (event.key === 'Escape') { this.menu.hidden = true; this.button.focus(); } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; items[next]?.focus(); } }, { signal: this.abort.signal });
    this.button.addEventListener('contextmenu', event => { event.preventDefault(); this.anchor = undefined; this.openMenu(event.clientX, event.clientY); }, { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => { if (!this.menu.contains(event.target as Node)) this.menu.hidden = true; }, { capture: true, signal: this.abort.signal });
    host.frame.closest('.candle-panel')?.addEventListener('keydown', event => { const key = event as KeyboardEvent; if (key.key === 'Escape') this.menu.hidden = true; if (key.altKey && key.shiftKey && key.code === 'KeyJ' && !key.ctrlKey && !key.metaKey && !(key.target as Element).closest('input,textarea,select,[contenteditable=true]')) { key.preventDefault(); key.stopPropagation(); void this.capture('quick'); } }, { signal: this.abort.signal });
    this.markers = new JournalMarkers(host.engine.chart, host.chartRoot, host.frame, host.scheduler, controller.repository, () => canonicalMarket(host.config()), () => duration[host.config().interval] ?? null, id => controller.open(id, canonicalMarket(host.config())));
    this.configure();
  }
  configure() { if (this.host.active()) this.controller.panel.setMarket(canonicalMarket(this.host.config())); const instance = this.host.config().indicators.find(item => item.definitionId === JOURNAL_INDICATOR_ID); this.markers.setSettings(journalMarkerSettings(instance?.settings)); this.markers.configure(Boolean(instance?.visible), this.host.visible()); }
  capture(mode: 'quick' | 'annotate', anchor?: number) {
    this.menu.hidden = true;
    return this.controller.capture({ id: this.host.id, root: this.host.frame, input: () => this.host.snapshotInput(), captureImage: () => this.host.captureImage(), currentMarketTime: () => this.host.currentMarketTime(), onSaved: () => { if (!this.dead) this.host.enableMarkers(); } }, mode, anchor);
  }
  setContextAnchor(event: ContextMenuEvent) { this.anchor = event.time === null ? undefined : Math.round(event.time * 1000); }
  appendContextActions(menu: HTMLElement) {
    for (const [label, mode] of [['Quick journal capture', 'quick'], ['Capture and annotate', 'annotate'], ['Open journal', 'open']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'chart-object-tree-menu-item'; button.setAttribute('role', 'menuitem'); button.textContent = label;
      button.dataset.journalMode = mode; button.dataset.journalChart = this.host.id; menu.append(button);
    }
  }
  private openMenu(x: number, y: number) { this.menu.replaceChildren(); this.appendContextActions(this.menu); this.menu.style.left = `${Math.max(4, Math.min(innerWidth - 248, x))}px`; this.menu.style.top = `${Math.max(4, Math.min(innerHeight - 100, y))}px`; this.menu.hidden = false; this.menu.querySelector<HTMLButtonElement>('button')?.focus(); }
  openSettings(raw: unknown) {
    const settings = journalMarkerSettings(raw), dialog = document.createElement('dialog'); dialog.className = 'indicator-settings journal-marker-settings'; dialog.setAttribute('aria-label', 'Journal marker settings');
    const form = document.createElement('form'); form.className = 'indicator-settings-form'; const title = document.createElement('h2'); title.textContent = 'Journal markers'; const detail = document.createElement('p'); detail.textContent = 'Exact instrument only, across timeframes. Markers use observed chart coverage. Entries remain saved when markers are hidden or removed.';
    const distance = document.createElement('input'); distance.type = 'number'; distance.min = '12'; distance.max = '64'; distance.value = String(settings.clusterDistance); distance.setAttribute('aria-label', 'Cluster distance (px)'); const preview = document.createElement('input'); preview.type = 'checkbox'; preview.checked = settings.previews; preview.setAttribute('aria-label', 'Show marker previews');
    const row = (text: string, input: HTMLElement) => { const label = document.createElement('label'); label.className = 'indicator-setting-field'; label.append(text, input); return label; };
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Cancel'; close.onclick = () => dialog.close(); const apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = 'Apply'; form.append(title, detail, row('Cluster distance (px)', distance), row('Show marker previews', preview), close, apply); dialog.append(form); document.body.append(dialog);
    form.addEventListener('submit', event => { event.preventDefault(); this.host.changeSettings({ ...journalMarkerSettings({ clusterDistance: Number(distance.value), previews: preview.checked }) }); dialog.close(); }); dialog.addEventListener('close', () => dialog.remove(), { once: true }); this.abort.signal.addEventListener('abort', () => { dialog.close(); dialog.remove(); }, { once: true }); dialog.showModal();
  }
  dispose() { this.controller.detachChart(this.host.id); this.dead = true; this.release(); this.abort.abort(); this.markers.dispose(); this.menu.remove(); this.button.remove(); }
}
