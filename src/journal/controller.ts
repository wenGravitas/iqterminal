import type { ScriptLibrary } from '../scripts/library';
import { captureRecord, capturedBundle, freezeFrame, releaseFrame, type FrozenFrame } from './capture';
import { createEntry, immutableCopy, credentialSource, type ChartSnapshot, type JournalBundle, type JournalMarket } from './model';
import { freezeSnapshot, type SnapshotInput } from './snapshot';
import { IndexedDbJournalRepository, type JournalRepository } from './repository';
import { JournalPanel } from './panel';

export interface JournalChartPort { id: string; root: HTMLElement; input(): SnapshotInput; captureImage(): HTMLCanvasElement; currentMarketTime(): number | null; onSaved?(): void }
export interface CaptureDraft { chartId: string; id: string; entryId: string; snapshot: ChartSnapshot; frame: FrozenFrame; marketTime: number; mode: 'quick' | 'annotate'; annotation: 'current' | 'historical'; error?: string; bundle?: JournalBundle; busy: boolean; onSaved?: () => void }
export class JournalController {
  readonly panel: JournalPanel;
  private drafts = new Map<string, CaptureDraft>();
  private pending = new Map<string, Promise<void>>();
  private last = new Map<string, number>();
  private toast = document.createElement('aside');
  private toastTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(readonly repository: JournalRepository, private readonly library: ScriptLibrary, restore: (snapshot: ChartSnapshot) => Promise<string[]>) {
    this.panel = new JournalPanel(repository, { restore, retry: id => this.retry(id), noteOnly: id => this.saveNoteOnly(id), discard: id => this.discard(id) });
    this.toast.className = 'journal-toast'; this.toast.setAttribute('role', 'status'); this.toast.hidden = true; document.body.append(this.toast);
  }
  static create(library: ScriptLibrary, restore: (snapshot: ChartSnapshot) => Promise<string[]>) { return new JournalController(new IndexedDbJournalRepository(), library, restore); }
  open(id?: string, market?: JournalMarket) { this.panel.open(id, market); }
  capture(port: JournalChartPort, mode: 'quick' | 'annotate', anchor?: number): Promise<void> {
    const pending = this.pending.get(port.id); if (pending) return pending;
    if (Date.now() - (this.last.get(port.id) ?? 0) < 1000) return Promise.resolve();
    const existing = [...this.drafts.values()].find(draft => draft.chartId === port.id); if (existing) { this.panel.showDraft(existing); return Promise.resolve(); }
    if (this.drafts.size >= 8) { this.message('Resolve or discard a frozen capture draft before creating another.'); return Promise.resolve(); }
    let draft: CaptureDraft; let capturedCanvas: HTMLCanvasElement | undefined;
    try {
      // Deliberately no await: paint, state and layout are frozen in one turn.
      const canvas = capturedCanvas = port.captureImage(), capturedAt = Date.now(), input = port.input(), snapshot = freezeSnapshot(input, capturedAt);
      const marketTime = anchor ?? port.currentMarketTime(); if (marketTime === null) { canvas.width = canvas.height = 0; throw Error('No observed market time is available. Wait for chart data before capturing.'); }
      const title = `${snapshot.market.venue} · ${snapshot.market.symbol} ${snapshot.market.market} · ${snapshot.config.interval} · captured ${new Date(capturedAt).toISOString()}${anchor !== undefined ? ` · observation ${new Date(anchor).toISOString()}` : ''}`;
      const frame = freezeFrame(input.chart, port.root, title, canvas);
      draft = { chartId: port.id, id: crypto.randomUUID(), entryId: crypto.randomUUID(), snapshot, frame, marketTime, mode, annotation: anchor !== undefined && anchor < (port.currentMarketTime() ?? anchor) ? 'historical' : 'current', busy: false, onSaved: port.onSaved }; this.drafts.set(draft.id, draft);
    } catch (error) { if (capturedCanvas) capturedCanvas.width = capturedCanvas.height = 0; this.message(`Capture unavailable: ${errorText(error)}`); return Promise.resolve(); }
    const work = this.encodeAndSave(draft).finally(() => { this.pending.delete(port.id); this.last.set(port.id, Date.now()); }); this.pending.set(port.id, work); return work;
  }
  private async enrich(snapshot: ChartSnapshot) {
    const scripts = await Promise.all(snapshot.scripts.map(async script => { const revision = await this.library.getRevision(script.scriptId, script.revisionId).catch(() => null); return revision ? { ...script, contentHash: revision.contentHash, ...(!credentialSource(revision.source) ? { source: revision.source } : {}) } : script; }));
    return immutableCopy({ ...snapshot, scripts, warnings: [...snapshot.warnings, ...scripts.filter(script => !script.contentHash).map(script => `Exact local script revision ${script.revisionId} was unavailable at capture.`)] });
  }
  private async encodeAndSave(draft: CaptureDraft) {
    if (draft.busy || this.disposed) return; draft.busy = true;
    try {
      if (!draft.bundle) { const snapshot = await this.enrich(draft.snapshot); if (this.disposed) return; draft.bundle = await capturedBundle(snapshot, draft.frame, draft.marketTime, draft.id, draft.entryId); draft.bundle.entry = { ...draft.bundle.entry, annotation: draft.annotation }; }
      if (this.disposed) return;
      await this.repository.save([draft.bundle]);
      this.saved(draft);
    } catch (error) { draft.error = errorText(error); if (!this.disposed) this.panel.showDraft(draft); }
    finally { draft.busy = false; }
  }
  private saved(draft: CaptureDraft) {
    if (this.disposed) { releaseFrame(draft.frame); return; }
    draft.onSaved?.();
    this.drafts.delete(draft.id); releaseFrame(draft.frame); this.panel.clearDraft(draft.id);
    if (draft.mode === 'annotate') this.open(draft.entryId, draft.snapshot.market);
    this.message('Chart saved locally · Open entry', () => this.open(draft.entryId, draft.snapshot.market));
  }
  retry(id: string) { const draft = this.drafts.get(id); if (draft) return this.encodeAndSave(draft); return Promise.resolve(); }
  async saveNoteOnly(id: string) {
    const draft = this.drafts.get(id); if (!draft || draft.busy) return; draft.busy = true;
    try { const snapshot = await this.enrich(draft.snapshot), capture = captureRecord(snapshot, draft.id, null, null, [`Screenshot unavailable: ${draft.error ?? 'explicit note-only choice'}`]);
      await this.repository.save([{ entry: { ...createEntry(capture, draft.marketTime), id: draft.entryId, annotation: draft.annotation }, capture, assets: [] }]); this.saved(draft);
    } catch (error) { draft.error = errorText(error); if (!this.disposed) this.panel.showDraft(draft); } finally { draft.busy = false; }
  }
  detachChart(id: string) { for (const draft of this.drafts.values()) if (draft.chartId === id) draft.onSaved = undefined; this.last.delete(id); }
  discard(id: string) { const draft = this.drafts.get(id); if (draft && !draft.busy) { releaseFrame(draft.frame); this.drafts.delete(id); this.panel.clearDraft(id); } }
  message(text: string, action?: () => void) { clearTimeout(this.toastTimer); this.toast.replaceChildren(); const content = document.createElement(action ? 'button' : 'span'); content.textContent = text; if (action) content.addEventListener('click', action, { once: true }); this.toast.append(content); this.toast.hidden = false; this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, action ? 12000 : 8000); }
  dispose() { this.disposed = true; clearTimeout(this.toastTimer); for (const draft of this.drafts.values()) releaseFrame(draft.frame); this.drafts.clear(); this.panel.dispose(); this.repository.close(); this.toast.remove(); }
}
export function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
