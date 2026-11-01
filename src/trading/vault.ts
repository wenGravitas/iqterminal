import { scryptAsync } from '@noble/hashes/scrypt.js';
import { privateKeyToAccount } from 'viem/accounts';

export interface EncryptedAgentRecord {
  version: 1;
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

const DB_NAME = 'basis.hyperliquid.agent.v1';
const DB_VERSION = 1;
const STORE = 'vault';
const KEY_ID = 'default-agent';
const AAD = new TextEncoder().encode('basis-hyperliquid-agent-v1');
const KDF = Object.freeze({ N: 2 ** 15, r: 8, p: 1, dkLen: 32, maxmem: 40 * 1024 * 1024, asyncTick: 12 });
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function secureSigningAvailable() {
  return typeof isSecureContext !== 'undefined' && isSecureContext === true
    && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function' && !!crypto.subtle;
}

export function secureVaultAvailable() {
  return typeof indexedDB !== 'undefined' && secureSigningAvailable();
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

async function readRecord(): Promise<EncryptedAgentRecord | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID);
      request.onsuccess = () => resolve((request.result as EncryptedAgentRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Unable to read encrypted agent record'));
    });
  } finally { db.close(); }
}

async function writeRecord(record: EncryptedAgentRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(record, KEY_ID);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save encrypted agent record'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving encrypted agent record was canceled'));
    });
  } finally { db.close(); }
}

export function validatePassphrase(passphrase: string) {
  if (passphrase.length < 12) throw new Error('Use a passphrase with at least 12 characters');
  if (passphrase.length > 1024) throw new Error('Passphrase is too long');
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const bytes = await scryptAsync(passphrase, salt, KDF);
  try { return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, usage); }
  finally { bytes.fill(0); }
}

export async function encryptAgentPrivateKey(privateKey: `0x${string}`, passphrase: string) {
  if (!secureSigningAvailable()) throw new Error('Agent key creation requires Web Crypto, secure randomness, and a secure browser context');
  validatePassphrase(passphrase);
  const address = privateKeyToAccount(privateKey).address.toLowerCase();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, ['encrypt']);
  const clear = encoder.encode(privateKey);
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, clear);
    const record: EncryptedAgentRecord = {
      version: 1, kdf: 'scrypt', ...KDF, address,
      salt: salt.buffer.slice(0), iv: iv.buffer.slice(0), ciphertext, savedAt: Date.now(),
    };
    await writeRecord(record);
    return { address, exists: true };
  } finally { clear.fill(0); salt.fill(0); iv.fill(0); }
}

export async function decryptAgentPrivateKey(passphrase: string): Promise<{ address: string; privateKey: `0x${string}` }> {
  validatePassphrase(passphrase);
  const record = await readRecord();
  if (!record) throw new Error('No encrypted agent key is stored in this browser');
  if (record.version !== 1 || record.kdf !== 'scrypt' || record.N !== KDF.N || record.r !== KDF.r || record.p !== KDF.p) {
    throw new Error('Stored agent encryption parameters are unsupported');
  }
  const salt = new Uint8Array(record.salt), iv = new Uint8Array(record.iv);
  const key = await deriveAesKey(passphrase, salt, ['decrypt']);
  try {
    const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, record.ciphertext));
    try {
      const privateKey = decoder.decode(clear);
      if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('Encrypted agent key has an invalid format');
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      if (account.address.toLowerCase() !== record.address.toLowerCase()) throw new Error('Encrypted agent key address does not match its record');
      return { address: account.address.toLowerCase(), privateKey: privateKey as `0x${string}` };
    } finally { clear.fill(0); }
  } catch {
    throw new Error('Unable to unlock agent key; check the passphrase or encrypted record');
  } finally { salt.fill(0); iv.fill(0); }
}

export async function encryptedAgentAddress(): Promise<string | null> {
  const record = await readRecord();
  if (!record || record.version !== 1 || record.kdf !== 'scrypt' || !/^0x[0-9a-f]{40}$/.test(record.address)) return null;
  return record.address;
}

export async function removeEncryptedAgent() {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb(false);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(KEY_ID);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to remove encrypted agent record'));
    });
  } finally { db.close(); }
}

