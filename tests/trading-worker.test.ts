import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  secureSigning: true,
  secureVault: true,
  clearing: { marginSummary: { accountValue: '10000', totalMarginUsed: '100', totalNtlPos: '0' }, assetPositions: [] as Record<string, unknown>[], withdrawable: '9900' },
  orders: [] as Record<string, unknown>[],
  fills: [] as Record<string, unknown>[],
  agents: [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'test', validUntil: null }] as Record<string, unknown>[],
  extraAgentsImpl: vi.fn(async (_params?: unknown) => state.agents),
  decryptAgentImpl: vi.fn(async () => ({ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', privateKey: `0x${'0'.repeat(63)}1` })),
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
  subscriptionErrors: [] as ((error: unknown) => void)[],
}));

vi.mock('@nktkas/hyperliquid', () => {
  class HttpTransport { constructor(_options?: unknown) {} }
  class WebSocketTransport { constructor(options?: unknown) { state.wsOptions.push(options); } close() {} }
  class InfoClient {
    async clearinghouseState() { return state.clearinghouseReadImpl(); }
    async openOrders() { return state.orders; }
    async userFills() { return state.fills; }
    async meta() { return { universe: [{ name: 'BTC', index: 0, szDecimals: 5 }] }; }
    async extraAgents(params?: unknown) { return state.extraAgentsImpl(params); }
    async orderStatus(params: unknown) { state.statusCalls.push(params); return state.orderStatusImpl(params); }
  }
  class SubscriptionClient {
    private subscription(options?: { onError?: (error: unknown) => void }) { if (options?.onError) state.subscriptionErrors.push(options.onError); return { unsubscribe: async () => {} }; }
    async clearinghouseState(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.clearinghouseListeners.push(listener); listener({ clearinghouseState: state.clearing }); return this.subscription(options); }
    async openOrders(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.openOrderListeners.push(listener); listener(state.orders); return this.subscription(options); }
    async orderUpdates(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.orderUpdateListeners.push(listener); listener([]); return this.subscription(options); }
    async userFills(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { state.userFillListeners.push(listener); listener(state.fills); return this.subscription(options); }
    async allMids(listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { listener({ mids: { BTC: '100000' } }); return this.subscription(options); }
    async activeAssetCtx(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { listener({ ctx: { markPx: '100001' } }); return this.subscription(options); }
  }
  class ExchangeClient {
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
  encryptedAgentAddress: vi.fn(async () => '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'),
  decryptAgentPrivateKey: state.decryptAgentImpl,
  encryptAgentPrivateKey: state.encryptAgentImpl,
  removeEncryptedAgent: state.removeAgentImpl,
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
  for (let i = 0; i < 100 && !resultEvents.some(event => event.type === 'snapshot' && (event.snapshot as any)?.btcAsset === 0); i++) {
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
  state.orders = []; state.fills = [];
  state.agents = [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'test', validUntil: null }];
  state.extraAgentsImpl.mockReset().mockImplementation(async () => state.agents);
  state.decryptAgentImpl.mockClear();
  state.clearinghouseReadImpl.mockReset().mockImplementation(async () => state.clearing);
  state.status = { status: 'unknownOid' };
  state.orderCalls.length = 0; state.modifyCalls.length = 0; state.cancelCalls.length = 0; state.leverageCalls.length = 0; state.statusCalls.length = 0;
  state.wsOptions.length = 0; state.subscriptionErrors.length = 0; state.orderUpdateListeners.length = 0; state.userFillListeners.length = 0;
  state.clearinghouseListeners.length = 0; state.openOrderListeners.length = 0;
  state.orderImpl.mockReset().mockImplementation(async () => state.orderResponse);
  state.modifyImpl.mockReset().mockImplementation(async () => ({ status: 'ok', response: { type: 'default' } }));
  state.cancelImpl.mockReset().mockImplementation(async () => ({ status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } }));
  state.leverageImpl.mockReset().mockImplementation(async () => ({ status: 'ok', response: { type: 'default' } }));
  state.orderStatusImpl.mockReset().mockImplementation(async () => ({ status: 'unknownOid' }));
  state.encryptAgentImpl.mockClear(); state.removeAgentImpl.mockClear();
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
    const signedAction = await request('submit-order');
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
    state.agents = [];
    await configureAndUnlock();
    const response = await request('submit-order', {
      kind: 'limit', intent: { side: 'buy', size: '0.001', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: CLOID },
    });
    expect(response.error).toMatch(/not currently authorized/);
    expect(state.orderCalls).toHaveLength(0);
  });

  it('rechecks a timestamped agent authorization immediately before every mutation', async () => {
    state.agents = [{ address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', name: 'expired', validUntil: Date.now() - 1 }];
    await configureAndUnlock();
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
    expect(refused?.error).toMatch(/account changed|signing session was locked/i);
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
    await configureAndUnlock();
    const response = await request('modify-order', { orderId: 13, price: '102000', size: '0.01' });
    expect(response.error).toBeUndefined();
    expect(state.modifyCalls).toHaveLength(1);
    expect(state.modifyCalls[0]).toMatchObject({
      oid: 13, order: { a: 0, b: false, p: '102000', s: '0.01', r: true, t: { trigger: { isMarket: true, triggerPx: '102000', tpsl: 'tp' } }, c: CLOID },
    });
  });

  it('submits take-profit and stop-loss as separate reduce-only trigger requests', async () => {
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
