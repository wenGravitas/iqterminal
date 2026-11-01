import { scryptAsync } from '@noble/hashes/scrypt.js';
import { privateKeyToAccount } from 'viem/accounts';
import type { TradingNetwork } from './model';

interface EncryptedRecordBase {
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  address: string;
  salt: ArrayBuffer;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  savedAt: number;
}

export interface LegacyAgentRecord extends EncryptedRecordBase {
  version: 1;
}

export interface ScopedAgentRecord extends EncryptedRecordBase {
  version: 2;
  network: TradingNetwork;
  principal: string;
}

export type EncryptedAgentRecord = LegacyAgentRecord | ScopedAgentRecord;

export interface VaultOperationContext {
  network: TradingNetwork;
  principal: string;
  accountGeneration: number;
  signingGeneration: number;
  signal?: AbortSignal;
  assertCurrent: () => void;
}

export interface VaultInfo {
  address: string | null;
  exists: boolean;
  legacyNeedsBinding: boolean;
  error?: string;
}

export interface DecryptedAgentKey {
  address: string;
  privateKey: `0x${string}`;
  sourceRecord: LegacyAgentRecord;
}

const DB_NAME = 'basis.hyperliquid.agent.v1';
const DB_VERSION = 1;
const STORE = 'vault';
const LEGACY_KEY_ID = 'default-agent';
const LEGACY_AAD = new TextEncoder().encode('basis-hyperliquid-agent-v1').buffer as ArrayBuffer;
const CURRENT_KDF = Object.freeze({ N: 2 ** 15, r: 8, p: 3, dkLen: 32, maxmem: 40 * 1024 * 1024, asyncTick: 12 });
const LEGACY_KDF = Object.freeze({ N: 2 ** 15, r: 8, p: 1, dkLen: 32, maxmem: 40 * 1024 * 1024, asyncTick: 12 });
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function secureSigningAvailable() {
  return typeof isSecureContext !== 'undefined' && isSecureContext === true
    && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function' && !!crypto.subtle;
}

export function secureVaultAvailable() {
  return typeof indexedDB !== 'undefined' && secureSigningAvailable();
}

function normalizeScope(network: TradingNetwork, principal: string) {
  if (network !== 'mainnet' && network !== 'testnet') throw new Error('Agent vault network is unsupported');
  if (!/^0x[0-9a-fA-F]{40}$/.test(principal)) throw new Error('Connect a valid principal before using the encrypted agent vault');
  return { network, principal: principal.toLowerCase() };
}

function scopedKeyId(network: TradingNetwork, principal: string) {
  const scope = normalizeScope(network, principal);
  return `agent:v2:${scope.network}:${scope.principal}`;
}

function scopedAad(record: Pick<ScopedAgentRecord, 'network' | 'principal' | 'address'>) {
  return encoder.encode(JSON.stringify([
    'basis-hyperliquid-agent', 2, record.network, record.principal, record.address,
    'scrypt', CURRENT_KDF.N, CURRENT_KDF.r, CURRENT_KDF.p,
  ])).buffer as ArrayBuffer;
}

function assertOperationCurrent(context?: VaultOperationContext) {
  if (!context) return;
  if (context.signal?.aborted) {
    context.assertCurrent();
    throw new Error('Agent vault operation was aborted');
  }
  context.assertCurrent();
}

function operationError(context: VaultOperationContext | undefined, fallback: string) {
  try { assertOperationCurrent(context); }
  catch (error) { return error; }
  return new Error(fallback);
}

function openDb(requireSecureContext = true): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || requireSecureContext && !secureVaultAvailable()) {
    return Promise.reject(new Error('Encrypted agent storage requires IndexedDB and Web Crypto in a secure context'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Encrypted agent storage is unavailable'));
    request.onblocked = () => reject(new Error('Encrypted agent storage is busy in another tab'));
  });
}

function isArrayBuffer(value: unknown): value is ArrayBuffer { return value instanceof ArrayBuffer; }

function sameBuffer(left: ArrayBuffer, right: ArrayBuffer) {
  if (left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left), b = new Uint8Array(right);
  return a.every((value, index) => value === b[index]);
}

function sameRecord(left: unknown, right: EncryptedAgentRecord): left is EncryptedAgentRecord {
  if (!left || typeof left !== 'object') return false;
  const record = left as Partial<EncryptedAgentRecord>;
  if (record.version !== right.version || record.kdf !== right.kdf || record.N !== right.N || record.r !== right.r
    || record.p !== right.p || record.address !== right.address || record.savedAt !== right.savedAt
    || !isArrayBuffer(record.salt) || !sameBuffer(record.salt, right.salt)
    || !isArrayBuffer(record.iv) || !sameBuffer(record.iv, right.iv)
    || !isArrayBuffer(record.ciphertext) || !sameBuffer(record.ciphertext, right.ciphertext)) return false;
  if (right.version === 1) return record.version === 1;
  return record.version === 2 && record.network === right.network && record.principal === right.principal;
}

function cloneLegacyRecord(record: LegacyAgentRecord): LegacyAgentRecord {
  return { ...record, salt: record.salt.slice(0), iv: record.iv.slice(0), ciphertext: record.ciphertext.slice(0) };
}

async function readRecord(key: IDBValidKey, context?: VaultOperationContext): Promise<unknown | null> {
  assertOperationCurrent(context);
  const db = await openDb();
  try {
    assertOperationCurrent(context);
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => {
        try { assertOperationCurrent(context); resolve(request.result ?? null); }
        catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to read encrypted agent record'));
    });
  } finally { db.close(); }
}

function recordShape(record: unknown): record is EncryptedAgentRecord {
  if (!record || typeof record !== 'object') return false;
  const value = record as Partial<EncryptedAgentRecord>;
  return (value.version === 1 || value.version === 2) && value.kdf === 'scrypt'
    && Number.isSafeInteger(value.N) && Number.isSafeInteger(value.r) && Number.isSafeInteger(value.p)
    && typeof value.address === 'string' && /^0x[0-9a-f]{40}$/.test(value.address)
    && isArrayBuffer(value.salt) && value.salt.byteLength === 16
    && isArrayBuffer(value.iv) && value.iv.byteLength === 12
    && isArrayBuffer(value.ciphertext) && value.ciphertext.byteLength === 82
    && typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
    && (value.version === 1 || (() => {
      const scoped = value as Partial<ScopedAgentRecord>;
      return (scoped.network === 'mainnet' || scoped.network === 'testnet')
        && typeof scoped.principal === 'string' && /^0x[0-9a-f]{40}$/.test(scoped.principal);
    })());
}

function isLegacyProfile(record: EncryptedAgentRecord): record is LegacyAgentRecord {
  return record.version === 1 && record.kdf === 'scrypt'
    && record.N === LEGACY_KDF.N && record.r === LEGACY_KDF.r && record.p === LEGACY_KDF.p;
}

function isScopedProfile(record: EncryptedAgentRecord, network: TradingNetwork, principal: string): record is ScopedAgentRecord {
  const scope = normalizeScope(network, principal);
  return record.version === 2 && record.kdf === 'scrypt'
    && record.N === CURRENT_KDF.N && record.r === CURRENT_KDF.r && record.p === CURRENT_KDF.p
    && record.network === scope.network && record.principal === scope.principal;
}

export function validatePassphrase(passphrase: string) {
  if (passphrase.length < 12) throw new Error('Use a passphrase with at least 12 characters');
  if (passphrase.length > 1024) throw new Error('Passphrase is too long');
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, usage: KeyUsage[], profile: typeof CURRENT_KDF | typeof LEGACY_KDF, context?: VaultOperationContext): Promise<CryptoKey> {
  const bytes = await scryptAsync(passphrase, salt, { ...profile, onProgress: () => assertOperationCurrent(context) });
  try {
    assertOperationCurrent(context);
    return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, usage);
  } finally { bytes.fill(0); }
}

function assertPrivateKey(privateKey: string, expectedAddress: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('Encrypted agent key has an invalid format');
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  if (account.address.toLowerCase() !== expectedAddress.toLowerCase()) throw new Error('Encrypted agent key address does not match its record');
  return privateKey as `0x${string}`;
}

function contextAwareError(context: VaultOperationContext | undefined, fallback: string) {
  try { assertOperationCurrent(context); }
  catch (error) { return error; }
  return new Error(fallback);
}

function attachTransactionCancellation(transaction: IDBTransaction, context: VaultOperationContext | undefined,
  finish: (error?: unknown) => void) {
  let abortError: unknown;
  const abortForContext = () => {
    abortError = contextAwareError(context, 'Agent vault transaction was canceled');
    try { transaction.abort(); } catch { finish(abortError); }
  };
  const cleanup = () => context?.signal?.removeEventListener('abort', abortForContext);
  context?.signal?.addEventListener('abort', abortForContext, { once: true });
  if (context?.signal?.aborted) abortForContext();
  transaction.onerror = () => { cleanup(); finish(abortError ?? transaction.error ?? new Error('Agent vault transaction failed')); };
  transaction.onabort = () => { cleanup(); finish(abortError ?? contextAwareError(context, 'Agent vault transaction was canceled')); };
  transaction.oncomplete = () => {
    cleanup();
    try { assertOperationCurrent(context); finish(); }
    catch (error) { finish(error); }
  };
  return {
    abort(error: unknown) {
      abortError = error;
      try { transaction.abort(); } catch { cleanup(); finish(error); }
    },
    isAborted: () => !!context?.signal?.aborted,
  };
}

async function addRecord(record: ScopedAgentRecord, context?: VaultOperationContext): Promise<void> {
  assertOperationCurrent(context);
  const keyId = scopedKeyId(record.network, record.principal);
  const db = await openDb();
  try {
    assertOperationCurrent(context);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error === undefined) resolve(); else reject(error);
      };
      const control = attachTransactionCancellation(transaction, context, finish);
      if (control.isAborted()) return;
      try { assertOperationCurrent(context); transaction.objectStore(STORE).add(record, keyId); }
      catch (error) { control.abort(error); }
    });
  } finally { db.close(); }
}

async function decryptRecord(passphrase: string, record: EncryptedAgentRecord, aad: ArrayBuffer,
  profile: typeof CURRENT_KDF | typeof LEGACY_KDF, context?: VaultOperationContext): Promise<`0x${string}`> {
  // Work on a private copy: wiping a view over record.salt would corrupt the
  // exact source record retained for the migration compare-and-swap.
  const salt = new Uint8Array(record.salt.slice(0));
  let clear: Uint8Array | undefined;
  try {
    const key = await deriveAesKey(passphrase, salt, ['decrypt'], profile, context);
    clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: aad, tagLength: 128 }, key, record.ciphertext));
    assertOperationCurrent(context);
    const privateKey = decoder.decode(clear);
    return assertPrivateKey(privateKey, record.address);
  } catch (error) {
    try { assertOperationCurrent(context); }
    catch (invalidated) { throw invalidated; }
    if (error instanceof Error && (error.message === 'Stored agent encryption parameters are unsupported'
      || error.message === 'Encrypted agent key has an invalid format'
      || error.message === 'Encrypted agent key address does not match its record')) throw error;
    throw new Error('Unable to unlock agent key; check the passphrase or encrypted record');
  } finally { clear?.fill(0); salt.fill(0); }
}

export async function getAgentVaultInfo(network: TradingNetwork, principal: string, context?: VaultOperationContext): Promise<VaultInfo> {
  const scope = principal ? normalizeScope(network, principal) : null;
  if (scope) {
    const scoped = await readRecord(scopedKeyId(scope.network, scope.principal), context);
    if (scoped !== null) {
      if (!recordShape(scoped) || !isScopedProfile(scoped, scope.network, scope.principal)) {
        return { address: null, exists: true, legacyNeedsBinding: false, error: 'The encrypted agent record for this account has unsupported or malformed parameters; it was not changed' };
      }
      return { address: scoped.address, exists: true, legacyNeedsBinding: false };
    }
  }
  const legacy = await readRecord(LEGACY_KEY_ID, context);
  if (legacy === null) return { address: null, exists: false, legacyNeedsBinding: false };
  if (!recordShape(legacy) || !isLegacyProfile(legacy)) {
    return { address: null, exists: true, legacyNeedsBinding: true, error: 'An unscoped legacy key exists with unsupported or malformed parameters; use Forget Device to remove it' };
  }
  return { address: null, exists: true, legacyNeedsBinding: true };
}

export async function prepareScopedAgentRecord(privateKey: `0x${string}`, passphrase: string,
  network: TradingNetwork, principal: string, context?: VaultOperationContext): Promise<ScopedAgentRecord> {
  if (!secureSigningAvailable()) throw new Error('Agent key creation requires Web Crypto, secure randomness, and a secure browser context');
  const scope = normalizeScope(network, principal);
  validatePassphrase(passphrase); assertOperationCurrent(context);
  const address = privateKeyToAccount(privateKey).address.toLowerCase();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = encoder.encode(privateKey);
  try {
    const key = await deriveAesKey(passphrase, salt, ['encrypt'], CURRENT_KDF, context);
    const header = { version: 2 as const, network: scope.network, principal: scope.principal, address,
      kdf: 'scrypt' as const, N: CURRENT_KDF.N, r: CURRENT_KDF.r, p: CURRENT_KDF.p };
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: scopedAad(header), tagLength: 128 }, key, clear);
    assertOperationCurrent(context);
    return { ...header, salt: salt.buffer.slice(0), iv: iv.buffer.slice(0), ciphertext, savedAt: Date.now() };
  } finally { clear.fill(0); salt.fill(0); iv.fill(0); }
}

export async function encryptAgentPrivateKey(privateKey: `0x${string}`, passphrase: string,
  network: TradingNetwork, principal: string, context?: VaultOperationContext) {
  const record = await prepareScopedAgentRecord(privateKey, passphrase, network, principal, context);
  await addRecord(record, context);
  return { address: record.address, exists: true };
}

export async function decryptScopedAgentPrivateKey(passphrase: string, network: TradingNetwork, principal: string,
  context?: VaultOperationContext): Promise<{ address: string; privateKey: `0x${string}` }> {
  validatePassphrase(passphrase);
  const scope = normalizeScope(network, principal);
  const record = await readRecord(scopedKeyId(scope.network, scope.principal), context);
  if (record === null) throw new Error('No encrypted agent key is stored for the selected network and principal');
  if (!recordShape(record) || !isScopedProfile(record, scope.network, scope.principal)) {
    throw new Error('Stored agent encryption parameters or account scope are unsupported');
  }
  const privateKey = await decryptRecord(passphrase, record, scopedAad(record), CURRENT_KDF, context);
  return { address: record.address, privateKey };
}

export async function decryptLegacyAgentPrivateKey(passphrase: string, context?: VaultOperationContext): Promise<DecryptedAgentKey> {
  validatePassphrase(passphrase);
  const record = await readRecord(LEGACY_KEY_ID, context);
  if (record === null) throw new Error('No unscoped legacy agent key is stored in this browser');
  if (!recordShape(record) || !isLegacyProfile(record)) {
    throw new Error('Stored legacy agent encryption parameters are unsupported');
  }
  const privateKey = await decryptRecord(passphrase, record, LEGACY_AAD, LEGACY_KDF, context);
  return { address: record.address, privateKey, sourceRecord: cloneLegacyRecord(record) };
}

export async function commitLegacyAgentBinding(source: LegacyAgentRecord, destination: ScopedAgentRecord, context?: VaultOperationContext): Promise<void> {
  assertOperationCurrent(context);
  if (!recordShape(source) || !isLegacyProfile(source) || !recordShape(destination)
    || !isScopedProfile(destination, destination.network, destination.principal)) {
    throw new Error('Legacy key binding records are malformed or unsupported');
  }
  const target = scopedKeyId(destination.network, destination.principal);
  const db = await openDb();
  try {
    assertOperationCurrent(context);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error === undefined) resolve(); else reject(error);
      };
      const control = attachTransactionCancellation(transaction, context, finish);
      if (control.isAborted()) return;
      const store = transaction.objectStore(STORE);
      const legacyRequest = store.get(LEGACY_KEY_ID);
      const destinationRequest = store.get(target);
      let legacyReady = false, destinationReady = false, scheduled = false;
      const scheduleMove = () => {
        if (!legacyReady || !destinationReady || scheduled) return;
        scheduled = true;
        try {
          assertOperationCurrent(context);
          if (!sameRecord(legacyRequest.result, source)) throw new Error('Unscoped legacy agent changed during binding; no record was replaced');
          if (destinationRequest.result !== undefined && destinationRequest.result !== null) {
            throw new Error('An agent record already exists for this network and principal; the legacy key was preserved');
          }
          // Add first, then delete only after the add request succeeds. Both
          // mutations share this transaction, so cancellation or any request
          // error rolls the destination back and preserves the legacy source.
          const add = store.add(destination, target);
          add.onsuccess = () => {
            try {
              assertOperationCurrent(context);
              store.delete(LEGACY_KEY_ID);
            } catch (error) { control.abort(error); }
          };
          add.onerror = () => control.abort(add.error ?? new Error('Unable to write the scoped agent record; the legacy key was preserved'));
        } catch (error) { control.abort(error); }
      };
      legacyRequest.onsuccess = () => { legacyReady = true; scheduleMove(); };
      destinationRequest.onsuccess = () => { destinationReady = true; scheduleMove(); };
      legacyRequest.onerror = () => control.abort(legacyRequest.error ?? new Error('Unable to verify the legacy agent record'));
      destinationRequest.onerror = () => control.abort(destinationRequest.error ?? new Error('Unable to verify the selected account vault slot'));
    });
  } finally { db.close(); }
}

export async function prepareLegacyAgentBinding(passphrase: string, legacy: DecryptedAgentKey, network: TradingNetwork,
  principal: string, context?: VaultOperationContext): Promise<ScopedAgentRecord> {
  validatePassphrase(passphrase); assertOperationCurrent(context);
  const scope = normalizeScope(network, principal);
  if (privateKeyToAccount(legacy.privateKey).address.toLowerCase() !== legacy.address.toLowerCase()
    || legacy.address.toLowerCase() !== legacy.sourceRecord.address.toLowerCase()) {
    throw new Error('Verified legacy key does not match its source record');
  }
  const destination = await prepareScopedAgentRecord(legacy.privateKey, passphrase, scope.network, scope.principal, context);
  assertOperationCurrent(context);
  return destination;
}

export async function removeEncryptedAgent(network: TradingNetwork, principal: string, context?: VaultOperationContext) {
  const target = scopedKeyId(network, principal);
  assertOperationCurrent(context);
  const db = await openDb(false);
  try {
    assertOperationCurrent(context);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error === undefined) resolve(); else reject(error);
      };
      const control = attachTransactionCancellation(transaction, context, finish);
      if (control.isAborted()) return;
      try { assertOperationCurrent(context); transaction.objectStore(STORE).delete(target); }
      catch (error) { control.abort(error); }
    });
  } finally { db.close(); }
}

export async function removeAllEncryptedAgents(context?: VaultOperationContext) {
  assertOperationCurrent(context);
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb(false);
  try {
    assertOperationCurrent(context);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error === undefined) resolve(); else reject(error);
      };
      const control = attachTransactionCancellation(transaction, context, finish);
      if (control.isAborted()) return;
      try { assertOperationCurrent(context); transaction.objectStore(STORE).clear(); }
      catch (error) { control.abort(error); }
    });
  } finally { db.close(); }
}
