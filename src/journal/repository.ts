import {
  JOURNAL_LIMITS, marketIdentity, utcMs, validateCapture, validateDraft, validateEntry,
  type ChartCapture, type JournalAsset, type JournalAttachment, type JournalChartLink,
  type JournalChartLinkQuery, type JournalDraft, type JournalEntry, type JournalQuery,
} from './model';
import { validateImageBytes } from './image-format';

export interface JournalChange { entryId?: string; draftId?: string; instrument?: string; kind?: 'entry' | 'draft' }
export type JournalSaveResult = { status: 'added' | 'updated' | 'duplicate' };
export interface JournalImportResult { added: number; duplicates: number; draftsAdded: number; draftsDuplicates: number }
export interface JournalRepository {
  entry(id: string): Promise<JournalEntry | null>;
  asset(id: string): Promise<JournalAsset | null>;
  entries(query: JournalQuery): Promise<JournalEntry[] & { capped?: boolean }>;
  saveEntry(entry: JournalEntry, assets: readonly JournalAsset[], expectedUpdatedAt?: number): Promise<JournalSaveResult>;
  deleteEntry(id: string): Promise<void>;
  draft(id: string): Promise<JournalDraft | null>;
  drafts(): Promise<JournalDraft[]>;
  saveDraft(draft: JournalDraft, assets: readonly JournalAsset[]): Promise<JournalSaveResult>;
  deleteDraft(id: string): Promise<void>;
  publishDraft(draftId: string, entry: JournalEntry, assets: readonly JournalAsset[], expectedUpdatedAt?: number): Promise<JournalSaveResult>;
  queryChartLinks(query: JournalChartLinkQuery): Promise<JournalChartLink[]>;
  /** Import is one atomic write so a later conflict cannot leave a partial archive. */
  importRecords(entries: readonly JournalEntry[], drafts: readonly JournalDraft[], assets: readonly JournalAsset[]): Promise<JournalImportResult>;
  subscribe(listener: (change: JournalChange) => void): () => void;
  usage(): Promise<{ entries: number; drafts: number; assets: number; bytes: number; browserUsage?: number; quota?: number }>;
  persist(): Promise<boolean>;
  close(): void;
}

export const JOURNAL_DATABASE = 'iqterminal-journal-v1';
export const JOURNAL_DATABASE_VERSION = 2;

export class JournalConflictError extends Error {
  constructor(message = 'This journal record changed in another editor. Reopen it before saving.') { super(message); this.name = 'JournalConflictError'; }
}
export class JournalQuotaError extends Error {
  constructor() { super('Browser storage is full. Export a journal backup or remove unused attachments, then retry.'); this.name = 'JournalQuotaError'; }
}
export class JournalBlockedError extends Error {
  constructor() { super('Journal database upgrade is blocked by another tab. Close the older tab and retry.'); this.name = 'JournalBlockedError'; }
}
const REQUEST_FAILED = 'Journal storage request failed';

const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error ?? Error(REQUEST_FAILED));
});
const errorName = (error: unknown) => error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
function storageError(error: unknown): unknown { return errorName(error) === 'QuotaExceededError' ? new JournalQuotaError() : error; }
function stableJson(value: unknown): string {
  const normalize = (v: any): any => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(key => [key, normalize(v[key])])) : v;
  return JSON.stringify(normalize(value));
}
function sameRecord(a: unknown, b: unknown) { return stableJson(a) === stableJson(b); }
function sameAsset(a: JournalAsset, b: JournalAsset) { return a.id === b.id && a.sha256.toLowerCase() === b.sha256.toLowerCase() && a.bytes === b.bytes && a.mime === b.mime; }
function queryLimit(value: number | undefined) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw Error('Journal query limit must be a positive integer');
  return Math.min(JOURNAL_LIMITS.query, value ?? 100);
}
function cursorDeleteBy(index: IDBIndex, key: IDBValidKey) {
  return new Promise<void>((resolve, reject) => {
    const cursor = index.openCursor(IDBKeyRange.only(key));
    cursor.onerror = () => reject(cursor.error ?? Error(REQUEST_FAILED));
    cursor.onsuccess = () => { const value = cursor.result; if (!value) { resolve(); return; } value.delete(); value.continue(); };
  });
}
function imageReferences(attachments: readonly JournalAttachment[]) {
  const result = new Set<string>();
  for (const attachment of attachments) {
    result.add(attachment.assetId);
    if (attachment.thumbnailAssetId) result.add(attachment.thumbnailAssetId);
  }
  return [...result];
}
function entryAttachments(entry: JournalEntry): JournalAttachment[] { return [...entry.attachments, ...entry.revisions.flatMap(revision => revision.attachments)]; }
function entryImageReferences(entry: JournalEntry) { return imageReferences(entryAttachments(entry)); }
function chartLinks(entry: JournalEntry) {
  return entry.attachments.flatMap(attachment => {
    const capture = attachment.kind === 'chart-capture' ? attachment.chartCapture : undefined;
    if (!capture || capture.marketTime === undefined) return [];
    return [{ instrument: marketIdentity(capture.snapshot.market), marketTime: capture.marketTime, entryId: entry.id, attachmentId: attachment.id }];
  });
}
async function checkedAssets(assets: readonly JournalAsset[]) {
  if (!Array.isArray(assets) || assets.length > JOURNAL_LIMITS.attachments * 2) throw Error('Too many journal assets in one save');
  const ids = new Set<string>(); let total = 0;
  for (const asset of assets) {
    validateAsset(asset);
    if (ids.has(asset.id)) throw Error('Duplicate asset id in journal save');
    ids.add(asset.id); total += asset.bytes;
    if (total > JOURNAL_LIMITS.archiveBytes) throw Error('Journal assets exceed the 100 MB transaction limit');
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    validateImageBytes(bytes, asset.mime);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (sha256 !== asset.sha256) throw Error('Journal asset checksum does not match its content');
  }
  return [...assets];
}

export class IndexedDbJournalRepository implements JournalRepository {
  private database?: Promise<IDBDatabase>;
  private listeners = new Set<(change: JournalChange) => void>();
  private channel?: BroadcastChannel;
  private closed = false;
  constructor(private readonly factory?: IDBFactory, private readonly name = JOURNAL_DATABASE) {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(`${name}:changes`);
        this.channel.onmessage = event => {
          if (event.data?.type !== 'journal-change') return;
          const change = event.data.change && typeof event.data.change === 'object' ? event.data.change as JournalChange : {};
          this.notify(change);
        };
      }
    } catch { /* Same-tab subscriptions work when browser messaging is denied. */ }
  }
  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(Error('Journal repository is closed'));
    if (this.database) return this.database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      let settled = false;
      let openRequest: IDBOpenDBRequest;
      try { openRequest = (this.factory ?? globalThis.indexedDB).open(this.name, JOURNAL_DATABASE_VERSION); }
      catch (error) { reject(storageError(error)); return; }
      openRequest.onupgradeneeded = event => {
        const db = openRequest.result, tx = openRequest.transaction;
        if (!tx) { reject(Error('Journal upgrade transaction unavailable')); return; }
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
        // R1 data uses incompatible records. Clear only its three journal stores once,
        // inside the v2 schema transaction; all unrelated stores remain untouched.
        if (oldVersion === 1) {
          for (const storeName of ['entries', 'captures', 'assets']) if (db.objectStoreNames.contains(storeName)) tx.objectStore(storeName).clear();
        }
        const ensure = (storeName: string, options: IDBObjectStoreParameters) => db.objectStoreNames.contains(storeName) ? tx.objectStore(storeName) : db.createObjectStore(storeName, options);
        const entries = ensure('entries', { keyPath: 'id' });
        for (const indexName of Array.from(entries.indexNames)) entries.deleteIndex(indexName);
        entries.createIndex('entryAtId', ['entryAt', 'id']);
        entries.createIndex('updatedAtId', ['updatedAt', 'id']);
        const assets = ensure('assets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('drafts')) {
          const drafts = db.createObjectStore('drafts', { keyPath: 'id' }); drafts.createIndex('updatedAtId', ['updatedAt', 'id']);
        } else {
          const drafts = tx.objectStore('drafts');
          if (!drafts.indexNames.contains('updatedAtId')) drafts.createIndex('updatedAtId', ['updatedAt', 'id']);
        }
        if (!db.objectStoreNames.contains('chartLinks')) {
          const links = db.createObjectStore('chartLinks', { keyPath: ['instrument', 'marketTime', 'entryId', 'attachmentId'] });
          links.createIndex('entryId', 'entryId'); links.createIndex('instrumentTime', ['instrument', 'marketTime', 'entryId', 'attachmentId']);
        }
        if (!db.objectStoreNames.contains('assetRefs')) {
          const refs = db.createObjectStore('assetRefs', { keyPath: ['assetId', 'ownerType', 'ownerId', 'attachmentId'] });
          refs.createIndex('assetId', 'assetId'); refs.createIndex('owner', ['ownerType', 'ownerId']);
        }
        void assets;
      };
      openRequest.onblocked = () => { blocked = true; if (!settled) { settled = true; reject(new JournalBlockedError()); } };
      openRequest.onerror = () => { if (!settled) { settled = true; reject(storageError(openRequest.error ?? Error('Journal storage unavailable'))); } };
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        if (blocked || this.closed) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.database = undefined; };
        db.onclose = () => { if (!this.closed) this.database = undefined; };
        if (!settled) { settled = true; resolve(db); }
      };
    });
    const cached = opening.catch(error => { if (this.database === cached) this.database = undefined; throw storageError(error); });
    this.database = cached;
    return cached;
  }
  private async transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(stores, mode); }
      catch (error) { reject(storageError(error)); return; }
      let result: T, failure: unknown, workDone = false, settled = false;
      tx.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
      tx.onabort = () => { if (!settled) { settled = true; reject(storageError(failure ?? tx.error ?? Error('Journal transaction interrupted; nothing was saved'))); } };
      tx.onerror = () => { failure ??= tx.error; };
      void work(tx).then(value => { result = value; workDone = true; }).catch(error => {
        failure = error;
        try { tx.abort(); } catch { if (!settled) { settled = true; reject(storageError(error)); } }
      });
      void workDone;
    });
  }
  async entry(id: string) {
    const raw = await this.transaction(['entries'], 'readonly', tx => request(tx.objectStore('entries').get(id)));
    return raw ? validateEntry(raw) : null;
  }
  async asset(id: string) {
    return this.transaction(['assets'], 'readonly', async tx => {
      const raw = await request(tx.objectStore('assets').get(id));
      if (!raw) return null;
      validateAsset(raw); return raw as JournalAsset;
    });
  }
  entries(query: JournalQuery) {
    if (query.order !== undefined && query.order !== 'newest' && query.order !== 'oldest') throw Error('Invalid journal order');
    if (query.from !== undefined) utcMs(query.from);
    if (query.to !== undefined) utcMs(query.to);
    if (query.before) { utcMs(query.before.entryAt); if (!query.before.id || query.before.id.length > 180 || /[\u0000-\u001f]/.test(query.before.id)) throw Error('Invalid journal page cursor'); }
    if (query.instrument !== undefined && (typeof query.instrument !== 'string' || query.instrument.length > 512)) throw Error('Invalid chart-context filter');
    if (query.text !== undefined && (typeof query.text !== 'string' || query.text.length > JOURNAL_LIMITS.note)) throw Error('Invalid journal text filter');
    if (query.tag !== undefined && (typeof query.tag !== 'string' || query.tag.length > 64)) throw Error('Invalid journal tag filter');
    if (query.kind !== undefined && (typeof query.kind !== 'string' || query.kind.length > JOURNAL_LIMITS.kind)) throw Error('Invalid journal kind filter');
    const limit = queryLimit(query.limit);
    if (query.from !== undefined && query.to !== undefined && query.from >= query.to) return Promise.resolve(withCapped([]));
    return this.transaction(['entries'], 'readonly', tx => new Promise<JournalEntry[] & { capped?: boolean }>((resolve, reject) => {
      const newest = (query.order ?? 'newest') === 'newest';
      const store = tx.objectStore('entries'), index = store.index('entryAtId');
      let low: IDBValidKey = [query.from ?? 0, ''], high: IDBValidKey = query.to === undefined ? [Number.MAX_SAFE_INTEGER, []] : [query.to];
      let lowerOpen = false, upperOpen = query.to !== undefined;
      if (query.before) {
        const cursorKey: IDBValidKey = [query.before.entryAt, query.before.id];
        if (newest && (query.to === undefined || query.before.entryAt < query.to)) { high = cursorKey; upperOpen = true; }
        else if (!newest && (query.from === undefined || query.before.entryAt >= query.from)) { low = cursorKey; lowerOpen = true; }
      }
      const lowTime = Number((low as unknown[])[0]), highTime = Number((high as unknown[])[0]);
      if (lowTime > highTime || (lowTime === highTime && (lowerOpen || upperOpen))) { resolve(withCapped([])); return; }
      let range: IDBKeyRange;
      try { range = IDBKeyRange.bound(low, high, lowerOpen, upperOpen); } catch { resolve(withCapped([])); return; }
      const cursor = index.openCursor(range, newest ? 'prev' : 'next'), found: JournalEntry[] = []; let scanned = 0;
      cursor.onerror = () => reject(cursor.error ?? Error('Journal query failed'));
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current || found.length >= limit) { resolve(withCapped(found)); return; }
        if (scanned >= 10_000) { resolve(withCapped(found, true)); return; }
        scanned++;
        try {
          const entry = validateEntry(current.value), search = query.text?.trim().toLowerCase();
          const matchesInstrument = !query.instrument || entry.attachments.some(attachment => attachment.kind === 'chart-capture' && attachment.chartCapture && marketIdentity(attachment.chartCapture.snapshot.market) === query.instrument);
          const matchesText = !search || [entry.title ?? '', entry.bodyMarkdown, ...entry.tags, entry.kind, ...entry.attachments.flatMap(attachment => [attachment.alt ?? '', attachment.caption ?? ''])].join(' ').toLowerCase().includes(search);
          if (matchesInstrument && matchesText && (!query.tag || entry.tags.includes(query.tag)) && (!query.kind || entry.kind === query.kind)) found.push(entry);
          current.continue();
        } catch (error) { reject(error); }
      };
    }));
  }
  async saveEntry(input: JournalEntry, inputAssets: readonly JournalAsset[], expectedUpdatedAt?: number) {
    const entry = validateEntry(input), assets = await checkedAssets(inputAssets);
    if (expectedUpdatedAt !== undefined) utcMs(expectedUpdatedAt);
    const result = await this.transaction(['entries', 'assets', 'chartLinks', 'assetRefs'], 'readwrite', async tx => this.writeEntry(tx, entry, assets, expectedUpdatedAt));
    if (result.status !== 'duplicate') this.changed({ kind: 'entry', entryId: entry.id });
    return result;
  }
  async deleteEntry(id: string) {
    const changed = await this.transaction(['entries', 'assets', 'chartLinks', 'assetRefs'], 'readwrite', async tx => {
      const entries = tx.objectStore('entries'), raw = await request(entries.get(id)); if (!raw) return false;
      const entry = validateEntry(raw); await request(entries.delete(id));
      const assetIds = entryImageReferences(entry);
      await this.removeOwnerReferences(tx, 'entry', id); await this.removeEntryLinks(tx, id);
      await this.collectAssets(tx, assetIds); return true;
    });
    if (changed) this.changed({ kind: 'entry', entryId: id });
  }
  async draft(id: string) {
    const raw = await this.transaction(['drafts'], 'readonly', tx => request(tx.objectStore('drafts').get(id)));
    return raw ? validateDraft(raw) : null;
  }
  async drafts() {
    return this.transaction(['drafts'], 'readonly', tx => request(tx.objectStore('drafts').getAll()).then(raw => (raw as unknown[]).map(validateDraft).sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))));
  }
  async saveDraft(input: JournalDraft, inputAssets: readonly JournalAsset[]) {
    const draft = validateDraft(input), assets = await checkedAssets(inputAssets);
    const result = await this.transaction(['entries', 'drafts', 'assets', 'assetRefs'], 'readwrite', async tx => {
      if (draft.editingEntryId) {
        const entryRaw = await request(tx.objectStore('entries').get(draft.editingEntryId));
        if (!entryRaw || validateEntry(entryRaw).updatedAt !== draft.expectedUpdatedAt) throw new JournalConflictError('The entry being edited changed in another tab. Reopen it before saving this draft.');
      }
      const store = tx.objectStore('drafts'), oldRaw = await request(store.get(draft.id));
      if (oldRaw) {
        const old = validateDraft(oldRaw);
        if (sameRecord(old, draft)) return { status: 'duplicate' as const };
        if (draft.updatedAt <= old.updatedAt || old.editingEntryId !== draft.editingEntryId) throw new JournalConflictError('This draft changed in another tab. Reopen it before saving.');
      }
      await this.ensureAssets(tx, assets, draft.attachments);
      await request(store.put(draft));
      await this.replaceOwnerReferences(tx, 'draft', draft.id, draft.attachments);
      if (oldRaw) await this.collectAssets(tx, imageReferences(validateDraft(oldRaw).attachments));
      return { status: oldRaw ? 'updated' as const : 'added' as const };
    });
    if (result.status !== 'duplicate') this.changed({ kind: 'draft', draftId: draft.id });
    return result;
  }
  async deleteDraft(id: string) {
    const changed = await this.transaction(['drafts', 'assets', 'assetRefs'], 'readwrite', async tx => {
      const store = tx.objectStore('drafts'), raw = await request(store.get(id)); if (!raw) return false;
      const draft = validateDraft(raw); await request(store.delete(id));
      const assetIds = imageReferences(draft.attachments); await this.removeOwnerReferences(tx, 'draft', id); await this.collectAssets(tx, assetIds); return true;
    });
    if (changed) this.changed({ kind: 'draft', draftId: id });
  }
  async publishDraft(draftId: string, input: JournalEntry, inputAssets: readonly JournalAsset[], expectedUpdatedAt?: number) {
    const entry = validateEntry(input), assets = await checkedAssets(inputAssets);
    if (expectedUpdatedAt !== undefined) utcMs(expectedUpdatedAt);
    const result = await this.transaction(['entries', 'drafts', 'assets', 'chartLinks', 'assetRefs'], 'readwrite', async tx => {
      const drafts = tx.objectStore('drafts'), rawDraft = await request(drafts.get(draftId));
      const draft = rawDraft ? validateDraft(rawDraft) : null;
      const expected = expectedUpdatedAt ?? draft?.expectedUpdatedAt;
      if (draft?.editingEntryId && (draft.editingEntryId !== entry.id || (expectedUpdatedAt !== undefined && expectedUpdatedAt !== draft.expectedUpdatedAt))) throw new JournalConflictError('The edit draft no longer matches the entry being published. Reopen it before saving.');
      const neededAssets = new Set(imageReferences(entryAttachments(entry)));
      const saved = await this.writeEntry(tx, entry, assets.filter(asset => neededAssets.has(asset.id)), expected);
      if (draft) {
        await request(drafts.delete(draftId));
        const refs = imageReferences(draft.attachments); await this.removeOwnerReferences(tx, 'draft', draftId); await this.collectAssets(tx, refs);
      }
      return { saved, hadDraft: Boolean(draft) };
    });
    if (result.saved.status !== 'duplicate') this.changed({ kind: 'entry', entryId: entry.id });
    if (result.hadDraft) this.changed({ kind: 'draft', draftId });
    return result.saved;
  }
  async queryChartLinks(query: JournalChartLinkQuery): Promise<JournalChartLink[]> {
    const instrument = String(query.instrument ?? '').trim(); if (!instrument || instrument.length > 512) throw Error('Chart link query requires an instrument identity');
    const from = utcMs(query.from), to = utcMs(query.to); if (from >= to) return [];
    const limit = queryLimit(query.limit);
    return this.transaction(['entries', 'chartLinks'], 'readonly', tx => new Promise<JournalChartLink[]>((resolve, reject) => {
      const index = tx.objectStore('chartLinks').index('instrumentTime');
      const range = IDBKeyRange.bound([instrument, from, '', ''], [instrument, to, '', ''], false, true);
      const cursor = index.openCursor(range, 'next'), found: JournalChartLink[] = []; let scanned = 0;
      cursor.onerror = () => reject(cursor.error ?? Error('Journal chart link query failed'));
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current || found.length >= limit || scanned >= 10_000) { resolve(found); return; }
        scanned++;
        const link = current.value as ChartLinkRecord;
        void request(tx.objectStore('entries').get(link.entryId)).then(raw => {
          if (raw) {
            try {
              const entry = validateEntry(raw), attachment = entry.attachments.find(item => item.id === link.attachmentId);
              if (attachment?.kind === 'chart-capture' && attachment.chartCapture && marketIdentity(attachment.chartCapture.snapshot.market) === instrument && attachment.chartCapture.marketTime === link.marketTime) found.push({ entry, attachment });
            } catch (error) { reject(error); return; }
          }
          current.continue();
        }, reject);
      };
    }));
  }
  async importRecords(inputEntries: readonly JournalEntry[], inputDrafts: readonly JournalDraft[], inputAssets: readonly JournalAsset[]): Promise<JournalImportResult> {
    if (!inputEntries.length && !inputDrafts.length) throw Error('Journal backup contains no entries or drafts');
    if (inputEntries.length > JOURNAL_LIMITS.entriesPerImport || inputDrafts.length > JOURNAL_LIMITS.entriesPerImport) throw Error('Journal import record count exceeds the limit');
    const entries = inputEntries.map(validateEntry), drafts = inputDrafts.map(validateDraft), assets = await checkedAssets(inputAssets);
    if (new Set(entries.map(entry => entry.id)).size !== entries.length || new Set(drafts.map(draft => draft.id)).size !== drafts.length) throw Error('Duplicate record ids inside backup');
    if (entries.some(entry => drafts.some(draft => draft.id === entry.id))) throw Error('Entry and draft ids overlap inside backup');
    const result = await this.transaction(['entries', 'drafts', 'assets', 'chartLinks', 'assetRefs'], 'readwrite', async tx => {
      const entryStore = tx.objectStore('entries'), draftStore = tx.objectStore('drafts');
      const newEntries: JournalEntry[] = [], newDrafts: JournalDraft[] = []; let duplicates = 0, draftsDuplicates = 0;
      for (const entry of entries) {
        const oldRaw = await request(entryStore.get(entry.id));
        if (!oldRaw) { newEntries.push(entry); continue; }
        if (!sameRecord(validateEntry(oldRaw), entry)) throw new JournalConflictError(`Entry ID conflict for ${entry.id}; existing entry was preserved.`);
        duplicates++;
      }
      for (const draft of drafts) {
        const oldRaw = await request(draftStore.get(draft.id));
        if (!oldRaw) { newDrafts.push(draft); continue; }
        if (!sameRecord(validateDraft(oldRaw), draft)) throw new JournalConflictError(`Draft ID conflict for ${draft.id}; existing draft was preserved.`);
        draftsDuplicates++;
      }
      const allIncomingAttachments = [...entries.flatMap(entryAttachments), ...drafts.map(d => d.attachments)].flat();
      this.assertNoUnreferencedAssets(assets, allIncomingAttachments);
      await this.ensureAssets(tx, assets, allIncomingAttachments);
      for (const entry of newEntries) {
        await request(entryStore.add(entry));
      }
      for (const draft of newDrafts) {
        await request(draftStore.add(draft));
      }
      for (const entry of entries) {
        await this.replaceOwnerReferences(tx, 'entry', entry.id, entryAttachments(entry)); await this.removeEntryLinks(tx, entry.id); await this.addEntryLinks(tx, entry);
      }
      for (const draft of drafts) await this.replaceOwnerReferences(tx, 'draft', draft.id, draft.attachments);
      return { added: newEntries.length, duplicates, draftsAdded: newDrafts.length, draftsDuplicates };
    });
    if (result.added) this.changed({ kind: 'entry' });
    if (result.draftsAdded) this.changed({ kind: 'draft' });
    return result;
  }
  subscribe(listener: (change: JournalChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async usage() {
    const own = await this.transaction(['entries', 'drafts', 'assets'], 'readonly', async tx => {
      const assets = await request(tx.objectStore('assets').getAll()) as JournalAsset[];
      return { entries: await request(tx.objectStore('entries').count()), drafts: await request(tx.objectStore('drafts').count()), assets: assets.length, bytes: assets.reduce((sum, asset) => sum + (Number(asset.bytes) || 0), 0) };
    });
    const storage = (globalThis as any).navigator?.storage;
    const estimate = typeof storage?.estimate === 'function' ? await storage.estimate().catch(() => undefined) : undefined;
    return { ...own, browserUsage: estimate?.usage, quota: estimate?.quota };
  }
  async persist() {
    const storage = (globalThis as any).navigator?.storage;
    return typeof storage?.persist === 'function' ? storage.persist() : false;
  }
  close() {
    this.closed = true;
    const database = this.database; this.database = undefined;
    void database?.then(db => db.close(), () => {});
    this.channel?.close(); this.channel = undefined; this.listeners.clear();
  }
  private async writeEntry(tx: IDBTransaction, entry: JournalEntry, assets: readonly JournalAsset[], expectedUpdatedAt?: number): Promise<JournalSaveResult> {
    const store = tx.objectStore('entries'), raw = await request(store.get(entry.id));
    if (raw) {
      const old = validateEntry(raw);
      if (sameRecord(old, entry)) return { status: 'duplicate' };
      if (expectedUpdatedAt === undefined || old.updatedAt !== expectedUpdatedAt) throw new JournalConflictError();
      if (entry.createdAt !== old.createdAt || entry.revisions.length !== old.revisions.length + 1 || !sameRecord(entry.revisions.slice(0, -1), old.revisions)) throw new JournalConflictError('Entry revision history changed. Reopen the entry before saving.');
    } else if (expectedUpdatedAt !== undefined) throw new JournalConflictError('The entry being edited no longer exists.');
    const oldEntry = raw ? validateEntry(raw) : null;
    const attachments = entryAttachments(entry);
    await this.ensureAssets(tx, assets, attachments);
    await request(store.put(entry));
    if (oldEntry) {
      await this.removeOwnerReferences(tx, 'entry', entry.id); await this.removeEntryLinks(tx, entry.id);
    }
    await this.replaceOwnerReferences(tx, 'entry', entry.id, attachments); await this.addEntryLinks(tx, entry);
    if (oldEntry) await this.collectAssets(tx, entryImageReferences(oldEntry));
    return { status: oldEntry ? 'updated' : 'added' };
  }
  private async ensureAssets(tx: IDBTransaction, incoming: readonly JournalAsset[], attachments: readonly JournalAttachment[]) {
    const store = tx.objectStore('assets'), supplied = new Map(incoming.map(asset => [asset.id, asset]));
    this.assertNoUnreferencedAssets(incoming, attachments);
    for (const asset of incoming) {
      const oldRaw = await request(store.get(asset.id));
      if (oldRaw) {
        validateAsset(oldRaw);
        if (!sameAsset(oldRaw as JournalAsset, asset)) throw new JournalConflictError(`Asset ID conflict for ${asset.id}; existing asset was preserved.`);
      } else await request(store.add(asset));
    }
    for (const id of imageReferences(attachments)) {
      const raw = supplied.get(id) ?? await request(store.get(id));
      if (!raw) throw Error(`Journal attachment asset ${id} is missing`);
      validateAsset(raw);
    }
  }
  private async replaceOwnerReferences(tx: IDBTransaction, ownerType: 'entry' | 'draft', ownerId: string, attachments: readonly JournalAttachment[]) {
    await this.removeOwnerReferences(tx, ownerType, ownerId);
    const store = tx.objectStore('assetRefs');
    for (const attachment of attachments) for (const assetId of new Set([attachment.assetId, attachment.thumbnailAssetId].filter((value): value is string => Boolean(value)))) {
      await request(store.put({ assetId, ownerType, ownerId, attachmentId: attachment.id } satisfies AssetReferenceRecord));
    }
  }
  private async removeOwnerReferences(tx: IDBTransaction, ownerType: 'entry' | 'draft', ownerId: string) {
    await cursorDeleteBy(tx.objectStore('assetRefs').index('owner'), [ownerType, ownerId]);
  }
  private async collectAssets(tx: IDBTransaction, candidates: readonly string[]) {
    const refs = tx.objectStore('assetRefs').index('assetId'), assets = tx.objectStore('assets');
    for (const assetId of new Set(candidates)) if (await request(refs.count(assetId)) === 0) await request(assets.delete(assetId));
  }
  private async addEntryLinks(tx: IDBTransaction, entry: JournalEntry) {
    const links = tx.objectStore('chartLinks');
    for (const link of chartLinks(entry)) await request(links.put(link));
  }
  private async removeEntryLinks(tx: IDBTransaction, entryId: string) {
    await cursorDeleteBy(tx.objectStore('chartLinks').index('entryId'), entryId);
  }
  private assertNoUnreferencedAssets(incoming: readonly JournalAsset[], attachments: readonly JournalAttachment[]) {
    const required = new Set(imageReferences(attachments));
    if (incoming.some(asset => !required.has(asset.id))) throw Error('Journal save contains an asset not referenced by an attachment');
  }
  private notify(change: JournalChange) { for (const listener of this.listeners) { try { listener(change); } catch { /* A view failure does not change committed state. */ } } }
  private changed(change: JournalChange) { this.notify(change); this.channel?.postMessage({ type: 'journal-change', change }); }
}

export function validateAsset(asset: JournalAsset) {
  if (!asset || typeof asset.id !== 'string' || !asset.id.length || asset.id.length > 180 || /[\u0000-\u001f]/.test(asset.id)
    || !(asset.blob instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime)
    || asset.blob.type !== asset.mime || asset.bytes !== asset.blob.size || asset.bytes <= 0 || asset.bytes > JOURNAL_LIMITS.assetBytes
    || !/^[a-f0-9]{64}$/i.test(asset.sha256)) throw Error('Invalid or oversized journal image asset');
}
export async function imageAsset(id: string, blob: Blob): Promise<JournalAsset> {
  if (!(blob instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw Error('Journal attachments must be PNG, JPEG, or WebP images');
  const bytes = new Uint8Array(await blob.arrayBuffer()); validateImageBytes(bytes, blob.type);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return { id, blob, mime: blob.type as JournalAsset['mime'], bytes: blob.size, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
}

interface ChartLinkRecord { instrument: string; marketTime: number; entryId: string; attachmentId: string }
interface AssetReferenceRecord { assetId: string; ownerType: 'entry' | 'draft'; ownerId: string; attachmentId: string }
function withCapped<T extends JournalEntry[]>(entries: T, capped = false): T & { capped?: boolean } {
  if (capped) Object.defineProperty(entries, 'capped', { value: true, enumerable: false });
  return entries as T & { capped?: boolean };
}
