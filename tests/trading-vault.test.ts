import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { privateKeyToAccount } from 'viem/accounts';
import { IDBFactory } from 'fake-indexeddb';

type StoredRecord = {
  version: number; kdf: string; N: number; r: number; p: number; address: string;
  salt: ArrayBuffer; iv: ArrayBuffer; ciphertext: ArrayBuffer; savedAt: number;
  network?: string; principal?: string;
};

const DB_NAME = 'basis.hyperliquid.agent.v1';
const LEGACY_KEY_ID = 'default-agent';
const NETWORK = 'testnet' as const;
const PRINCIPAL = `0x${'12'.repeat(20)}`;
const OTHER_PRINCIPAL = `0x${'34'.repeat(20)}`;
const PRIVATE_KEY = `0x${'0'.repeat(63)}1` as `0x${string}`;
const PASSPHRASE = 'correct horse battery staple';
const LEGACY_AAD = new TextEncoder().encode('basis-hyperliquid-agent-v1');
let factory: IDBFactory;

const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
const previousSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');

async function openTestDb() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('vault')) request.result.createObjectStore('vault'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRaw(key: IDBValidKey): Promise<unknown | undefined> {
  const db = await openTestDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('vault', 'readonly');
      const request = transaction.objectStore('vault').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function writeRaw(key: IDBValidKey, value: unknown) {
  const db = await openTestDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('vault', 'readwrite');
      transaction.objectStore('vault').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('test write aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('test write failed'));
    });
  } finally { db.close(); }
}

async function scopedRecordKey(network: 'mainnet' | 'testnet' = NETWORK, principal = PRINCIPAL) {
  return `agent:v2:${network}:${principal.toLowerCase()}`;
}

async function legacyFixture(passphrase = PASSPHRASE, privateKey = PRIVATE_KEY): Promise<StoredRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const derived = await scryptAsync(passphrase, salt, {
    N: 2 ** 15, r: 8, p: 1, dkLen: 32, maxmem: 40 * 1024 * 1024, asyncTick: 12,
  });
  try {
    const aesKey = await crypto.subtle.importKey('raw', derived, { name: 'AES-GCM' }, false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: LEGACY_AAD, tagLength: 128 }, aesKey,
      new TextEncoder().encode(privateKey));
    return {
      version: 1, kdf: 'scrypt', N: 2 ** 15, r: 8, p: 1,
      address: privateKeyToAccount(privateKey).address.toLowerCase(),
      salt: salt.buffer.slice(0), iv: iv.buffer.slice(0), ciphertext, savedAt: 1,
    };
  } finally { derived.fill(0); salt.fill(0); iv.fill(0); }
}

let vault: typeof import('../src/trading/vault');
beforeEach(async () => {
  factory = new IDBFactory();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  vault = await import('../src/trading/vault');
});

afterAll(() => {
  if (previousIndexedDb) Object.defineProperty(globalThis, 'indexedDB', previousIndexedDb);
  else Reflect.deleteProperty(globalThis, 'indexedDB');
  if (previousSecureContext) Object.defineProperty(globalThis, 'isSecureContext', previousSecureContext);
  else Reflect.deleteProperty(globalThis, 'isSecureContext');
});

describe('local Hyperliquid agent vault', () => {
  it('writes scoped p=3 records and requires that account scope and passphrase to unlock', async () => {
    await expect(vault.encryptAgentPrivateKey(PRIVATE_KEY, PASSPHRASE, NETWORK, PRINCIPAL)).resolves.toMatchObject({ exists: true });
    const key = await scopedRecordKey();
    const record = await readRaw(key) as StoredRecord;
    expect(record).toMatchObject({ version: 2, network: NETWORK, principal: PRINCIPAL, kdf: 'scrypt', N: 32_768, r: 8, p: 3 });
    expect(record.salt).toBeInstanceOf(ArrayBuffer);
    expect(record.iv).toBeInstanceOf(ArrayBuffer);
    expect(record.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(record.ciphertext)).not.toContain(PRIVATE_KEY);
    expect(await vault.getAgentVaultInfo(NETWORK, PRINCIPAL)).toMatchObject({ address: record.address, exists: true, legacyNeedsBinding: false });
    await expect(vault.decryptScopedAgentPrivateKey(PASSPHRASE, NETWORK, PRINCIPAL)).resolves.toMatchObject({ privateKey: PRIVATE_KEY });
    await expect(vault.decryptScopedAgentPrivateKey('wrong passphrase value', NETWORK, PRINCIPAL))
      .rejects.toThrow('Unable to unlock agent key; check the passphrase or encrypted record');
    await expect(vault.decryptScopedAgentPrivateKey(PASSPHRASE, 'mainnet', PRINCIPAL))
      .rejects.toThrow('No encrypted agent key is stored for the selected network and principal');
    await expect(vault.decryptScopedAgentPrivateKey(PASSPHRASE, NETWORK, OTHER_PRINCIPAL))
      .rejects.toThrow('No encrypted agent key is stored for the selected network and principal');
  });

  it('rejects unsupported legacy KDF parameters before attempting decryption', async () => {
    const record = await legacyFixture();
    await writeRaw(LEGACY_KEY_ID, { ...record, p: 2 });
    await expect(vault.decryptLegacyAgentPrivateKey(PASSPHRASE)).rejects.toThrow('Stored legacy agent encryption parameters are unsupported');
    await expect(vault.getAgentVaultInfo(NETWORK, PRINCIPAL)).resolves.toMatchObject({ legacyNeedsBinding: true, address: null });
  });

  it('rejects corrupted authenticated ciphertext and leaves the scoped record untouched', async () => {
    await vault.encryptAgentPrivateKey(PRIVATE_KEY, PASSPHRASE, NETWORK, PRINCIPAL);
    const key = await scopedRecordKey();
    const record = structuredClone(await readRaw(key)) as StoredRecord;
    const damaged = new Uint8Array(record.ciphertext); damaged[0] ^= 1;
    const corrupted = { ...record, ciphertext: damaged.buffer };
    await writeRaw(key, corrupted);
    await expect(vault.decryptScopedAgentPrivateKey(PASSPHRASE, NETWORK, PRINCIPAL))
      .rejects.toThrow('Unable to unlock agent key; check the passphrase or encrypted record');
    expect(await readRaw(key)).toEqual(corrupted);
  });

  it('rejects a cross-scope ciphertext copy even when its public header matches the destination key', async () => {
    await vault.encryptAgentPrivateKey(PRIVATE_KEY, PASSPHRASE, NETWORK, PRINCIPAL);
    const sourceKey = await scopedRecordKey();
    const source = structuredClone(await readRaw(sourceKey)) as StoredRecord;
    const destinationKey = await scopedRecordKey('mainnet', OTHER_PRINCIPAL);
    const tampered = { ...source, network: 'mainnet', principal: OTHER_PRINCIPAL };
    await writeRaw(destinationKey, tampered);

    await expect(vault.decryptScopedAgentPrivateKey(PASSPHRASE, 'mainnet', OTHER_PRINCIPAL))
      .rejects.toThrow('Unable to unlock agent key; check the passphrase or encrypted record');
    expect(await readRaw(sourceKey)).toEqual(source);
    expect(await readRaw(destinationKey)).toEqual(tampered);
  });

  it('explicitly decrypts legacy p=1, prepares scoped p=3, then atomically moves the record', async () => {
    const legacy = await legacyFixture();
    await writeRaw(LEGACY_KEY_ID, legacy);
    await expect(vault.getAgentVaultInfo(NETWORK, PRINCIPAL)).resolves.toMatchObject({ address: null, exists: true, legacyNeedsBinding: true });
    await expect(vault.decryptLegacyAgentPrivateKey('wrong passphrase value'))
      .rejects.toThrow('Unable to unlock agent key; check the passphrase or encrypted record');
    expect(await readRaw(LEGACY_KEY_ID)).toEqual(legacy);
    const decrypted = await vault.decryptLegacyAgentPrivateKey(PASSPHRASE);
    const storedLegacy = await readRaw(LEGACY_KEY_ID) as StoredRecord;
    expect(decrypted.sourceRecord).toEqual(storedLegacy);
    expect(storedLegacy.salt).toBeInstanceOf(ArrayBuffer);
    expect(decrypted.sourceRecord.salt).toBeInstanceOf(ArrayBuffer);
    expect(decrypted).toMatchObject({ address: legacy.address, privateKey: PRIVATE_KEY });
    const prepared = await vault.prepareLegacyAgentBinding(PASSPHRASE, decrypted, NETWORK, PRINCIPAL);
    expect(prepared).toMatchObject({ version: 2, network: NETWORK, principal: PRINCIPAL, address: legacy.address, p: 3 });

    await vault.commitLegacyAgentBinding(decrypted.sourceRecord, prepared);
    const target = await scopedRecordKey();
    expect(await readRaw(LEGACY_KEY_ID)).toBeUndefined();
    expect(await readRaw(target)).toMatchObject({ version: 2, network: NETWORK, principal: PRINCIPAL, address: legacy.address, p: 3 });
    await expect(vault.decryptScopedAgentPrivateKey(PASSPHRASE, NETWORK, PRINCIPAL)).resolves.toMatchObject({ privateKey: PRIVATE_KEY });
  });

  it('preserves the source and destination when a concurrent scoped record already exists', async () => {
    const legacy = await legacyFixture();
    await writeRaw(LEGACY_KEY_ID, legacy);
    const decrypted = await vault.decryptLegacyAgentPrivateKey(PASSPHRASE);
    const prepared = await vault.prepareLegacyAgentBinding(PASSPHRASE, decrypted, NETWORK, PRINCIPAL);
    const target = await scopedRecordKey();
    const existing = { version: 2, corrupt: true };
    await writeRaw(target, existing);
    await expect(vault.commitLegacyAgentBinding(decrypted.sourceRecord, prepared)).rejects.toThrow('An agent record already exists');
    expect(await readRaw(LEGACY_KEY_ID)).toMatchObject({ version: 1 });
    expect(await readRaw(target)).toEqual(existing);
  });

  it('rolls back a scoped add when cancellation occurs after the add succeeds', async () => {
    const legacy = await legacyFixture();
    await writeRaw(LEGACY_KEY_ID, legacy);
    const decrypted = await vault.decryptLegacyAgentPrivateKey(PASSPHRASE);
    const prepared = await vault.prepareLegacyAgentBinding(PASSPHRASE, decrypted, NETWORK, PRINCIPAL);
    let checks = 0;
    const context = {
      network: NETWORK, principal: PRINCIPAL, accountGeneration: 1, signingGeneration: 1,
      assertCurrent() {
        checks++;
        if (checks === 4) throw new Error('canceled after scoped add succeeded');
      },
    };
    await expect(vault.commitLegacyAgentBinding(decrypted.sourceRecord, prepared, context)).rejects.toThrow('canceled after scoped add succeeded');
    expect(await readRaw(LEGACY_KEY_ID)).toMatchObject({ version: 1, address: legacy.address });
    expect(await readRaw(await scopedRecordKey())).toBeUndefined();
  });

  it('requires a secure context and Web Crypto before enabling agent signing', async () => {
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    expect(vault.secureSigningAvailable()).toBe(false);
    expect(vault.secureVaultAvailable()).toBe(false);
    await expect(vault.encryptAgentPrivateKey(PRIVATE_KEY, PASSPHRASE, NETWORK, PRINCIPAL))
      .rejects.toThrow('secure browser context');
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  });
});
