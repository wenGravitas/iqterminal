import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INACTIVITY_MINUTES, MAX_INACTIVITY_MINUTES, MIN_INACTIVITY_MINUTES, TradingController, restoreTradingConfig } from '../src/trading/controller';
import { TRADING_SNAPSHOT_KEY, type OrderAttempt, type TradingSnapshot } from '../src/trading/model';

const PRINCIPAL = `0x${'12'.repeat(20)}`;
const CLOID = `0x${'ab'.repeat(16)}`;

class MemoryStorage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  entries() { return [...this.values.entries()]; }
}

class MockWorker {
  readonly messages: Record<string, any>[] = [];
  vaultInfoState: Record<string, any> = { address: null, exists: false, unlocked: false, storageAvailable: true, sessionOnlyAvailable: false };
  private listeners = new Map<string, Set<EventListener>>();
  terminated = false;
  addEventListener(type: string, listener: EventListener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: EventListener) { this.listeners.get(type)?.delete(listener); }
  terminate() { this.terminated = true; }
  emitVaultInfo() { this.emit({ type: 'vault-state', ...this.vaultInfoState }); }
  postMessage(message: Record<string, any>) {
    this.messages.push(message);
    if (message.type === 'activity' || message.type === 'dispose') return;
    if (message.type === 'configure') this.emit({ type: 'snapshot', snapshot: emptySnapshot(message.network, message.principal) });
    if (message.type === 'vault-info') this.emit({ type: 'vault-state', ...this.vaultInfoState });
    if (message.type === 'vault-remove') {
      this.vaultInfoState = { ...this.vaultInfoState, address: null, exists: false, unlocked: false, sessionOnly: false };
      this.emit({ type: 'vault-state', ...this.vaultInfoState });
    }
    this.emit({ type: 'result', id: message.id, value: message.type === 'configure' ? emptySnapshot(message.network, message.principal) : true });
  }
  private emit(data: unknown) { for (const listener of this.listeners.get('message') ?? []) listener({ data } as MessageEvent); }
}

function emptySnapshot(network: 'mainnet' | 'testnet', principal: string): TradingSnapshot {
  return {
    network, principal, feedState: 'disconnected', lastMessageAt: 0, lastSnapshotAt: 0,
    accountValue: null, marginUsed: null, withdrawable: null, totalNotional: null,
    positions: [], orders: [], fills: [], midPrice: null, markPrice: null, szDecimals: null, btcAsset: null,
    agentAddress: null, agentAuthorized: false, agentValidUntil: null, error: null,
  };
}

function attempt(network: 'mainnet' | 'testnet', principal: string): OrderAttempt {
  return {
    cloid: CLOID, network, principal,
    intent: { side: 'buy', size: '0.01', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    phase: 'unknown', createdAt: 1, updatedAt: 1, exchangeId: null, message: 'unknown',
  };
}

const storage = new MemoryStorage();
const controllers: TradingController[] = [];

function owner() {
  const listeners = new Set<(owned: boolean, otherOwner: boolean) => void>();
  const fake = {
    state: { owned: false, otherOwner: false, supported: true },
    subscribe(listener: (owned: boolean, otherOwner: boolean) => void) { listeners.add(listener); listener(false, false); return () => listeners.delete(listener); },
    acquire: async () => true,
    release: async () => {},
    dispose() {},
  };
  return fake;
}

function createController(options: { worker?: MockWorker; workerFactory?: () => Worker; fixtureMode?: boolean } = {}) {
  const worker = options.worker ?? new MockWorker();
  const factory = options.workerFactory ?? (() => worker as unknown as Worker);
  const controller = new TradingController({ workerFactory: factory, owner: owner() as any, fixtureMode: options.fixtureMode });
  controllers.push(controller);
  return { controller, worker };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  storage.clear();
});

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

describe('Hyperliquid trading controller lifecycle', () => {
  it('blocks key handling and exchange actions when diagnostic fixture mode is selected', async () => {
    const { controller, worker } = createController({ fixtureMode: true });
    expect(controller.state.executionDisabled).toBe(true);
    await expect(controller.generateAgent('a secure test passphrase')).rejects.toThrow(/fixture mode/i);
    await expect(controller.importAgent(`0x${'0'.repeat(63)}1`, 'a secure test passphrase')).rejects.toThrow(/fixture mode/i);
    await expect(controller.unlock('a secure test passphrase')).rejects.toThrow(/fixture mode/i);
    await expect(controller.generateSessionAgent()).rejects.toThrow(/fixture mode/i);
    await expect(controller.importSessionAgent(`0x${'0'.repeat(63)}1`)).rejects.toThrow(/fixture mode/i);
    expect(worker.messages).toHaveLength(0);

    await controller.setConfig('testnet', PRINCIPAL);
    expect(worker.messages.find(message => message.type === 'configure')).toMatchObject({ fixtureMode: true });
    const beforeActions = worker.messages.length;
    await expect(controller.submit({ side: 'buy', size: '0.01', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID })).rejects.toThrow(/fixture mode/i);
    await expect(controller.modify(1, '100000', '0.01')).rejects.toThrow(/fixture mode/i);
    await expect(controller.cancel(1)).rejects.toThrow(/fixture mode/i);
    await expect(controller.setLeverage(5, true)).rejects.toThrow(/fixture mode/i);
    expect(worker.messages).toHaveLength(beforeActions);
    expect(worker.messages.some(message => ['submit-order', 'modify-order', 'cancel-order', 'set-leverage', 'vault-generate', 'vault-import', 'vault-unlock'].includes(message.type))).toBe(false);
  });

  it('defaults old saved settings to a 15-minute timeout and bounds restored timeout values', () => {
    const legacy = restoreTradingConfig(JSON.stringify({ version: 1, network: 'testnet', principal: PRINCIPAL }));
    expect(legacy.inactivityMinutes).toBe(DEFAULT_INACTIVITY_MINUTES);
    expect(restoreTradingConfig(JSON.stringify({ version: 1, network: 'testnet', principal: PRINCIPAL, inactivityMinutes: MIN_INACTIVITY_MINUTES - 1 })).inactivityMinutes).toBe(DEFAULT_INACTIVITY_MINUTES);
    expect(restoreTradingConfig(JSON.stringify({ version: 1, network: 'testnet', principal: PRINCIPAL, inactivityMinutes: MAX_INACTIVITY_MINUTES + 1 })).inactivityMinutes).toBe(DEFAULT_INACTIVITY_MINUTES);
  });

  it('persists and sends a bounded inactivity timeout to the worker', async () => {
    const { controller, worker } = createController();
    await controller.setConfig('testnet', PRINCIPAL);
    await controller.setInactivityMinutes(37);
    expect(controller.state.config.inactivityMinutes).toBe(37);
    expect(JSON.parse(storage.getItem(TRADING_SNAPSHOT_KEY)!).inactivityMinutes).toBe(37);
    expect(worker.messages.find(message => message.type === 'set-inactivity-timeout')).toMatchObject({ minutes: 37 });
    await expect(controller.setInactivityMinutes(MIN_INACTIVITY_MINUTES - 1)).rejects.toThrow('Lock timeout must be');
    await expect(controller.setInactivityMinutes(MAX_INACTIVITY_MINUTES + 1)).rejects.toThrow('Lock timeout must be');
  });

  it('exposes session-only actions only when secure signing works and IndexedDB is unavailable', async () => {
    const worker = new MockWorker();
    worker.vaultInfoState = { address: null, exists: false, unlocked: false, storageAvailable: false, sessionOnlyAvailable: false, error: 'secure context required' };
    const { controller } = createController({ worker });
    await controller.setConfig('testnet', PRINCIPAL);
    expect(controller.state.vault).toMatchObject({ storageAvailable: false, sessionOnlyAvailable: false });
    await expect(controller.generateSessionAgent()).rejects.toThrow('IndexedDB is unavailable and secure signing is supported');
    expect(worker.messages.some(message => message.type === 'vault-session-generate')).toBe(false);

    worker.vaultInfoState = { address: null, exists: false, unlocked: false, storageAvailable: false, sessionOnlyAvailable: true };
    worker.emitVaultInfo();
    expect(controller.state.vault).toMatchObject({ storageAvailable: false, sessionOnlyAvailable: true });
    await controller.generateSessionAgent();
    expect(worker.messages.some(message => message.type === 'vault-session-generate')).toBe(true);
  });

  it('disconnects public account reads while retaining remembered identity and attempt history', async () => {
    storage.setItem(TRADING_SNAPSHOT_KEY, JSON.stringify({ version: 1, network: 'mainnet', principal: PRINCIPAL, connected: true }));
    const key = `${TRADING_SNAPSHOT_KEY}.attempts:mainnet:${PRINCIPAL.toLowerCase()}`;
    storage.setItem(key, JSON.stringify([attempt('mainnet', PRINCIPAL)]));
    const { controller, worker } = createController();
    await controller.ready;
    await controller.disconnect();
    expect(controller.state.config).toMatchObject({ network: 'mainnet', principal: PRINCIPAL.toLowerCase(), connected: false });
    expect(storage.getItem(key)).not.toBeNull();
    expect(worker.messages.some(message => message.type === 'vault-remove')).toBe(false);
    expect(worker.messages.filter(message => message.type === 'configure').at(-1)).toMatchObject({ principal: '' });
  });

  it('forgets local trading data and deletes the saved encrypted agent', async () => {
    storage.setItem(TRADING_SNAPSHOT_KEY, JSON.stringify({ version: 1, network: 'testnet', principal: PRINCIPAL, connected: true }));
    storage.setItem(`${TRADING_SNAPSHOT_KEY}.attempts:testnet:${PRINCIPAL.toLowerCase()}`, JSON.stringify([attempt('testnet', PRINCIPAL)]));
    const { controller, worker } = createController();
    await controller.ready;
    await controller.forgetDevice();
    expect(worker.messages.some(message => message.type === 'vault-remove')).toBe(true);
    expect(storage.entries()).toEqual([]);
    expect(controller.state.config).toMatchObject({ principal: '', connected: false, network: 'testnet' });
  });

  it('does not create the SDK worker for a fresh workspace until trading is explicitly requested', async () => {
    const factory = vi.fn(() => new MockWorker() as unknown as Worker);
    const { controller } = createController({ workerFactory: factory });
    await controller.ready;
    controller.activity();
    expect(factory).not.toHaveBeenCalled();
    controller.dispose();
    expect(factory).not.toHaveBeenCalled();
  });

  it('restores public account state on startup when a principal was saved', async () => {
    storage.setItem(TRADING_SNAPSHOT_KEY, JSON.stringify({ version: 1, network: 'mainnet', principal: PRINCIPAL }));
    const { controller, worker } = createController();
    await controller.ready;
    expect(worker.messages.map(message => message.type)).toEqual(['configure', 'vault-info']);
    expect(controller.state.snapshot).toMatchObject({ network: 'mainnet', principal: PRINCIPAL.toLowerCase() });
    expect(controller.state.vault.unlocked).toBe(false);
  });

  it('restores cloid attempts only for the saved network and principal', async () => {
    storage.setItem(TRADING_SNAPSHOT_KEY, JSON.stringify({ version: 1, network: 'testnet', principal: PRINCIPAL }));
    storage.setItem(`${TRADING_SNAPSHOT_KEY}.attempts:testnet:${PRINCIPAL.toLowerCase()}`, JSON.stringify([attempt('testnet', PRINCIPAL)]));
    storage.setItem(`${TRADING_SNAPSHOT_KEY}.attempts:mainnet:${PRINCIPAL.toLowerCase()}`, JSON.stringify([attempt('mainnet', PRINCIPAL)]));
    const { controller } = createController();
    await controller.ready;
    expect(controller.state.attempts).toHaveLength(1);
    expect(controller.state.attempts[0]?.network).toBe('testnet');
  });

  it('switches the public worker identity without carrying snapshot rows across accounts', async () => {
    const { controller, worker } = createController();
    await controller.setConfig('testnet', PRINCIPAL);
    await controller.setConfig('mainnet', `0x${'34'.repeat(20)}`);
    expect(worker.messages.filter(message => message.type === 'configure').map(message => [message.network, message.principal])).toEqual([
      ['testnet', PRINCIPAL.toLowerCase()], ['mainnet', `0x${'34'.repeat(20)}`],
    ]);
    expect(controller.state.snapshot).toMatchObject({ network: 'mainnet', principal: `0x${'34'.repeat(20)}`, positions: [], orders: [], fills: [] });
  });
});
