import Decimal from 'decimal.js';
import { MAX_POSITION_LIFETIME_MS, RECONCILE_TIMEOUT_MS, buildAcceptancePlan, safePublicError } from './hyperliquid-testnet-acceptance-core.mjs';
import { marketIocLimit, newClientOrderId, validatePrice } from '../src/trading/model.ts';

function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function dec(value) { return new Decimal(value); }
function samePositiveDecimal(left, right) {
  try {
    const actual = dec(left), expected = dec(right);
    return actual.isFinite() && expected.isFinite() && actual.gt(0) && expected.gt(0) && actual.eq(expected);
  } catch { return false; }
}

function uniqueOrders(state) {
  const rows = new Map();
  for (const order of [...state.openOrders, ...state.frontendOrders]) {
    const key = String(order.cloid ?? `oid:${order.oid}`).toLowerCase();
    if (!rows.has(key)) rows.set(key, order);
  }
  return [...rows.values()];
}

function positionSignedSize(snapshot) {
  if (snapshot.account.positions.length > 1 || snapshot.account.positions.some(position => position.coin !== 'BTC')) {
    throw new Error('The adapter reports an unexpected position set.');
  }
  const position = snapshot.account.positions[0];
  if (!position) return new Decimal(0);
  const size = dec(position.size);
  return position.side === 'long' ? size : size.negated();
}

function assertExpectedPosition(state, expected, szDecimals) {
  const actual = positionSignedSize(state.snapshot);
  const tolerance = new Decimal(10).pow(-szDecimals).div(2);
  if (actual.minus(expected).abs().gt(tolerance)) {
    throw new Error('The live BTC position no longer matches the runner-owned confirmed fills; it will not be changed.');
  }
}

function assertOnlyOwnedOrders(state, owners) {
  const unexpected = uniqueOrders(state).filter(order => !order.cloid || !owners.has(String(order.cloid).toLowerCase()));
  if (unexpected.length) throw new Error('An order not created by this runner appeared; it will not be canceled.');
}

async function readState(adapter, info, principal) {
  const [snapshot, account, openOrders, frontendOrders] = await Promise.all([
    adapter.readSnapshot(), info.clearinghouseState({ user: principal, dex: '' }),
    info.openOrders({ user: principal, dex: '' }), info.frontendOpenOrders({ user: principal, dex: '' }),
  ]);
  const accountPositions = (account.assetPositions ?? []).map(row => row.position ?? row)
    .filter(position => Number(position.szi ?? 0) !== 0);
  if (accountPositions.length !== snapshot.account.positions.length || accountPositions.some(position => position.coin !== 'BTC')) {
    throw new Error('The authoritative account contains a position outside the BTC adapter snapshot; stopping without changing it.');
  }
  return { snapshot, accountPositions, openOrders, frontendOrders, accountValue: account.marginSummary?.accountValue ?? null };
}

function cumulativeFill(owner, state, status, fallbackFill) {
  const values = [owner.filled, fallbackFill ?? '0'];
  const orderId = state.snapshot.orders.find(order => order.cloid?.toLowerCase() === owner.cloid)?.id ?? status.order?.id ?? owner.orderId;
  if (orderId !== null && orderId !== undefined) {
    owner.orderId = orderId;
    const fills = state.snapshot.fills.filter(fill => fill.orderId === orderId)
      .reduce((total, fill) => total.plus(fill.size), new Decimal(0));
    values.push(fills);
  }
  const openOrder = state.snapshot.orders.find(order => order.cloid?.toLowerCase() === owner.cloid);
  const reportedOrder = openOrder ?? status.order;
  if (reportedOrder && ['resting', 'partiallyFilled', 'canceled', 'triggering'].includes(status.status)) {
    const original = dec(reportedOrder.originalSize), remaining = dec(reportedOrder.size);
    if (original.isFinite() && remaining.isFinite() && original.gte(remaining)) values.push(original.minus(remaining));
  }
  if (status.status === 'filled' && reportedOrder && dec(reportedOrder.size).isZero()) {
    values.push(dec(reportedOrder.originalSize));
  }
  return values.map(value => dec(value)).reduce((maximum, value) => value.gt(maximum) ? value : maximum, new Decimal(0));
}

/** Execute the bounded venue sequence through the actual TradingVenueAdapter contract. */
export async function runAcceptanceSequence({ adapter, info, principal, agentAddress, instrumentId, szDecimals, markPrice, plan,
  now = () => Date.now(), onProgress = () => {}, reconcileTimeoutMs = RECONCILE_TIMEOUT_MS, pollIntervalMs = 300 }) {
  const owners = new Map();
  const results = [];
  const cancelAttempts = new Set();
  const unresolved = new Set();
  let expectedPosition = new Decimal(0);
  let positionStartedAt = null;
  let closeAttempts = 0;
  let state = null;
  let operationError = null;
  let cleanupError = null;
  let finalState = null;

  const report = (stage, details = {}, snapshot = state?.snapshot) => {
    try {
      onProgress({
        stage,
        expectedPosition: expectedPosition.toString(),
        observedPosition: snapshot ? positionSignedSize(snapshot).toString() : 'unavailable',
        openOrders: state ? uniqueOrders(state).length : null,
        unresolvedClientOrderIds: [...unresolved],
        ...details,
      });
    } catch { /* progress reporting must not interrupt venue cleanup */ }
  };

  const refresh = async ({ verifyPosition = true } = {}) => {
    state = await readState(adapter, info, principal);
    assertOnlyOwnedOrders(state, owners);
    for (const owner of owners.values()) {
      if (!owner.attempted) continue;
      const status = await adapter.readOrderStatus(owner.cloid);
      const openOrder = state.snapshot.orders.find(order => order.cloid?.toLowerCase() === owner.cloid);
      if (openOrder?.id !== undefined) owner.orderId = openOrder.id;
      if (status.order?.id !== undefined) owner.orderId = status.order.id;
      const known = Boolean(openOrder) || status.status !== 'unknown';
      if (known) {
        owner.known = true;
        owner.status = status.status;
        unresolved.delete(owner.cloid);
      } else if (!owner.known || !openOrder) {
        unresolved.add(owner.cloid);
      }
      const totalFilled = cumulativeFill(owner, state, status, '0');
      if (totalFilled.gt(owner.filled)) {
        const increase = totalFilled.minus(owner.filled);
        expectedPosition = expectedPosition.plus(owner.side === 'buy' ? increase : increase.negated());
        owner.filled = totalFilled;
        if (!expectedPosition.isZero() && positionStartedAt === null) positionStartedAt = now();
      }
    }
    if (verifyPosition) assertExpectedPosition(state, expectedPosition, szDecimals);
    return state;
  };

  const assertAuthorized = async () => {
    const authorizations = await adapter.readAuthorizations();
    const current = authorizations.find(item => item.address.toLowerCase() === agentAddress.toLowerCase());
    if (!current || current.validUntil !== null && current.validUntil <= now()) {
      throw new Error('The testnet API agent is no longer authorized for this principal; no signed action was sent.');
    }
  };

  const assertPositionWindow = () => {
    if (positionStartedAt !== null && now() - positionStartedAt > MAX_POSITION_LIFETIME_MS) {
      throw new Error(`The runner-owned BTC position exceeded ${MAX_POSITION_LIFETIME_MS / 1000} seconds.`);
    }
  };

  const reconcile = async (owner, fallbackFill = '0', fallbackOrderId = null) => {
    const deadline = now() + reconcileTimeoutMs;
    while (now() < deadline) {
      const current = await refresh({ verifyPosition: false });
      const status = await adapter.readOrderStatus(owner.cloid);
      if (fallbackOrderId !== null) owner.orderId = fallbackOrderId;
      if (status.order?.id !== undefined) owner.orderId = status.order.id;
      const totalFilled = cumulativeFill(owner, current, status, fallbackFill);
      if (totalFilled.gt(owner.filled)) {
        const increase = totalFilled.minus(owner.filled);
        expectedPosition = expectedPosition.plus(owner.side === 'buy' ? increase : increase.negated());
        owner.filled = totalFilled;
        if (!expectedPosition.isZero() && positionStartedAt === null) positionStartedAt = now();
        assertExpectedPosition(current, expectedPosition, szDecimals);
      }
      const active = current.snapshot.orders.some(order => order.cloid?.toLowerCase() === owner.cloid);
      const known = active || status.status !== 'unknown' || owner.filled.gt(0);
      let positionMatches = true;
      try { assertExpectedPosition(current, expectedPosition, szDecimals); } catch { positionMatches = false; }
      if (known && positionMatches) {
        owner.known = true;
        owner.status = status.status;
        unresolved.delete(owner.cloid);
        return { state: current, order: current.snapshot.orders.find(order => order.cloid?.toLowerCase() === owner.cloid) ?? null, status: status.status, filledSize: owner.filled.toString(), orderId: owner.orderId };
      }
      if (known && !positionMatches) unresolved.add(owner.cloid);
      await pause(pollIntervalMs);
    }
    unresolved.add(owner.cloid);
    throw new Error(`Order ${owner.cloid} remains unknown after bounded reconciliation; it will not be repeated.`);
  };

  const submit = async (request, kind) => {
    const cloid = request.intent.cloid.toLowerCase();
    if (owners.has(cloid)) throw new Error('A client order ID would be reused; stopping.');
    const owner = { cloid, kind, side: request.intent.side, requestedSize: request.intent.size, filled: new Decimal(0), orderId: null, known: false, attempted: false, status: 'unknown' };
    owners.set(cloid, owner);
    const before = await refresh();
    assertExpectedPosition(before, expectedPosition, szDecimals);
    if (!expectedPosition.isZero() && !request.intent.reduceOnly) throw new Error('A new non-reduce-only order is blocked while a test position is open.');
    if (positionStartedAt !== null && now() - positionStartedAt > MAX_POSITION_LIFETIME_MS && ['take-profit', 'stop-loss'].includes(kind)) {
      throw new Error('The bounded test-position timer blocks adding new protection; the owned position will be reduced during cleanup.');
    }
    await assertAuthorized();
    let response = null, responseError = null;
    owner.attempted = true;
    report('order-submit-started', {
      kind, clientOrderId: cloid, side: request.intent.side, size: request.intent.size,
      price: request.intent.price, reduceOnly: request.intent.reduceOnly,
    });
    try { response = await adapter.placeOrder(request); } catch (error) { responseError = safePublicError(error); }
    const outcome = await reconcile(owner, response?.filledSize ?? '0', response?.orderId ?? null);
    report('order-reconciled', {
      kind, clientOrderId: cloid, orderId: owner.orderId, orderStatus: outcome.status,
      filledSize: owner.filled.toString(), active: Boolean(outcome.order), reduceOnly: request.intent.reduceOnly,
    }, outcome.state.snapshot);
    if (response?.outcome === 'rejected') {
      throw new Error(`Testnet rejected the ${kind} order: ${safePublicError(new Error(response.message))}`);
    }
    if (responseError) throw new Error(`The ${kind} submit errored (${responseError}) but its client ID reconciled as ${outcome.status}; it was not repeated.`);
    return { response, ...outcome, owner };
  };

  const cancelOwned = async cloidValue => {
    const cloid = cloidValue.toLowerCase();
    const owner = owners.get(cloid);
    if (!owner) throw new Error('Refusing to cancel a client order ID not created by this runner.');
    let current = await refresh();
    const active = current.snapshot.orders.find(order => order.cloid?.toLowerCase() === cloid);
    if (!active) { report('owned-order-already-absent', { clientOrderId: cloid, kind: owner.kind }); return; }
    if (cancelAttempts.has(cloid)) throw new Error('A prior cancel is unresolved; it will not be repeated.');
    await assertAuthorized();
    cancelAttempts.add(cloid);
    let cancelError = null;
    report('cancel-started', { clientOrderId: cloid, orderId: active.id, kind: owner.kind });
    try { await adapter.cancelOrder(instrumentId, active.id); } catch (error) { cancelError = safePublicError(error); }
    const deadline = now() + reconcileTimeoutMs;
    while (now() < deadline) {
      current = await refresh();
      const remains = current.snapshot.orders.some(order => order.cloid?.toLowerCase() === cloid);
      if (!remains) {
        report('cancel-reconciled', { clientOrderId: cloid, orderId: active.id, kind: owner.kind, responseError: cancelError });
        if (cancelError) results.push({ action: 'cancel response reconciled', cloid, responseError: cancelError, finalStatus: owners.get(cloid).status });
        return;
      }
      await pause(pollIntervalMs);
    }
    throw new Error(`Runner-owned order ${cloid} remains open after one cancel attempt${cancelError ? ` (${cancelError})` : ''}.`);
  };

  const modifyOwned = async (cloidValue, price, size) => {
    const cloid = cloidValue.toLowerCase();
    const owner = owners.get(cloid);
    if (!owner) throw new Error('Refusing to modify an order not created by this runner.');
    const before = await refresh();
    const order = before.snapshot.orders.find(item => item.cloid?.toLowerCase() === cloid);
    if (!order) throw new Error('The runner-owned GTC is no longer open; it will not be recreated.');
    await assertAuthorized();
    let responseError = null;
    report('modify-started', { clientOrderId: cloid, orderId: order.id, kind: owner.kind, price, size });
    try {
      await adapter.modifyOrder({ instrument: 'BTC-PERP', instrumentId, orderId: order.id, side: order.side, price, size,
        reduceOnly: order.reduceOnly, clientOrderId: cloid, type: { kind: 'limit', timeInForce: 'Gtc' } });
    } catch (error) { responseError = safePublicError(error); }
    const deadline = now() + reconcileTimeoutMs;
    while (now() < deadline) {
      const current = await refresh();
      const changed = current.snapshot.orders.find(item => item.cloid?.toLowerCase() === cloid);
      if (changed && samePositiveDecimal(changed.price, price) && samePositiveDecimal(changed.originalSize, size)) {
        report('modify-reconciled', { clientOrderId: cloid, orderId: changed.id, kind: owner.kind, price: changed.price, size: changed.originalSize, responseError });
        results.push({ action: 'modify response reconciled', cloid, responseError });
        return changed;
      }
      if (!changed) throw new Error('The runner-owned GTC disappeared during modification; it will not be resent.');
      await pause(pollIntervalMs);
    }
    throw new Error(`The GTC modification was not confirmed${responseError ? ` (${responseError})` : ''}; it will not be repeated.`);
  };

  const refreshAll = async ({ allowExpiredPosition = false } = {}) => {
    let current = await refresh({ verifyPosition: false });
    for (const owner of owners.values()) {
      if (owner.attempted && unresolved.has(owner.cloid)) {
        const resolved = await reconcile(owner, '0', owner.orderId);
        current = resolved.state;
      }
    }
    assertOnlyOwnedOrders(current, owners);
    assertExpectedPosition(current, expectedPosition, szDecimals);
    if (!allowExpiredPosition && !expectedPosition.isZero()) assertPositionWindow();
    return current;
  };

  const closePosition = async reason => {
    for (let attempt = 0; attempt < 3 && !expectedPosition.isZero(); attempt++) {
      if (closeAttempts >= 3) throw new Error('The three allowed reduce-only IOC attempts have been used.');
      if (unresolved.size) throw new Error('A prior mutation is unresolved; no further order will be sent.');
      const current = await refreshAll({ allowExpiredPosition: true });
      if (expectedPosition.isZero()) break;
      const open = current.snapshot.orders;
      if (open.some(order => !['takeProfit', 'stopLoss'].includes(order.kind) || !order.reduceOnly || !order.trigger)) {
        throw new Error('A non-protective order remains open before close; preserving it and stopping.');
      }
      const freshMids = await info.allMids({ dex: '' });
      const closeSide = expectedPosition.gt(0) ? 'sell' : 'buy';
      const closePrice = marketIocLimit(freshMids.BTC, closeSide, 50, szDecimals);
      if (validatePrice(closePrice, szDecimals)) throw new Error('The reduce-only close has invalid live BTC price precision.');
      const closeCloid = newClientOrderId();
      closeAttempts++;
      report('reduce-only-close-planned', {
        clientOrderId: closeCloid, side: closeSide, size: expectedPosition.abs().toFixed(szDecimals),
        price: closePrice, attempt: closeAttempts, reason,
      });
      try {
        await submit({ instrument: 'BTC-PERP', instrumentId,
          intent: { side: closeSide, size: expectedPosition.abs().toFixed(szDecimals), price: closePrice, reduceOnly: true, tif: 'Ioc', cloid: closeCloid },
          type: { kind: 'limit', timeInForce: 'Ioc' }, grouping: 'independent' }, `reduce-only close${reason ? ` (${reason})` : ''}`);
      } catch (error) {
        const after = await refreshAll({ allowExpiredPosition: true });
        if (!expectedPosition.isZero()) throw error;
        state = after;
      }
      await refreshAll({ allowExpiredPosition: true });
    }
    if (!expectedPosition.isZero()) throw new Error('The runner-owned BTC position remains after three confirmed reduce-only IOC actions.');
  };

  const cancelProtectionAfterFlat = async () => {
    const current = await refreshAll();
    if (!expectedPosition.isZero()) throw new Error('Protective TP/SL orders remain active until the BTC position is authoritatively flat.');
    const protects = [...owners.values()].filter(owner => owner.kind === 'takeProfit' || owner.kind === 'stopLoss');
    for (const owner of protects) await cancelOwned(owner.cloid);
  };

  try {
    state = await readState(adapter, info, principal);
    if (state.accountPositions.length || uniqueOrders(state).length) throw new Error('The account is not empty; pre-existing positions and orders are preserved.');
    report('empty-account-preflight-confirmed', { accountValue: state.accountValue, positions: 0, openOrders: 0 });
    await assertAuthorized();

    const gtcCloid = newClientOrderId();
    const gtcRequest = { instrument: 'BTC-PERP', instrumentId,
      intent: { side: 'buy', size: plan.gtc.size, price: plan.gtc.price, reduceOnly: false, tif: 'Gtc', cloid: gtcCloid },
      type: { kind: 'limit', timeInForce: 'Gtc' }, grouping: 'independent' };
    const gtc = await submit(gtcRequest, 'GTC');
    if (!gtc.order || gtc.order.side !== 'buy') throw new Error('The far-resting GTC did not reconcile as an open runner-owned buy.');
    if (!expectedPosition.isZero()) {
      await cancelOwned(gtcCloid);
      throw new Error('The far-resting GTC partially filled; its remainder was canceled and the confirmed fill is being closed.');
    }
    await modifyOwned(gtcCloid, plan.gtc.modifiedPrice, plan.gtc.size);
    await cancelOwned(gtcCloid);
    if (!expectedPosition.isZero()) throw new Error('The GTC filled while being modified or canceled; no new entry will be sent.');
    results.push({ action: 'GTC place/modify/cancel', verified: true, cloid: gtcCloid });

    const entryCloid = newClientOrderId();
    const entry = await submit({ instrument: 'BTC-PERP', instrumentId,
      intent: { side: 'buy', size: plan.entryIoc.size, price: plan.entryIoc.limitPrice, reduceOnly: false, tif: 'Ioc', cloid: entryCloid },
      type: { kind: 'limit', timeInForce: 'Ioc' }, grouping: 'independent' }, 'protected IOC entry');
    if (!entry.owner.filled.gt(0) || !expectedPosition.gt(0)) throw new Error('The IOC entry had no confirmed fill; no replacement order will be sent.');
    const opened = await refreshAll();
    const currentMark = dec(markPrice);
    const positionNotional = opened.snapshot.account.positions[0].size
      ? dec(opened.snapshot.account.positions[0].size).mul(currentMark) : new Decimal(0);
    results.push({ action: 'protected IOC entry', filledSize: expectedPosition.toString(), orderId: entry.owner.orderId, markNotional: positionNotional.toFixed(2) });
    if (positionNotional.gt(15)) throw new Error('The confirmed test position exceeds the $15 exposure cap; closing the runner-owned amount.');

    const [freshMids, freshMetaAndCtxs] = await Promise.all([info.allMids({ dex: '' }), info.metaAndAssetCtxs({ dex: '' })]);
    const btcIndex = freshMetaAndCtxs[0].universe.findIndex(asset => asset.name === 'BTC');
    const freshMark = freshMetaAndCtxs[1]?.[btcIndex]?.markPx;
    if (!freshMark || dec(freshMark).minus(markPrice).abs().div(markPrice).gt('0.02')) {
      throw new Error('BTC mark moved more than 2% before protective-order placement; stopping and closing the runner-owned position.');
    }
    const protectionPlan = buildAcceptancePlan({ markPrice: freshMark, midPrice: freshMids.BTC, szDecimals });
    const positionSize = expectedPosition.abs().toString();
    const tpCloid = newClientOrderId();
    const tp = await submit({ instrument: 'BTC-PERP', instrumentId,
      intent: { side: 'sell', size: positionSize, price: protectionPlan.takeProfit.limitPrice, reduceOnly: true, tif: 'Gtc', cloid: tpCloid },
      type: { kind: 'trigger', trigger: 'takeProfit', triggerPrice: protectionPlan.takeProfit.triggerPrice, execution: 'limit' }, grouping: 'independent' }, 'takeProfit');
    if (!tp.order || tp.order.kind !== 'takeProfit' || !tp.order.reduceOnly || !tp.order.trigger) throw new Error('The separate reduce-only take-profit was not confirmed open.');
    const slCloid = newClientOrderId();
    const sl = await submit({ instrument: 'BTC-PERP', instrumentId,
      intent: { side: 'sell', size: positionSize, price: protectionPlan.stopLoss.limitPrice, reduceOnly: true, tif: 'Gtc', cloid: slCloid },
      type: { kind: 'trigger', trigger: 'stopLoss', triggerPrice: protectionPlan.stopLoss.triggerPrice, execution: 'limit' }, grouping: 'independent' }, 'stopLoss');
    if (!sl.order || sl.order.kind !== 'stopLoss' || !sl.order.reduceOnly || !sl.order.trigger) throw new Error('The separate reduce-only stop-loss was not confirmed open.');
    const protectedState = await refreshAll();
    if (protectedState.snapshot.orders.filter(order => [tpCloid, slCloid].includes(order.cloid?.toLowerCase())).length !== 2) {
      throw new Error('Both separate native TP/SL orders are not present in the authoritative BTC snapshot.');
    }
    results.push({ action: 'independent reduce-only TP/SL place', verified: true, triggerExecution: 'not exercised; both triggers were placed away from the current mark' });

    await closePosition('acceptance sequence');
    await cancelProtectionAfterFlat();
    state = await refreshAll({ allowExpiredPosition: true });
    if (expectedPosition.isZero() && uniqueOrders(state).length === 0) {
      results.push({ action: 'reduce-only close and runner-owned order cleanup', verified: true, finalPosition: 'flat', openOrders: 0 });
      report('sequence-cleanup-verified', { flat: true, openOrders: 0 });
    } else {
      throw new Error('The final account state is not flat and empty.');
    }
  } catch (error) {
    operationError = safePublicError(error);
    report('sequence-stopped', { error: operationError });
  }

  try {
    report('safe-cleanup-started', { operationError });
    state = await refreshAll({ allowExpiredPosition: true });
    const open = state.snapshot.orders;
    for (const owner of owners.values()) {
      if (unresolved.has(owner.cloid)) continue;
      if (owner.kind === 'takeProfit' || owner.kind === 'stopLoss') continue;
      if (open.some(order => order.cloid?.toLowerCase() === owner.cloid)) await cancelOwned(owner.cloid);
    }
    state = await refreshAll({ allowExpiredPosition: true });
    if (expectedPosition.isZero()) {
      for (const owner of owners.values()) {
        if (owner.kind === 'takeProfit' || owner.kind === 'stopLoss') await cancelOwned(owner.cloid);
      }
    } else if (!unresolved.size) {
      await closePosition('safe cleanup');
      if (expectedPosition.isZero()) await cancelProtectionAfterFlat();
    }
    finalState = await refreshAll({ allowExpiredPosition: true });
    const openOrders = uniqueOrders(finalState).length;
    const flat = expectedPosition.isZero() && positionSignedSize(finalState.snapshot).isZero();
    const empty = openOrders === 0;
    if ((!flat || !empty) && !operationError) operationError = 'Final authoritative state remains non-flat or has open orders.';
    report('final-authoritative-state', { flat, openOrders }, finalState.snapshot);
  } catch (error) {
    cleanupError = safePublicError(error);
    report('cleanup-error', { cleanupError });
    try {
      finalState = await readState(adapter, info, principal);
    } catch { finalState = null; }
  }

  const finalPosition = finalState ? positionSignedSize(finalState.snapshot).toString() : 'unavailable';
  const finalOpenOrders = finalState ? uniqueOrders(finalState).length : null;
  const cleanupVerified = finalState !== null && expectedPosition.isZero() && finalPosition === '0' && finalOpenOrders === 0;
  return {
    ok: !operationError && !cleanupError && cleanupVerified,
    error: operationError,
    cleanupError,
    cleanupVerified,
    results,
    finalState: { signedBtcPosition: finalPosition, openOrders: finalOpenOrders, unresolvedClientOrderIds: [...unresolved] },
  };
}
