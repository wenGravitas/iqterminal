import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDbJournalRepository, imageAsset, JournalConflictError } from '../src/journal/repository';
import { exportJournal, importJournal } from '../src/journal/import-export';
import { marketIdentity, reviseEntry, type JournalAttachment, type JournalDraft, type JournalEntry, type JournalMarket } from '../src/journal/model';
import { captureRecord } from '../src/journal/capture';
import { journalBundle, journalSnapshot, journalTime, pngBytes } from './helpers/journal';

let repository: IndexedDbJournalRepository;
let factory: IDBFactory;
beforeEach(() => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 100, quota: 10000 }), persist: async () => true } });
  factory = new IDBFactory(); repository = new IndexedDbJournalRepository(factory, 'journal-tests');
});
afterEach(() => { repository.close(); vi.unstubAllGlobals(); });

function entry(id: string, entryAt = journalTime - 60000): JournalEntry {
  const base = journalBundle(id).entry;
  return entryAt === base.entryAt ? base : reviseEntry(base, { entryAt, title: base.title ?? '', bodyMarkdown: base.bodyMarkdown, tags: base.tags }, journalTime);
}
function draft(id: string, createdAt = journalTime): JournalDraft {
  return { version: 2, id, entryAt: createdAt, createdAt, updatedAt: createdAt, title: '', bodyMarkdown: '', tags: [], kind: 'note', attachments: [], relatedEntryIds: [] };
}
async function chartAttachment(entryId: string, assetId = 'full', thumbnailAssetId = 'thumb', marketTime = journalTime - 30000, market: JournalMarket = journalSnapshot().market, attachmentId = `chart-${entryId}`): Promise<{ attachment: JournalAttachment; assets: Awaited<ReturnType<typeof imageAsset>>[] }> {
  const assets = [await imageAsset(assetId, new Blob([pngBytes()], { type: 'image/png' })), await imageAsset(thumbnailAssetId, new Blob([pngBytes()], { type: 'image/png' }))];
  const snapshot = { ...journalSnapshot(), market }, capture = captureRecord(snapshot, `capture-${attachmentId}`, assetId, thumbnailAssetId, []);
  const anchored = { ...capture, marketTime };
  return { attachment: { id: attachmentId, kind: 'chart-capture', assetId, thumbnailAssetId, chartCapture: anchored }, assets };
}

describe('journal IndexedDB v2 transactions', () => {
  it('persists entries, pages by entryAt/id, and applies optimistic edit conflicts', async () => {
    const first = entry('entry-first', journalTime - 2000), second = entry('entry-second', journalTime - 1000);
    expect(await repository.saveEntry(first, [])).toEqual({ status: 'added' });
    expect(await repository.saveEntry(first, [])).toEqual({ status: 'duplicate' });
    const conflicting = reviseEntry(first, { title: 'different', bodyMarkdown: 'different', tags: [] }, journalTime + 500);
    await expect(repository.saveEntry(conflicting, [])).rejects.toBeInstanceOf(JournalConflictError);
    await repository.saveEntry(second, []);
    expect((await repository.entries({ order: 'newest' })).map(item => item.id)).toEqual(['entry-second', 'entry-first']);
    expect((await repository.entries({ from: journalTime - 1000, to: journalTime })).map(item => item.id)).toEqual(['entry-second']);
    expect((await repository.entries({ before: { entryAt: second.entryAt, id: second.id } })).map(item => item.id)).toEqual(['entry-first']);
    expect((await repository.entries({ order: 'oldest' })).map(item => item.id)).toEqual(['entry-first', 'entry-second']);
    const revised = reviseEntry(first, { title: 'Reasoning', bodyMarkdown: 'hello', tags: ['zone'] }, journalTime + 1000);
    expect(await repository.saveEntry(revised, [], first.updatedAt)).toEqual({ status: 'updated' });
    await expect(repository.saveEntry(revised, [], first.updatedAt)).resolves.toEqual({ status: 'duplicate' });
    await expect(repository.saveEntry(reviseEntry(first, { title: 'stale', bodyMarkdown: '', tags: [] }, journalTime + 2000), [], first.updatedAt)).rejects.toThrow(/changed in another editor/);
    expect((await repository.entry(first.id))?.revisions).toHaveLength(first.revisions.length + 1);
  });

  it('orders equal entry times by stable ID and paginates through ties in either direction', async () => {
    const tiedAt = journalTime - 5000, a = entry('tie-a', tiedAt), b = entry('tie-b', tiedAt);
    await repository.saveEntry(a, []); await repository.saveEntry(b, []);
    expect((await repository.entries({ order: 'newest' })).map(item => item.id)).toEqual(['tie-b', 'tie-a']);
    expect((await repository.entries({ order: 'newest', before: { entryAt: tiedAt, id: b.id } })).map(item => item.id)).toEqual(['tie-a']);
    expect((await repository.entries({ order: 'oldest' })).map(item => item.id)).toEqual(['tie-a', 'tie-b']);
    expect((await repository.entries({ order: 'oldest', before: { entryAt: tiedAt, id: a.id } })).map(item => item.id)).toEqual(['tie-b']);
  });

  it('indexes exact chart market-time anchors independently from entryAt', async () => {
    const item = entry('linked-entry', journalTime - 2 * 60 * 60 * 1000), linked = await chartAttachment(item.id, 'linked-image', 'linked-thumb', journalTime - 5000);
    const attached = reviseEntry(item, { title: item.title ?? '', bodyMarkdown: item.bodyMarkdown, tags: item.tags, attachments: [linked.attachment] }, journalTime);
    await repository.saveEntry(attached, linked.assets);
    expect(await repository.queryChartLinks({ instrument: JSON.stringify(['binance', 'perpetual', 'BTCUSDT', null]), from: journalTime - 10_000, to: journalTime })).toEqual([{ entry: attached, attachment: linked.attachment }]);
    expect(await repository.queryChartLinks({ instrument: JSON.stringify(['binance', 'perpetual', 'BTCUSDT', null]), from: journalTime - 1000, to: journalTime })).toEqual([]);
    expect((await repository.entries({ instrument: JSON.stringify(['binance', 'perpetual', 'BTCUSDT', null]) })).map(row => row.id)).toEqual([item.id]);
  });

  it('indexes and returns each instrument attachment independently on a shared entry', async () => {
    const item = entry('multi-market-entry', journalTime - 60 * 60 * 1000);
    const hyperliquid: JournalMarket = { venue: 'hyperliquid', market: 'perpetual', symbol: 'BTC' };
    const binanceLink = await chartAttachment(item.id, 'binance-image', 'binance-thumb', journalTime - 8000);
    const secondBinanceLink = await chartAttachment(item.id, 'binance-image-two', 'binance-thumb-two', journalTime - 6000, journalSnapshot().market, 'chart-binance-two');
    const hyperliquidLink = await chartAttachment(item.id, 'hyperliquid-image', 'hyperliquid-thumb', journalTime - 3000, hyperliquid, 'chart-hyperliquid');
    const attachments = [binanceLink.attachment, secondBinanceLink.attachment, hyperliquidLink.attachment];
    const multi = reviseEntry(item, { title: '', bodyMarkdown: '', tags: [], attachments }, journalTime);
    await repository.saveEntry(multi, [...binanceLink.assets, ...secondBinanceLink.assets, ...hyperliquidLink.assets]);
    const binanceInstrument = marketIdentity(binanceLink.attachment.chartCapture!.snapshot.market);
    const hyperliquidInstrument = marketIdentity(hyperliquid);
    const range = { from: journalTime - 10000, to: journalTime };
    const binanceLinks = await repository.queryChartLinks({ instrument: binanceInstrument, ...range });
    const hyperliquidLinks = await repository.queryChartLinks({ instrument: hyperliquidInstrument, ...range });
    expect(binanceLinks.map(link => link.attachment.id)).toEqual([binanceLink.attachment.id, secondBinanceLink.attachment.id]);
    expect(binanceLinks.every(link => link.entry.id === multi.id)).toBe(true);
    expect(hyperliquidLinks).toEqual([{ entry: multi, attachment: hyperliquidLink.attachment }]);
    expect((await repository.entries({ instrument: binanceInstrument })).map(row => row.id)).toEqual([multi.id]);
    expect((await repository.entries({ instrument: hyperliquidInstrument })).map(row => row.id)).toEqual([multi.id]);
    const backup = await exportJournal(repository, [multi]);
    const imported = new IndexedDbJournalRepository(new IDBFactory(), 'journal-multi-market-import');
    try {
      expect(await importJournal(imported, backup)).toMatchObject({ added: 1, draftsAdded: 0 });
      expect((await imported.queryChartLinks({ instrument: binanceInstrument, ...range })).map(link => link.attachment.id)).toEqual([binanceLink.attachment.id, secondBinanceLink.attachment.id]);
      expect((await imported.queryChartLinks({ instrument: hyperliquidInstrument, ...range })).map(link => link.attachment.id)).toEqual([hyperliquidLink.attachment.id]);
      expect((await imported.usage()).assets).toBe(6);
    } finally { imported.close(); }
  });

  it('saves drafts, publishes atomically, and keeps shared referenced assets until the last owner is removed', async () => {
    const item = entry('published-entry'), link = await chartAttachment(item.id, 'shared-image', 'shared-thumb');
    const attached = reviseEntry(item, { title: item.title ?? '', bodyMarkdown: item.bodyMarkdown, tags: item.tags, attachments: [link.attachment] }, journalTime);
    const savedDraft = { ...draft('draft-to-publish'), attachments: [link.attachment] };
    expect(await repository.saveDraft(savedDraft, link.assets)).toEqual({ status: 'added' });
    expect((await repository.usage()).assets).toBe(2);
    expect(await repository.draft(savedDraft.id)).toEqual(savedDraft);
    expect(await repository.publishDraft(savedDraft.id, attached, link.assets)).toEqual({ status: 'added' });
    expect(await repository.draft(savedDraft.id)).toBe(null);
    expect(await repository.publishDraft(savedDraft.id, attached, link.assets)).toEqual({ status: 'duplicate' });

    const otherBase = entry('other-entry'), other = reviseEntry(otherBase, { title: otherBase.title ?? '', bodyMarkdown: otherBase.bodyMarkdown, tags: otherBase.tags, attachments: [{ ...link.attachment, id: 'chart-other' }] }, journalTime);
    await repository.saveEntry(other, []);
    await repository.deleteEntry(attached.id);
    expect((await repository.usage()).assets).toBe(2);
    await repository.deleteEntry(other.id);
    expect((await repository.usage()).assets).toBe(0);
  });

  it('keeps assets shared by a draft and entry, then collects assets when each final owner is deleted', async () => {
    const item = entry('draft-shared-entry'), link = await chartAttachment(item.id, 'draft-shared-image', 'draft-shared-thumb');
    const attached = reviseEntry(item, { title: '', bodyMarkdown: '', tags: [], attachments: [link.attachment] }, journalTime);
    await repository.saveEntry(attached, link.assets);
    const draftAttachment = { ...link.attachment, id: 'draft-shared-context' };
    const sharedDraft = { ...draft('draft-shared'), attachments: [draftAttachment] };
    await repository.saveDraft(sharedDraft, []);
    await repository.deleteEntry(attached.id);
    expect((await repository.usage()).assets).toBe(2);
    expect(await repository.queryChartLinks({ instrument: marketIdentity(link.attachment.chartCapture!.snapshot.market), from: journalTime - 60000, to: journalTime })).toEqual([]);
    await repository.deleteDraft(sharedDraft.id);
    expect((await repository.usage()).assets).toBe(0);

    const unique = await chartAttachment('draft-only', 'draft-only-image', 'draft-only-thumb');
    const onlyDraft = { ...draft('draft-only'), attachments: [unique.attachment] };
    await repository.saveDraft(onlyDraft, unique.assets);
    await repository.deleteDraft(onlyDraft.id);
    expect((await repository.usage()).assets).toBe(0);
  });

  it('retains removed attachment assets in immutable revisions and exports that revision history', async () => {
    const base = entry('history-assets'), link = await chartAttachment(base.id, 'history-image', 'history-thumb');
    const attached = reviseEntry(base, { title: '', bodyMarkdown: '', tags: [], attachments: [link.attachment] }, journalTime);
    await repository.saveEntry(attached, link.assets);
    const removed = reviseEntry(attached, { title: '', bodyMarkdown: '', tags: [], attachments: [] }, journalTime + 1000);
    await repository.saveEntry(removed, [], attached.updatedAt);
    expect(await repository.queryChartLinks({ instrument: JSON.stringify(['binance', 'perpetual', 'BTCUSDT', null]), from: journalTime - 60000, to: journalTime })).toEqual([]);
    expect((await repository.usage()).assets).toBe(2);
    const backup = await exportJournal(repository, [removed]);
    const other = new IndexedDbJournalRepository(new IDBFactory(), 'journal-history-import');
    try {
      await importJournal(other, backup);
      expect((await other.entry(removed.id))?.revisions[1]?.attachments).toEqual([link.attachment]);
      expect((await other.usage()).assets).toBe(2);
    } finally { other.close(); }
    await repository.deleteEntry(removed.id);
    expect((await repository.usage()).assets).toBe(0);
  });

  it('detects a stale editing draft and leaves it intact on failed publish', async () => {
    const original = entry('edited-entry'); await repository.saveEntry(original, []);
    const editDraft: JournalDraft = { ...draft('edit-draft'), editingEntryId: original.id, expectedUpdatedAt: original.updatedAt };
    await repository.saveDraft(editDraft, []);
    await repository.saveEntry(reviseEntry(original, { title: 'newer tab', bodyMarkdown: '', tags: [] }, journalTime + 1000), [], original.updatedAt);
    const publication = reviseEntry(original, { title: 'stale tab', bodyMarkdown: '', tags: [] }, journalTime + 2000);
    await expect(repository.publishDraft(editDraft.id, publication, [], original.updatedAt)).rejects.toThrow(/changed in another editor/);
    expect(await repository.draft(editDraft.id)).toEqual(editDraft);
  });

  it('broadcasts committed entry changes to peer tabs without exposing entry content', async () => {
    if (typeof BroadcastChannel === 'undefined') return;
    const peer = new IndexedDbJournalRepository(factory, 'journal-tests'); let stop = () => {};
    const notified = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Cross-tab journal notification timed out')), 1000);
      stop = peer.subscribe(change => {
        if (change.entryId === 'peer-entry' && change.kind === 'entry') { expect(change).toEqual({ kind: 'entry', entryId: 'peer-entry' }); clearTimeout(timeout); stop(); resolve(); }
      });
    });
    try { await repository.saveEntry(entry('peer-entry'), []); await notified; }
    finally { stop(); peer.close(); }
  });

  it('round-trips checksummed R2 archives and rejects archive tampering before writes', async () => {
    const item = entry('archive-entry'), linked = await chartAttachment(item.id, 'archive-image', 'archive-thumb');
    const attached = reviseEntry(item, { title: item.title ?? '', bodyMarkdown: item.bodyMarkdown, tags: item.tags, attachments: [linked.attachment] }, journalTime); await repository.saveEntry(attached, linked.assets);
    const backup = await exportJournal(repository, [attached]);
    const other = new IndexedDbJournalRepository(new IDBFactory(), 'journal-import');
    try {
      expect(await importJournal(other, backup)).toEqual({ added: 1, duplicates: 0, draftsAdded: 0, draftsDuplicates: 0 });
      expect(await importJournal(other, backup)).toEqual({ added: 0, duplicates: 1, draftsAdded: 0, draftsDuplicates: 0 });
      expect(await other.entry(attached.id)).toEqual(attached);
      expect((await other.asset('archive-image'))?.sha256).toBe(linked.assets[0]?.sha256);
      expect(await other.queryChartLinks({ instrument: JSON.stringify(['binance', 'perpetual', 'BTCUSDT', null]), from: journalTime - 60000, to: journalTime })).toHaveLength(1);
      const tampered = JSON.parse(await backup.text()); tampered.entries[0].bodyMarkdown = 'changed';
      await expect(importJournal(other, new Blob([JSON.stringify(tampered)], { type: 'application/json' }))).rejects.toThrow(/checksum/);
      expect((await other.usage()).entries).toBe(1);
    } finally { other.close(); }
  });

  it('reports an archive ID reused for different content as a conflict without partial writes', async () => {
    const existing = entry('archive-id-conflict');
    await repository.saveEntry(existing, []);
    const incomingRepository = new IndexedDbJournalRepository(new IDBFactory(), 'journal-conflicting-export');
    try {
      const conflicting = reviseEntry(existing, { title: 'Different content', bodyMarkdown: 'another note', tags: ['imported'] }, journalTime + 1000);
      await incomingRepository.saveEntry(conflicting, []);
      const freshBase = entry('fresh-before-archive-conflict'), freshLink = await chartAttachment(freshBase.id, 'fresh-archive-image', 'fresh-archive-thumb');
      const fresh = reviseEntry(freshBase, { title: '', bodyMarkdown: '', tags: [], attachments: [freshLink.attachment] }, journalTime);
      await incomingRepository.saveEntry(fresh, freshLink.assets);
      const backup = await exportJournal(incomingRepository, [fresh, conflicting]);
      await expect(importJournal(repository, backup)).rejects.toBeInstanceOf(JournalConflictError);
      expect(await repository.entry(existing.id)).toEqual(existing);
      expect(await repository.entry(fresh.id)).toBe(null);
      expect(await repository.asset('fresh-archive-image')).toBe(null);
      expect(await repository.usage()).toMatchObject({ entries: 1, drafts: 0, assets: 0 });
    } finally { incomingRepository.close(); }
  });

  it('keeps unsupported future entry bytes and does not clear other stores during R1 upgrade', async () => {
    const old = await openSeedDb(factory, 'journal-tests', ['entries', 'captures', 'assets', 'other-data']);
    const tx = old.transaction(['entries', 'captures', 'assets', 'other-data'], 'readwrite');
    tx.objectStore('entries').add({ id: 'old-entry', version: 1 }); tx.objectStore('captures').add({ id: 'old-capture' }); tx.objectStore('assets').add({ id: 'old-asset' }); tx.objectStore('other-data').add({ id: 'keep', value: 'untouched' });
    await transactionDone(tx); old.close();
    const db = await (repository as any).open() as IDBDatabase;
    expect(db.version).toBe(2);
    expect(await count(db, 'entries')).toBe(0); expect(await count(db, 'captures')).toBe(0); expect(await count(db, 'assets')).toBe(0);
    expect(await record(db, 'other-data', 'keep')).toEqual({ id: 'keep', value: 'untouched' });
    expect(['entries', 'captures', 'assets', 'drafts', 'chartLinks', 'assetRefs', 'other-data'].every(name => db.objectStoreNames.contains(name))).toBe(true);
    const future = { version: 99, id: 'future-entry', unknownEvidence: 'preserve' };
    const write = db.transaction('entries', 'readwrite'); write.objectStore('entries').add(future); await transactionDone(write);
    await expect(repository.entry(future.id)).rejects.toThrow(/Unsupported/);
    expect(await record(db, 'entries', future.id)).toEqual(future);
  });

  it('resets R1 journal stores once and keeps committed R2 entries after reopening', async () => {
    const name = 'one-time-r1-journal-reset';
    const old = await openSeedDb(factory, name, ['entries', 'captures', 'assets', 'other-data']);
    const oldWrite = old.transaction(['entries', 'captures', 'assets', 'other-data'], 'readwrite');
    oldWrite.objectStore('entries').add({ id: 'r1-entry', version: 1 });
    oldWrite.objectStore('captures').add({ id: 'r1-capture' });
    oldWrite.objectStore('assets').add({ id: 'r1-asset' });
    oldWrite.objectStore('other-data').add({ id: 'preserved', value: 'workspace metadata' });
    await transactionDone(oldWrite); old.close();

    const firstOpen = new IndexedDbJournalRepository(factory, name);
    expect(await firstOpen.entry('r1-entry')).toBe(null);
    const current = entry('r2-after-upgrade');
    await firstOpen.saveEntry(current, []);
    firstOpen.close();

    const secondOpen = new IndexedDbJournalRepository(factory, name);
    try {
      expect(await secondOpen.entry(current.id)).toEqual(current);
      expect(await secondOpen.entry('r1-entry')).toBe(null);
      const db = await (secondOpen as any).open() as IDBDatabase;
      expect(await record(db, 'other-data', 'preserved')).toEqual({ id: 'preserved', value: 'workspace metadata' });
      expect(await count(db, 'entries')).toBe(1);
      expect(await count(db, 'captures')).toBe(0);
      expect(await count(db, 'assets')).toBe(0);
    } finally { secondOpen.close(); }
  });

  it('clears a blocked open promise and permits a retry after the older tab closes', async () => {
    const blockedFactory = new IDBFactory(), old = await openSeedDb(blockedFactory, 'blocked-journal', ['entries', 'captures', 'assets']);
    await transactionDone(old.transaction('entries', 'readonly'));
    const blocked = new IndexedDbJournalRepository(blockedFactory, 'blocked-journal');
    await expect(blocked.entry('missing')).rejects.toThrow('Journal database upgrade is blocked by another tab. Close the older tab and retry.');
    old.close();
    expect(await blocked.entry('missing')).toBe(null);
    blocked.close();
  });

  it('closes its open connection when another tab requests a version change', async () => {
    const open = await (repository as any).open() as IDBDatabase;
    const newer = await openAtVersion(factory, 'journal-tests', 3);
    expect(open.version).toBe(2);
    expect((repository as any).database).toBeUndefined();
    newer.close();
  });

  it('closes an already-open connection when another client requests a schema upgrade', async () => {
    const versionFactory = new IDBFactory(), name = 'versionchange-journal';
    const client = new IndexedDbJournalRepository(versionFactory, name);
    expect(await client.entry('missing')).toBe(null);
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = versionFactory.open(name, 3);
      request.onupgradeneeded = () => request.result.createObjectStore('newer-client');
      request.onblocked = () => reject(Error('Existing journal client did not close on versionchange'));
      request.onerror = () => reject(request.error ?? Error('Versionchange open failed'));
      request.onsuccess = () => resolve(request.result);
    });
    expect(newer.version).toBe(3);
    newer.close(); client.close();
  });

  it('surfaces denied storage and malformed asset references without partial writes', async () => {
    await expect(importJournal(repository, new Blob([JSON.stringify({ format: 'iqterminal-journal', version: 99 })]))).rejects.toThrow(/backup/);
    expect((await repository.usage()).entries).toBe(0);
    const denied = new IndexedDbJournalRepository({ open() { throw new DOMException('Storage denied', 'SecurityError'); } } as unknown as IDBFactory, 'denied');
    try { await expect(denied.saveEntry(entry('denied'), [])).rejects.toThrow(/denied/); } finally { denied.close(); }
    const badBase = entry('bad-reference');
    const bad = reviseEntry(badBase, { title: '', bodyMarkdown: '', tags: [], attachments: [{ id: 'image', kind: 'image', assetId: 'missing' }] }, journalTime);
    await expect(repository.saveEntry(bad, [])).rejects.toThrow(/missing/);
    expect((await repository.usage()).entries).toBe(0);
  });
});

function openSeedDb(factory: IDBFactory, name: string, stores: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => { for (const store of stores) request.result.createObjectStore(store, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
function openAtVersion(factory: IDBFactory, name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const request = factory.open(name, version); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
}
function count(db: IDBDatabase, store: string) {
  return new Promise<number>((resolve, reject) => { const request = db.transaction(store, 'readonly').objectStore(store).count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function record(db: IDBDatabase, store: string, id: string) {
  return new Promise<unknown>((resolve, reject) => { const request = db.transaction(store, 'readonly').objectStore(store).get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
