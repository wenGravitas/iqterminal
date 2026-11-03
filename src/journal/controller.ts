import type { ScriptLibrary } from '../scripts/library';
import { captureRecord, encodeFrame, freezeFrame, releaseFrame, type FrozenFrame } from './capture';
import { immutableCopy, credentialSource, type ChartSnapshot, type JournalAttachment, type JournalDraft, type JournalEntry, type JournalMarket } from './model';
import { freezeSnapshot, type SnapshotInput } from './snapshot';
import { imageAsset, IndexedDbJournalRepository, type JournalRepository } from './repository';

export interface JournalChartPort {
  id: string;
  root: HTMLElement;
  input(): SnapshotInput;
  chart: SnapshotInput['chart'];
  captureImage(): HTMLCanvasElement;
  currentMarketTime(): number | null;
  onSaved?(market: JournalMarket): void;
}

export interface JournalOpenOptions {
  entryId?: string;
  entryAt?: number;
  attachmentId?: string;
  draftId?: string;
}

interface FrozenChartAction { chartId: string; snapshot: ChartSnapshot; frame: FrozenFrame; entryAt: number; captureId: string; attachmentId: string }
type CaptureDecision = 'retry' | 'continue' | 'discard';
type OpenJournal = (options?: JournalOpenOptions) => void;

export class JournalController {
  readonly repository: JournalRepository;
  private pending = new Map<string, Promise<void>>();
  private publishedCallbacks = new Map<string, { chartId: string; invoke: () => void }>();
  private attachedCharts = new Set<string>();
  private openJournal?: OpenJournal;
  private toast = document.createElement('aside');
  private toastTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(repository: JournalRepository, private readonly library: ScriptLibrary) {
    this.repository = repository;
    this.toast.className = 'journal-toast';
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;
    document.body.append(this.toast);
  }

  static create(library: ScriptLibrary) { return new JournalController(new IndexedDbJournalRepository(), library); }

  setOpenJournal(handler: OpenJournal) { this.openJournal = handler; }
  attachChart(id: string) { this.attachedCharts.add(id); }
  open(options?: JournalOpenOptions) { this.openJournal?.(options); }
  openEntry(entryId: string, entryAt?: number, attachmentId?: string) { this.open({ entryId, entryAt, attachmentId }); }

  /** Resolve a source-chart callback only after the journal entry transaction commits. */
  published(entry: JournalEntry) {
    for (const attachment of entry.attachments) {
      const captureId = attachment.chartCapture?.id;
      const callback = captureId ? this.publishedCallbacks.get(captureId) : undefined;
      if (callback) { this.publishedCallbacks.delete(captureId!); callback.invoke(); }
    }
  }

  addToJournal(port: JournalChartPort, anchor?: number): Promise<void> {
    const existing = this.pending.get(`${port.id}:add`);
    if (existing) return existing;
    let frozen: FrozenChartAction;
    try { frozen = this.freeze(port, anchor); }
    catch (error) { this.message(`Capture unavailable: ${errorText(error)}`); return Promise.resolve(); }
    const work = this.persistChartDraft(frozen, port.onSaved).finally(() => this.pending.delete(`${port.id}:add`));
    this.pending.set(`${port.id}:add`, work);
    return work;
  }

  copyChartImage(port: JournalChartPort): Promise<void> {
    const existing = this.pending.get(`${port.id}:copy`);
    if (existing) return existing;
    let frozen: FrozenChartAction;
    try { frozen = this.freeze(port); }
    catch (error) { this.message(`Chart image unavailable: ${errorText(error)}`); return Promise.resolve(); }
    // Ask for clipboard access in this click turn. Chromium/WebKit may reject a
    // delayed write even when the original toolbar gesture was legitimate.
    const encoded = encodeFrame(frozen.frame);
    let clipboardWrite: Promise<void> | undefined, clipboardStartError: unknown;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw Error('Image clipboard is unsupported in this browser');
      const png = encoded.then(result => {
        if (result.warnings.length) throw Error('The compositor reported capture warnings.');
        return result.image;
      });
      clipboardWrite = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } catch (error) { clipboardStartError = error; }
    const work = this.finishCopy(frozen, encoded, clipboardWrite, clipboardStartError).finally(() => this.pending.delete(`${port.id}:copy`));
    this.pending.set(`${port.id}:copy`, work);
    return work;
  }

  downloadChartImage(port: JournalChartPort): Promise<void> {
    const existing = this.pending.get(`${port.id}:download`);
    if (existing) return existing;
    let frozen: FrozenChartAction;
    try { frozen = this.freeze(port); }
    catch (error) { this.message(`PNG unavailable: ${errorText(error)}`); return Promise.resolve(); }
    const work = this.downloadFrozen(frozen).finally(() => this.pending.delete(`${port.id}:download`));
    this.pending.set(`${port.id}:download`, work);
    return work;
  }

  private freeze(port: JournalChartPort, anchor?: number): FrozenChartAction {
    let canvas: HTMLCanvasElement | undefined;
    try {
      // The chart image, current configuration and DOM ink are frozen before any asynchronous work or dialog.
      canvas = port.captureImage();
      const input = port.input(), capturedAt = Date.now(), snapshot = freezeSnapshot(input, capturedAt);
      const entryAt = anchor ?? port.currentMarketTime();
      if (entryAt === null) throw Error('No observed chart time is available. Wait for chart data or add a note from the Journal.');
      const title = `${snapshot.market.venue} · ${snapshot.market.symbol} ${snapshot.market.market} · ${snapshot.config.interval} · captured ${new Date(capturedAt).toISOString()}`;
      const frame = freezeFrame(port.chart, port.root, title, canvas);
      canvas = undefined;
      return { chartId: port.id, snapshot, frame, entryAt, captureId: crypto.randomUUID(), attachmentId: crypto.randomUUID() };
    } catch (error) {
      if (canvas) canvas.width = canvas.height = 0;
      throw error;
    }
  }

  private async enriched(snapshot: ChartSnapshot) {
    const scripts = await Promise.all(snapshot.scripts.map(async script => {
      const revision = await this.library.getRevision(script.scriptId, script.revisionId).catch(() => null);
      return revision ? { ...script, contentHash: revision.contentHash, ...(!credentialSource(revision.source) ? { source: revision.source } : {}) } : script;
    }));
    return immutableCopy({ ...snapshot, scripts, warnings: [...snapshot.warnings, ...scripts.filter(script => !script.contentHash).map(script => `Exact local script revision ${script.revisionId} was unavailable at capture.`)] });
  }

  private async encodeWithChoices(frame: FrozenFrame, purpose: 'journal' | 'copy' | 'download') {
    let attempt = 0;
    for (;;) {
      try {
        const encoded = await encodeFrame(frame);
        if (!encoded.warnings.length) return encoded;
        if (purpose === 'copy') return encoded;
        const decision = await this.captureDialog(`${purpose === 'journal' ? 'This chart capture is partial.' : 'This PNG is partial.'}\n\n${encoded.warnings.join('\n')}`, true);
        if (decision === 'continue') return encoded;
        if (decision === 'discard' || ++attempt >= 3) return null;
      } catch (error) {
        const decision = await this.captureDialog(`The chart image could not be encoded: ${errorText(error)}`, false);
        if (decision !== 'retry' || ++attempt >= 3) throw error;
      }
    }
  }

  private async persistChartDraft(frozen: FrozenChartAction, onSaved?: (market: JournalMarket) => void) {
    try {
      const encoded = await this.encodeWithChoices(frozen.frame, 'journal');
      if (!encoded) { this.message('Capture draft discarded; no journal entry or marker was created.'); return; }
      const snapshot = await this.enriched(frozen.snapshot);
      const imageId = `${frozen.captureId}:image`, thumbnailId = `${frozen.captureId}:thumbnail`;
      const assets = await Promise.all([imageAsset(imageId, encoded.image), imageAsset(thumbnailId, encoded.thumbnail)]);
      const chartCapture = captureRecord(snapshot, frozen.captureId, imageId, thumbnailId, encoded.warnings, frozen.entryAt);
      const attachment: JournalAttachment = {
        id: frozen.attachmentId, kind: 'chart-capture', assetId: imageId, thumbnailAssetId: thumbnailId,
        alt: 'Frozen chart image', caption: `${snapshot.market.venue} · ${snapshot.market.symbol} · captured ${new Date(snapshot.capturedAt).toISOString()}`,
        chartCapture,
      };
      const now = Date.now();
      const draft: JournalDraft = {
        version: 2, id: crypto.randomUUID(), entryAt: frozen.entryAt, createdAt: now, updatedAt: now,
        bodyMarkdown: `![${attachment.alt}](attachment:${attachment.id})`, tags: [], kind: 'note', attachments: [attachment], relatedEntryIds: [],
      };
      await this.repository.saveDraft(draft, assets);
      if (onSaved && this.attachedCharts.has(frozen.chartId)) {
        this.publishedCallbacks.set(frozen.captureId, { chartId: frozen.chartId, invoke: () => onSaved(frozen.snapshot.market) });
        while (this.publishedCallbacks.size > 128) this.publishedCallbacks.delete(this.publishedCallbacks.keys().next().value!);
      }
      if (this.disposed) return;
      this.open({ draftId: draft.id, entryAt: draft.entryAt });
      this.message('Chart image saved as an unpublished journal draft. Save the entry to publish it.');
    } catch (error) {
      if (!this.disposed) this.message(`Chart draft was not saved: ${errorText(error)}. The chart image was not published.`);
    } finally { releaseFrame(frozen.frame); }
  }

  private async finishCopy(frozen: FrozenChartAction, encodedPromise: Promise<{ image: Blob; thumbnail: Blob; warnings: string[] }>, clipboardWrite?: Promise<void>, startError?: unknown) {
    try {
      const encoded = await encodedPromise.catch(error => { throw Error(`PNG encoding failed: ${errorText(error)}`); });
      let copied = false, failure = startError;
      if (clipboardWrite) {
        try { await clipboardWrite; copied = true; }
        catch (error) { failure = error; }
      }
      if (copied) { this.message('Chart image copied to the clipboard.'); return; }
      if (encoded.warnings.length) {
        const decision = await this.captureDialog(`The chart image has capture warnings:\n\n${encoded.warnings.join('\n')}`, true);
        if (decision !== 'continue') { this.message('Copy cancelled; no image was copied or downloaded.'); return; }
        try {
          if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw Error('Image clipboard is unsupported in this browser');
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': encoded.image })]);
          this.message(`Chart image copied with ${encoded.warnings.length} capture warning${encoded.warnings.length === 1 ? '' : 's'}.`);
          return;
        } catch (error) { failure = error; }
      }
      this.downloadBlob(encoded.image, 'iqterminal-chart.png');
      this.message(`Clipboard copy failed (${errorText(failure ?? 'Clipboard write was unavailable')}); PNG download started${encoded.warnings.length ? ' with capture warnings' : ''}.`);
    } catch (error) {
      this.message(`Chart image was not copied or downloaded: ${errorText(error)}`);
    } finally { releaseFrame(frozen.frame); }
  }

  private async downloadFrozen(frozen: FrozenChartAction) {
    try {
      const encoded = await this.encodeWithChoices(frozen.frame, 'download');
      if (!encoded) { this.message('PNG download cancelled; no file was created.'); return; }
      this.downloadBlob(encoded.image, 'iqterminal-chart.png');
      this.message(encoded.warnings.length ? `PNG download started with ${encoded.warnings.length} capture warning${encoded.warnings.length === 1 ? '' : 's'}.` : 'PNG download started.');
    } catch (error) { this.message(`PNG was not downloaded: ${errorText(error)}`); }
    finally { releaseFrame(frozen.frame); }
  }

  private captureDialog(message: string, allowContinue: boolean): Promise<CaptureDecision> {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.className = 'indicator-settings journal-capture-warning';
      dialog.setAttribute('aria-label', 'Chart image capture status');
      const form = document.createElement('div'); form.className = 'indicator-settings-form';
      const title = document.createElement('h2'); title.textContent = allowContinue ? 'Capture needs review' : 'Capture failed';
      const detail = document.createElement('p'); detail.textContent = message;
      const buttons = document.createElement('div'); buttons.className = 'journal-capture-warning-actions';
      const finish = (choice: CaptureDecision) => { if (!dialog.open) return; dialog.close(); resolve(choice); };
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry frozen capture'; retry.onclick = () => finish('retry');
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Discard'; cancel.onclick = () => finish('discard');
      buttons.append(retry);
      if (allowContinue) { const proceed = document.createElement('button'); proceed.type = 'button'; proceed.textContent = 'Continue with warnings'; proceed.onclick = () => finish('continue'); buttons.append(proceed); }
      buttons.append(cancel); form.append(title, detail, buttons); dialog.append(form); document.body.append(dialog);
      dialog.addEventListener('close', () => { dialog.remove(); resolve('discard'); }, { once: true });
      dialog.showModal(); retry.focus();
    });
  }

  private downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private message(text: string, action?: () => void) {
    clearTimeout(this.toastTimer); this.toast.replaceChildren();
    const content = document.createElement(action ? 'button' : 'span'); content.textContent = text;
    if (action) content.addEventListener('click', action, { once: true });
    this.toast.append(content); this.toast.hidden = false; this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, action ? 12000 : 8000);
  }

  detachChart(id: string) {
    this.attachedCharts.delete(id);
    for (const [captureId, callback] of this.publishedCallbacks) if (callback.chartId === id) this.publishedCallbacks.delete(captureId);
  }

  dispose() {
    this.disposed = true; clearTimeout(this.toastTimer); this.toast.remove();
    this.publishedCallbacks.clear(); this.attachedCharts.clear(); this.repository.close();
  }
}

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
