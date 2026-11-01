import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@nktkas/hyperliquid/api/exchange';

const state = vi.hoisted(() => ({
  secureSigning: true,
  secureVault: true,
  clearing: { marginSummary: { accountValue: '10000', totalMarginUsed: '100', totalNtlPos: '0' }, assetPositions: [] as Record<string, unknown>[], withdrawable: '9900' },
  activeAssetData: { leverage: { type: 'cross', value: 5 }, availableToTrade: ['100', '100'] } as Record<string, unknown>,
  orders: [] as Record<string, unknown>[],
  fills: [] as Record<string, unknown>[],
  agents: [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'test', validUntil: null }] as Record<string, unknown>[],
  extraAgentsImpl: vi.fn(async (_params?: unknown) => state.agents),
  decryptAgentImpl: vi.fn(async () => ({ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', privateKey: `0x${'0'.repeat(63)}1` })),
  decryptLegacyAgentImpl: vi.fn(async () => ({
    address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', privateKey: `0x${'0'.repeat(63)}1`,
    sourceRecord: { version: 1, kdf: 'scrypt', N: 32_768, r: 8, p: 1 },
  })),
  vaultInfoImpl: vi.fn(async () => ({ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf' as string | null, exists: true, legacyNeedsBinding: false })),
  prepareLegacyImpl: vi.fn(async () => ({ version: 2, network: 'testnet', principal: `0x${'22'.repeat(20)}`, p: 3 })),
  commitLegacyImpl: vi.fn(async () => {}),
  clearinghouseReadImpl: vi.fn(async () => state.clearing),
  status: { status: 'unknownOid' } as Record<string, unknown>,
  orderResponse: { status: 'ok', response: { data: { statuses: [{ resting: { oid: 77 } }] } } } as unknown,
  orderImpl: vi.fn(async (_params?: unknown): Promise<unknown> => ({ status: 'ok', response: { data: { statuses: [{ resting: { oid: 77 } }] } } })),
  modifyImpl: vi.fn(async (_params?: unknown): Promise<unknown> => ({ status: 'ok', response: { type: 'default' } })),
  cancelImpl: vi.fn(async (_params?: unknown): Promise<unknown> => ({ status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } })),
  leverageImpl: vi.fn(async (_params?: unknown): Promise<unknown> => ({ status: 'ok', response: { type: 'default' } })),
  orderStatusImpl: vi.fn(async (_params?: unknown): Promise<any> => ({ status: 'unknownOid' })),
  encryptAgentImpl: vi.fn(async () => ({ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', exists: true })),
  removeAgentImpl: vi.fn(async () => {}),
  orderCalls: [] as unknown[],
  modifyCalls: [] as unknown[],
  cancelCalls: [] as unknown[],
  leverageCalls: [] as unknown[],
  statusCalls: [] as unknown[],
  intervalCallbacks: [] as { callback: () => void; delay: number }[],
  wsOptions: [] as unknown[],
  orderUpdateListeners: [] as ((value: unknown) => void)[],
  userFillListeners: [] as ((value: unknown) => void)[],
  clearinghouseListeners: [] as ((value: unknown) => void)[],
  openOrderListeners: [] as ((value: unknown) => void)[],
  midPriceListeners: [] as ((value: unknown) => void)[],
  markPriceListeners: [] as ((value: unknown) => void)[],
  subscriptionErrors: [] as ((error: unknown) => void)[],
  websocketSockets: [] as EventTarget[],
  exchangeWallets: [] as unknown[],
  failSubscriptionAcks: [] as string[],
}));

vi.mock('@nktkas/hyperliquid', () => {
  class HttpTransport {
    isTestnet: boolean;
    apiUrl: string;
    constructor(options: { isTestnet?: boolean; apiUrl?: string } = {}) {
      this.isTestnet = options.isTestnet ?? false;
      this.apiUrl = options.apiUrl ?? (this.isTestnet ? 'https://api.hyperliquid-testnet.xyz' : 'https://api.hyperliquid.xyz');
    }
  }
  class WebSocketTransport {
    socket = new EventTarget();
    constructor(options?: unknown) { state.wsOptions.push(options); state.websocketSockets.push(this.socket); }
    close() { this.socket.dispatchEvent(new Event('close')); }
  }
  class InfoClient {
    async clearinghouseState() { return state.clearinghouseReadImpl(); }
    async openOrders() { return state.orders; }
    async frontendOpenOrders() { return state.orders; }
    async userFills() { return state.fills; }
    async meta() { return { universe: [{ name: 'BTC', index: 0, szDecimals: 5, maxLeverage: 40 }] }; }
    async activeAssetData() { return state.activeAssetData; }
    async extraAgents(params?: unknown) { return state.extraAgentsImpl(params); }
    async orderStatus(params: unknown) { state.statusCalls.push(params); return state.orderStatusImpl(params); }
  }
  class SubscriptionClient {
    private sentInitialEvent = new Set<string>();
    private subscription(kind: string, options?: { onError?: (error: unknown) => void }) {
      if (state.failSubscriptionAcks.includes(kind)) return Promise.reject(new Error(`${kind} resubscription rejected`));
      if (options?.onError) state.subscriptionErrors.push(options.onError);
      return Promise.resolve({ unsubscribe: async () => {} });
    }
    private event(kind: string, listener: (value: unknown) => void, value: unknown) { if (this.sentInitialEvent.has(kind)) return; this.sentInitialEvent.add(kind); listener(value); }
    async clearinghouseState(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.clearinghouseListeners.push(listener); this.event('Account', listener, { clearinghouseState: state.clearing }); return this.subscription('Account', options); }
    async openOrders(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.openOrderListeners.push(listener); this.event('Open-order', listener, state.orders); return this.subscription('Open-order', options); }
    async orderUpdates(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.orderUpdateListeners.push(listener); this.event('Order-update', listener, []); return this.subscription('Order-update', options); }
    async userFills(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.userFillListeners.push(listener); this.event('Fill', listener, state.fills); return this.subscription('Fill', options); }
    async allMids(listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.midPriceListeners.push(listener); this.event('Mid-price', listener, { mids: { BTC: '100000' } }); return this.subscription('Mid-price', options); }
    async activeAssetCtx(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.markPriceListeners.push(listener); this.event('Mark-price', listener, { ctx: { markPx: '100001' } }); return this.subscription('Mark-price', options); }
  }
  class ExchangeClient {
    constructor(options?: { wallet?: unknown }) { if (options?.wallet) state.exchangeWallets.push(options.wallet); }
    async order(params: unknown) { state.orderCalls.push(params); return state.orderImpl(params); }
    async modify(params: unknown) { state.modifyCalls.push(params); return state.modifyImpl(params); }
    async cancel(params: unknown) { state.cancelCalls.push(params); return state.cancelImpl(params); }
    async updateLeverage(params: unknown) { state.leverageCalls.push(params); return state.leverageImpl(params); }
  }
  return { HttpTransport, WebSocketTransport, InfoClient, SubscriptionClient, ExchangeClient };
});

vi.mock('../src/trading/vault', () => ({
  secureSigningAvailable: vi.fn(() => state.secureSigning),
  secureVaultAvailable: vi.fn(() => state.secureVault),
  getAgentVaultInfo: state.vaultInfoImpl,
  decryptScopedAgentPrivateKey: state.decryptAgentImpl,
  decryptLegacyAgentPrivateKey: state.decryptLegacyAgentImpl,
  prepareLegacyAgentBinding: state.prepareLegacyImpl,
  commitLegacyAgentBinding: state.commitLegacyImpl,
  encryptAgentPrivateKey: state.encryptAgentImpl,
  removeEncryptedAgent: state.removeAgentImpl,
  removeAllEncryptedAgents: vi.fn(async () => {}),
}));

const PRINCIPAL = `0x${'22'.repeat(20)}`;
const CLOID = `0x${'ab'.repeat(16)}`;
const resultEvents: Record<string, unknown>[] = [];
let fakeSelf: { postMessage(message: Record<string, unknown>): void; close(): void; onmessage: ((event: { data: Record<string, unknown> }) => void) | null; closed: boolean };
let workerModule: unknown;
let id = 0;
let selfDescriptor: PropertyDescriptor | undefined;

async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve(); }

async function waitUntil(predicate: () => boolean, label: string) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await flush(); await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`${label} did not settle`);
}

function latestAttempt() {
  return resultEvents.filter(event => event.type === 'attempt').at(-1)?.attempt as Record<string, unknown> | undefined;
}
function latestSnapshot() {
  return resultEvents.filter(event => event.type === 'snapshot').at(-1)?.snapshot as Record<string, unknown> | undefined;
}

async function request(type: string, fields: Record<string, unknown> = {}) {
  const requestId = ++id;
  fakeSelf.onmessage?.({ data: { type, id: requestId, ...fields } });
  for (let i = 0; i < 100; i++) {
    await flush();
    const result = resultEvents.find(event => event.type === 'result' && event.id === requestId);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`worker request ${type} did not resolve`);
}

async function configureAndUnlock() {
  const configured = await request('configure', { network: 'testnet', principal: PRINCIPAL, fixtureMode: false });
  expect(configured.error).toBeUndefined();
  for (let i = 0; i < 100 && !resultEvents.some(event => event.type === 'snapshot' && (event.snapshot as any)?.btcAsset === 0
    && (event.snapshot as any)?.btcLeverage === 5 && (event.snapshot as any)?.feedState === 'live'); i++) {
    await flush(); await new Promise(resolve => setTimeout(resolve, 0));
  }
  const unlocked = await request('vault-unlock', { passphrase: 'a secure test passphrase' });
  expect(unlocked.error).toBeUndefined();
  return unlocked;
}

async function configureOnly() {
  const configured = await request('configure', { network: 'testnet', principal: PRINCIPAL, fixtureMode: false });
  expect(configured.error).toBeUndefined();
  for (let i = 0; i < 100 && !resultEvents.some(event => event.type === 'snapshot' && (event.snapshot as any)?.btcAsset === 0); i++) {
    await flush(); await new Promise(resolve => setTimeout(resolve, 0));
  }
}

beforeEach(async () => {
  vi.resetModules();
  state.intervalCallbacks.length = 0;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: TimerHandler, delay?: number) => {
    state.intervalCallbacks.push({ callback: callback as () => void, delay: delay ?? 0 });
    return state.intervalCallbacks.length as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval);
  state.secureSigning = true; state.secureVault = true;
  state.clearing = { marginSummary: { accountValue: '10000', totalMarginUsed: '100', totalNtlPos: '0' }, assetPositions: [], withdrawable: '9900' };
  state.activeAssetData = { leverage: { type: 'cross', value: 5 }, availableToTrade: ['100', '100'] };
  state.orders = []; state.fills = [];
  state.agents = [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'test', validUntil: null }];
  state.extraAgentsImpl.mockReset().mockImplementation(async () => state.agents);
  state.decryptAgentImpl.mockClear();
  state.decryptLegacyAgentImpl.mockReset().mockImplementation(async () => ({
    address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', privateKey: `0x${'0'.repeat(63)}1`,
    sourceRecord: { version: 1, kdf: 'scrypt', N: 32_768, r: 8, p: 1 },
  }));
  state.vaultInfoImpl.mockReset().mockImplementation(async () => ({ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', exists: true, legacyNeedsBinding: false }));
  state.prepareLegacyImpl.mockReset().mockImplementation(async () => ({ version: 2, network: 'testnet', principal: PRINCIPAL, p: 3 }));
  state.commitLegacyImpl.mockReset().mockResolvedValue(undefined);
  state.clearinghouseReadImpl.mockReset().mockImplementation(async () => state.clearing);
  state.status = { status: 'unknownOid' };
  state.orderCalls.length = 0; state.modifyCalls.length = 0; state.cancelCalls.length = 0; state.leverageCalls.length = 0; state.statusCalls.length = 0;
  state.wsOptions.length = 0; state.websocketSockets.length = 0; state.subscriptionErrors.length = 0; state.orderUpdateListeners.length = 0; state.userFillListeners.length = 0;
  state.failSubscriptionAcks.length = 0;
  state.clearinghouseListeners.length = 0; state.openOrderListeners.length = 0; state.midPriceListeners.length = 0; state.markPriceListeners.length = 0;
  state.orderImpl.mockReset().mockImplementation(async () => state.orderResponse);
  state.modifyImpl.mockReset().mockImplementation(async () => ({ status: 'ok', response: { type: 'default' } }));
  state.cancelImpl.mockReset().mockImplementation(async () => ({ status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } }));
  state.leverageImpl.mockReset().mockImplementation(async () => ({ status: 'ok', response: { type: 'default' } }));
  state.orderStatusImpl.mockReset().mockImplementation(async () => ({ status: 'unknownOid' }));
  state.encryptAgentImpl.mockClear(); state.removeAgentImpl.mockClear();
  state.exchangeWallets.length = 0;
  resultEvents.length = 0; id = 0;
  selfDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
  fakeSelf = { postMessage: message => resultEvents.push(message), close() { this.closed = true; }, onmessage: null, closed: false };
  Object.defineProperty(globalThis, 'self', { value: fakeSelf, configurable: true, writable: true });
  workerModule = await import('../src/trading/worker');
});

afterEach(async () => {
  if (fakeSelf.onmessage) { fakeSelf.onmessage({ data: { type: 'dispose' } }); await flush(); }
  if (selfDescriptor) Object.defineProperty(globalThis, 'self', selfDescriptor);
  else Reflect.deleteProperty(globalThis, 'self');
  vi.useRealTimers();
  vi.restoreAllMocks();
  void workerModule;
});

describe('Hyperliquid worker mutations against mocked SDK clients', () => {
  it('fails closed before mode selection and blocks key and exchange requests in latched fixture mode', async () => {
    const beforeConfigure = await request('vault-import', { privateKey: `0x${'0'.repeat(63)}1`, passphrase: 'a secure test passphrase' });
    expect(beforeConfigure.error).toContain('configured before key handling');
    expect(state.encryptAgentImpl).not.toHaveBeenCalled();

    const configured = await request('configure', { network: 'testnet', principal: PRINCIPAL, fixtureMode: true });
    expect(configured.error).toBeUndefined();
    const blocked = [
      ['vault-generate', { passphrase: 'a secure test passphrase' }],
      ['vault-import', { privateKey: `0x${'0'.repeat(63)}1`, passphrase: 'a secure test passphrase' }],
      ['vault-session-generate', {}],
      ['vault-session-import', { privateKey: `0x${'0'.repeat(63)}1` }],
      ['vault-unlock', { passphrase: 'a secure test passphrase' }],
      ['submit-order', {}], ['modify-order', {}], ['cancel-order', {}], ['set-leverage', {}],
    ] as const;
    for (const [type, fields] of blocked) {
      const response = await request(type, fields);
      expect(response.error, type).toContain('disabled while diagnostic fixture mode is selected');
    }
    expect(state.encryptAgentImpl).not.toHaveBeenCalled();
    expect(state.decryptAgentImpl).not.toHaveBeenCalled();
    expect(state.orderCalls).toHaveLength(0);
    expect(state.modifyCalls).toHaveLength(0);
    expect(state.cancelCalls).toHaveLength(0);
    expect(state.leverageCalls).toHaveLength(0);

    const flipped = await request('configure', { network: 'mainnet', principal: PRINCIPAL, fixtureMode: false });
    expect(flipped.error).toContain('fixture mode is immutable');
    const afterFlip = await request('submit-order', {});
    expect(afterFlip.error).toContain('disabled while diagnostic fixture mode is selected');
    expect(state.orderCalls).toHaveLength(0);
  });

  it('requires a fresh live authoritative account snapshot before and after asynchronous authorization', async () => {
    await configureAndUnlock();
    const intent = (cloid: string) => ({ side: 'buy' as const, size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc' as const, cloid });
    const authorityCalls = state.extraAgentsImpl.mock.calls.length;
    state.subscriptionErrors[0]?.(new Error('account socket closed'));
    const staleBeforeAuth = await request('submit-order', { intent: intent(`0x${'31'.repeat(16)}`) });
    expect(staleBeforeAuth.error).toContain('fresh live authoritative BTC account snapshot');
    expect(state.extraAgentsImpl).toHaveBeenCalledTimes(authorityCalls);
    expect(state.orderCalls).toHaveLength(0);

    const staleSnapshotAt = Number(latestSnapshot()?.lastSnapshotAt);
    state.clearinghouseListeners.at(-1)?.({ clearinghouseState: state.clearing });
    state.openOrderListeners.at(-1)?.(state.orders);
    state.orderUpdateListeners.at(-1)?.([]);
    state.userFillListeners.at(-1)?.([]);
    await request('refresh');
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) > staleSnapshotAt && latestSnapshot()?.feedState === 'live', 'fresh account after restored streams');
    // A separate stream error during the awaited authority lookup invalidates
    // readiness before the exchange adapter can be called.
    state.extraAgentsImpl.mockImplementationOnce(async () => {
      state.subscriptionErrors[0]?.(new Error('account socket closed during auth'));
      return state.agents;
    });
    const staleAfterAuth = await request('submit-order', { intent: intent(`0x${'32'.repeat(16)}`) });
    expect(staleAfterAuth.error).toContain('fresh live authoritative BTC account snapshot');
    expect(state.orderCalls).toHaveLength(0);
  });

  it('serializes order mutations and rejects a client order ID already recorded in any phase', async () => {
    await configureAndUnlock();
    const makeIntent = (cloid: string) => ({ side: 'buy' as const, size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc' as const, cloid });
    let releaseOrder!: (value: unknown) => void;
    state.orderImpl.mockImplementationOnce(() => new Promise(resolve => { releaseOrder = resolve; }));
    const firstId = ++id;
    fakeSelf.onmessage?.({ data: { type: 'submit-order', id: firstId, intent: makeIntent(CLOID) } });
    await waitUntil(() => state.orderCalls.length === 1, 'first order mutation');
    const secondId = ++id;
    fakeSelf.onmessage?.({ data: { type: 'submit-order', id: secondId, intent: makeIntent(`0x${'33'.repeat(16)}`) } });
    await flush();
    expect(state.orderCalls).toHaveLength(1);

    releaseOrder({ status: 'ok', response: { data: { statuses: [{ resting: { oid: 77 } }] } } });
    await waitUntil(() => resultEvents.some(event => event.type === 'result' && event.id === firstId)
      && resultEvents.some(event => event.type === 'result' && event.id === secondId), 'serialized order results');
    expect(state.orderCalls).toHaveLength(2);

    const duplicate = await request('submit-order', { intent: makeIntent(CLOID) });
    expect(duplicate.error).toContain('client order ID has already been used');
    expect(state.orderCalls).toHaveLength(2);
  });

  it('blocks fresh client order IDs while any prior submission outcome remains unknown', async () => {
    await configureAndUnlock();
    state.orderImpl.mockRejectedValueOnce(new Error('socket timeout after submission'));
    const unresolved = await request('submit-order', {
      intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(unresolved.value).toMatchObject({ phase: 'unknown', cloid: CLOID });
    const blocked = await request('submit-order', {
      intent: { side: 'sell', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: `0x${'34'.repeat(16)}` },
    });
    expect(blocked.error).toContain(`Resolve order attempt ${CLOID} (unknown)`);
    expect(state.orderCalls).toHaveLength(1);
  });

  it('rejects queued actions after an account or signing epoch changes before dequeue', async () => {
    await configureAndUnlock();
    let releaseAuthority!: (value: typeof state.agents) => void;
    const callsBefore = state.extraAgentsImpl.mock.calls.length;
    state.extraAgentsImpl.mockImplementationOnce(() => new Promise(resolve => { releaseAuthority = resolve; }));
    const firstId = ++id;
    fakeSelf.onmessage?.({ data: { type: 'submit-order', id: firstId, intent: {
      side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: `0x${'35'.repeat(16)}`,
    } } });
    await waitUntil(() => state.extraAgentsImpl.mock.calls.length > callsBefore, 'deferred first mutation authority lookup');
    const queuedId = ++id;
    fakeSelf.onmessage?.({ data: { type: 'submit-order', id: queuedId, intent: {
      side: 'sell', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: `0x${'36'.repeat(16)}`,
    } } });
    await flush();

    const newPrincipal = `0x${'33'.repeat(20)}`;
    const switched = await request('configure', { network: 'mainnet', principal: newPrincipal, fixtureMode: false });
    expect(switched.error).toBeUndefined();
    await request('vault-unlock', { passphrase: 'a secure test passphrase' });
    releaseAuthority(state.agents);
    await waitUntil(() => resultEvents.some(event => event.type === 'result' && event.id === firstId)
      && resultEvents.some(event => event.type === 'result' && event.id === queuedId), 'old account mutation results');

    expect(resultEvents.find(event => event.type === 'result' && event.id === firstId)?.error).toContain('Selected trading account changed');
    const queuedError = String(resultEvents.find(event => event.type === 'result' && event.id === queuedId)?.error ?? '');
    expect(queuedError).toMatch(/changed|invalidated/i);
    expect(state.orderCalls).toHaveLength(0);
  });

  it('locks the signer when the configured inactivity timeout expires', async () => {
    const now = Date.now();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    await configureAndUnlock();
    const timeout = await request('set-inactivity-timeout', { minutes: 1 });
    expect(timeout.value).toBe(1);
    const idleTimer = state.intervalCallbacks.find(item => item.delay === 10_000)?.callback;
    expect(idleTimer).toBeDefined();

    dateNow.mockReturnValue(now + 59_999); idleTimer?.(); await flush();
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)).toMatchObject({ unlocked: true });
    dateNow.mockReturnValue(now + 60_000); idleTimer?.(); await flush();
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)).toMatchObject({ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', unlocked: false, exists: true, sessionOnly: false });
    expect(latestSnapshot()?.error).toContain('Agent locked after 1 minutes of inactivity');
  });

  it('does not restore a signer when a pending unlock is locked before decryption finishes', async () => {
    await configureOnly();
    const authorizationCallsBeforeUnlock = state.extraAgentsImpl.mock.calls.length;
    let releaseDecrypt!: (value: { address: string; privateKey: `0x${string}` }) => void;
    let notifyDecryptStarted!: () => void;
    const decryptStarted = new Promise<void>(resolve => { notifyDecryptStarted = resolve; });
    state.decryptAgentImpl.mockImplementationOnce(() => new Promise(resolve => {
      releaseDecrypt = resolve; notifyDecryptStarted();
    }));

    const unlockId = ++id;
    fakeSelf.onmessage?.({ data: { type: 'vault-unlock', id: unlockId, passphrase: 'a secure test passphrase' } });
    await decryptStarted;
    await request('vault-lock');
    releaseDecrypt({ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', privateKey: `0x${'0'.repeat(63)}1` });
    await waitUntil(() => resultEvents.some(event => event.type === 'result' && event.id === unlockId), 'invalidated unlock result');

    expect(resultEvents.find(event => event.type === 'result' && event.id === unlockId)?.error).toContain('Agent was locked or changed');
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)).toMatchObject({ unlocked: false, exists: true });
    expect(state.extraAgentsImpl).toHaveBeenCalledTimes(authorizationCallsBeforeUnlock);
  });

  it('does not install a decrypted signer before current authorization succeeds', async () => {
    await configureOnly();
    state.agents = [];
    const revoked = await request('vault-unlock', { passphrase: 'a secure test passphrase' });
    expect(revoked.error).toMatch(/not currently authorized/);
    expect(state.exchangeWallets).toHaveLength(0);

    state.agents = [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'expired', validUntil: Date.now() - 1 }];
    const expired = await request('vault-unlock', { passphrase: 'a secure test passphrase' });
    expect(expired.error).toMatch(/not currently authorized/);
    expect(state.exchangeWallets).toHaveLength(0);

    state.agents = [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'test', validUntil: null }];
    state.extraAgentsImpl.mockRejectedValueOnce(new Error('authorization transport failed'));
    const unavailable = await request('vault-unlock', { passphrase: 'a secure test passphrase' });
    expect(unavailable.error).toContain('authorization transport failed');
    expect(state.exchangeWallets).toHaveLength(0);
  });

  it('clears an active signer when a replacement unlock fails authorization', async () => {
    await configureAndUnlock();
    expect(state.exchangeWallets).toHaveLength(1);
    state.agents = [];
    const failedReplacement = await request('vault-unlock', { passphrase: 'a secure test passphrase' });
    expect(failedReplacement.error).toMatch(/not currently authorized/);
    expect(state.exchangeWallets).toHaveLength(1);

    state.agents = [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'test', validUntil: null }];
    const submit = await request('submit-order', {
      intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(submit.error).toContain('Unlock an authorized agent wallet before trading');
    expect(state.orderCalls).toHaveLength(0);
  });

  it('does not activate session-only signing until the agent is currently authorized', async () => {
    await configureOnly();
    state.secureVault = false;
    await request('vault-info');
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)).toMatchObject({ sessionOnlyAvailable: true, storageAvailable: false });
    state.agents = [];
    const result = await request('vault-session-import', { privateKey: `0x${'0'.repeat(63)}1` });
    expect(result.error).toMatch(/not currently authorized/);
    expect(state.exchangeWallets).toHaveLength(0);
  });

  it('does not restore signing after Lock races an asynchronous legacy-binding commit', async () => {
    await configureOnly();
    state.vaultInfoImpl.mockResolvedValue({ address: null, exists: true, legacyNeedsBinding: true });
    const pending = await request('vault-unlock', { passphrase: 'a secure test passphrase' });
    expect(pending.value).toMatchObject({ legacyBindingRequired: true, network: 'testnet', principal: PRINCIPAL });
    const token = String((pending.value as Record<string, unknown>).token);

    let finishCommit!: () => void;
    let notifyCommit!: () => void;
    const commitStarted = new Promise<void>(resolve => { notifyCommit = resolve; });
    state.commitLegacyImpl.mockImplementationOnce(() => new Promise(resolve => { finishCommit = resolve; notifyCommit(); }));
    const bindingId = ++id;
    fakeSelf.onmessage?.({ data: { type: 'vault-bind-legacy', id: bindingId, token, network: 'testnet', principal: PRINCIPAL } });
    await commitStarted;
    await request('vault-lock');
    finishCommit();
    await waitUntil(() => resultEvents.some(event => event.type === 'result' && event.id === bindingId), 'invalidated legacy binding result');

    expect(resultEvents.find(event => event.type === 'result' && event.id === bindingId)?.error).toMatch(/locked or changed|Agent was locked/i);
    expect(state.exchangeWallets).toHaveLength(0);
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)).toMatchObject({ unlocked: false, legacyNeedsBinding: true });
  });

  it('keeps public account and price feeds plus both account timers running through lock and unlock', async () => {
    await configureAndUnlock();
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) > 0, 'initial account reconciliation');
    const reconcileTimer = state.intervalCallbacks.find(item => item.delay === 20_000)?.callback;
    const staleTimer = state.intervalCallbacks.find(item => item.delay === 1_000)?.callback;
    expect(reconcileTimer).toBeDefined();
    expect(staleTimer).toBeDefined();

    await request('vault-lock');
    state.clearing = { marginSummary: { accountValue: '12000', totalMarginUsed: '125', totalNtlPos: '0' }, assetPositions: [], withdrawable: '11875' };
    state.orders = [{ coin: 'BTC', side: 'B', limitPx: '99000', sz: '0.01', oid: 90, timestamp: Date.now(), origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null }];
    state.clearinghouseListeners.at(-1)?.({ clearinghouseState: state.clearing });
    state.openOrderListeners.at(-1)?.([]);
    state.midPriceListeners.at(-1)?.({ mids: { BTC: '120000' } });
    state.markPriceListeners.at(-1)?.({ ctx: { markPx: '120001' } });
    await flush();
    expect(latestSnapshot()).toMatchObject({
      feedState: 'live', accountValue: '12000', orders: [expect.objectContaining({ id: 90 })],
      midPrice: '120000', markPrice: '120001',
    });

    const snapshotAtLock = Number(latestSnapshot()?.lastSnapshotAt);
    state.clearing = { marginSummary: { accountValue: '12500', totalMarginUsed: '130', totalNtlPos: '0' }, assetPositions: [], withdrawable: '12370' };
    reconcileTimer?.();
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) > snapshotAtLock && latestSnapshot()?.accountValue === '12500', 'post-lock REST reconciliation');
    staleTimer?.();
    await flush();
    expect(latestSnapshot()?.feedState).toBe('live');

    await request('vault-unlock', { passphrase: 'a secure test passphrase' });
    state.clearing = { marginSummary: { accountValue: '13000', totalMarginUsed: '140', totalNtlPos: '0' }, assetPositions: [], withdrawable: '12860' };
    state.clearinghouseListeners.at(-1)?.({ clearinghouseState: state.clearing });
    await flush();
    expect(latestSnapshot()).toMatchObject({ feedState: 'live', accountValue: '13000', midPrice: '120000', markPrice: '120001' });
  });

  it('does not report a live account before the initial REST snapshot resolves', async () => {
    let releaseRead!: (value: typeof state.clearing) => void;
    state.clearinghouseReadImpl.mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }));
    const configured = await request('configure', { network: 'testnet', principal: PRINCIPAL, fixtureMode: false });
    expect(configured.error).toBeUndefined();
    await waitUntil(() => !!releaseRead, 'deferred initial REST account read');
    state.midPriceListeners.at(-1)?.({ mids: { BTC: '100000' } });
    state.markPriceListeners.at(-1)?.({ ctx: { markPx: '100001' } });
    expect(latestSnapshot()).toMatchObject({ feedState: 'connecting', midPrice: '100000', markPrice: '100001' });
    releaseRead(state.clearing);
    await waitUntil(() => latestSnapshot()?.feedState === 'live', 'initial REST snapshot and healthy streams');
  });

  it('keeps an account stale after stream failure even when quotes and REST refreshes succeed', async () => {
    await configureOnly();
    await waitUntil(() => latestSnapshot()?.feedState === 'live', 'initial REST snapshot and healthy streams');
    await flush();
    const failedAccountStream = state.subscriptionErrors[0];
    failedAccountStream?.(new Error('socket closed'));
    expect(latestSnapshot()?.feedState).toBe('stale');

    state.midPriceListeners.at(-1)?.({ mids: { BTC: '101000' } });
    state.markPriceListeners.at(-1)?.({ ctx: { markPx: '101001' } });
    state.clearing = { marginSummary: { accountValue: '10001', totalMarginUsed: '100', totalNtlPos: '0' }, assetPositions: [], withdrawable: '9901' };
    const beforeRefresh = Number(latestSnapshot()?.lastSnapshotAt);
    const priorReadCount = state.clearinghouseReadImpl.mock.calls.length;
    state.intervalCallbacks.find(item => item.delay === 20_000)?.callback();
    await waitUntil(() => state.clearinghouseReadImpl.mock.calls.length > priorReadCount, 'REST reconciliation request after stream failure');
    await waitUntil(() => latestSnapshot()?.accountValue === '10001' && Number(latestSnapshot()?.lastSnapshotAt) >= beforeRefresh,
      'successful REST refresh after stream failure');
    expect(latestSnapshot()).toMatchObject({
      feedState: 'stale', midPrice: '101000', markPrice: '101001',
      error: expect.stringContaining('websocket subscription failed'),
    });
  });

  it('marks a transient websocket close stale and requires REST plus restored account streams after open', async () => {
    await configureOnly();
    await waitUntil(() => latestSnapshot()?.feedState === 'live', 'initial REST snapshot and healthy streams');
    await flush();
    await flush();
    const socket = state.websocketSockets.at(-1);
    expect(socket).toBeDefined();
    const snapshotBeforeClose = Number(latestSnapshot()?.lastSnapshotAt);

    socket?.dispatchEvent(new Event('close'));
    state.midPriceListeners.at(-1)?.({ mids: { BTC: '102000' } });
    state.markPriceListeners.at(-1)?.({ ctx: { markPx: '102001' } });
    await flush();
    expect(latestSnapshot()).toMatchObject({ feedState: 'stale', midPrice: '102000', markPrice: '102001' });
    expect(String(latestSnapshot()?.error)).toContain('websocket transport disconnected');

    vi.spyOn(Date, 'now').mockReturnValue(snapshotBeforeClose + 1_000);
    const accountReadsBeforeReconnect = state.clearinghouseReadImpl.mock.calls.length;
    socket?.dispatchEvent(new Event('open'));
    await waitUntil(() => state.clearinghouseReadImpl.mock.calls.length > accountReadsBeforeReconnect, 'REST request after websocket reconnect');
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) === snapshotBeforeClose + 1_000, 'REST refresh after websocket reconnect');
    expect(latestSnapshot()?.feedState).toBe('stale');

    state.clearinghouseListeners.at(-1)?.({ clearinghouseState: state.clearing });
    state.openOrderListeners.at(-1)?.([]);
    await waitUntil(() => latestSnapshot()?.feedState === 'live', 'restored account streams after reconnect');
    expect(latestSnapshot()).toMatchObject({ feedState: 'live', error: null });
  });

  it('stays stale when a quiet event-only channel rejects its reconnect subscription acknowledgement', async () => {
    await configureOnly();
    await waitUntil(() => latestSnapshot()?.feedState === 'live', 'initial REST snapshot and healthy streams');
    await flush();
    const socket = state.websocketSockets.at(-1)!;
    state.failSubscriptionAcks.push('Order-update');
    socket.dispatchEvent(new Event('close'));
    await flush();
    socket.dispatchEvent(new Event('open'));
    await flush();
    state.clearinghouseListeners.at(-1)?.({ clearinghouseState: state.clearing });
    state.openOrderListeners.at(-1)?.([]);
    state.intervalCallbacks.find(item => item.delay === 20_000)?.callback();
    await flush();
    expect(latestSnapshot()?.feedState).toBe('stale');
    expect(String(latestSnapshot()?.error)).toContain('Order-update websocket subscription failed');
  });

  it('rejects protected market and trigger orders when their own quote is stale despite fresh account messages', async () => {
    const now = Date.now();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    await configureAndUnlock();
    await waitUntil(() => latestSnapshot()?.feedState === 'live', 'initial REST snapshot and healthy streams');
    const oldMidTimestamp = latestSnapshot()?.midPriceUpdatedAt;
    const oldMarkTimestamp = latestSnapshot()?.markPriceUpdatedAt;

    dateNow.mockReturnValue(now + 6_000);
    state.clearinghouseListeners.at(-1)?.({ clearinghouseState: state.clearing });
    await flush();
    expect(Number(latestSnapshot()?.lastMessageAt)).toBeGreaterThan(Number(oldMidTimestamp));
    expect(Number(latestSnapshot()?.lastMessageAt)).toBeGreaterThan(Number(oldMarkTimestamp));

    const market = await request('submit-order', {
      kind: 'market', slippageBps: 50,
      intent: { side: 'buy', size: '0.001', price: '100500', reduceOnly: false, tif: 'Ioc', cloid: CLOID },
    });
    expect(market.error).toContain('Fresh live BTC mid price');

    const trigger = await request('submit-order', {
      kind: 'takeProfit', triggerPrice: '105000',
      intent: { side: 'sell', size: '0.001', price: '105000', reduceOnly: true, tif: 'Gtc', cloid: `0x${'cd'.repeat(16)}` },
    });
    expect(trigger.error).toContain('Fresh live BTC mark price');
    expect(state.orderCalls).toHaveLength(0);
  });

  it('keeps a healthy quiet account live when its periodic REST snapshot succeeds', async () => {
    await configureOnly();
    await waitUntil(() => latestSnapshot()?.feedState === 'live', 'initial REST snapshot and healthy streams');
    const initialSnapshotAt = Number(latestSnapshot()?.lastSnapshotAt);
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(initialSnapshotAt + 13_000);
    state.intervalCallbacks.find(item => item.delay === 1_000)?.callback();
    await flush();
    expect(latestSnapshot()?.feedState).toBe('live');

    dateNow.mockReturnValue(initialSnapshotAt + 20_000);
    state.intervalCallbacks.find(item => item.delay === 20_000)?.callback();
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) > initialSnapshotAt, 'periodic REST reconciliation');
    state.intervalCallbacks.find(item => item.delay === 1_000)?.callback();
    await flush();
    expect(latestSnapshot()).toMatchObject({ feedState: 'live', error: null });
  });

  it('ignores account stream callbacks and errors after switching the configured account', async () => {
    await configureOnly();
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) > 0, 'initial account reconciliation');
    const oldAccountListener = state.clearinghouseListeners[0];
    const oldSubscriptionError = state.subscriptionErrors[0];

    const nextPrincipal = `0x${'33'.repeat(20)}`;
    const switched = await request('configure', { network: 'mainnet', principal: nextPrincipal, fixtureMode: false });
    expect(switched.error).toBeUndefined();
    await waitUntil(() => latestSnapshot()?.principal === nextPrincipal && Number(latestSnapshot()?.lastSnapshotAt) > 0, 'new account reconciliation');
    const valueBeforeLateCallbacks = latestSnapshot()?.accountValue;

    oldAccountListener?.({ marginSummary: { accountValue: '999999' }, assetPositions: [], withdrawable: '999999' });
    oldSubscriptionError?.(new Error('old account socket closed'));
    await flush();

    expect(latestSnapshot()).toMatchObject({ principal: nextPrincipal, accountValue: valueBeforeLateCallbacks, feedState: 'live', error: null });
  });

  it('permits a session-only agent only when secure signing works and IndexedDB vault storage does not', async () => {
    state.secureVault = false;
    await configureOnly();
    const info = await request('vault-info');
    expect(info.value).toMatchObject({ storageAvailable: false, sessionOnlyAvailable: true });
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)).toMatchObject({
      storageAvailable: false, sessionOnlyAvailable: true, sessionOnly: false,
    });

    const imported = await request('vault-session-import', { privateKey: `0x${'0'.repeat(63)}1` });
    expect(imported.error).toBeUndefined();
    expect(imported.value).toMatchObject({ sessionOnly: true, authorized: true });
    expect(state.encryptAgentImpl).not.toHaveBeenCalled();
    expect(state.removeAgentImpl).not.toHaveBeenCalled();

    await request('vault-lock');
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)).toMatchObject({
      address: null, unlocked: false, exists: false, sessionOnly: false,
    });
    const signedAction = await request('submit-order', {
      intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(signedAction.error).toContain('Unlock an authorized agent wallet');
    expect(state.orderCalls).toHaveLength(0);
  });

  it('fails closed without secure Web Crypto and never exposes session-only signing', async () => {
    state.secureSigning = false; state.secureVault = false;
    await configureOnly();
    const info = await request('vault-info');
    expect(info.value).toMatchObject({ storageAvailable: null, sessionOnlyAvailable: false });
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)).toMatchObject({
      storageAvailable: null, sessionOnlyAvailable: false,
    });
    expect(resultEvents.filter(event => event.type === 'vault-state').at(-1)?.error).toContain('Web Crypto');
    const imported = await request('vault-session-import', { privateKey: `0x${'0'.repeat(63)}1` });
    expect(String(imported.error).toLowerCase()).toContain('session-only mode is available only');
    expect(state.encryptAgentImpl).not.toHaveBeenCalled();
    expect(state.orderCalls).toHaveLength(0);
  });

  it('submits a GTC order once, records the exchange ID, and sends the exact decimal payload', async () => {
    await configureAndUnlock();
    const response = await request('submit-order', {
      kind: 'limit',
      intent: { side: 'buy', size: '0.00123', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(response.error).toBeUndefined();
    expect(response.value).toMatchObject({ phase: 'resting', exchangeId: 77, cloid: CLOID });
    expect(state.orderCalls).toHaveLength(1);
    expect(state.orderCalls[0]).toMatchObject({
      orders: [{ a: 0, b: true, p: '100000', s: '0.00123', r: false, t: { limit: { tif: 'Gtc' } }, c: CLOID }], grouping: 'na',
    });
  });

  it('sends the exact BTC leverage and margin-mode payload through the venue adapter', async () => {
    await configureAndUnlock();
    const cross = await request('set-leverage', { leverage: 12, isCross: true });
    const isolated = await request('set-leverage', { leverage: 7, isCross: false });
    expect(cross.value).toBe(true);
    expect(isolated.value).toBe(true);
    expect(state.leverageCalls).toEqual([
      { asset: 0, isCross: true, leverage: 12 },
      { asset: 0, isCross: false, leverage: 7 },
    ]);
  });

  it('enforces live max leverage and margin using the actual configured leverage', async () => {
    state.activeAssetData = { leverage: { type: 'cross', value: 40 }, availableToTrade: ['100', '100'] };
    state.clearing = { ...state.clearing, withdrawable: '0.20' };
    await configureAndUnlock();
    const intent = (cloid: string) => ({ side: 'buy' as const, size: '0.00015', price: '80000', reduceOnly: false, tif: 'Gtc' as const, cloid });
    const insufficient = await request('submit-order', { intent: intent(CLOID) });
    expect(insufficient.error).toContain('Insufficient available margin');
    expect(insufficient.error).toContain('40x');
    expect(state.orderCalls).toHaveLength(0);

    state.clearing = { ...state.clearing, withdrawable: '1.00' };
    const fresh = Number(latestSnapshot()?.lastSnapshotAt);
    await request('refresh');
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) > fresh, 'margin refresh');
    const accepted = await request('submit-order', { intent: intent(`0x${'37'.repeat(16)}`) });
    expect(accepted.value).toMatchObject({ phase: 'resting' });
    expect(state.orderCalls).toHaveLength(1);

    const tooHigh = await request('set-leverage', { leverage: 41, isCross: true });
    expect(tooHigh.error).toContain('venue maximum of 40x');
    expect(state.leverageCalls).toHaveLength(0);
    const atMaximum = await request('set-leverage', { leverage: 40, isCross: true });
    expect(atMaximum.error).toBeUndefined();
    expect(state.leverageCalls).toHaveLength(1);
  });

  it('requires reduce-only orders to oppose and fit the current BTC position', async () => {
    state.clearing = { ...state.clearing, assetPositions: [{ position: { coin: 'BTC', szi: '0.01', entryPx: '99000', unrealizedPnl: '0', liquidationPx: '80000', leverage: { value: 5 } } }] };
    await configureAndUnlock();
    const submit = (side: 'buy' | 'sell', size: string, cloid: string) => request('submit-order', {
      intent: { side, size, price: '100000', reduceOnly: true, tif: 'Gtc', cloid },
    });
    expect((await submit('buy', '0.001', CLOID)).error).toContain('must use the SELL side');
    expect((await submit('sell', '0.02', `0x${'38'.repeat(16)}`)).error).toContain('exceeds the current long position');
    expect(state.orderCalls).toHaveLength(0);
    expect((await submit('sell', '0.01', `0x${'39'.repeat(16)}`)).error).toBeUndefined();
    expect(state.orderCalls).toHaveLength(1);
  });

  it('rejects trigger prices on the wrong side of a fresh mark', async () => {
    state.clearing = { ...state.clearing, assetPositions: [{ position: { coin: 'BTC', szi: '0.01', entryPx: '99000', unrealizedPnl: '0', liquidationPx: '80000', leverage: { value: 5 } } }] };
    await configureAndUnlock();
    const intent = (cloid: string) => ({ side: 'sell' as const, size: '0.001', price: '99000', reduceOnly: true, tif: 'Gtc' as const, cloid });
    const wrong = await request('submit-order', { kind: 'takeProfit', triggerPrice: '99000', intent: intent(CLOID) });
    expect(wrong.error).toContain('Take-profit trigger must be beyond the live mark (above');
    expect(state.orderCalls).toHaveLength(0);
    const valid = await request('submit-order', { kind: 'takeProfit', triggerPrice: '101000', intent: intent(`0x${'40'.repeat(16)}`) });
    expect(valid.error).toBeUndefined();
    expect(state.orderCalls).toHaveLength(1);
  });

  it('preserves partial fills when a fill races an in-flight cancel and the canceled update arrives late', async () => {
    const openOrder = { coin: 'BTC', side: 'B', limitPx: '100000', sz: '0.01', oid: 77, timestamp: 1, origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: CLOID };
    state.orders = [openOrder];
    await configureAndUnlock();
    const submitted = await request('submit-order', {
      kind: 'limit', intent: { side: 'buy', size: '0.01', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(submitted.value).toMatchObject({ phase: 'resting', exchangeId: 77 });
    await flush();

    let releaseCancel!: (value: unknown) => void;
    let notifyCancelStarted!: () => void;
    const cancelStarted = new Promise<void>(resolve => { notifyCancelStarted = resolve; });
    state.cancelImpl.mockImplementationOnce(() => new Promise(resolve => {
      releaseCancel = resolve; notifyCancelStarted();
    }));
    const cancelId = ++id;
    fakeSelf.onmessage?.({ data: { type: 'cancel-order', id: cancelId, orderId: 77 } });
    await cancelStarted;

    const now = Date.now();
    const fill = { coin: 'BTC', oid: 77, px: '100000', sz: '0.004', side: 'B', time: now, tid: 701, fee: '0', closedPnl: '0' };
    state.userFillListeners.forEach(listener => listener([fill]));
    state.orderUpdateListeners.forEach(listener => listener([{ order: { ...openOrder, sz: '0.006', timestamp: now }, status: 'open', statusTimestamp: now }]));
    await flush();
    expect(latestAttempt()).toMatchObject({ phase: 'partiallyFilled', exchangeId: 77, filledSize: '0.004', remainingSize: '0.006' });

    state.orders = [];
    releaseCancel({ status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } });
    await waitUntil(() => resultEvents.some(event => event.type === 'result' && event.id === cancelId), 'cancel result');
    expect(resultEvents.find(event => event.type === 'result' && event.id === cancelId)?.value).toBe(true);
    state.orderUpdateListeners.forEach(listener => listener([{ order: { ...openOrder, sz: '0.006', timestamp: now }, status: 'canceled', statusTimestamp: now + 1 }]));
    state.userFillListeners.forEach(listener => listener([fill]));
    await flush();

    expect(latestAttempt()).toMatchObject({ phase: 'canceled', exchangeId: 77, filledSize: '0.004', remainingSize: '0' });
    expect(latestSnapshot()?.orders).toEqual([]);
    expect(state.cancelCalls).toHaveLength(1);
    expect(state.orderCalls).toHaveLength(1);
  });

  it('reconciles a populated account after disconnect and resubscribe without applying the stale REST snapshot', async () => {
    const account = (accountValue: string, size: string) => ({
      marginSummary: { accountValue, totalMarginUsed: '100', totalNtlPos: '1500' },
      assetPositions: [{ position: { coin: 'BTC', szi: size, entryPx: '100000', unrealizedPnl: '12', liquidationPx: '90000', leverage: { value: 5 } } }],
      withdrawable: '9900',
    });
    const order = (id: number, size: string) => ({ coin: 'BTC', side: 'B', limitPx: '100000', sz: size, oid: id, timestamp: 10, origSz: size,
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null });
    const originalAccount = account('11000', '0.01');
    state.clearing = originalAccount;
    state.orders = [order(10, '0.01')];
    await configureAndUnlock();
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) > 0, 'initial account reconciliation');
    expect(latestSnapshot()).toMatchObject({ accountValue: '11000', positions: [expect.objectContaining({ size: '0.01' })], orders: [expect.objectContaining({ id: 10 })] });

    let releaseStaleRead!: (value: typeof state.clearing) => void;
    let notifyReadStarted!: () => void;
    const readStarted = new Promise<void>(resolve => { notifyReadStarted = resolve; });
    state.clearinghouseReadImpl.mockImplementationOnce(() => new Promise(resolve => {
      releaseStaleRead = resolve; notifyReadStarted();
    }));
    const baseline = Number(latestSnapshot()?.lastSnapshotAt);
    const refreshId = ++id;
    fakeSelf.onmessage?.({ data: { type: 'refresh', id: refreshId } });
    await readStarted;

    state.subscriptionErrors[0]?.(new Error('socket closed'));
    await flush();
    expect(latestSnapshot()?.feedState).toBe('stale');

    const recoveredAccount = account('12500', '0.015');
    state.clearing = recoveredAccount;
    state.orders = [order(10, '0.006'), order(11, '0.002')];
    state.clearinghouseListeners.forEach(listener => listener({ clearinghouseState: recoveredAccount }));
    state.openOrderListeners.forEach(listener => listener(state.orders));
    await flush();
    expect(latestSnapshot()).toMatchObject({ accountValue: '12500', positions: [expect.objectContaining({ size: '0.015' })], orders: expect.arrayContaining([expect.objectContaining({ id: 10 }), expect.objectContaining({ id: 11 })]) });

    releaseStaleRead(originalAccount);
    await waitUntil(() => Number(latestSnapshot()?.lastSnapshotAt) > baseline && latestSnapshot()?.accountValue === '12500'
      && (latestSnapshot()?.orders as unknown[] | undefined)?.length === 2, 'new REST snapshot after websocket revision');
    const finalSnapshot = latestSnapshot();
    expect(finalSnapshot).toMatchObject({ feedState: 'live', accountValue: '12500', positions: [expect.objectContaining({ size: '0.015' })] });
    expect(finalSnapshot?.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: 10 }), expect.objectContaining({ id: 11 })]));
    expect(state.wsOptions).toContainEqual(expect.objectContaining({ resubscribe: true }));
  });

  it('rejects below-minimum notional before calling the exchange', async () => {
    await configureAndUnlock();
    const response = await request('submit-order', {
      kind: 'limit', intent: { side: 'buy', size: '0.0001', price: '84000', reduceOnly: true, tif: 'Gtc', cloid: CLOID },
    });
    expect(response.error).toContain('at least $10');
    expect(state.orderCalls).toHaveLength(0);
  });

  it('tracks partial fills by order ID through open remainder and only resolves full on authoritative fill status', async () => {
    await configureAndUnlock();
    const submitted = await request('submit-order', {
      kind: 'limit', intent: { side: 'buy', size: '0.01', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(submitted.value).toMatchObject({ phase: 'resting', exchangeId: 77, filledSize: '0', remainingSize: '0.01' });

    const now = Date.now();
    state.userFillListeners.forEach(listener => listener([{ coin: 'BTC', oid: 77, px: '100000', sz: '0.004', side: 'B', time: now, tid: 501, fee: '0', closedPnl: '0' }]));
    await flush();
    expect(latestAttempt()).toMatchObject({ phase: 'partiallyFilled', exchangeId: 77, filledSize: '0.004', remainingSize: '0.006' });

    const order = (size: string, status = 'open') => ({ order: {
      coin: 'BTC', side: 'B', limitPx: '100000', sz: size, oid: 77, timestamp: now,
      origSz: '0.01', cloid: CLOID, triggerCondition: 'N/A', triggerPx: '0', reduceOnly: false, orderType: 'Limit',
    }, status, statusTimestamp: Date.now() });
    state.orderUpdateListeners.forEach(listener => listener([order('0.006')]));
    await flush();
    expect(latestAttempt()).toMatchObject({ phase: 'partiallyFilled', filledSize: '0.004', remainingSize: '0.006' });

    state.userFillListeners.forEach(listener => listener([{ coin: 'BTC', oid: 77, px: '100000', sz: '0.003', side: 'B', time: now + 1, tid: 502, fee: '0', closedPnl: '0' }]));
    state.orderUpdateListeners.forEach(listener => listener([order('0.003')]));
    await flush();
    expect(latestAttempt()).toMatchObject({ phase: 'partiallyFilled', filledSize: '0.007', remainingSize: '0.003' });

    state.orderUpdateListeners.forEach(listener => listener([order('0', 'filled')]));
    await flush();
    expect(latestAttempt()).toMatchObject({ phase: 'filled', filledSize: '0.01', remainingSize: '0' });
  });

  it('keeps a partially filled IOC terminal when a late open-order update arrives', async () => {
    await configureAndUnlock();
    state.orderImpl.mockImplementationOnce(async () => {
      const now = Date.now();
      const update = [{ order: {
        coin: 'BTC', side: 'B', limitPx: '100500', sz: '0.006', oid: 77, timestamp: now,
        origSz: '0.01', cloid: CLOID, triggerCondition: 'N/A', triggerPx: '0', reduceOnly: false, orderType: 'Limit',
      }, status: 'open', statusTimestamp: now }];
      state.orderUpdateListeners.forEach(listener => listener(update));
      return { status: 'ok', response: { data: { statuses: [{ filled: { totalSz: '0.004', avgPx: '100000', oid: 77 } }] } } };
    });
    const submitted = await request('submit-order', {
      kind: 'market', slippageBps: 50,
      intent: { side: 'buy', size: '0.01', price: '100500', reduceOnly: false, tif: 'Ioc', cloid: CLOID },
    });
    expect(submitted.value).toMatchObject({
      phase: 'partiallyFilled', exchangeId: 77, filledSize: '0.004', remainingSize: '0',
      message: 'Partially filled 0.004 of 0.01 BTC; 0.006 BTC IOC remainder was canceled',
    });
    expect(latestAttempt()).toMatchObject({ phase: 'partiallyFilled', remainingSize: '0' });
    expect(latestSnapshot()?.orders).toEqual([]);
    state.orderUpdateListeners.forEach(listener => listener([{ order: {
      coin: 'BTC', side: 'B', limitPx: '100500', sz: '0.006', oid: 77, timestamp: Date.now(),
      origSz: '0.01', cloid: CLOID, triggerCondition: 'N/A', triggerPx: '0', reduceOnly: false, orderType: 'Limit',
    }, status: 'open', statusTimestamp: Date.now() }]));
    await flush();
    expect(latestAttempt()).toMatchObject({ phase: 'partiallyFilled', remainingSize: '0' });
    expect(latestSnapshot()?.orders).toEqual([]);
  });

  it('keeps a partially filled attempt partial when orderStatus still returns unknownOid', async () => {
    await configureAndUnlock();
    await request('submit-order', {
      kind: 'limit', intent: { side: 'buy', size: '0.01', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    state.userFillListeners.forEach(listener => listener([{ coin: 'BTC', oid: 77, px: '100000', sz: '0.004', side: 'B', time: Date.now(), tid: 601, fee: '0', closedPnl: '0' }]));
    await flush();
    state.orderStatusImpl.mockResolvedValue({ status: 'unknownOid' });
    const checked = await request('order-status', { cloid: CLOID });
    expect(checked.value).toMatchObject({ phase: 'partiallyFilled', filledSize: '0.004', remainingSize: '0.006' });
  });

  it('records a definite per-order rejection and never resends it', async () => {
    await configureAndUnlock();
    state.orderImpl.mockResolvedValue({ status: 'ok', response: { data: { statuses: [{ error: 'bad price tick' }] } } });
    const response = await request('submit-order', {
      kind: 'limit', intent: { side: 'sell', size: '0.01', price: '100001', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(response.error).toBeUndefined();
    expect(response.value).toMatchObject({ phase: 'rejected', cloid: CLOID, message: 'bad price tick' });
    expect(state.orderCalls).toHaveLength(1);
  });

  it('keeps a timed out submit unknown and reconciles its cloid without another order request', async () => {
    await configureAndUnlock();
    state.orderImpl.mockRejectedValue(new Error('HTTP timeout after 15000ms'));
    const submitted = await request('submit-order', {
      kind: 'market', slippageBps: 50,
      intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Ioc', cloid: CLOID },
    });
    expect(submitted.value).toMatchObject({ phase: 'unknown', cloid: CLOID });
    expect(state.orderCalls).toHaveLength(1);
    state.orderStatusImpl.mockResolvedValue({ status: 'order', order: {
      order: { coin: 'BTC', side: 'B', limitPx: '100500', sz: '0.001', oid: 88, timestamp: Date.now(), origSz: '0.001',
        triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', children: [], isPositionTpsl: false, reduceOnly: false,
        orderType: 'Limit', tif: 'Ioc', cloid: CLOID }, status: 'filled', statusTimestamp: Date.now(),
    } });
    const reconciled = await request('order-status', { cloid: CLOID });
    expect(reconciled.value).toMatchObject({ phase: 'filled', exchangeId: 88, cloid: CLOID });
    expect(state.statusCalls).toEqual([{ user: PRINCIPAL, oid: CLOID }]);
    expect(state.orderCalls).toHaveLength(1);
  });

  it('does not sign when the agent is no longer authorized by the selected principal', async () => {
    await configureAndUnlock();
    state.agents = [];
    const response = await request('submit-order', {
      kind: 'limit', intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(response.error).toMatch(/not currently authorized/);
    expect(state.orderCalls).toHaveLength(0);
  });

  it('rechecks a timestamped agent authorization immediately before every mutation', async () => {
    await configureAndUnlock();
    state.agents = [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'expired', validUntil: Date.now() - 1 }];
    const response = await request('submit-order', {
      kind: 'limit', intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(response.error).toMatch(/not currently authorized/);
    expect(state.orderCalls).toHaveLength(0);
  });

  it('does not sign with the old account when its authority lookup resolves after an account switch', async () => {
    await configureAndUnlock();
    let release!: (value: Record<string, unknown>[]) => void;
    let started!: () => void;
    const authorityStarted = new Promise<void>(resolve => { started = resolve; });
    state.extraAgentsImpl.mockImplementationOnce(() => new Promise(resolve => { release = resolve; started(); }));
    const submitId = ++id;
    fakeSelf.onmessage?.({ data: {
      type: 'submit-order', id: submitId, kind: 'limit',
      intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    } });
    await authorityStarted;

    const changed = await request('configure', { network: 'mainnet', principal: `0x${'33'.repeat(20)}`, fixtureMode: false });
    expect(changed.error).toBeUndefined();
    release(state.agents);
    for (let i = 0; i < 100 && !resultEvents.some(event => event.type === 'result' && event.id === submitId); i++) {
      await flush(); await new Promise(resolve => setTimeout(resolve, 0));
    }
    const refused = resultEvents.find(event => event.type === 'result' && event.id === submitId);
    expect(refused?.error).toMatch(/account changed|signing session was locked|connection changed/i);
    expect(state.orderCalls).toHaveLength(0);
  });

  it('reconciles a successful HTTP response with an ambiguous status without resubmitting', async () => {
    await configureAndUnlock();
    state.orderImpl.mockResolvedValue({ status: 'ok', response: { data: { statuses: ['waitingForTrigger'] } } });
    const response = await request('submit-order', {
      kind: 'limit', intent: { side: 'sell', size: '0.002', price: '101000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(response.value).toMatchObject({ phase: 'triggering', cloid: CLOID });
    expect(state.orderCalls).toHaveLength(1);
  });

  it('reports a cancel status rejection as definite and preserves the authoritative snapshot', async () => {
    state.orders = [{ coin: 'BTC', side: 'B', limitPx: '99000', sz: '0.01', oid: 12, timestamp: 1, origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null }];
    await configureAndUnlock();
    state.cancelImpl.mockResolvedValue({ status: 'ok', response: { type: 'cancel', data: { statuses: [{ error: 'already filled' }] } } });
    const response = await request('cancel-order', { orderId: 12 });
    expect(response.error).toContain('Hyperliquid rejected cancellation: already filled');
    expect(state.cancelCalls).toHaveLength(1);
    const lastSnapshot = resultEvents.filter(event => event.type === 'snapshot').at(-1)?.snapshot as any;
    expect(lastSnapshot.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: 12 })]));
  });

  it('modifies TP orders as reduce-only triggers, not plain GTC orders', async () => {
    state.orders = [{ coin: 'BTC', side: 'A', limitPx: '101000', sz: '0.01', oid: 13, timestamp: 1, origSz: '0.01',
      triggerCondition: 'Price above', isTrigger: true, triggerPx: '101000', reduceOnly: true, orderType: 'Take Profit Market', cloid: CLOID }];
    state.clearing = { ...state.clearing, assetPositions: [{ position: { coin: 'BTC', szi: '0.01', entryPx: '99000', unrealizedPnl: '0', liquidationPx: '80000', leverage: { value: 5 } } }] };
    await configureAndUnlock();
    const response = await request('modify-order', { orderId: 13, price: '102000', size: '0.01' });
    expect(response.error).toBeUndefined();
    expect(state.modifyCalls).toHaveLength(1);
    expect(state.modifyCalls[0]).toMatchObject({
      oid: 13, order: { a: 0, b: false, p: '102000', s: '0.01', r: true, t: { trigger: { isMarket: true, triggerPx: '102000', tpsl: 'tp' } }, c: CLOID },
    });
  });

  it('submits take-profit and stop-loss as separate reduce-only trigger requests', async () => {
    state.clearing = { ...state.clearing, assetPositions: [{ position: { coin: 'BTC', szi: '0.01', entryPx: '99000', unrealizedPnl: '0', liquidationPx: '80000', leverage: { value: 5 } } }] };
    await configureAndUnlock();
    for (const [kind, triggerPrice, cloid] of [
      ['takeProfit', '105000', CLOID], ['stopLoss', '95000', `0x${'cd'.repeat(16)}`],
    ] as const) {
      const response = await request('submit-order', {
        kind, triggerPrice,
        intent: { side: 'sell', size: '0.001', price: triggerPrice, reduceOnly: true, tif: 'Gtc', cloid },
      });
      expect(response.error).toBeUndefined();
    }
    expect(state.orderCalls).toHaveLength(2);
    expect(state.orderCalls[0]).toMatchObject({ grouping: 'positionTpsl', orders: [{ r: true, t: { trigger: { isMarket: false, triggerPx: '105000', tpsl: 'tp' } } }] });
    expect(state.orderCalls[1]).toMatchObject({ grouping: 'positionTpsl', orders: [{ r: true, t: { trigger: { isMarket: false, triggerPx: '95000', tpsl: 'sl' } } }] });
  });

  it('does not retry a modify after an uncertain timeout', async () => {
    state.orders = [{ coin: 'BTC', side: 'B', limitPx: '99000', sz: '0.01', oid: 12, timestamp: 1, origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null }];
    await configureAndUnlock();
    state.modifyImpl.mockRejectedValue(new Error('HTTP timeout'));
    const response = await request('modify-order', { orderId: 12, price: '99100', size: '0.01' });
    expect(response.error).toContain('Modify outcome is unknown');
    expect(response.error).toContain('not resent');
    expect(state.modifyCalls).toHaveLength(1);
    expect(latestSnapshot()?.orderOperations).toEqual(expect.arrayContaining([expect.objectContaining({ orderId: 12, phase: 'unknown', kind: 'modify' })]));
    const retry = await request('cancel-order', { orderId: 12 });
    expect(retry.error).toContain('unknown modify operation');
    expect(state.cancelCalls).toHaveLength(0);
  });

  it('keeps a successful modify pending until canonical order terms arrive', async () => {
    state.orders = [{ coin: 'BTC', side: 'B', limitPx: '99000', sz: '0.01', oid: 12, timestamp: Date.now() - 1000, origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null }];
    await configureAndUnlock();
    const modified = await request('modify-order', { orderId: 12, price: '99100', size: '0.01' });
    expect(modified.value).toBe(true);
    expect(latestSnapshot()?.orderOperations).toEqual(expect.arrayContaining([expect.objectContaining({ orderId: 12, phase: 'reconciling', kind: 'modify' })]));
    const secondAction = await request('cancel-order', { orderId: 12 });
    expect(secondAction.error).toContain('reconciling modify operation');
    expect(state.cancelCalls).toHaveLength(0);

    state.orders = [{ coin: 'BTC', side: 'B', limitPx: '99100', sz: '0.01', oid: 12, timestamp: Date.now(), origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null }];
    await request('refresh');
    await waitUntil(() => ((latestSnapshot()?.orderOperations as unknown[]) ?? []).length === 0, 'modified canonical terms');
  });

  it('keeps actual SDK ApiRequestError rejections definite for modify and leverage', async () => {
    state.orders = [{ coin: 'BTC', side: 'B', limitPx: '99000', sz: '0.01', oid: 12, timestamp: Date.now(), origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null }];
    await configureAndUnlock();
    state.modifyImpl.mockRejectedValueOnce(new ApiRequestError({ status: 'err', response: 'bad price tick' }, 'bad price tick'));
    const modify = await request('modify-order', { orderId: 12, price: '99100', size: '0.01' });
    expect(modify.error).toContain('Hyperliquid rejected modification: bad price tick');
    expect(latestSnapshot()?.orderOperations).toEqual(expect.arrayContaining([expect.objectContaining({ orderId: 12, phase: 'rejected', kind: 'modify' })]));
    expect(latestSnapshot()?.feedState).toBe('live');

    state.leverageImpl.mockRejectedValueOnce(new ApiRequestError({ status: 'err', response: 'leverage exceeds maximum' }, 'leverage exceeds maximum'));
    const leverage = await request('set-leverage', { leverage: 10, isCross: true });
    expect(leverage.error).toContain('Hyperliquid rejected leverage update: leverage exceeds maximum');
    expect(latestSnapshot()?.feedState).toBe('live');
  });

  it('reconciles a no-cloid modify through its exact replacement OID', async () => {
    const original = { coin: 'BTC', side: 'B', limitPx: '99000', sz: '0.01', oid: 12, timestamp: Date.now() - 1000, origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null };
    state.orders = [original];
    await configureAndUnlock();
    state.modifyImpl.mockResolvedValueOnce({ status: 'ok', response: { type: 'modify', data: { statuses: [{ resting: { oid: 99 } }] } } });
    const modified = await request('modify-order', { orderId: 12, price: '99100', size: '0.01' });
    expect(modified.value).toBe(true);
    expect(latestSnapshot()?.orderOperations).toEqual(expect.arrayContaining([expect.objectContaining({ orderId: 12, resolvedOrderId: 99, phase: 'reconciling' })]));

    state.orders = [{ ...original, oid: 99, limitPx: '99100', timestamp: Date.now() }];
    await request('refresh');
    await waitUntil(() => ((latestSnapshot()?.orderOperations as unknown[]) ?? []).length === 0, 'replacement order reconciliation');
    expect(latestSnapshot()?.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: 99, price: '99100' })]));
  });

  it('freezes all candidates instead of guessing between identical no-cloid replacements', async () => {
    const original = { coin: 'BTC', side: 'B', limitPx: '99000', sz: '0.01', oid: 12, timestamp: Date.now() - 1000, origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null };
    const alreadyMatching = { ...original, oid: 13, limitPx: '99100' };
    state.orders = [original, alreadyMatching];
    await configureAndUnlock();
    const modified = await request('modify-order', { orderId: 12, price: '99100', size: '0.01' });
    expect(modified.value).toBe(true);
    state.orders = [
      { ...original, oid: 99, limitPx: '99100', timestamp: Date.now() },
      { ...original, oid: 100, limitPx: '99100', timestamp: Date.now() + 1 },
    ];
    await request('refresh');
    await waitUntil(() => (latestSnapshot()?.orderOperations as any[])?.some(item => item.phase === 'unknown'), 'ambiguous replacement hold');
    expect(latestSnapshot()?.orderOperations).toEqual(expect.arrayContaining([expect.objectContaining({ orderId: 12, phase: 'unknown', possibleOrderIds: [99, 100] })]));
    const blocked = await request('cancel-order', { orderId: 99 });
    expect(blocked.error).toContain('unknown modify operation');
    expect(state.cancelCalls).toHaveLength(0);
  });

  it('does not retry a cancel after an uncertain timeout', async () => {
    state.orders = [{ coin: 'BTC', side: 'B', limitPx: '99000', sz: '0.01', oid: 12, timestamp: 1, origSz: '0.01',
      triggerCondition: 'N/A', isTrigger: false, triggerPx: '0', reduceOnly: false, orderType: 'Limit', cloid: null }];
    await configureAndUnlock();
    state.cancelImpl.mockRejectedValue(new Error('HTTP timeout'));
    const response = await request('cancel-order', { orderId: 12 });
    expect(response.error).toContain('Cancel outcome is unknown');
    expect(response.error).toContain('not resent');
    expect(state.cancelCalls).toHaveLength(1);
  });

  it('keeps the websocket explicitly resubscribing and marks a failed account stream stale', async () => {
    await configureAndUnlock();
    expect(state.wsOptions).toContainEqual(expect.objectContaining({ resubscribe: true }));
    expect(state.subscriptionErrors.length).toBeGreaterThan(0);
    state.subscriptionErrors[0]?.(new Error('socket closed'));
    await flush();
    const snapshot = resultEvents.filter(event => event.type === 'snapshot').at(-1)?.snapshot as any;
    expect(snapshot.feedState).toBe('stale');
    expect(snapshot.error).toContain('websocket subscription failed');
  });

  it('blocks mutations on an order-metadata gap until authoritative REST repair succeeds', async () => {
    await configureAndUnlock();
    state.orderStatusImpl.mockRejectedValueOnce(new Error('temporary Info order status failure'));
    state.orderUpdateListeners.forEach(listener => listener([{ order: {
      coin: 'BTC', side: 'B', limitPx: '100000', sz: '0.01', oid: 909, timestamp: Date.now(), origSz: '0.01', cloid: null,
    }, status: 'open' }]));
    await waitUntil(() => latestSnapshot()?.feedState === 'stale', 'metadata error marks account stale');
    expect(latestSnapshot()?.error).toContain('Order-update metadata data gap');
    const blocked = await request('submit-order', {
      intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: `0x${'91'.repeat(16)}` },
    });
    expect(blocked.error).toContain('fresh live authoritative BTC account snapshot');
    expect(state.orderCalls).toHaveLength(0);

    const staleSnapshotAt = Number(latestSnapshot()?.lastSnapshotAt);
    await request('refresh');
    await waitUntil(() => latestSnapshot()?.feedState === 'live' && Number(latestSnapshot()?.lastSnapshotAt) > staleSnapshotAt, 'authoritative REST repair');
    expect(latestSnapshot()?.error).toBeNull();
  });

  it('rejects status reconciliation when a local client order ID belongs to another network', async () => {
    await configureAndUnlock();
    state.orderImpl.mockRejectedValue(new Error('HTTP timeout'));
    await request('submit-order', {
      kind: 'limit', intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    const switched = await request('configure', { network: 'mainnet', principal: `0x${'33'.repeat(20)}`, fixtureMode: false });
    expect(switched.error).toBeUndefined();
    const status = await request('order-status', { cloid: CLOID });
    expect(status.error).toContain('different network or principal');
    expect(state.statusCalls).toHaveLength(0);
  });
});
