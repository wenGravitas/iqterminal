import { afterAll, beforeEach, describe, expect, it } from 'vitest';

type Stored = { [key: string]: unknown };
const rows = new Map<IDBValidKey, unknown>();
let storeCreated = false;

function request<T>(run: () => T): IDBRequest<T> {
  const result: Record<string, any> = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try { result.result = run(); result.onsuccess?.({ target: result } as Event); }
    catch (error) { result.error = error; result.onerror?.({ target: result } as Event); }
  });
  return result as IDBRequest<T>;
}

const database = {
  objectStoreNames: { contains: (name: string) => storeCreated && name === 'vault' } as DOMStringList,
  createObjectStore(name: string) { if (name === 'vault') storeCreated = true; return {}; },
  close() {},
  transaction(_name: string, _mode: IDBTransactionMode) {
    const transaction: Record<string, any> = { oncomplete: null, onerror: null, onabort: null, error: null };
    let completionScheduled = false;
    const complete = () => {
      if (completionScheduled) return;
      completionScheduled = true;
      setTimeout(() => transaction.oncomplete?.({ target: transaction } as Event), 0);
    };
    transaction.objectStore = () => ({
      get(key: IDBValidKey) { return request(() => rows.get(key)); },
      put(value: unknown, key: IDBValidKey) { rows.set(key, structuredClone(value)); complete(); return request(() => key); },
      delete(key: IDBValidKey) { rows.delete(key); complete(); return request(() => undefined); },
    });
    return transaction as unknown as IDBTransaction;
  },
};
const fakeIndexedDb = {
  open(_name: string, _version?: number) {
    const result: Record<string, any> = { result: database, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    queueMicrotask(() => { if (!storeCreated) result.onupgradeneeded?.({ target: result } as Event); result.onsuccess?.({ target: result } as Event); });
    return result as IDBOpenDBRequest;
  },
} as unknown as IDBFactory;

const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fakeIndexedDb });
const previousSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });

let vault: typeof import('../src/trading/vault');
beforeEach(async () => {
  rows.clear(); storeCreated = false;
  vault = await import('../src/trading/vault');
});

afterAll(() => {
  if (previousIndexedDb) Object.defineProperty(globalThis, 'indexedDB', previousIndexedDb);
  else Reflect.deleteProperty(globalThis, 'indexedDB');
  if (previousSecureContext) Object.defineProperty(globalThis, 'isSecureContext', previousSecureContext);
  else Reflect.deleteProperty(globalThis, 'isSecureContext');
});

describe('local Hyperliquid agent vault', () => {
  it('encrypts an imported agent key at rest and requires the same passphrase to unlock', async () => {
    const privateKey = `0x${'0'.repeat(63)}1` as `0x${string}`;
    await expect(vault.encryptAgentPrivateKey(privateKey, 'correct horse battery staple')).resolves.toMatchObject({ exists: true });
    const record = rows.values().next().value as Stored;
    expect(record).toMatchObject({ version: 1, kdf: 'scrypt', N: 32_768, r: 8, p: 1 });
    expect(record.salt).toBeInstanceOf(ArrayBuffer);
    expect(record.iv).toBeInstanceOf(ArrayBuffer);
    expect(record.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(record.ciphertext as ArrayBuffer)).not.toContain(privateKey);
    await expect(vault.encryptedAgentAddress()).resolves.toMatch(/^0x[0-9a-f]{40}$/);
    await expect(vault.decryptAgentPrivateKey('correct horse battery staple')).resolves.toMatchObject({ privateKey });
    await expect(vault.decryptAgentPrivateKey('wrong passphrase value')).rejects.toThrow('Unable to unlock agent key; check the passphrase or encrypted record');
  });

  it('rejects unsupported encryption parameters before attempting decryption', async () => {
    rows.set('default-agent', {
      version: 1, kdf: 'scrypt', N: 16_384, r: 8, p: 1, address: `0x${'12'.repeat(20)}`,
      salt: new ArrayBuffer(16), iv: new ArrayBuffer(12), ciphertext: new ArrayBuffer(32), savedAt: 1,
    });
    await expect(vault.decryptAgentPrivateKey('correct horse battery staple')).rejects.toThrow('Stored agent encryption parameters are unsupported');
  });

  it('rejects corrupted authenticated ciphertext even with the right passphrase', async () => {
    await vault.encryptAgentPrivateKey(`0x${'0'.repeat(63)}1`, 'correct horse battery staple');
    const record = structuredClone(rows.get('default-agent')) as { ciphertext: ArrayBuffer };
    const damaged = new Uint8Array(record.ciphertext); damaged[0] ^= 1;
    rows.set('default-agent', { ...record, ciphertext: damaged.buffer });
    await expect(vault.decryptAgentPrivateKey('correct horse battery staple')).rejects.toThrow('Unable to unlock agent key; check the passphrase or encrypted record');
  });

  it('requires a secure context and Web Crypto before enabling agent signing', async () => {
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    expect(vault.secureSigningAvailable()).toBe(false);
    expect(vault.secureVaultAvailable()).toBe(false);
    await expect(vault.encryptAgentPrivateKey(`0x${'0'.repeat(63)}1`, 'correct horse battery staple'))
      .rejects.toThrow('secure browser context');
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  });
});
