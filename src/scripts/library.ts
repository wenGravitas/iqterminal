import { BUILT_IN_STUDIES, type BuiltInStudy } from './examples';
import { SCRIPT_RUNTIME_VERSION } from './compiled-cache';

export type ScriptSourceInspector = (source: string) => Promise<readonly string[]>;

export const SCRIPT_LIBRARY_DB = 'iqterminal.openscript.library';
export const SCRIPT_LIBRARY_VERSION = 2;
export const MAX_LIBRARY_SCRIPTS = 100;
export const MAX_SCRIPT_REVISIONS = 50;
export const MAX_LIBRARY_BYTES = 10_000_000;
export const MAX_SCRIPT_PACKAGE_BYTES = 150_000;
const SCRIPT_FORMAT = 'iqterminal.openscript';

export interface ScriptRevision {
  id: string;
  contentHash: string;
  source: string;
  createdAt: number;
  languageVersion: 1;
  runtimeVersion: typeof SCRIPT_RUNTIME_VERSION;
  declaredCapabilities: string[];
}
export interface ScriptRecord {
  id: string;
  title: string;
  description: string;
  author?: string;
  license?: string;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
  currentRevision: string;
  revisions: ScriptRevision[];
}
export interface ScriptPackageV1 {
  format: 'iqterminal.openscript';
  version: 1;
  metadata: { title: string; description: string; author?: string; license?: string };
  revision: { contentHash: string; source: string; languageVersion: 1; runtimeVersion: typeof SCRIPT_RUNTIME_VERSION; declaredCapabilities: string[] };
}

export class ScriptLibrary {
  private database?: Promise<IDBDatabase>;
  private damagedRecords = 0;
  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  get damagedRecordCount() { return this.damagedRecords; }

  async ensureBuiltIns(): Promise<ScriptRecord[]> {
    const records: ScriptRecord[] = [];
    for (const study of BUILT_IN_STUDIES) records.push(await this.ensureBuiltIn(study));
    return records;
  }

  async list(): Promise<ScriptRecord[]> {
    const db = await this.open();
    const tx = db.transaction('scripts', 'readonly');
    const stored = await requestResult<unknown[]>(tx.objectStore('scripts').getAll());
    await transactionDone(tx);
    const rows = stored.filter(isStoredRecord);
    this.damagedRecords = stored.length - rows.length;
    return rows.sort((a, b) => Number(a.builtin) - Number(b.builtin) || a.title.localeCompare(b.title));
  }

  async get(id: string): Promise<ScriptRecord | null> {
    const db = await this.open();
    const tx = db.transaction('scripts', 'readonly');
    const row = await requestResult<unknown>(tx.objectStore('scripts').get(id));
    await transactionDone(tx);
    return isStoredRecord(row) ? row : null;
  }

  async getRevision(id: string, revisionId: string): Promise<ScriptRevision | null> {
    const record = await this.get(id);
    return record?.revisions.find(revision => revision.id === revisionId) ?? null;
  }

  async saveRevision(id: string, metadata: { title: string; description: string; author?: string; license?: string }, source: string, capabilities: readonly string[]): Promise<ScriptRecord> {
    const clean = cleanMetadata(metadata);
    validateSource(source);
    const declaredCapabilities = cleanCapabilities(capabilities);
    const hash = await contentHash(source);
    const revision = makeRevision(hash, source, declaredCapabilities);
    return this.write(id, existing => {
      if (!existing) throw new Error('This script is no longer in the local library. Save a copy instead.');
      if (existing.builtin) throw new Error('Built-in examples are read-only. Use Save copy to make them your own.');
      const revisions = existing.revisions.some(item => item.id === hash) ? existing.revisions : [...existing.revisions, revision];
      if (revisions.length > MAX_SCRIPT_REVISIONS) throw new Error(`A script can keep at most ${MAX_SCRIPT_REVISIONS} immutable revisions.`);
      return { ...existing, ...clean, currentRevision: hash, revisions, updatedAt: Date.now() };
    });
  }

  /** Store an applied draft as an immutable revision without moving the saved-current pointer. */
  async pinRevision(id: string, source: string, required: readonly string[]): Promise<ScriptRevision> {
    validateSource(source);
    const capabilities = cleanCapabilities(required);
    const hash = await contentHash(source);
    await this.write(id, existing => {
      if (!existing) throw new Error('This script disappeared from the local library. Save a copy before applying it.');
      if (existing.revisions.some(item => item.id === hash)) {
        const revisions = existing.revisions.map(item => item.id === hash ? { ...item, declaredCapabilities: capabilities } : item);
        return { ...existing, revisions };
      }
      if (existing.revisions.length >= MAX_SCRIPT_REVISIONS) throw new Error(`A script can keep at most ${MAX_SCRIPT_REVISIONS} immutable revisions.`);
      return { ...existing, updatedAt: Date.now(), revisions: [...existing.revisions, makeRevision(hash, source, capabilities)] };
    });
    const record = await this.get(id);
    const revision = record?.revisions.find(item => item.id === hash);
    if (!revision) throw new Error('The applied revision could not be pinned in local storage.');
    return revision;
  }

  async saveCopy(metadata: { title: string; description: string; author?: string; license?: string }, source: string, capabilities: readonly string[]): Promise<ScriptRecord> {
    const clean = cleanMetadata(metadata);
    validateSource(source);
    const declaredCapabilities = cleanCapabilities(capabilities);
    const hash = await contentHash(source);
    const now = Date.now();
    const record: ScriptRecord = {
      id: `script-${crypto.randomUUID()}`,
      ...clean,
      builtin: false,
      createdAt: now,
      updatedAt: now,
      currentRevision: hash,
      revisions: [makeRevision(hash, source, declaredCapabilities)],
    };
    return this.write(record.id, existing => {
      if (existing) throw new Error('A script with this local id already exists. Try saving again.');
      return record;
    });
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('scripts', 'readwrite');
      const store = tx.objectStore('scripts');
      const get = store.get(id);
      get.onsuccess = () => {
        const record = get.result as ScriptRecord | undefined;
        if (record?.builtin) { tx.abort(); reject(new Error('Built-in examples cannot be removed.')); return; }
        store.delete(id);
      };
      get.onerror = () => reject(get.error ?? new Error('Could not read this script.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not remove this script.'));
      tx.onabort = () => { if (!tx.error) reject(new Error('Script removal was cancelled.')); };
    });
  }

  async exportPackage(id: string, revisionId: string, actualCapabilities: readonly string[]): Promise<string> {
    const record = await this.get(id);
    const revision = record?.revisions.find(item => item.id === revisionId);
    if (!record || !revision) throw new Error('The selected saved revision is unavailable.');
    const capabilities = cleanCapabilities(actualCapabilities);
    if (!sameStrings([...revision.declaredCapabilities].sort(), capabilities)) throw new Error('The selected source requirements changed. Preview and save the revision again before exporting.');
    const payload: ScriptPackageV1 = {
      format: SCRIPT_FORMAT,
      version: 1,
      metadata: { title: record.title, description: record.description, ...(record.author ? { author: record.author } : {}), ...(record.license ? { license: record.license } : {}) },
      revision: { contentHash: revision.contentHash, source: revision.source, languageVersion: 1, runtimeVersion: SCRIPT_RUNTIME_VERSION, declaredCapabilities: capabilities },
    };
    return JSON.stringify(payload, null, 2);
  }

  async exportSource(id: string, revisionId: string): Promise<string> {
    const revision = await this.getRevision(id, revisionId);
    if (!revision) throw new Error('The selected saved revision is unavailable.');
    return revision.source;
  }

  async importText(text: string, filename: string, inspectSource: ScriptSourceInspector): Promise<ScriptRecord> {
    if (!text.trimStart().startsWith('{')) {
      const title = cleanTitle(filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
      const capabilities = cleanCapabilities(await inspectSource(text));
      return this.saveCopy({ title, description: 'Imported OpenScript source.' }, text, capabilities);
    }
    const parsed = await decodeScriptPackage(text, inspectSource);
    return this.saveCopy(parsed.metadata, parsed.revision.source, parsed.revision.declaredCapabilities);
  }

  private async ensureBuiltIn(study: BuiltInStudy): Promise<ScriptRecord> {
    const existing = await this.get(study.id);
    validateSource(study.source);
    const hash = await contentHash(study.source);
    if (existing) {
      if (!existing.builtin) return existing;
      if (existing.currentRevision === hash) {
        const currentRevision = existing.revisions.find(item => item.id === hash);
        if (currentRevision && sameStrings([...currentRevision.declaredCapabilities].sort(), [...study.capabilities].sort())) return existing;
        const revisions = existing.revisions.map(item => item.id === hash ? { ...item, declaredCapabilities: [...study.capabilities] } : item);
        return this.write(study.id, current => current ? { ...current, title: study.title, description: study.description, revisions } : existing);
      }
      const revision = makeRevision(hash, study.source, study.capabilities);
      const revised = existing.revisions.some(item => item.id === hash) ? existing.revisions : [...existing.revisions, revision];
      if (revised.length > MAX_SCRIPT_REVISIONS) throw new Error(`Built-in example ${study.title} has reached its revision cap.`);
      return this.write(study.id, current => current ? { ...current, title: study.title, description: study.description, currentRevision: hash, revisions: revised, updatedAt: Date.now() } : existing);
    }
    const now = Date.now();
    const record: ScriptRecord = {
      id: study.id,
      title: study.title,
      description: study.description,
      builtin: true,
      createdAt: now,
      updatedAt: now,
      currentRevision: hash,
      revisions: [makeRevision(hash, study.source, study.capabilities)],
    };
    return this.write(study.id, current => current ?? record);
  }

  private async write(id: string, update: (record: ScriptRecord | undefined) => ScriptRecord): Promise<ScriptRecord> {
    const db = await this.open();
    const result = await new Promise<ScriptRecord>((resolve, reject) => {
      const tx = db.transaction('scripts', 'readwrite');
      const store = tx.objectStore('scripts');
      const get = store.getAll();
      let next: ScriptRecord | undefined;
      get.onsuccess = () => {
        try {
          const stored = get.result as unknown[];
          const rows = stored.filter(isStoredRecord);
          this.damagedRecords = stored.length - rows.length;
          next = update(rows.find(row => row.id === id));
          const projected = [...rows.filter(row => row.id !== id), next];
          const total = projected.reduce((sum, row) => sum + row.revisions.reduce((bytes, revision) => bytes + byteLength(revision.source), 0), 0);
          if (projected.length > MAX_LIBRARY_SCRIPTS || total > MAX_LIBRARY_BYTES) throw new Error(`The local library is limited to ${MAX_LIBRARY_SCRIPTS} scripts and ${MAX_LIBRARY_BYTES.toLocaleString()} source bytes.`);
          store.put(next);
        } catch (error) { tx.abort(); reject(asError(error)); }
      };
      get.onerror = () => reject(get.error ?? new Error('Could not read the local library.'));
      tx.oncomplete = () => next ? resolve(next) : reject(new Error('The library transaction did not write a script.'));
      tx.onerror = () => reject(tx.error ?? new Error('The local library could not save this script.'));
      tx.onabort = () => { if (!tx.error) reject(new Error('The local library save was cancelled.')); };
    });
    return result;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    if (!this.factory) return Promise.reject(new Error('IndexedDB is unavailable. Examples remain usable, but local scripts cannot be saved in this browser.'));
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open(SCRIPT_LIBRARY_DB, SCRIPT_LIBRARY_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('scripts')) db.createObjectStore('scripts', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.database = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('The local script library could not open.'));
      request.onblocked = () => reject(new Error('The local script library upgrade is blocked by another open tab. Close the older IQTerminal tab and retry.'));
    }).catch(error => { this.database = undefined; throw error; });
    this.database = opening;
    return opening;
  }
}

export async function decodeScriptPackage(text: string, inspectSource: ScriptSourceInspector): Promise<ScriptPackageV1> {
  if (byteLength(text) > MAX_SCRIPT_PACKAGE_BYTES) throw new Error(`Import exceeds ${MAX_SCRIPT_PACKAGE_BYTES.toLocaleString()} bytes.`);
  if (!text.trim()) throw new Error('The imported file is empty.');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('The OpenScript package is not valid JSON.'); }
  const parsed = validatePackage(input);
  validateSource(parsed.revision.source);
  const actualHash = await contentHash(parsed.revision.source);
  if (actualHash !== parsed.revision.contentHash) throw new Error('Package source hash does not match its declared revision.');
    const actualCapabilities = cleanCapabilities(await inspectSource(parsed.revision.source));
    if (!sameStrings([...parsed.revision.declaredCapabilities].sort(), actualCapabilities)) {
      throw new Error('Package capabilities do not match the requirements derived from its source.');
    }
  return parsed;
}

export async function contentHash(source: string): Promise<string> {
  validateSource(source);
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot calculate a revision hash. Use a current secure browser context.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function validateSource(source: string): asserts source is string {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Script source is empty.');
  if (byteLength(source) > 100_000) throw new Error('Script source exceeds 100,000 UTF-8 bytes.');
  if (source.includes('\0')) throw new Error('Script source contains a null character.');
}

function validatePackage(value: unknown): ScriptPackageV1 {
  if (!isRecord(value) || value.format !== SCRIPT_FORMAT || value.version !== 1 || !isRecord(value.metadata) || !isRecord(value.revision)) throw new Error('Unsupported OpenScript package format or version.');
  const metadata = cleanMetadata(value.metadata as { title?: unknown; description?: unknown; author?: unknown; license?: unknown });
  const revision = value.revision;
  if (revision.languageVersion !== 1 || revision.runtimeVersion !== SCRIPT_RUNTIME_VERSION || typeof revision.source !== 'string' || typeof revision.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(revision.contentHash)) throw new Error('Package compatibility or revision fields are invalid.');
  if (!Array.isArray(revision.declaredCapabilities) || revision.declaredCapabilities.length > 16 || revision.declaredCapabilities.some(item => typeof item !== 'string' || item.length > 80)) throw new Error('Package capabilities must be a short list of text labels.');
  return {
    format: SCRIPT_FORMAT,
    version: 1,
    metadata,
    revision: {
      contentHash: revision.contentHash,
      source: revision.source,
      languageVersion: 1,
      runtimeVersion: SCRIPT_RUNTIME_VERSION,
      declaredCapabilities: revision.declaredCapabilities as string[],
    },
  };
}

function cleanMetadata(value: { title?: unknown; description?: unknown; author?: unknown; license?: unknown }) {
  const title = cleanTitle(value.title);
  const description = cleanText(value.description ?? '', 500, 'Description');
  const author = value.author === undefined ? undefined : cleanText(value.author, 100, 'Author');
  const license = value.license === undefined ? undefined : cleanText(value.license, 80, 'Licence');
  return { title, description, ...(author ? { author } : {}), ...(license ? { license } : {}) };
}

function cleanTitle(value: unknown) {
  const title = cleanText(value, 80, 'Title').trim();
  if (!title) throw new Error('Title is required.');
  return title;
}
function cleanText(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${label} must be plain text up to ${max} characters.`);
  return value;
}
function makeRevision(hash: string, source: string, capabilities: readonly string[]): ScriptRevision {
  const declaredCapabilities = cleanCapabilities(capabilities);
  return { id: hash, contentHash: hash, source, createdAt: Date.now(), languageVersion: 1, runtimeVersion: SCRIPT_RUNTIME_VERSION, declaredCapabilities: [...declaredCapabilities] };
}
function byteLength(value: string) { return new TextEncoder().encode(value).byteLength; }
function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function asError(error: unknown) { return error instanceof Error ? error : new Error(String(error)); }
function sameStrings(left: string[], right: string[]) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function cleanCapabilities(value: readonly string[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16 || value.some(item => typeof item !== 'string' || !['ohlcv', 'iqterminal.depth.series.v1'].includes(item))) throw new Error('The worker returned an unsupported capability list.');
  const normalized = [...new Set(value)].sort();
  if (!normalized.includes('ohlcv')) throw new Error('Every study must declare its OHLCV capability.');
  return normalized;
}
function isStoredRecord(value: unknown): value is ScriptRecord {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 128
    || typeof value.builtin !== 'boolean' || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
    || !Array.isArray(value.revisions) || value.revisions.length < 1 || value.revisions.length > MAX_SCRIPT_REVISIONS
    || typeof value.currentRevision !== 'string') return false;
  try {
    cleanMetadata(value);
    for (const revision of value.revisions as unknown[]) {
      if (!isRecord(revision) || typeof revision.id !== 'string' || !/^[a-f0-9]{64}$/.test(revision.id)
        || revision.contentHash !== revision.id || !Number.isFinite(revision.createdAt)
        || revision.languageVersion !== 1 || revision.runtimeVersion !== SCRIPT_RUNTIME_VERSION
        || !Array.isArray(revision.declaredCapabilities)) return false;
      validateSource(revision.source);
      cleanCapabilities(revision.declaredCapabilities);
    }
    return value.revisions.some((revision: ScriptRevision) => revision.id === value.currentRevision);
  } catch { return false; }
}
function requestResult<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.')); }); }
function transactionDone(tx: IDBTransaction) { return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.')); tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.')); }); }
