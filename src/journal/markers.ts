import type { Chart } from 'openalgo-charts';
import type { Scheduler, Drawable } from '../chart/scheduler';
import { formatDateTime, getDisplayTimezone } from '../timezone';
import { marketIdentity, type JournalEntry, type JournalMarket } from './model';
import { journalMarkerSettings, type JournalMarkerSettings } from './indicator';
import type { JournalRepository } from './repository';

export interface MarkerCluster { x: number; entries: JournalEntry[] }
export function clusterMarkers(entries: readonly JournalEntry[], coordinate: (time: number) => number | null, width: number, distance = 24): MarkerCluster[] {
  const points = entries.flatMap(entry => { const x = coordinate(entry.marketTime); return x !== null && Number.isFinite(x) && x >= 0 && x <= width ? [{ x, entry }] : []; }).sort((a, b) => a.x - b.x);
  const clusters: MarkerCluster[] = [];
  for (const point of points) { const previous = clusters.at(-1); if (previous && point.x - previous.x < distance) { previous.x = (previous.x * previous.entries.length + point.x) / (previous.entries.length + 1); previous.entries.push(point.entry); } else clusters.push({ x: point.x, entries: [point.entry] }); }
  return clusters;
}
/** Never extrapolate an observation into missing history or a future interval. */
export function coveredMarkerIndex(marketTime: number, data: { length: number; indexToTime(index: number): number | undefined; timeToIndexFloat(time: number): number }, stepMs: number | null): number | null {
  if (!data.length) return null;
  const time = marketTime / 1000, first = data.indexToTime(0), last = data.indexToTime(data.length - 1); if (first === undefined || last === undefined || time < first || time >= last + (stepMs ?? 1) / 1000) return null;
  const index = data.timeToIndexFloat(time), before = data.indexToTime(Math.max(0, Math.min(data.length - 1, Math.floor(index))));
  if (before === undefined || !Number.isFinite(index)) return null;
  if (stepMs === null) return before === time ? Math.floor(index) : null;
  return time - before < stepMs / 1000 ? index : null;
}
export class JournalMarkers implements Drawable {
  visible = false; readonly element = document.createElement('div'); private preview = document.createElement('div');
  private releases: (() => void)[] = []; private abort = new AbortController(); private entries: JournalEntry[] = []; private clusters: MarkerCluster[] = [];
  private markerNodes = new Map<string, HTMLButtonElement>(); private marketKey = '';
  private key = ''; private generation = 0; private dead = false; private queryTimer?: ReturnType<typeof setTimeout>; private hoverTimer?: ReturnType<typeof setTimeout>; private previewUrl?: string;
  private settings = journalMarkerSettings(undefined);
  setSettings(settings: JournalMarkerSettings) { this.settings = settings; }
  private enabled = false; private hostVisible = true; private previewGeneration = 0;
  diagnostics = { queries: 0, draws: 0, entries: 0, clusters: 0, capped: false };
  constructor(private chart: Chart, private chartRoot: HTMLElement, private frame: HTMLElement, private scheduler: Scheduler, private repository: JournalRepository,
    private market: () => JournalMarket, private stepMs: () => number | null, private open: (id: string) => void) {
    this.element.className = 'journal-marker-lane'; this.element.setAttribute('aria-label', 'Journal observations'); this.element.hidden = true; frame.append(this.element);
    this.preview.className = 'journal-marker-preview'; this.preview.hidden = true; this.preview.setAttribute('aria-label', 'Journal marker preview'); document.body.append(this.preview);
    const invalidate = () => { if (!this.dead && this.visible) { this.scheduler.invalidate(this); this.scheduleQuery(); } };
    for (const event of ['pan', 'zoom', 'resize', 'paneResized', 'paneMoved', 'data:update'] as const) this.releases.push(chart.on(event, invalidate));
    this.releases.push(repository.subscribe(change => { if (!change.instrument || change.instrument === marketIdentity(this.market())) { this.key = ''; invalidate(); } }));
    this.element.addEventListener('click', event => { const button = (event.target as Element).closest<HTMLButtonElement>('[data-cluster]'); if (!button) return; const cluster = this.clusters[Number(button.dataset.cluster)]; if (!cluster) return; if (cluster.entries.length === 1) this.open(cluster.entries[0]!.id); else void this.showPreview(cluster, button, true); }, { signal: this.abort.signal });
    const hover = (event: Event) => { if (!this.settings.previews) return; const button = (event.target as Element).closest<HTMLButtonElement>('[data-cluster]'); clearTimeout(this.hoverTimer); if (!button) return; const cluster = this.clusters[Number(button.dataset.cluster)]; if (!cluster) return; this.hoverTimer = setTimeout(() => void this.showPreview(cluster, button, false), event.type === 'focusin' ? 0 : 500); };
    this.element.addEventListener('pointerover', hover, { signal: this.abort.signal }); this.element.addEventListener('focusin', hover, { signal: this.abort.signal });
    this.element.addEventListener('pointerleave', () => { if (this.preview.dataset.interactive !== 'true') this.hidePreview(); }, { signal: this.abort.signal });
    this.element.addEventListener('focusout', () => { if (this.preview.dataset.interactive !== 'true') this.hidePreview(); }, { signal: this.abort.signal });
    this.preview.addEventListener('click', event => { const button = (event.target as Element).closest<HTMLButtonElement>('[data-entry-id]'); if (button) { this.open(button.dataset.entryId!); this.hidePreview(); } }, { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => { if (!this.element.contains(event.target as Node) && !this.preview.contains(event.target as Node)) this.hidePreview(); }, { capture: true, signal: this.abort.signal });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.hidePreview(); }, { signal: this.abort.signal });
  }
  configure(enabled: boolean, hostVisible: boolean) { const marketKey = marketIdentity(this.market()); if (marketKey !== this.marketKey) { this.marketKey = marketKey; this.entries = []; this.key = ''; this.generation++; this.markerNodes.clear(); this.element.replaceChildren(); this.hidePreview(); } const changed = enabled !== this.enabled; this.enabled = enabled; this.hostVisible = hostVisible; this.visible = enabled && hostVisible; this.element.hidden = !enabled; if (!this.visible) { this.generation++; this.hidePreview(); this.scheduler.remove(this); } else { if (changed) this.key = ''; this.scheduler.invalidate(this); this.scheduleQuery(); } }
  private scheduleQuery() { if (!this.visible || this.queryTimer) return; this.queryTimer = setTimeout(() => { this.queryTimer = undefined; void this.query(); }, 100); }
  private async query() {
    const range = this.chart.getVisibleLogicalRange(), data = this.chart.dataLayer; if (!this.visible || !range || !data.length) return;
    const from = data.indexToTimeFloat(range.from) * 1000, to = data.indexToTimeFloat(range.to) * 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return; const margin = Math.max(60_000, (to - from) * .1), quantum = this.stepMs() ?? 60_000;
    const start = Math.max(0, Math.floor((from - margin) / quantum) * quantum), end = Math.ceil((to + margin) / quantum) * quantum, instrument = marketIdentity(this.market()); const key = `${instrument}:${start}:${end}`;
    if (key === this.key) return; this.key = key; const generation = ++this.generation; this.diagnostics.queries++;
    try { const entries = await this.repository.query({ instrument, from: start, to: end, limit: 500 }); if (generation !== this.generation || !this.visible || this.dead) return; this.entries = entries; this.diagnostics.entries = entries.length; this.diagnostics.capped = entries.length === 500; this.scheduler.invalidate(this); }
    catch (error) { if (!this.dead) { this.key = ''; this.element.textContent = `Journal markers unavailable: ${error instanceof Error ? error.message : String(error)}`; } }
  }
  draw() {
    if (!this.visible || this.dead) return; const plot = this.chart.plotRect(this.chart.primaryPaneIndex()); if (!plot) return;
    this.diagnostics.draws++; const left = this.chartRoot.getBoundingClientRect().left - this.frame.getBoundingClientRect().left + plot.left;
    const clusters = clusterMarkers(this.entries, time => { const index = coveredMarkerIndex(time, this.chart.dataLayer, this.stepMs()); return index === null ? null : this.chart.timeScale.indexToX(index); }, plot.width, this.settings.clusterDistance);
    this.clusters = clusters.slice(0, 100); this.diagnostics.clusters = this.clusters.length;
    const children: HTMLElement[] = [], active = new Set<string>(); for (const [index, cluster] of this.clusters.entries()) { const key = cluster.entries.map(entry => entry.id).join('|'); active.add(key); let button = this.markerNodes.get(key); if (!button) { button = document.createElement('button'); button.type = 'button'; this.markerNodes.set(key, button); } button.dataset.cluster = String(index); button.className = 'journal-marker'; button.style.left = `${left + Math.max(8, Math.min(plot.width - 8, cluster.x))}px`; button.textContent = cluster.entries.length > 1 ? String(cluster.entries.length) : '◆'; button.setAttribute('aria-label', cluster.entries.length > 1 ? `${cluster.entries.length} journal entries` : `Journal entry · ${formatDateTime(cluster.entries[0]!.marketTime, getDisplayTimezone(), true)} · ${cluster.entries[0]!.title || cluster.entries[0]!.note.slice(0, 80)}`); children.push(button); }
    if (this.diagnostics.capped || clusters.length > 100) { const notice = document.createElement('span'); notice.className = 'journal-marker-limit'; notice.textContent = 'Zoom in · marker limit'; children.push(notice); }
    if (!this.entries.length) { const notice = document.createElement('span'); notice.className = 'journal-marker-empty'; notice.textContent = 'Journal · no entries in view'; children.push(notice); }
    for (let i = 0; i < children.length; i++) if (this.element.children[i] !== children[i]) this.element.insertBefore(children[i]!, this.element.children[i] ?? null);
    while (this.element.children.length > children.length) this.element.lastElementChild?.remove();
    for (const [key, button] of this.markerNodes) if (!active.has(key)) { button.remove(); this.markerNodes.delete(key); }
  }
  private async showPreview(cluster: MarkerCluster, anchor: HTMLElement, interactive: boolean) {
    this.hidePreview(); const generation = ++this.previewGeneration; this.preview.dataset.interactive = String(interactive); this.preview.hidden = false; this.preview.replaceChildren();
    const rect = anchor.getBoundingClientRect(); this.preview.style.left = `${Math.max(4, Math.min(innerWidth - 340, rect.left))}px`; this.preview.style.bottom = `${Math.max(4, innerHeight - rect.top + 6)}px`;
    for (const entry of cluster.entries.slice(0, 100)) { const row = document.createElement(interactive ? 'button' : 'p'); if (interactive) { (row as HTMLButtonElement).type = 'button'; row.dataset.entryId = entry.id; } row.textContent = `${entry.title || entry.market.symbol} · Observation ${formatDateTime(entry.marketTime, getDisplayTimezone(), true)}\nCaptured ${formatDateTime(entry.capturedAt, getDisplayTimezone(), true)}\n${entry.note.slice(0, 180)}\n${entry.tags.map(tag => '#' + tag).join(' ')}`; this.preview.append(row); }
    if (interactive) this.preview.querySelector<HTMLButtonElement>('button')?.focus();
    try { const capture = await this.repository.capture(cluster.entries[0]!.captureId), asset = capture?.thumbnail ? await this.repository.asset(capture.thumbnail) : null; if (!asset || this.dead || generation !== this.previewGeneration) return; this.previewUrl = URL.createObjectURL(asset.blob); const img = document.createElement('img'); img.alt = 'Journal capture preview'; img.src = this.previewUrl; this.preview.prepend(img); } catch { /* Entry text remains usable when an image is unavailable. */ }
  }
  private hidePreview() { clearTimeout(this.hoverTimer); this.previewGeneration++; this.preview.hidden = true; if (this.previewUrl) URL.revokeObjectURL(this.previewUrl); this.previewUrl = undefined; }
  dispose() { this.dead = true; this.generation++; clearTimeout(this.queryTimer); this.hidePreview(); this.abort.abort(); this.releases.forEach(release => release()); this.scheduler.remove(this); this.element.remove(); this.preview.remove(); }
}
