import { JOURNAL_LIMITS, marketIdentity, validateCapture, validateEntry, type ChartCapture, type JournalAsset, type JournalBundle, type JournalEntry, type JournalQuery } from './model';

export interface JournalChange { instrument?: string; entryId?: string }
export interface JournalRepository {
  save(bundles: readonly JournalBundle[]): Promise<{ added: number; duplicates: number }>;
  entry(id: string): Promise<JournalEntry | null>; capture(id: string): Promise<ChartCapture | null>; asset(id: string): Promise<JournalAsset | null>;
  query(query: JournalQuery): Promise<JournalEntry[]>; update(entry: JournalEntry, expectedRevisions: number): Promise<void>; delete(id: string): Promise<void>;
  subscribe(listener: (change: JournalChange) => void): () => void; usage(): Promise<{ entries: number; assets: number; bytes: number; browserUsage?: number; quota?: number }>;
  persist(): Promise<boolean>; close(): void;
}
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error ?? Error('Journal storage request failed')); });
export const JOURNAL_DATABASE = 'iqterminal-journal-v1';
export class IndexedDbJournalRepository implements JournalRepository {
  private database?: Promise<IDBDatabase>;
  private listeners = new Set<(change: JournalChange) => void>();
  private channel?: BroadcastChannel;
  constructor(private readonly factory?: IDBFactory, private readonly name = JOURNAL_DATABASE) {
    try { if (typeof BroadcastChannel !== 'undefined') { this.channel = new BroadcastChannel(name); this.channel.onmessage = event => { if (event.data?.type === 'journal-change') for (const listener of this.listeners) { try { listener({}); } catch { /* Isolate failed views. */ } } }; } } catch { /* Storage policy can deny cross-tab messaging; same-tab subscriptions still work. */ }
  }
  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = (this.factory ?? globalThis.indexedDB).open(this.name, 1); let blocked = false;
      r.onupgradeneeded = () => { const db = r.result; const entries = db.createObjectStore('entries', { keyPath: 'id' }); entries.createIndex('instrumentTime', ['instrument', 'marketTime', 'id']); entries.createIndex('marketTime', ['marketTime', 'id']); entries.createIndex('createdAt', ['createdAt', 'id']); entries.createIndex('captureId', 'captureId'); const captures = db.createObjectStore('captures', { keyPath: 'id' }); captures.createIndex('image', 'image'); captures.createIndex('thumbnail', 'thumbnail'); db.createObjectStore('assets', { keyPath: 'id' }); };
      r.onsuccess = () => { const db = r.result; if (blocked) { db.close(); return; } db.onversionchange = () => db.close(); resolve(db); };
      r.onerror = () => { this.database = undefined; reject(r.error ?? Error('Journal storage unavailable')); };
      r.onblocked = () => { blocked = true; reject(Error('Journal database is blocked by another tab. Close the older tab and retry.')); };
    }).catch(error => { this.database = undefined; throw error; });
  }
  private async transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result: T, failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? Error('Journal transaction interrupted; nothing was saved'));
      void work(tx).then(value => { result = value; }).catch(error => { failure = error; try { tx.abort(); } catch { reject(error); } });
    });
  }
  async entry(id: string) { const raw = await this.transaction(['entries'], 'readonly', tx => request(tx.objectStore('entries').get(id))); return raw ? validateEntry(raw) : null; }
  async capture(id: string) { const raw = await this.transaction(['captures'], 'readonly', tx => request(tx.objectStore('captures').get(id))); return raw ? validateCapture(raw) : null; }
  async asset(id: string) { return this.transaction(['assets'], 'readonly', async tx => { const raw = await request(tx.objectStore('assets').get(id)); if (!raw) return null; validateAsset(raw); return raw as JournalAsset; }); }
  async save(input: readonly JournalBundle[]) {
    if (!input.length || input.length > JOURNAL_LIMITS.entriesPerImport) throw Error('Journal import entry count exceeds the limit');
    const bundles = input.map(bundle => { const entry = validateEntry(bundle.entry), capture = validateCapture(bundle.capture); if (entry.captureId !== capture.id || entry.capturedAt !== capture.capturedAt || entry.instrument !== marketIdentity(capture.snapshot.market)) throw Error('Entry and capture identities do not match'); const assets = bundle.assets; assets.forEach(validateAsset); if (assets.length > 2 || new Set(assets.map(a => a.id)).size !== assets.length || [capture.image, capture.thumbnail].filter(Boolean).some(id => !assets.some(a => a.id === id))) throw Error('Missing or duplicate image assets'); return { entry, capture, assets }; });
    const result = await this.transaction(['entries', 'captures', 'assets'], 'readwrite', async tx => {
      const entries = tx.objectStore('entries'), captures = tx.objectStore('captures'), assets = tx.objectStore('assets'); let added = 0, duplicates = 0;
      for (const bundle of bundles) {
        const oldCapture = await request(captures.get(bundle.capture.id));
        if (oldCapture && JSON.stringify(validateCapture(oldCapture)) !== JSON.stringify(bundle.capture)) throw Error('Capture ID conflict; existing capture was preserved');
        const oldEntry = await request(entries.get(bundle.entry.id));
        if (oldEntry) { if (validateEntry(oldEntry).captureId !== bundle.entry.captureId) throw Error('Entry ID conflict; existing entry was preserved'); duplicates++; continue; }
        for (const asset of bundle.assets) { const old = await request(assets.get(asset.id)); if (old && (old.sha256 !== asset.sha256 || old.bytes !== asset.bytes)) throw Error('Image ID conflict; existing image was preserved'); if (!old) await request(assets.add(asset)); }
        if (!oldCapture) await request(captures.add(bundle.capture));
        await request(entries.add(bundle.entry)); added++;
      }
      return { added, duplicates };
    });
    if (result.added) this.changed({}); return result;
  }
  query(query: JournalQuery) {
    return this.transaction(['entries'], 'readonly', tx => new Promise<JournalEntry[]>((resolve, reject) => {
      const limit = Math.max(1, Math.min(JOURNAL_LIMITS.query, query.limit ?? 100));
      const store = tx.objectStore('entries'), byInstrument = Boolean(query.instrument);
      const byMarketTime = byInstrument || query.from !== undefined || query.to !== undefined;
      const minimum = query.from ?? 0, maximum = query.to ?? Number.MAX_SAFE_INTEGER;
      const before = query.before ?? (query.createdBefore ? { time: query.createdBefore, id: '' } : undefined);
      const low = byInstrument ? [query.instrument!, minimum, ''] : [byMarketTime ? minimum : 0, ''];
      const highTime = Math.min(byMarketTime ? maximum : Number.MAX_SAFE_INTEGER, before?.time ?? Number.MAX_SAFE_INTEGER);
      if (highTime < minimum) { resolve([]); return; }
      const high = byInstrument ? [query.instrument!, highTime, before?.time === highTime ? before.id : '\uffff'] : [highTime, before?.time === highTime ? before.id : '\uffff'];
      const range = IDBKeyRange.bound(low, high, false, Boolean(before));
      const cursor = store.index(byInstrument ? 'instrumentTime' : byMarketTime ? 'marketTime' : 'createdAt').openCursor(range, 'prev'); const found: JournalEntry[] = []; let scanned = 0;
      cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {
        const current = cursor.result; if (!current || found.length >= limit || scanned++ >= 10000) { resolve(found); return; }
        try { const entry = validateEntry(current.value), search = query.text?.toLowerCase();
          if ((!query.from || entry.marketTime >= query.from) && (!query.to || entry.marketTime <= query.to)
            && (!query.createdBefore || entry.createdAt < query.createdBefore) && (!query.tag || entry.tags.includes(query.tag))
            && (!search || [entry.title, entry.note, ...entry.tags, ...Object.values(entry.reasoning)].join(' ').toLowerCase().includes(search))) found.push(entry);
        } catch (error) { reject(error); return; } current.continue();
      };
    }));
  }
  async update(input: JournalEntry, expectedRevisions: number) {
    const entry = validateEntry(input);
    await this.transaction(['entries'], 'readwrite', async tx => { const store = tx.objectStore('entries'), old = validateEntry(await request(store.get(entry.id)));
      if (old.revisions.length !== expectedRevisions) throw Error('This note changed in another editor. Reopen it before saving.');
      for (const key of ['captureId', 'instrument', 'marketTime', 'createdAt', 'capturedAt', 'annotation'] as const) if (old[key] !== entry[key]) throw Error('Capture identity and original timestamps are immutable');
      if (entry.revisions.length !== old.revisions.length + 1 || JSON.stringify(entry.revisions.slice(0, -1)) !== JSON.stringify(old.revisions)) throw Error('Original note revisions are immutable');
      await request(store.put(entry));
    }); this.changed({ instrument: entry.instrument, entryId: entry.id });
  }
  async delete(id: string) {
    await this.transaction(['entries', 'captures', 'assets'], 'readwrite', async tx => {
      const entries = tx.objectStore('entries'), captures = tx.objectStore('captures'), assets = tx.objectStore('assets'); const raw = await request(entries.get(id)); if (!raw) return; const entry = validateEntry(raw);
      await request(entries.delete(id)); if (await request(entries.index('captureId').count(entry.captureId))) return;
      const rawCapture = await request(captures.get(entry.captureId)); if (!rawCapture) return; const capture = validateCapture(rawCapture);
      await request(captures.delete(capture.id));
      for (const assetId of [capture.image, capture.thumbnail]) if (assetId && !await request(captures.index('image').count(assetId)) && !await request(captures.index('thumbnail').count(assetId))) await request(assets.delete(assetId));
    }); this.changed({ entryId: id });
  }
  async usage() { const own = await this.transaction(['entries', 'assets'], 'readonly', async tx => { const assets: JournalAsset[] = await request(tx.objectStore('assets').getAll()); return { entries: await request(tx.objectStore('entries').count()), assets: assets.length, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0) }; }); const estimate = await navigator.storage?.estimate?.().catch(() => undefined); return { ...own, browserUsage: estimate?.usage, quota: estimate?.quota }; }
  async persist() { return navigator.storage?.persist ? navigator.storage.persist() : false; }
  subscribe(listener: (change: JournalChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(change: JournalChange) { for (const listener of this.listeners) { try { listener(change); } catch { /* A view failure cannot turn a committed write into a retry. */ } } this.channel?.postMessage({ type: 'journal-change' }); }
  close() { void this.database?.then(db => db.close(), () => {}); this.channel?.close(); this.listeners.clear(); }
}
export function validateAsset(asset: JournalAsset) { if (!asset || typeof asset.id !== 'string' || asset.id.length > 180 || !(asset.blob instanceof Blob) || asset.mime !== 'image/png' || asset.blob.type !== 'image/png' || asset.bytes !== asset.blob.size || asset.bytes <= 0 || asset.bytes > JOURNAL_LIMITS.assetBytes || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Invalid or oversized journal image'); }
export async function imageAsset(id: string, blob: Blob): Promise<JournalAsset> { const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return { id, blob, mime: 'image/png', bytes: blob.size, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') }; }
