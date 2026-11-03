import type { ContextMenuEvent } from 'openalgo-charts';
import type { OpenAlgoCandleChart } from '../chart/openalgo';
import type { Scheduler } from '../chart/scheduler';
import type { PanelConfig } from '../panel';
import type { JournalController } from './controller';
import { JournalMarkers } from './markers';
import { JOURNAL_INDICATOR_ID, journalMarkerSettings } from './indicator';
import type { SnapshotInput } from './snapshot';
import { canonicalMarket, marketIdentity, type JournalMarket } from './model';
import { duration } from '../feed/protocol';

export interface JournalBridgeHost {
  id: string; frame: HTMLElement; chartRoot: HTMLElement; toolbar: HTMLElement; engine: OpenAlgoCandleChart; scheduler: Scheduler;
  config(): PanelConfig; snapshotInput(): SnapshotInput; captureImage(): HTMLCanvasElement; currentMarketTime(): number | null;
  enableMarkers(): void; changeSettings(settings: Record<string, unknown>): void; visible(): boolean; active(): boolean;
}

type CameraAction = 'copy' | 'add' | 'download';
const ACTIONS: readonly { action: CameraAction; label: string }[] = [
  { action: 'copy', label: 'Copy chart image' },
  { action: 'add', label: 'Add to journal…' },
  { action: 'download', label: 'Download PNG' },
];

export class JournalChartBridge {
  readonly markers: JournalMarkers;
  private menu = document.createElement('div');
  private button = document.createElement('button');
  private abort = new AbortController();
  private release: () => void;
  private anchor?: number;
  private dead = false;

  constructor(private controller: JournalController, private host: JournalBridgeHost) {
    controller.attachChart(host.id);
    this.button.type = 'button';
    this.button.className = 'journal-capture-button';
    this.button.innerHTML = '<svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path d="M2.5 4.5h3l1-2h5l1 2h3v11h-13Z"/><circle cx="9" cy="9.5" r="3"/></svg>';
    this.button.setAttribute('aria-label', 'Camera actions');
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.title = 'Copy chart image · Add to journal · Download PNG · Alt+Shift+J to add';
    const latest = host.toolbar.querySelector('.chart-latest-button');
    if (latest) latest.after(this.button); else host.toolbar.append(this.button);
    this.button.addEventListener('click', () => {
      const box = this.button.getBoundingClientRect();
      this.openMenu(box.left, box.bottom + 2);
    }, { signal: this.abort.signal });

    this.menu.className = 'journal-context-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Chart image actions');
    this.menu.hidden = true;
    document.body.append(this.menu);
    this.release = host.engine.chart.on('contextmenu', event => {
      this.anchor = event.time === null ? undefined : Math.round(event.time * 1000);
      if (event.target.kind === 'drawing') return;
      event.preventDefault();
      const box = host.chartRoot.getBoundingClientRect();
      this.openMenu(box.left + event.point.x, box.top + event.point.y);
    });

    document.addEventListener('click', event => {
      const item = (event.target as Element).closest<HTMLButtonElement>('[data-journal-mode]');
      if (item?.dataset.journalChart !== host.id) return;
      event.stopPropagation();
      this.closeMenu();
      const mode = item.dataset.journalMode as CameraAction | undefined;
      if (mode === 'add') void this.addToJournal();
      else if (mode === 'copy') void this.copyImage();
      else if (mode === 'download') void this.downloadImage();
    }, { capture: true, signal: this.abort.signal });

    this.menu.addEventListener('keydown', event => {
      const items = [...this.menu.querySelectorAll<HTMLButtonElement>('button')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { this.closeMenu(); this.button.focus(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items[next]?.focus();
      }
    }, { signal: this.abort.signal });
    this.button.addEventListener('contextmenu', event => {
      event.preventDefault(); this.anchor = undefined; this.openMenu(event.clientX, event.clientY);
    }, { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => {
      if (!this.menu.contains(event.target as Node) && event.target !== this.button) this.closeMenu();
    }, { capture: true, signal: this.abort.signal });
    host.frame.closest('.candle-panel')?.addEventListener('keydown', event => {
      const key = event as KeyboardEvent;
      if (key.key === 'Escape') this.closeMenu();
      if (key.altKey && key.shiftKey && key.code === 'KeyJ' && !key.ctrlKey && !key.metaKey
        && !(key.target as Element).closest('input,textarea,select,[contenteditable=true]')) {
        key.preventDefault(); key.stopPropagation(); void this.addToJournal();
      }
    }, { signal: this.abort.signal });

    this.markers = new JournalMarkers(host.engine.chart, host.chartRoot, host.frame, host.scheduler, controller.repository,
      () => canonicalMarket(host.config()), () => duration[host.config().interval] ?? null,
      (id, entryAt, attachmentId) => controller.openEntry(id, entryAt, attachmentId));
    this.configure();
  }

  configure() {
    const instance = this.host.config().indicators.find(item => item.definitionId === JOURNAL_INDICATOR_ID);
    this.markers.setSettings(journalMarkerSettings(instance?.settings));
    this.markers.configure(Boolean(instance?.visible), this.host.visible());
  }

  private port() {
    return {
      id: this.host.id,
      root: this.host.frame,
      input: () => this.host.snapshotInput(),
      chart: this.host.engine.chart,
      captureImage: () => this.host.captureImage(),
      currentMarketTime: () => this.host.currentMarketTime(),
      onSaved: (market: JournalMarket) => {
        if (!this.dead && marketIdentity(canonicalMarket(this.host.config())) === marketIdentity(market)) this.host.enableMarkers();
      },
    };
  }

  private addToJournal() {
    this.closeMenu();
    return this.controller.addToJournal(this.port(), this.anchor);
  }

  private copyImage() {
    this.closeMenu();
    return this.controller.copyChartImage(this.port());
  }

  private downloadImage() {
    this.closeMenu();
    return this.controller.downloadChartImage(this.port());
  }

  setContextAnchor(event: ContextMenuEvent) { this.anchor = event.time === null ? undefined : Math.round(event.time * 1000); }

  appendContextActions(menu: HTMLElement) {
    for (const { label, action } of ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'chart-object-tree-menu-item';
      button.setAttribute('role', 'menuitem'); button.textContent = label;
      button.dataset.journalMode = action; button.dataset.journalChart = this.host.id;
      menu.append(button);
    }
  }

  private openMenu(x: number, y: number) {
    this.menu.replaceChildren();
    this.appendContextActions(this.menu);
    this.menu.style.left = `${Math.max(4, Math.min(innerWidth - 248, x))}px`;
    this.menu.style.top = `${Math.max(4, Math.min(innerHeight - 100, y))}px`;
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.menu.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private closeMenu() { this.menu.hidden = true; this.button.setAttribute('aria-expanded', 'false'); }

  openSettings(raw: unknown) {
    const settings = journalMarkerSettings(raw), dialog = document.createElement('dialog');
    dialog.className = 'indicator-settings journal-marker-settings'; dialog.setAttribute('aria-label', 'Journal marker settings');
    const form = document.createElement('form'); form.className = 'indicator-settings-form';
    const title = document.createElement('h2'); title.textContent = 'Journal markers';
    const detail = document.createElement('p'); detail.textContent = 'Exact chart attachments only, across timeframes. Markers use observed chart coverage. Hiding or removing markers keeps entries and attachments.';
    const distance = document.createElement('input'); distance.type = 'number'; distance.min = '12'; distance.max = '64'; distance.value = String(settings.clusterDistance); distance.setAttribute('aria-label', 'Cluster distance (px)');
    const preview = document.createElement('input'); preview.type = 'checkbox'; preview.checked = settings.previews; preview.setAttribute('aria-label', 'Show marker previews');
    const row = (text: string, input: HTMLElement) => { const label = document.createElement('label'); label.className = 'indicator-setting-field'; label.append(text, input); return label; };
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Cancel'; close.onclick = () => dialog.close();
    const apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = 'Apply';
    form.append(title, detail, row('Cluster distance (px)', distance), row('Show marker previews', preview), close, apply);
    dialog.append(form); document.body.append(dialog);
    form.addEventListener('submit', event => { event.preventDefault(); this.host.changeSettings({ ...journalMarkerSettings({ clusterDistance: Number(distance.value), previews: preview.checked }) }); dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    this.abort.signal.addEventListener('abort', () => { dialog.close(); dialog.remove(); }, { once: true });
    dialog.showModal();
  }

  dispose() { this.controller.detachChart(this.host.id); this.dead = true; this.release(); this.abort.abort(); this.markers.dispose(); this.menu.remove(); this.button.remove(); }
}
