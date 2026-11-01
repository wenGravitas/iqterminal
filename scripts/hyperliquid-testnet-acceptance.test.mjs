import test from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { MAX_POSITION_LIFETIME_MS, assertTestnetEnvironment, buildAcceptancePlan, executionOptIn } from './hyperliquid-testnet-acceptance-core.mjs';
import { runAcceptanceSequence } from './hyperliquid-testnet-acceptance-sequence.mjs';

const AGENT = `0x${'a'.repeat(40)}`;
const PRINCIPAL = `0x${'b'.repeat(40)}`;
const MARK = '85000';
const MID = '85010';
const PLAN = buildAcceptancePlan({ markPrice: MARK, midPrice: MID, szDecimals: 5 });
const INSTRUMENT = 0;

function orderCopy(order) { return order ? { ...order } : null; }

function terminalOrder(request, id) {
  const kind = request.type.kind === 'trigger' ? request.type.trigger : 'limit';
  return {
    coin: 'BTC', id, cloid: request.intent.cloid.toLowerCase(), side: request.intent.side,
    price: request.intent.price, size: request.intent.size, originalSize: request.intent.size, timestamp: 1,
    status: 'open', reduceOnly: request.intent.reduceOnly, trigger: request.type.kind === 'trigger',
    triggerPrice: request.type.kind === 'trigger' ? request.type.triggerPrice : null,
    triggerMarket: request.type.kind === 'trigger' && request.type.execution === 'market', kind,
  };
}

class FakeAdapter {
  constructor(options = {}) {
    this.options = options;
    this.position = new Decimal(0);
    this.orders = new Map();
    this.statuses = new Map();
    this.fills = [];
    this.calls = [];
    this.sequence = 100;
    this.authReads = 0;
    this.cancelCalls = 0;
  }

  async readSnapshot() {
    const positions = this.position.isZero() ? [] : [{
      coin: 'BTC', size: this.position.abs().toString(), side: this.position.gt(0) ? 'long' : 'short',
      entryPrice: MARK, unrealizedPnl: '0', liquidationPrice: null, leverage: '1',
    }];
    return { account: { accountValue: '999', marginUsed: '0', withdrawable: '999', totalNotional: this.position.abs().mul(MARK).toString(), positions },
      orders: [...this.orders.values()].map(orderCopy), fills: this.fills.map(fill => ({ ...fill })), market: { instrumentId: 0, sizeDecimals: 5 } };
  }

  async readAuthorizations() {
    this.authReads++;
    if (this.options.failAuthorizationRead === this.authReads) throw new Error('authorization Info API timeout');
    return [{ address: AGENT, name: 'test-agent', validUntil: null }];
  }

  async readOrderStatus(cloid) {
    const key = cloid.toLowerCase();
    if (this.statuses.has(key)) return this.statuses.get(key);
    const order = this.orders.get(key);
    return order ? { status: order.trigger ? 'triggering' : 'resting', order: orderCopy(order) } : { status: 'unknown', order: null };
  }

  addFill(order, size) {
    const amount = new Decimal(size);
    this.position = this.position.plus(order.side === 'buy' ? amount : amount.negated());
    this.fills.push({ id: `fill-${order.id}`, coin: 'BTC', orderId: order.id, side: order.side, price: order.price, size: amount.toString(), time: 1, fee: '0', closedPnl: '0' });
    const filled = { ...order, size: '0', status: 'filled' };
    this.orders.delete(order.cloid);
    this.statuses.set(order.cloid, { status: 'filled', order: filled });
  }

  async placeOrder(request) {
    const cloid = request.intent.cloid.toLowerCase();
    const order = terminalOrder(request, ++this.sequence);
    this.calls.push({ action: 'place', kind: request.type.kind === 'trigger' ? request.type.trigger : request.intent.tif, reduceOnly: request.intent.reduceOnly, cloid });
    if (request.type.kind === 'trigger') {
      order.status = 'triggering';
      this.orders.set(cloid, order);
      this.statuses.set(cloid, { status: 'triggering', order: orderCopy(order) });
      return { outcome: 'triggering', orderId: order.id, filledSize: '0', averagePrice: null, message: 'Waiting for mark-price trigger' };
    }
    if (request.intent.tif === 'Gtc' && !request.intent.reduceOnly) {
      this.orders.set(cloid, order);
      this.statuses.set(cloid, { status: 'resting', order: orderCopy(order) });
      return { outcome: 'resting', orderId: order.id, filledSize: '0', averagePrice: null, message: 'Resting' };
    }
    if (request.intent.reduceOnly && this.options.protectiveRace && !this.options.protectiveRaceDone) {
      this.options.protectiveRaceDone = true;
      const tp = [...this.orders.values()].find(item => item.kind === 'takeProfit');
      assert.ok(tp, 'test race should have an open take-profit');
      this.addFill(tp, this.position.abs());
      this.statuses.set(cloid, { status: 'rejected', order: { ...order, size: request.intent.size, status: 'rejected' } });
      return { outcome: 'rejected', orderId: null, filledSize: '0', averagePrice: null, message: 'Reduce only order would increase position' };
    }
    if (request.intent.reduceOnly) {
      const quantity = Decimal.min(this.position.abs(), new Decimal(request.intent.size));
      this.addFill(order, quantity);
      return { outcome: 'filled', orderId: order.id, filledSize: quantity.toString(), averagePrice: order.price, message: 'Filled' };
    }
    this.addFill(order, request.intent.size);
    if (this.options.throwAfterEntry && !this.options.threwAfterEntry) {
      this.options.threwAfterEntry = true;
      throw new Error('test transport timeout after accepted fill');
    }
    return { outcome: 'filled', orderId: order.id, filledSize: request.intent.size, averagePrice: order.price, message: 'Filled' };
  }

  async modifyOrder(request) {
    this.calls.push({ action: 'modify', cloid: request.clientOrderId });
    const order = [...this.orders.values()].find(item => item.id === request.orderId);
    assert.ok(order);
    order.price = request.price;
    order.originalSize = request.size;
    if (this.options.canonicalizeModify) {
      order.id = ++this.sequence;
      order.price = `${new Decimal(request.price).toString()}.0`;
      order.originalSize = new Decimal(request.size).toFixed(6);
    }
    this.statuses.set(order.cloid, { status: 'resting', order: orderCopy(order) });
    if (this.options.throwAfterModify && !this.options.threwAfterModify) {
      this.options.threwAfterModify = true;
      throw new Error('test modify response timed out after apply');
    }
  }

  async cancelOrder(_instrumentId, orderId) {
    this.cancelCalls++;
    this.calls.push({ action: 'cancel', orderId });
    if (this.options.failCancel) throw new Error('test cancel refused');
    const order = [...this.orders.values()].find(item => item.id === orderId);
    if (!order) return;
    this.orders.delete(order.cloid);
    this.statuses.set(order.cloid, { status: 'canceled', order: { ...order, status: 'canceled' } });
  }
}

class FakeInfo {
  constructor(adapter, options = {}) { this.adapter = adapter; this.options = options; this.allMidsReads = 0; }
  async clearinghouseState() {
    const state = await this.adapter.readSnapshot();
    return { marginSummary: { accountValue: '999', totalMarginUsed: '0', totalNtlPos: state.account.totalNotional },
      assetPositions: state.account.positions.map(position => ({ position: { coin: position.coin, szi: position.side === 'long' ? position.size : `-${position.size}`, entryPx: MARK } })) };
  }
  raw(order) {
    return { coin: 'BTC', isPositionTpsl: false, isTrigger: order.trigger, limitPx: order.price, oid: order.id,
      orderType: order.kind === 'takeProfit' ? 'Take Profit Limit' : order.kind === 'stopLoss' ? 'Stop Loss Limit' : 'Limit',
      origSz: order.originalSize, reduceOnly: order.reduceOnly, side: order.side === 'buy' ? 'B' : 'A', sz: order.size,
      timestamp: order.timestamp, triggerCondition: order.trigger ? order.kind === 'takeProfit' ? 'Price above' : 'Price below' : 'N/A',
      triggerPx: order.triggerPrice ?? '0', cloid: order.cloid };
  }
  async openOrders() { return [...this.adapter.orders.values()].map(order => ({ coin: order.coin, limitPx: order.price, oid: order.id, side: order.side === 'buy' ? 'B' : 'A', sz: order.size, timestamp: order.timestamp, cloid: order.cloid })); }
  async frontendOpenOrders() { return [...this.adapter.orders.values()].map(order => this.raw(order)); }
  async allMids() {
    this.allMidsReads++;
    if (this.options.bumpClockOnMarketRead && this.options.clock) this.options.clock.value += MAX_POSITION_LIFETIME_MS + 1;
    return { BTC: MID };
  }
  async metaAndAssetCtxs() { return [{ universe: [{ name: 'BTC', szDecimals: 5 }] }, [{ markPx: MARK }]]; }
}

function baseState(options = {}) {
  const adapter = new FakeAdapter(options);
  const info = new FakeInfo(adapter, options);
  return { adapter, info };
}

function run(adapter, info, options = {}) {
  const currentTime = options.now ?? (() => Date.now());
  return runAcceptanceSequence({ adapter, info, principal: PRINCIPAL, agentAddress: AGENT, instrumentId: INSTRUMENT,
    szDecimals: 5, markPrice: MARK, plan: PLAN, now: currentTime,
    reconcileTimeoutMs: options.reconcileTimeoutMs ?? 30, pollIntervalMs: options.pollIntervalMs ?? 0 });
}

test('execution gate is read-only by default, accepts only explicit testnet opt-in, and rejects mainnet configuration', () => {
  assert.equal(executionOptIn([], {}), false);
  assert.equal(executionOptIn(['--execute-testnet'], {}), true);
  assert.equal(executionOptIn([], { HYPERLIQUID_TESTNET_EXECUTION_OPT_IN: '1' }), true);
  assert.equal(executionOptIn(['--dry-run'], { HYPERLIQUID_TESTNET_EXECUTION_OPT_IN: '1' }), false);
  assert.throws(() => executionOptIn(['--dry-run', '--execute-testnet'], {}), /do not combine/i);
  assert.throws(() => executionOptIn(['--execute-mainnet'], {}), /mainnet actions are not supported/i);
  assert.throws(() => assertTestnetEnvironment({ HYPERLIQUID_NETWORK: 'mainnet' }), /must be testnet/i);
  assert.throws(() => assertTestnetEnvironment({ HYPERLIQUID_API_URL: 'https://api.hyperliquid.xyz' }), /fixed Hyperliquid testnet endpoint/i);
});

test('plan uses app precision helpers and stays within the $10 minimum and $13.50 order cap', () => {
  const plan = PLAN;
  assert.equal(plan.gtc.price, '59500');
  assert.equal(plan.gtc.modifiedPrice, '61200');
  for (const item of [plan.gtc, { price: plan.gtc.modifiedPrice, size: plan.gtc.size, notional: plan.gtc.modifiedNotional },
    { price: plan.entryIoc.limitPrice, size: plan.entryIoc.size, notional: plan.entryIoc.limitNotional }]) {
    const notional = new Decimal(item.price).mul(item.size);
    assert.ok(notional.gte(10));
    assert.ok(notional.lte(13.5));
  }
  assert.equal(plan.maxPositionNotional, '15.00');
});

test('full sequence keeps native TP/SL live until a reduce-only close is confirmed flat', async () => {
  const { adapter, info } = baseState();
  const result = await run(adapter, info);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.cleanupVerified, true);
  assert.deepEqual(result.finalState, { signedBtcPosition: '0', openOrders: 0, unresolvedClientOrderIds: [] });
  const closeIndex = adapter.calls.findIndex(call => call.action === 'place' && call.reduceOnly && call.kind === 'Ioc');
  const tpSlCancelIndex = adapter.calls.findIndex((call, index) => index > closeIndex && call.action === 'cancel');
  assert.ok(closeIndex >= 0);
  assert.ok(tpSlCancelIndex > closeIndex);
  assert.equal(adapter.calls.filter(call => call.action === 'place' && !call.reduceOnly && call.kind === 'Ioc').length, 1);
});

test('unknown submit reconciles the accepted IOC by client ID and fill, then cleans up without resending it', async () => {
  const { adapter, info } = baseState({ throwAfterEntry: true });
  const result = await run(adapter, info);
  assert.equal(result.ok, false);
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.finalState.signedBtcPosition, '0');
  assert.equal(adapter.calls.filter(call => call.action === 'place' && !call.reduceOnly && call.kind === 'Ioc').length, 1);
  assert.equal(adapter.calls.filter(call => call.action === 'place' && call.reduceOnly && call.kind === 'Ioc').length, 1);
  assert.match(result.error, /submit errored/i);
});

test('a TP fill racing with close prevents a short flip and keeps SL until the account is flat', async () => {
  const { adapter, info } = baseState({ protectiveRace: true });
  const result = await run(adapter, info);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.finalState.signedBtcPosition, '0');
  assert.equal(adapter.position.toString(), '0');
  assert.equal(adapter.calls.filter(call => call.action === 'place' && call.reduceOnly && call.kind === 'Ioc').length, 1);
});

test('position lifetime limit does not block reduce-only cleanup', async () => {
  const clock = { value: 1_000 };
  const { adapter, info } = baseState({ bumpClockOnMarketRead: true, clock });
  const result = await run(adapter, info, { now: () => clock.value });
  assert.equal(result.ok, false);
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.finalState.signedBtcPosition, '0');
  assert.equal(adapter.calls.filter(call => call.action === 'place' && call.reduceOnly && call.kind === 'Ioc').length, 1);
});

test('pre-sign authorization failure does not create a phantom mutation that blocks cleanup', async () => {
  const { adapter, info } = baseState({ failAuthorizationRead: 6 });
  const result = await run(adapter, info);
  assert.equal(result.ok, false);
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.finalState.signedBtcPosition, '0');
  assert.equal(adapter.calls.some(call => call.action === 'place' && (call.kind === 'takeProfit' || call.kind === 'stopLoss')), false);
  assert.equal(adapter.calls.filter(call => call.action === 'place' && call.reduceOnly && call.kind === 'Ioc').length, 1);
});

test('modify timeout is reconciled once by order state without duplicating the GTC', async () => {
  const { adapter, info } = baseState({ throwAfterModify: true });
  const result = await run(adapter, info);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(adapter.calls.filter(call => call.action === 'modify').length, 1);
  assert.equal(adapter.calls.filter(call => call.action === 'place' && call.kind === 'Gtc').length, 1);
});

test('modify reconciliation accepts canonical decimal strings and a venue-rotated order ID', async () => {
  const { adapter, info } = baseState({ canonicalizeModify: true });
  const result = await run(adapter, info);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(adapter.calls.filter(call => call.action === 'modify').length, 1);
  assert.equal(adapter.calls.filter(call => call.action === 'place' && call.kind === 'Gtc').length, 1);
  assert.equal(result.finalState.signedBtcPosition, '0');
  assert.equal(result.finalState.openOrders, 0);
});

test('cancel failure reports final orders and does not issue a second cancel', async () => {
  const { adapter, info } = baseState({ failCancel: true });
  const result = await run(adapter, info, { reconcileTimeoutMs: 2, pollIntervalMs: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.cleanupVerified, false);
  assert.equal(result.finalState.openOrders, 1);
  assert.equal(adapter.cancelCalls, 1);
  assert.match(result.error ?? result.cleanupError ?? '', /cancel/i);
});
