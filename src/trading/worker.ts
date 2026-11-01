import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import Decimal from 'decimal.js';
import {
  commitLegacyAgentBinding, decryptLegacyAgentPrivateKey, decryptScopedAgentPrivateKey, encryptAgentPrivateKey,
  getAgentVaultInfo, prepareLegacyAgentBinding, prepareScopedAgentRecord, removeAllEncryptedAgents, removeEncryptedAgent,
  secureSigningAvailable, secureVaultAvailable,
  type DecryptedAgentKey, type ScopedAgentRecord, type VaultInfo, type VaultOperationContext,
} from './vault';
import { HyperliquidTradingAdapter } from './hyperliquid-adapter';
import {
  isEvmAddress, isFreshMarkPrice, isFreshMidPrice, marketIocLimit, normalizeAddress, orderFilledSize, orderPhaseFromStatus, positiveDecimal, reconcileOrderAttempt, validateAvailableMargin, validateLeverage, validateOrderNotional, validatePrice, validateReduceOnlyOrder, validateSize, validateTriggerOrientation,
  type OrderAttempt, type OrderIntent, type OrderPhase, type TradingNetwork, type TradingOrder, type TradingOrderOperation, type TradingSnapshot,
} from './model';
import type { TradingWorkerEvent, TradingWorkerRequest } from './protocol';
import type {
  TradingVenueAccount, TradingVenueActiveAssetData, TradingVenueAdapter, TradingVenueAuthorization, TradingVenueMarketMetadata,
  TradingVenueOrderResult, TradingVenueOrderType, TradingVenueUpdate,
} from './venue-adapter';
import { TradingVenueRejectedError } from './venue-adapter';

const MAX_FILLS = 50;
const MAX_ORDER_UPDATES = 150;
const MAX_TRACKED_FILL_IDS = 2_000;
const RECONCILE_MS = 20_000;
const DEFAULT_INACTIVITY_MINUTES = 15;
const MIN_INACTIVITY_MINUTES = 1;
const MAX_INACTIVITY_MINUTES = 120;
const FIXTURE_EXECUTION_DISABLED = 'Agent key handling and exchange actions are disabled while diagnostic fixture mode is selected';
const MUTATION_ACCOUNT_MAX_AGE_MS = 30_000;
const emptySnapshot = (network: TradingNetwork = 'testnet', principal = ''): TradingSnapshot => ({
  network, principal, feedState: 'disconnected', lastMessageAt: 0, lastSnapshotAt: 0,
  accountValue: null, marginUsed: null, withdrawable: null, totalNotional: null,
  positions: [], orders: [], fills: [], midPrice: null, midPriceUpdatedAt: 0, markPrice: null, markPriceUpdatedAt: 0, szDecimals: null, btcAsset: null,
  orderOperations: [], btcMaxLeverage: null, btcLeverage: null, btcAvailableToTrade: null,
  agentAddress: null, agentAuthorized: false, agentValidUntil: null, error: null,
});
type AgentSigner = ReturnType<typeof privateKeyToAccount>;

let network: TradingNetwork = 'testnet';
let principal = '';
let snapshot = emptySnapshot();
let adapter: TradingVenueAdapter | null = null;
let signer: AgentSigner | null = null;
let agentAddress: string | null = null;
let sessionOnly = false;
let vaultStorageAvailable: boolean | null = null;
let sessionOnlyAvailable = false;
let inactivityMinutes = DEFAULT_INACTIVITY_MINUTES;
let fixtureMode: boolean | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | undefined;
let staleTimer: ReturnType<typeof setInterval> | undefined;
let idleTimer: ReturnType<typeof setInterval> | undefined;
let lastUserActivityAt = Date.now();
let accountGeneration = 0;
let signingGeneration = 0;
let credentialAbortController: AbortController | null = null;
let pendingLegacyBinding: {
  token: string;
  epoch: CredentialEpoch;
  address: string;
  legacy: DecryptedAgentKey;
  prepared: ScopedAgentRecord;
} | null = null;
let accountSnapshotReady = false;
let accountRestRecoveryRequired = false;
let accountRestError: string | null = null;
let accountSubscriptionError: string | null = null;
let lastAccountErrorPublished: string | null = null;
let accountStreamHealth = { account: false, openOrders: false, orderUpdates: false, fills: false };
let reconcileBusyGeneration: number | null = null;
let wsRevision = 0;
const attempts = new Map<string, OrderAttempt>();
const reservedOrderCloids = new Set<string>();
let mutationQueue: Promise<void> = Promise.resolve();
const recentUpdates = new Map<number, TradingOrder>();
const seenFillIds = new Set<string>();
const fillTotals = new Map<number, Decimal>();
const orderOperations = new Map<number, TradingOrderOperation>();

function send(event: TradingWorkerEvent) { self.postMessage(event); }
function sendVaultState(fields: Omit<Extract<TradingWorkerEvent, { type: 'vault-state' }>, 'type' | 'network' | 'principal'>) {
  send({ type: 'vault-state', network, principal, ...fields });
}
function result(id: number, value?: unknown, error?: unknown) {
  send({ type: 'result', id, ...(error === undefined ? { value } : { error: cleanError(error) }) });
}
function cleanError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? 'Unknown trading error');
  return text.replace(/0x[0-9a-fA-F]{64}/g, '[redacted key]').slice(0, 240);
}
function selectFixtureMode(selected: boolean) {
  if (typeof selected !== 'boolean') throw new Error('Trading worker requires an explicit fixture-mode selection before account configuration');
  if (fixtureMode === null) fixtureMode = selected;
  else if (fixtureMode !== selected) throw new Error('Trading worker fixture mode is immutable for this worker; close and reopen the page to change it');
}
function assertExecutionAllowed() {
  if (fixtureMode !== false) throw new Error(fixtureMode === true
    ? FIXTURE_EXECUTION_DISABLED
    : 'Trading worker must be configured before key handling or exchange actions');
}
function rejectFixtureExecution(id: number) {
  try { assertExecutionAllowed(); return false; }
  catch (error) { result(id, undefined, error); return true; }
}
function publishSnapshot(patch: Partial<TradingSnapshot> = {}) {
  snapshot = { ...snapshot, ...patch };
  send({ type: 'snapshot', snapshot: { ...snapshot, positions: [...snapshot.positions], orders: [...snapshot.orders], fills: [...snapshot.fills] } });
}
class SessionInvalidatedError extends Error {}
function accountChannelsHealthy() {
  return accountStreamHealth.account && accountStreamHealth.openOrders && accountStreamHealth.orderUpdates && accountStreamHealth.fills;
}
function accountStatusPatch(lastMessageAt?: number): Partial<TradingSnapshot> {
  const error = accountRestError ?? accountSubscriptionError;
  const feedState = error
    ? accountSnapshotReady ? 'stale' as const : 'failed' as const
    : accountSnapshotReady && !accountRestRecoveryRequired && accountChannelsHealthy() ? 'live' as const : 'connecting' as const;
  const patch: Partial<TradingSnapshot> = { feedState, ...(lastMessageAt === undefined ? {} : { lastMessageAt }) };
  if (error) patch.error = error;
  else if (lastAccountErrorPublished && snapshot.error === lastAccountErrorPublished) patch.error = null;
  lastAccountErrorPublished = error;
  return patch;
}
function accountStreamPatch(channel?: 'account' | 'openOrders' | 'orderUpdates' | 'fills'): Partial<TradingSnapshot> {
  if (channel === 'account' || channel === 'openOrders') {
    accountStreamHealth[channel] = true;
    if (accountChannelsHealthy() && !accountRestRecoveryRequired) {
      accountSubscriptionError = null;
    }
  }
  return accountStatusPatch(Date.now());
}
function applyClearinghouse(account: TradingVenueAccount, source: 'stream' | 'snapshot') {
  publishSnapshot({
    positions: account.positions,
    accountValue: account.accountValue, marginUsed: account.marginUsed,
    withdrawable: account.withdrawable, totalNotional: account.totalNotional,
    ...(source === 'stream' ? accountStreamPatch('account') : {}),
  });
}
function nonnegativeDecimal(value: string) {
  try { const parsed = new Decimal(value); return parsed.isFinite() && parsed.gte(0) ? parsed : null; }
  catch { return null; }
}
function attemptForOrder(orderId: number, cloid: string | null) {
  if (cloid) {
    const byCloid = attempts.get(cloid.toLowerCase());
    if (byCloid) return byCloid;
  }
  return [...attempts.values()].find(attempt => attempt.exchangeId === orderId);
}
function isTerminalPartialIoc(attempt: OrderAttempt) {
  return attempt.intent.tif === 'Ioc' && attempt.phase === 'partiallyFilled' && attempt.remainingSize === '0';
}
function isTerminalPartialIocOrder(order: TradingOrder) {
  const attempt = attemptForOrder(order.id, order.cloid);
  return !!attempt && isTerminalPartialIoc(attempt);
}
function syncAttemptFromOrder(order: TradingOrder) {
  const attempt = attemptForOrder(order.id, order.cloid);
  if (!attempt) return;
  if (isTerminalPartialIoc(attempt)) return;
  const statusPhase = orderPhaseFromStatus(order.status);
  if (attempt.phase === 'filled') return;
  if (['canceled', 'rejected'].includes(attempt.phase) && !['filled', 'canceled', 'rejected'].includes(statusPhase)) return;

  const requested = positiveDecimal(attempt.intent.size) ?? new Decimal(0);
  const priorFilled = positiveDecimal(attempt.filledSize ?? '0') ?? new Decimal(0);
  const orderFilled = positiveDecimal(orderFilledSize(order)) ?? new Decimal(0);
  const streamedFilled = fillTotals.get(order.id) ?? new Decimal(0);
  const evidenceFilled = Decimal.max(priorFilled, streamedFilled);
  const filled = Decimal.max(evidenceFilled, orderFilled);
  const orderRemaining = nonnegativeDecimal(order.size);
  const calculatedRemaining = Decimal.max(requested.minus(filled), 0);
  const remaining = statusPhase === 'filled' || statusPhase === 'canceled' || statusPhase === 'rejected'
    ? new Decimal(0)
    : orderRemaining ? Decimal.min(orderRemaining, calculatedRemaining) : calculatedRemaining;
  const phase: OrderPhase = statusPhase === 'filled' ? 'filled'
    : statusPhase === 'canceled' || statusPhase === 'rejected' || statusPhase === 'triggering' ? statusPhase
      : filled.gt(0) && remaining.gt(0) ? 'partiallyFilled'
        : filled.gt(0) && remaining.isZero() ? 'unknown'
          : statusPhase === 'unknown' ? attempt.phase : statusPhase;
  const message = phase === 'partiallyFilled'
    ? `Partially filled ${filled.toString()} of ${attempt.intent.size} BTC; ${remaining.toString()} BTC remains open`
    : phase === 'filled' ? 'Exchange order status confirms the full requested size filled'
      : phase === 'unknown' && filled.gt(0) ? `Observed ${filled.toString()} BTC filled; waiting for authoritative order status`
        : phase === 'canceled' && filled.gt(0) ? `Canceled after ${filled.toString()} BTC filled`
          : `Exchange order status: ${order.status}`;
  safeAttempt({ ...attempt, exchangeId: order.id, phase, filledSize: filled.toString(), remainingSize: remaining.toString(), updatedAt: Date.now(), message });
}
function syncAttemptFromFill(orderId: number) {
  const attempt = attemptForOrder(orderId, null);
  if (!attempt) return;
  if (isTerminalPartialIoc(attempt)) return;
  const requested = positiveDecimal(attempt.intent.size) ?? new Decimal(0);
  const previous = positiveDecimal(attempt.filledSize ?? '0') ?? new Decimal(0);
  const observed = fillTotals.get(orderId) ?? new Decimal(0);
  const filled = Decimal.max(previous, observed);
  if (filled.lte(previous)) return;
  const remaining = Decimal.max(requested.minus(filled), 0);
  const phase: OrderPhase = ['filled', 'canceled', 'rejected'].includes(attempt.phase) ? attempt.phase
    : filled.lt(requested) && remaining.gt(0) ? 'partiallyFilled' : 'unknown';
  safeAttempt({
    ...attempt, phase, exchangeId: orderId, filledSize: filled.toString(), remainingSize: remaining.toString(), updatedAt: Date.now(),
    message: phase === 'partiallyFilled'
      ? `Partially filled ${filled.toString()} of ${attempt.intent.size} BTC; ${remaining.toString()} BTC remains`
      : `Observed fills total ${filled.toString()} BTC; waiting for authoritative order status`,
  });
}
function operationMatchesOrder(operation: TradingOrderOperation, order: TradingOrder) {
  return operation.orderId === order.id || operation.resolvedOrderId === order.id
    || operation.possibleOrderIds?.includes(order.id) === true || Boolean(operation.cloid && order.cloid
    && operation.cloid.toLowerCase() === order.cloid.toLowerCase());
}
function positionForReduceOnly() { return snapshot.positions.find(position => position.coin === 'BTC'); }
function operationIsBlocking(operation: TradingOrderOperation | undefined) {
  return !!operation && operation.phase !== 'rejected';
}
function publishOrderOperation(operation: TradingOrderOperation) {
  orderOperations.set(operation.orderId, operation);
  publishSnapshot({ orderOperations: [...orderOperations.values()] });
}
function clearOrderOperation(orderId: number) {
  if (orderOperations.delete(orderId)) publishSnapshot({ orderOperations: [...orderOperations.values()] });
}
function findOrderOperation(orderId: number, cloid: string | null) {
  const direct = orderOperations.get(orderId);
  if (direct) return direct;
  return [...orderOperations.values()].find(item => item.resolvedOrderId === orderId || item.possibleOrderIds?.includes(orderId)
    || Boolean(cloid && item.cloid?.toLowerCase() === cloid.toLowerCase()));
}
function assertOrderOperationAvailable(order: TradingOrder) {
  const operation = findOrderOperation(order.id, order.cloid);
  if (operationIsBlocking(operation)) {
    throw new Error(`Order #${order.id} has a ${operation!.phase} ${operation!.kind} operation; wait for canonical exchange reconciliation before another action`);
  }
}
function beginOrderOperation(kind: TradingOrderOperation['kind'], order: TradingOrder, requestedPrice?: string, requestedSize?: string) {
  const now = Date.now();
  const operation: TradingOrderOperation = {
    orderId: order.id, cloid: order.cloid, side: order.side, reduceOnly: order.reduceOnly, trigger: order.trigger, orderKind: order.kind,
    priorOrderIds: snapshot.orders.map(item => item.id), kind, phase: 'pending', createdAt: now, updatedAt: now,
    message: `${kind === 'cancel' ? 'Cancel' : 'Modify'} request sent; waiting for the venue response`,
    ...(requestedPrice === undefined ? {} : { requestedPrice }),
    ...(requestedSize === undefined ? {} : { requestedSize }),
  };
  publishOrderOperation(operation);
  return operation;
}
function updateOrderOperation(orderId: number, phase: TradingOrderOperation['phase'], message: string) {
  const current = orderOperations.get(orderId);
  if (current) publishOrderOperation({ ...current, phase, updatedAt: Date.now(), message });
}
function hasTerminalOrderUpdate(operation: TradingOrderOperation) {
  return [...recentUpdates.values()].some(update => operationMatchesOrder(operation, update)
    && ['canceled', 'filled', 'rejected', 'triggered'].includes(update.status.toLowerCase()));
}
function syncOrderOperationEvidence(orders: readonly TradingOrder[], canonicalOpenOrderSnapshot = false) {
  let changed = false;
  for (const operation of [...orderOperations.values()]) {
    if (operation.possibleOrderIds?.length && canonicalOpenOrderSnapshot) {
      const stillPossible = orders.filter(order => operation.possibleOrderIds?.includes(order.id)
        && order.side === operation.side && order.reduceOnly === operation.reduceOnly && order.trigger === operation.trigger
        && (positiveDecimal(order.trigger && order.triggerPrice ? order.triggerPrice : order.price)?.eq(operation.requestedPrice ?? '') ?? false)
        && (positiveDecimal(order.originalSize)?.eq(operation.requestedSize ?? '') ?? false));
      if (stillPossible.length === 1) { orderOperations.delete(operation.orderId); changed = true; }
      else if (stillPossible.length !== operation.possibleOrderIds.length) {
        orderOperations.set(operation.orderId, { ...operation, possibleOrderIds: stillPossible.map(order => order.id), updatedAt: Date.now() }); changed = true;
      }
      continue;
    }
    const order = orders.find(item => item.id === operation.orderId || item.id === operation.resolvedOrderId
      || Boolean(operation.cloid && item.cloid?.toLowerCase() === operation.cloid.toLowerCase()));
    if (order) {
      const status = order.status.toLowerCase();
      const terminal = ['canceled', 'filled', 'rejected', 'triggered'].includes(status);
      const changedToRequested = operation.kind === 'modify'
        && operation.requestedPrice !== undefined && operation.requestedSize !== undefined
        && (positiveDecimal(order.trigger && order.triggerPrice ? order.triggerPrice : order.price)?.eq(operation.requestedPrice) ?? false)
        && (positiveDecimal(order.originalSize)?.eq(operation.requestedSize) ?? false);
      if (terminal || changedToRequested) {
        orderOperations.delete(operation.orderId); changed = true; continue;
      }
      if (operation.phase !== 'pending' && operation.phase !== 'rejected') {
        const next = operation.kind === 'cancel'
          ? { ...operation, phase: 'reconciling' as const, updatedAt: Date.now(), message: 'The order remains in the canonical open-order snapshot; waiting for final exchange status' }
          : operation;
        if (next !== operation) { orderOperations.set(operation.orderId, next); changed = true; }
      }
    } else if (operation.kind === 'modify' && canonicalOpenOrderSnapshot && operation.requestedPrice && operation.requestedSize
      && !hasTerminalOrderUpdate(operation)) {
      const requestedPrice = operation.requestedPrice;
      const requestedSize = operation.requestedSize;
      const candidates = orders.filter(candidate => candidate.id !== operation.orderId
        && candidate.id !== operation.resolvedOrderId && !operation.priorOrderIds.includes(candidate.id)
        && candidate.timestamp >= operation.createdAt - 1_000 && candidate.side === operation.side
        && candidate.reduceOnly === operation.reduceOnly && candidate.trigger === operation.trigger
        && (!operation.trigger || candidate.kind === operation.orderKind)
        && (positiveDecimal(candidate.trigger && candidate.triggerPrice ? candidate.triggerPrice : candidate.price)?.eq(requestedPrice) ?? false)
        && (positiveDecimal(candidate.originalSize)?.eq(requestedSize) ?? false));
      if ((operation.resolvedOrderId !== undefined && candidates.some(candidate => candidate.id === operation.resolvedOrderId))
        || (operation.resolvedOrderId === undefined && candidates.length === 1)) {
        orderOperations.delete(operation.orderId); changed = true;
      } else if (candidates.length > 1) {
        const next = { ...operation, possibleOrderIds: candidates.map(candidate => candidate.id), phase: 'unknown' as const,
          updatedAt: Date.now(), message: 'Multiple new canonical orders match this no-cloid modification; none was selected. Review the exchange orders before retrying.' };
        orderOperations.set(operation.orderId, next); changed = true;
      } else if (operation.cloid !== null || operation.resolvedOrderId !== undefined) {
        // Canonical absence after a cloid-addressable or response-addressed modify means the order is no longer open.
        orderOperations.delete(operation.orderId); changed = true;
      }
    } else if (canonicalOpenOrderSnapshot || hasTerminalOrderUpdate(operation)) {
      // An order's absence is evidence that it is no longer open, not proof that it was canceled.
      orderOperations.delete(operation.orderId); changed = true;
    }
  }
  if (changed) publishSnapshot({ orderOperations: [...orderOperations.values()] });
}
function applyOpenOrders(orders: readonly TradingOrder[], mergeLive = true, source: 'stream' | 'snapshot' = 'stream') {
  const incoming = new Map<number, TradingOrder>();
  for (const order of orders) if (!isTerminalPartialIocOrder(order)) { incoming.set(order.id, order); syncAttemptFromOrder(order); }
  if (mergeLive) for (const [id, order] of recentUpdates) {
    const phase = order.status.toLowerCase();
    if (isTerminalPartialIocOrder(order)) incoming.delete(id);
    else if (['open', 'resting', 'working', 'waitingfortrigger'].includes(phase)) incoming.set(id, order);
    else incoming.delete(id);
  }
  syncOrderOperationEvidence([...incoming.values()], true);
  publishSnapshot({ orders: [...incoming.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ORDER_UPDATES),
    ...(source === 'stream' ? accountStreamPatch('openOrders') : {}) });
}
function applyOrderUpdates(orders: readonly TradingOrder[]) {
  for (const order of orders) {
    if (isTerminalPartialIocOrder(order)) { recentUpdates.delete(order.id); continue; }
    syncAttemptFromOrder(order);
    recentUpdates.set(order.id, order);
    while (recentUpdates.size > MAX_ORDER_UPDATES) recentUpdates.delete(recentUpdates.keys().next().value!);
  }
  syncOrderOperationEvidence(orders);
  const next = new Map(snapshot.orders.map(order => [order.id, order]));
  for (const [id, order] of recentUpdates) {
    const phase = order.status.toLowerCase();
    if (isTerminalPartialIocOrder(order)) next.delete(id);
    else if (['open', 'resting', 'working', 'waitingfortrigger'].includes(phase)) next.set(id, order);
    else next.delete(id);
  }
  publishSnapshot({ orders: [...next.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ORDER_UPDATES), ...accountStreamPatch('orderUpdates') });
}
function applyFills(fills: readonly TradingSnapshot['fills'][number][], replace = false, source: 'stream' | 'snapshot' = 'stream') {
  if (replace) { seenFillIds.clear(); fillTotals.clear(); }
  const map = new Map(replace ? [] : snapshot.fills.map(fill => [fill.id, fill]));
  const changedOrders = new Set<number>();
  for (const fill of fills) {
    map.set(fill.id, fill);
    if (seenFillIds.has(fill.id)) continue;
    seenFillIds.add(fill.id);
    if (fill.orderId !== null) {
      fillTotals.set(fill.orderId, (fillTotals.get(fill.orderId) ?? new Decimal(0)).plus(fill.size));
      changedOrders.add(fill.orderId);
    }
    while (seenFillIds.size > MAX_TRACKED_FILL_IDS) seenFillIds.delete(seenFillIds.values().next().value!);
    while (fillTotals.size > MAX_ORDER_UPDATES) fillTotals.delete(fillTotals.keys().next().value!);
  }
  for (const orderId of changedOrders) syncAttemptFromFill(orderId);
  const recentFills = [...map.values()].sort((a, b) => b.time - a.time).slice(0, MAX_FILLS);
  publishSnapshot({ fills: recentFills, ...(source === 'stream' ? accountStreamPatch('fills') : {}) });
}
function applyMeta(metadata: TradingVenueMarketMetadata) {
  if (metadata.instrumentId === null) { publishSnapshot({ btcAsset: null, szDecimals: null, btcMaxLeverage: null, error: 'BTC perpetual metadata is unavailable on this network' }); return; }
  if (metadata.sizeDecimals === null) { publishSnapshot({ btcAsset: metadata.instrumentId, szDecimals: null, btcMaxLeverage: metadata.maxLeverage, error: 'BTC perpetual size precision is invalid' }); return; }
  publishSnapshot({ btcAsset: metadata.instrumentId, szDecimals: metadata.sizeDecimals, btcMaxLeverage: metadata.maxLeverage, error: null });
}
function applyActiveAssetData(data: TradingVenueActiveAssetData | null) {
  publishSnapshot({
    btcLeverage: data?.leverage ?? null,
    btcAvailableToTrade: data?.availableToTrade ?? null,
  });
}
function applyAgents(rows: readonly TradingVenueAuthorization[]) {
  const address = agentAddress;
  const match = address ? rows.find(item => normalizeAddress(item.address) === address) : undefined;
  const expires = match?.validUntil ?? null;
  const authorized = !!match && (expires === null || expires > Date.now());
  publishSnapshot({ agentAddress: address, agentAuthorized: authorized, agentValidUntil: authorized ? expires : null });
}

async function disconnect(invalidate = true) {
  if (invalidate) {
    accountGeneration++;
    signingGeneration++;
    invalidateCredentialOperations();
    signer = null;
    adapter?.setSigningAccount(null);
  }
  clearInterval(reconcileTimer); clearInterval(staleTimer);
  reconcileTimer = undefined; staleTimer = undefined;
  const oldAdapter = adapter; adapter = null;
  if (oldAdapter) await oldAdapter.disconnect();
}
function enabledIdentity() {
  if (!isEvmAddress(principal)) throw new Error('Enter a valid principal (master or sub-account) address first');
  return normalizeAddress(principal);
}

interface AccountEpoch { generation: number; network: TradingNetwork; principal: string; adapter: TradingVenueAdapter | null }
interface CredentialEpoch extends AccountEpoch { signingGeneration: number; signal?: AbortSignal }
interface MutationReceipt extends AccountEpoch { signingGeneration: number }
interface SigningSession extends AccountEpoch {
  signingGeneration: number;
  signer: AgentSigner;
  adapter: TradingVenueAdapter;
  agentAddress: string;
}
function captureAccountEpoch(): AccountEpoch { return { generation: accountGeneration, network, principal, adapter }; }
function isAccountEpochCurrent(epoch: AccountEpoch) {
  return epoch.generation === accountGeneration && epoch.network === network && epoch.principal === principal && epoch.adapter === adapter
    && snapshot.network === epoch.network && snapshot.principal === epoch.principal;
}
function assertAccountEpochCurrent(epoch: AccountEpoch) {
  if (!isAccountEpochCurrent(epoch)) {
    throw new SessionInvalidatedError('Selected trading account changed while checking authorization; action was not signed');
  }
}
function invalidateCredentialOperations() {
  credentialAbortController?.abort();
  credentialAbortController = null;
  pendingLegacyBinding = null;
}
function captureCredentialEpoch(): CredentialEpoch {
  return { ...captureAccountEpoch(), signingGeneration, signal: credentialAbortController?.signal };
}
function vaultOperationContext(epoch: CredentialEpoch): VaultOperationContext {
  return {
    network: epoch.network, principal: epoch.principal, accountGeneration: epoch.generation, signingGeneration: epoch.signingGeneration,
    signal: epoch.signal, assertCurrent: () => assertCredentialEpochCurrent(epoch),
  };
}
function beginCredentialOperation(): CredentialEpoch {
  invalidateCredentialOperations();
  const controller = new AbortController(); credentialAbortController = controller;
  const hadSigner = !!signer;
  const hadSessionOnly = sessionOnly;
  if (hadSigner) {
    signer = null;
    if (hadSessionOnly) agentAddress = null;
    sessionOnly = false;
    adapter?.setSigningAccount(null);
    publishSnapshot({ agentAddress, agentAuthorized: false, agentValidUntil: null });
    sendVaultState({ address: agentAddress, unlocked: false, exists: !!agentAddress, legacyNeedsBinding: false,
      releaseOwner: false, sessionOnly: false });
  }
  return { ...captureAccountEpoch(), signingGeneration: ++signingGeneration, signal: controller.signal };
}
function isCredentialEpochCurrent(epoch: CredentialEpoch) {
  return isAccountEpochCurrent(epoch) && epoch.signingGeneration === signingGeneration;
}
function assertCredentialEpochCurrent(epoch: CredentialEpoch) {
  assertAccountEpochCurrent(epoch);
  if (epoch.signingGeneration !== signingGeneration) throw new SessionInvalidatedError('Agent was locked or changed while credentials were being processed');
}
function captureSigningSession(): SigningSession {
  if (!adapter || !signer || !agentAddress) throw new Error('Unlock an authorized agent wallet before trading');
  return { ...captureAccountEpoch(), signingGeneration, signer, adapter, agentAddress };
}
function assertSigningSessionCurrent(session: SigningSession) {
  assertAccountEpochCurrent(session);
  if (session.signingGeneration !== signingGeneration || session.signer !== signer || session.adapter !== adapter || session.agentAddress !== agentAddress) {
    throw new SessionInvalidatedError('Signing session was locked or changed while checking authorization; action was not signed');
  }
}
function assertMutationAccountReady() {
  const age = Date.now() - snapshot.lastSnapshotAt;
  if (!adapter || !principal || !accountSnapshotReady || snapshot.feedState !== 'live'
    || snapshot.lastSnapshotAt <= 0 || age < 0 || age > MUTATION_ACCOUNT_MAX_AGE_MS) {
    throw new Error('A fresh live authoritative BTC account snapshot is required before signing; refresh and wait for account reconciliation');
  }
}
function reserveOrderCloid(cloid: unknown) {
  if (typeof cloid !== 'string' || !/^0x[0-9a-f]{32}$/.test(cloid)) throw new Error('Client order ID is invalid');
  const key = cloid.toLowerCase();
  if (attempts.has(key) || reservedOrderCloids.has(key)) throw new Error('This client order ID has already been used; create a new order ID');
  const unresolved = [...attempts.values()].find(attempt => attempt.network === network
    && normalizeAddress(attempt.principal) === normalizeAddress(principal)
    && (attempt.phase === 'submitting' || attempt.phase === 'unknown'));
  if (unresolved) throw new Error(`Resolve order attempt ${unresolved.cloid} (${unresolved.phase}) before submitting another order`);
  reservedOrderCloids.add(key);
  return () => reservedOrderCloids.delete(key);
}
function enqueueMutation(id: number, operation: () => Promise<unknown>) {
  const receipt: MutationReceipt = { ...captureAccountEpoch(), signingGeneration };
  const current = mutationQueue.then(() => {
    assertAccountEpochCurrent(receipt);
    if (receipt.signingGeneration !== signingGeneration) {
      throw new SessionInvalidatedError('Account or signing session changed while the action waited; no exchange action was sent');
    }
    return operation();
  });
  mutationQueue = current.then(() => undefined, () => undefined);
  void current.then(value => result(id, value), error => result(id, undefined, error));
}
async function reconcile() {
  const epoch = captureAccountEpoch();
  const venue = epoch.adapter;
  if (!venue || !principal || reconcileBusyGeneration === epoch.generation) return;
  reconcileBusyGeneration = epoch.generation;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = wsRevision;
      const [account, agents] = await Promise.all([
        venue.readSnapshot(), agentAddress ? venue.readAuthorizations() : Promise.resolve([]),
      ]);
      if (!isAccountEpochCurrent(epoch)) return;
      if (revision !== wsRevision && attempt < 2) continue;
      applyClearinghouse(account.account, 'snapshot');
      applyMeta(account.market);
      applyOpenOrders(account.orders, false, 'snapshot');
      applyFills(account.fills, true, 'snapshot');
      applyActiveAssetData(account.activeAssetData);
      if (agentAddress) applyAgents(agents);
      const now = Date.now();
      accountSnapshotReady = true;
      accountRestRecoveryRequired = false;
      accountRestError = null;
      if (accountChannelsHealthy()) accountSubscriptionError = null;
      publishSnapshot({ lastSnapshotAt: now, lastMessageAt: Math.max(snapshot.lastMessageAt, now), ...accountStatusPatch(now) });
      return;
    }
  } catch (error) {
    if (isAccountEpochCurrent(epoch)) {
      accountRestError = `Account refresh failed: ${cleanError(error)}`;
      publishSnapshot(accountStatusPatch());
    }
  } finally {
    if (reconcileBusyGeneration === epoch.generation) reconcileBusyGeneration = null;
  }
}
async function refreshAgentAuthority(session: SigningSession) {
  assertSigningSessionCurrent(session);
  const agents = await session.adapter.readAuthorizations();
  assertSigningSessionCurrent(session);
  applyAgents(agents);
  return snapshot.agentAuthorized;
}
async function configure(nextNetwork: TradingNetwork, nextPrincipal: string, nextInactivityMinutes = DEFAULT_INACTIVITY_MINUTES) {
  if (!Number.isInteger(nextInactivityMinutes) || nextInactivityMinutes < MIN_INACTIVITY_MINUTES || nextInactivityMinutes > MAX_INACTIVITY_MINUTES) {
    throw new RangeError(`Lock timeout must be ${MIN_INACTIVITY_MINUTES}–${MAX_INACTIVITY_MINUTES} minutes`);
  }
  inactivityMinutes = nextInactivityMinutes;
  lastUserActivityAt = Date.now();
  const generation = ++accountGeneration;
  invalidateCredentialOperations();
  signingGeneration++;
  // Invalidate pending authorization checks before teardown can yield.
  signer = null;
  adapter?.setSigningAccount(null);
  publishSnapshot({ agentAuthorized: false, agentValidUntil: null });
  sendVaultState({ address: null, unlocked: false, exists: false, legacyNeedsBinding: false, releaseOwner: false });
  await disconnect(false);
  if (generation !== accountGeneration) return;
  await lockSession(false);
  if (generation !== accountGeneration) return;
  network = nextNetwork; principal = isEvmAddress(nextPrincipal) ? normalizeAddress(nextPrincipal) : '';
  recentUpdates.clear(); seenFillIds.clear(); fillTotals.clear(); reservedOrderCloids.clear();
  orderOperations.clear();
  wsRevision++;
  accountSnapshotReady = false;
  accountRestRecoveryRequired = false;
  accountRestError = null;
  accountSubscriptionError = null;
  lastAccountErrorPublished = null;
  accountStreamHealth = { account: false, openOrders: false, orderUpdates: false, fills: false };
  snapshot = emptySnapshot(network, principal);
  publishSnapshot();
  if (!principal) return;
  const venue = new HyperliquidTradingAdapter();
  adapter = venue;
  publishSnapshot({ feedState: 'connecting', error: null });
  const onUpdate = (update: TradingVenueUpdate) => {
    if (generation !== accountGeneration) return;
    if (update.type === 'subscriptions-ready') {
      accountStreamHealth.orderUpdates = update.orderUpdates;
      accountStreamHealth.fills = update.fills;
      if (update.reconnected) void reconcile();
      return;
    }
    if (update.type === 'mid-price') {
      publishSnapshot({ midPrice: update.value, midPriceUpdatedAt: Date.now(), ...(snapshot.error?.startsWith('Mid-price stream') ? { error: null } : {}) });
      return;
    }
    if (update.type === 'mark-price') {
      publishSnapshot({ markPrice: update.value, markPriceUpdatedAt: Date.now(), ...(snapshot.error?.startsWith('Mark-price stream') ? { error: null } : {}) });
      return;
    }
    wsRevision++;
    if (update.type === 'account') applyClearinghouse(update.value, 'stream');
    else if (update.type === 'open-orders') applyOpenOrders(update.value, false, 'stream');
    else if (update.type === 'order-updates') applyOrderUpdates(update.value);
    else if (update.type === 'fills') applyFills(update.value, update.snapshot, 'stream');
  };
  const onError = (kind: string, error: unknown) => {
    if (generation !== accountGeneration) return;
    if (kind.toLowerCase().includes('metadata') || kind === 'Feed normalization') {
      wsRevision++;
      accountRestRecoveryRequired = true;
      accountRestError = `${kind} data gap requires an authoritative account refresh: ${cleanError(error)}`;
      publishSnapshot(accountStatusPatch());
      return;
    }
    if (kind === 'Mark-price' || kind === 'Mid-price') {
      publishSnapshot({ error: `${kind} stream failed; a fresh live quote is required before price-sensitive actions: ${cleanError(error)}` });
      return;
    }
    if (kind === 'Transport') {
      accountStreamHealth = { account: false, openOrders: false, orderUpdates: false, fills: false };
    } else if (kind === 'Account') accountStreamHealth.account = false;
    else if (kind === 'Open-order') accountStreamHealth.openOrders = false;
    else if (kind === 'Order-update') accountStreamHealth.orderUpdates = false;
    else if (kind === 'Fill') accountStreamHealth.fills = false;
    else return;
    wsRevision++;
    accountRestRecoveryRequired = true;
    accountSubscriptionError = kind === 'Transport'
      ? `Hyperliquid websocket transport disconnected: ${cleanError(error)}`
      : `${kind} websocket subscription failed: ${cleanError(error)}`;
    publishSnapshot(accountStatusPatch());
  };
  const subscriptions = await venue.connect({ network, principal }, onUpdate, onError);
  if (generation !== accountGeneration) {
    await venue.disconnect();
    return;
  }
  if (subscriptions.failedSubscriptions && !accountChannelsHealthy()) {
    accountSubscriptionError ??= `${subscriptions.failedSubscriptions} Hyperliquid account websocket subscription(s) failed`;
    publishSnapshot(accountStatusPatch());
  }
  reconcileTimer = setInterval(() => { if (generation === accountGeneration) void reconcile(); }, RECONCILE_MS);
  staleTimer = setInterval(() => {
    if (generation !== accountGeneration) return;
    const now = Date.now();
    if (snapshot.feedState === 'live' && (!snapshot.lastSnapshotAt || now - snapshot.lastSnapshotAt > RECONCILE_MS * 2)) {
      accountRestError = 'Authoritative account snapshot is overdue';
      publishSnapshot(accountStatusPatch());
    }
    if (snapshot.feedState === 'stale' && (!snapshot.lastSnapshotAt || now - snapshot.lastSnapshotAt > RECONCILE_MS)) void reconcile();
  }, 1_000);
  void reconcile();
}

function assertAgentAuthorized(address: string, rows: readonly TradingVenueAuthorization[]) {
  const normalized = normalizeAddress(address);
  const match = rows.find(item => normalizeAddress(item.address) === normalized);
  if (!match || match.validUntil !== null && match.validUntil <= Date.now()) {
    throw new Error('Agent key is not currently authorized by the selected principal; the key was not unlocked for signing');
  }
  return match;
}

function newBindingToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function lockSession(invalidate = true, releaseOwner = true) {
  if (invalidate) {
    signingGeneration++;
    invalidateCredentialOperations();
  }
  const epoch: CredentialEpoch = { ...captureAccountEpoch(), signingGeneration };
  adapter?.setSigningAccount(null); signer = null;
  const discardedSessionOnly = sessionOnly;
  sessionOnly = false;
  let info: VaultInfo = { address: null, exists: false, legacyNeedsBinding: false };
  if (!discardedSessionOnly && secureVaultAvailable()) {
    try { info = await getAgentVaultInfo(network, principal, vaultOperationContext(epoch)); }
    catch (error) { info.error = cleanError(error); }
  }
  if (!isCredentialEpochCurrent(epoch)) return;
  agentAddress = discardedSessionOnly ? null : info.address;
  publishSnapshot({ agentAddress, agentAuthorized: false, agentValidUntil: null });
  sendVaultState({ address: agentAddress, unlocked: false, exists: discardedSessionOnly ? false : info.exists,
    legacyNeedsBinding: discardedSessionOnly ? false : info.legacyNeedsBinding, releaseOwner,
    storageAvailable: vaultStorageAvailable ?? undefined, sessionOnly: false, sessionOnlyAvailable,
    error: discardedSessionOnly ? 'Session-only agent was discarded when locked; import or generate it again' : info.error });
}

async function prepareLegacyUnlock(passphrase: string, epoch: CredentialEpoch, venue: TradingVenueAdapter, user: string) {
  const context = vaultOperationContext(epoch);
  const legacy = await decryptLegacyAgentPrivateKey(passphrase, context);
  assertCredentialEpochCurrent(epoch);
  if (normalizeAddress(legacy.address) === user) throw new Error('Agent address must be different from the account principal');
  const authorizations = await venue.readAuthorizations();
  assertCredentialEpochCurrent(epoch);
  assertAgentAuthorized(legacy.address, authorizations);
  const prepared = await prepareLegacyAgentBinding(passphrase, legacy, epoch.network, user, context);
  assertCredentialEpochCurrent(epoch);
  const token = newBindingToken();
  pendingLegacyBinding = { token, epoch, address: legacy.address, legacy, prepared };
  return { legacyBindingRequired: true as const, token, network: epoch.network, principal: user, address: legacy.address };
}

async function unlockSession(passphrase: string) {
  const epoch = beginCredentialOperation();
  const context = vaultOperationContext(epoch);
  const venue = epoch.adapter;
  if (!venue) throw new Error('Connect an account before unlocking the agent');
  const user = enabledIdentity();
  const info = await getAgentVaultInfo(epoch.network, user, context);
  assertCredentialEpochCurrent(epoch);
  if (info.legacyNeedsBinding) return prepareLegacyUnlock(passphrase, epoch, venue, user);
  if (!info.address) throw new Error(info.error ?? 'No encrypted agent key is stored for the selected network and principal');
  const restored = await decryptScopedAgentPrivateKey(passphrase, epoch.network, user, context);
  assertCredentialEpochCurrent(epoch);
  if (normalizeAddress(restored.address) === user) throw new Error('Agent address must be different from the account principal');
  const authorizations = await venue.readAuthorizations();
  assertCredentialEpochCurrent(epoch);
  assertAgentAuthorized(restored.address, authorizations);
  const account = privateKeyToAccount(restored.privateKey);
  signer = account; agentAddress = account.address.toLowerCase();
  venue.setSigningAccount(account);
  applyAgents(authorizations);
  assertCredentialEpochCurrent(epoch);
  sendVaultState({ address: agentAddress, unlocked: true, exists: true, legacyNeedsBinding: false });
  lastUserActivityAt = Date.now();
  return { address: agentAddress, authorized: true };
}

async function bindLegacyAgent(request: Extract<TradingWorkerRequest, { type: 'vault-bind-legacy' }>) {
  const pending = pendingLegacyBinding;
  if (!pending || pending.token !== request.token) throw new Error('Legacy key binding expired; unlock the unscoped key again');
  if (request.network !== pending.epoch.network || normalizeAddress(request.principal) !== normalizeAddress(pending.epoch.principal)) {
    throw new SessionInvalidatedError('Selected trading account changed before legacy key binding; no record was moved');
  }
  try {
    assertCredentialEpochCurrent(pending.epoch);
    const venue = pending.epoch.adapter;
    if (!venue) throw new SessionInvalidatedError('Trading account disconnected before legacy key binding');
    const authorizations = await venue.readAuthorizations();
    assertCredentialEpochCurrent(pending.epoch);
    assertAgentAuthorized(pending.address, authorizations);
    await commitLegacyAgentBinding(pending.legacy.sourceRecord, pending.prepared, vaultOperationContext(pending.epoch));
    assertCredentialEpochCurrent(pending.epoch);
    if (pendingLegacyBinding !== pending) throw new SessionInvalidatedError('Legacy key binding was canceled; no signer was activated');
    const account = privateKeyToAccount(pending.legacy.privateKey);
    signer = account; agentAddress = pending.address; sessionOnly = false;
    venue.setSigningAccount(account);
    applyAgents(authorizations);
    assertCredentialEpochCurrent(pending.epoch);
    pendingLegacyBinding = null;
    sendVaultState({ address: agentAddress, unlocked: true, exists: true, legacyNeedsBinding: false, releaseOwner: false });
    lastUserActivityAt = Date.now();
    return { address: agentAddress, authorized: snapshot.agentAuthorized, bound: true };
  } catch (error) {
    if (pendingLegacyBinding === pending) pendingLegacyBinding = null;
    throw error;
  }
}

function cancelLegacyBinding(token: string) {
  const pending = pendingLegacyBinding;
  if (!pending) return true;
  if (pending.token !== token) throw new Error('Legacy key binding token does not match the pending confirmation');
  signingGeneration++;
  invalidateCredentialOperations();
  signer = null; agentAddress = null;
  pending.epoch.adapter?.setSigningAccount(null);
  publishSnapshot({ agentAddress: null, agentAuthorized: false, agentValidUntil: null });
  sendVaultState({ address: null, unlocked: false, exists: true, legacyNeedsBinding: true, releaseOwner: false });
  return true;
}

async function activateSessionAgent(privateKey: `0x${string}`) {
  if (!secureSigningAvailable()) throw new Error('Session-only signing requires Web Crypto, secure randomness, and a secure browser context');
  if (vaultStorageAvailable !== false || !sessionOnlyAvailable) throw new Error('Session-only agent mode is available only when encrypted browser storage is unavailable');
  const epoch = beginCredentialOperation();
  const user = enabledIdentity();
  const venue = epoch.adapter;
  if (!venue) throw new Error('Connect an account before creating a session-only agent');
  assertCredentialEpochCurrent(epoch);
  const account = privateKeyToAccount(privateKey);
  if (normalizeAddress(account.address) === user) throw new Error('Agent address must be different from the account principal');
  const authorizations = await venue.readAuthorizations();
  assertCredentialEpochCurrent(epoch);
  assertAgentAuthorized(account.address, authorizations);
  signer = account; agentAddress = account.address.toLowerCase(); sessionOnly = true;
  venue.setSigningAccount(account);
  applyAgents(authorizations);
  assertCredentialEpochCurrent(epoch);
  lastUserActivityAt = Date.now();
  sendVaultState({ address: agentAddress, unlocked: true, exists: true, legacyNeedsBinding: false, storageAvailable: false, sessionOnly: true,
    error: undefined });
  return { address: agentAddress, authorized: true, sessionOnly: true };
}

function safeAttempt(attempt: OrderAttempt) {
  const stored = { ...attempt };
  attempts.set(stored.cloid.toLowerCase(), stored);
  if (isTerminalPartialIoc(stored) && stored.exchangeId !== null) {
    recentUpdates.delete(stored.exchangeId);
    if (snapshot.orders.some(order => order.id === stored.exchangeId)) {
      publishSnapshot({ orders: snapshot.orders.filter(order => order.id !== stored.exchangeId) });
    }
  }
  send({ type: 'attempt', attempt: stored });
}
function responseStatus(response: TradingVenueOrderResult, requestedSize: string, tif: OrderIntent['tif']): Pick<OrderAttempt, 'phase' | 'exchangeId' | 'message' | 'filledSize' | 'remainingSize'> {
  const total = positiveDecimal(requestedSize);
  const filled = positiveDecimal(response.filledSize ?? '');
  if (response.outcome === 'rejected') return { phase: 'rejected', exchangeId: response.orderId, filledSize: '0', remainingSize: requestedSize, message: response.message };
  if (response.outcome === 'triggering') return { phase: 'triggering', exchangeId: response.orderId, filledSize: '0', remainingSize: requestedSize, message: response.message };
  if (response.outcome === 'unknown') return { phase: 'unknown', exchangeId: response.orderId, filledSize: '0', remainingSize: requestedSize, message: response.message };
  if (response.orderId !== null && filled && total && filled.gt(0) && filled.lt(total)) {
    const canceled = tif === 'Ioc' && response.outcome === 'filled';
    const remaining = canceled ? '0' : Decimal.max(total.minus(filled), 0).toString();
    return { phase: 'partiallyFilled', exchangeId: response.orderId, filledSize: filled.toString(), remainingSize: remaining,
      message: canceled ? `Partially filled ${filled.toString()} of ${requestedSize} BTC; ${total.minus(filled).toString()} BTC IOC remainder was canceled`
        : `Partially filled ${filled.toString()} of ${requestedSize} BTC; remainder is resting` };
  }
  if (response.outcome === 'resting' && response.orderId !== null) {
    return { phase: 'resting', exchangeId: response.orderId, filledSize: '0', remainingSize: requestedSize, message: response.message };
  }
  if (response.outcome === 'filled') return { phase: 'filled', exchangeId: response.orderId, filledSize: filled?.toString() ?? requestedSize, remainingSize: '0', message: response.message };
  return { phase: 'unknown', exchangeId: response.orderId, filledSize: filled?.toString() ?? '0', remainingSize: requestedSize, message: response.message };
}
async function authorizeBeforeMutation() {
  assertMutationAccountReady();
  const session = captureSigningSession();
  const expected = enabledIdentity();
  if (expected === session.agentAddress) throw new Error('Agent and principal addresses must differ');
  let authorized: boolean;
  try { authorized = await refreshAgentAuthority(session); }
  catch (error) {
    if (!isAccountEpochCurrent(session)) {
      throw new SessionInvalidatedError('Selected trading account changed while checking authorization; action was not signed');
    }
    throw error;
  }
  assertSigningSessionCurrent(session);
  assertMutationAccountReady();
  if (!authorized) throw new Error('This agent is not currently authorized by the selected principal on this network');
  return session;
}

async function submitOrder(request: Extract<TradingWorkerRequest, { type: 'submit-order' }>) {
  const releaseCloid = reserveOrderCloid(request.intent?.cloid);
  try { return await submitReservedOrder(request); }
  finally { releaseCloid(); }
}

async function submitReservedOrder(request: Extract<TradingWorkerRequest, { type: 'submit-order' }>) {
  const session = await authorizeBeforeMutation();
  assertSigningSessionCurrent(session);
  if (snapshot.btcAsset === null || snapshot.szDecimals === null) throw new Error('BTC perpetual metadata is not available');
  const { intent } = request;
  if (!/^0x[0-9a-f]{32}$/.test(intent.cloid)) throw new Error('Client order ID is invalid');
  const sizeError = validateSize(intent.size, snapshot.szDecimals); if (sizeError) throw new Error(sizeError);
  const kind = request.kind ?? (intent.tif === 'Ioc' ? 'market' : 'limit');
  let p = intent.price;
  let type: TradingVenueOrderType;
  let grouping: 'independent' | 'position-protection' = request.grouping === 'positionTpsl' ? 'position-protection' : 'independent';
  if (kind === 'market') {
    if (!snapshot.midPrice || snapshot.feedState !== 'live' || !isFreshMidPrice(snapshot)) throw new Error('Fresh live BTC mid price required for a protected market order');
    p = marketIocLimit(snapshot.midPrice, intent.side, request.slippageBps ?? 50, snapshot.szDecimals);
    type = { kind: 'limit', timeInForce: 'Ioc' };
  } else if (kind === 'takeProfit' || kind === 'stopLoss') {
    if (snapshot.feedState !== 'live' || !isFreshMarkPrice(snapshot)) throw new Error('Fresh live BTC mark price required for a trigger order');
    const triggerPrice = request.triggerPrice;
    if (!triggerPrice) throw new Error('Trigger price is required');
    const priceError = validatePrice(p, snapshot.szDecimals); if (priceError) throw new Error(priceError);
    const triggerError = validatePrice(triggerPrice, snapshot.szDecimals); if (triggerError) throw new Error(triggerError);
    if (!intent.reduceOnly) throw new Error('Take-profit and stop-loss orders must be reduce-only');
    type = { kind: 'trigger', trigger: kind, triggerPrice, execution: 'limit' };
    grouping = 'position-protection';
  } else {
    const priceError = validatePrice(p, snapshot.szDecimals); if (priceError) throw new Error(priceError);
    type = { kind: 'limit', timeInForce: kind === 'limit' ? 'Gtc' : intent.tif };
  }
  const notionalError = validateOrderNotional(intent.size, p); if (notionalError) throw new Error(notionalError);
  const position = positionForReduceOnly();
  if (intent.reduceOnly) {
    const reduceOnlyError = validateReduceOnlyOrder(intent.side, intent.size, position); if (reduceOnlyError) throw new Error(reduceOnlyError);
  } else if (position && intent.side === (position.side === 'long' ? 'sell' : 'buy')) {
    throw new Error(`This order would reduce or reverse the current ${position.side} BTC position; use an explicit reduce-only close, then review any new opposite-side order separately`);
  } else {
    const marginError = validateAvailableMargin(intent.size, p, snapshot.btcLeverage, snapshot.withdrawable); if (marginError) throw new Error(marginError);
  }
  if (kind === 'takeProfit' || kind === 'stopLoss') {
    const orientationError = validateTriggerOrientation(kind, intent.side, request.triggerPrice!, snapshot.markPrice);
    if (orientationError) throw new Error(orientationError);
  }
  const journal: OrderAttempt = {
    cloid: intent.cloid, network: session.network, principal: session.principal, intent: { ...intent, price: p }, phase: 'submitting',
    createdAt: Date.now(), updatedAt: Date.now(), exchangeId: null, filledSize: '0', remainingSize: intent.size,
    message: 'Submitting once; reconciliation uses this client order ID',
  };
  safeAttempt(journal);
  try {
    const response = await session.adapter.placeOrder({
      instrument: 'BTC-PERP', instrumentId: snapshot.btcAsset, intent: { ...intent, price: p }, type, grouping,
    });
    const outcome = responseStatus(response, intent.size, intent.tif);
    const completed = { ...journal, ...outcome, updatedAt: Date.now() };
    safeAttempt(completed);
    void reconcile();
    return completed;
  } catch (error) {
    const unknown = { ...journal, phase: 'unknown' as const, updatedAt: Date.now(), message: `Submission outcome unknown. It will not be resent. Reconcile cloid ${intent.cloid}.` };
    safeAttempt(unknown);
    publishSnapshot({ error: cleanError(error) });
    return unknown;
  }
}

async function modifyOrder(request: Extract<TradingWorkerRequest, { type: 'modify-order' }>) {
  const session = await authorizeBeforeMutation();
  assertSigningSessionCurrent(session);
  if (snapshot.btcAsset === null || snapshot.szDecimals === null) throw new Error('BTC perpetual metadata is not available');
  const current = snapshot.orders.find(order => order.id === request.orderId);
  if (!current) throw new Error('Order is no longer in the current BTC open-order snapshot; refresh before modifying');
  assertOrderOperationAvailable(current);
  const sizeError = validateSize(request.size, snapshot.szDecimals); if (sizeError) throw new Error(sizeError);
  const priceError = validatePrice(request.price, snapshot.szDecimals); if (priceError) throw new Error(priceError);
  let type: TradingVenueOrderType;
  let price = request.price;
  if (current.trigger) {
    if (snapshot.feedState !== 'live' || !isFreshMarkPrice(snapshot)) throw new Error('Fresh live BTC mark price required to modify a trigger order');
    if (current.kind !== 'takeProfit' && current.kind !== 'stopLoss') throw new Error('This trigger order type cannot be modified safely');
    const reduceError = validateReduceOnlyOrder(current.side, request.size, positionForReduceOnly()); if (reduceError) throw new Error(reduceError);
    const orientationError = validateTriggerOrientation(current.kind, current.side, request.price, snapshot.markPrice); if (orientationError) throw new Error(orientationError);
    price = current.triggerMarket ? request.price : current.price;
    type = { kind: 'trigger', trigger: current.kind, triggerPrice: request.price, execution: current.triggerMarket ? 'market' : 'limit' };
  } else {
    if (current.reduceOnly) {
      const reduceError = validateReduceOnlyOrder(current.side, request.size, positionForReduceOnly()); if (reduceError) throw new Error(reduceError);
    } else {
      const position = positionForReduceOnly();
      if (position && current.side === (position.side === 'long' ? 'sell' : 'buy')) {
        throw new Error(`This modification would reduce or reverse the current ${position.side} BTC position; use an explicit reduce-only close`);
      }
      const reserved = positiveDecimal(current.size)?.mul(current.price).toString() ?? '0';
      const marginError = validateAvailableMargin(request.size, request.price, snapshot.btcLeverage, snapshot.withdrawable, reserved);
      if (marginError) throw new Error(marginError);
    }
    type = { kind: 'limit', timeInForce: 'Gtc' };
  }
  beginOrderOperation('modify', current, current.trigger ? request.price : request.price, request.size);
  try {
    const modified = await session.adapter.modifyOrder({
      instrument: 'BTC-PERP', instrumentId: snapshot.btcAsset, orderId: request.orderId, side: current.side,
      price, size: request.size, reduceOnly: current.reduceOnly, clientOrderId: current.cloid, type,
    });
    const operation = orderOperations.get(current.id);
    if (operation && modified.orderId !== null) publishOrderOperation({ ...operation, resolvedOrderId: modified.orderId, updatedAt: Date.now() });
    if (orderOperations.has(current.id)) updateOrderOperation(current.id, 'reconciling', 'Modification accepted; waiting for the canonical open-order snapshot to confirm the new terms');
    void reconcile(); return true;
  } catch (error) {
    if (error instanceof TradingVenueRejectedError) {
      updateOrderOperation(current.id, 'rejected', error.message);
      throw error;
    }
    updateOrderOperation(current.id, 'unknown', 'Modification outcome is uncertain; it was not resent. Refresh and wait for canonical order reconciliation before retrying.');
    publishSnapshot({ error: `Modify outcome unknown; it was not resent. Refresh the live order snapshot. ${cleanError(error)}`, feedState: 'stale' });
    void reconcile();
    throw new Error('Modify outcome is unknown; the action was not resent. Refresh order status before retrying.');
  }
}

async function cancelOrder(request: Extract<TradingWorkerRequest, { type: 'cancel-order' }>) {
  const session = await authorizeBeforeMutation();
  assertSigningSessionCurrent(session);
  if (snapshot.btcAsset === null) throw new Error('BTC perpetual metadata is not available');
  const current = snapshot.orders.find(order => order.id === request.orderId);
  if (!current) throw new Error('Order is no longer in the current BTC open-order snapshot; refresh before canceling');
  assertOrderOperationAvailable(current);
  beginOrderOperation('cancel', current);
  try {
    await session.adapter.cancelOrder(snapshot.btcAsset, request.orderId);
    if (orderOperations.has(current.id)) updateOrderOperation(current.id, 'reconciling', 'Cancellation accepted; waiting for a canonical order or fill update');
    void reconcile();
  }
  catch (error) {
    if (error instanceof TradingVenueRejectedError) {
      updateOrderOperation(current.id, 'rejected', error.message);
      throw error;
    }
    updateOrderOperation(current.id, 'unknown', 'Cancellation outcome is uncertain; it was not resent. Refresh and wait for canonical order reconciliation before retrying.');
    publishSnapshot({ error: `Cancel outcome unknown; it was not resent. Refresh the live order snapshot. ${cleanError(error)}`, feedState: 'stale' });
    void reconcile();
    throw new Error('Cancel outcome is unknown; the action was not resent. Refresh order status before retrying.');
  }
  return true;
}

async function setLeverage(request: Extract<TradingWorkerRequest, { type: 'set-leverage' }>) {
  const session = await authorizeBeforeMutation();
  assertSigningSessionCurrent(session);
  if (snapshot.btcAsset === null) throw new Error('BTC perpetual metadata is not available');
  const leverageError = validateLeverage(request.leverage, snapshot.btcMaxLeverage); if (leverageError) throw new Error(leverageError);
  try {
    await session.adapter.setLeverage(snapshot.btcAsset, request.leverage, request.isCross ? 'cross' : 'isolated');
    void reconcile();
    return true;
  } catch (error) {
    if (error instanceof TradingVenueRejectedError) {
      publishSnapshot({ error: error.message });
      throw error;
    }
    publishSnapshot({ error: `Leverage update outcome is unknown; refresh the account before retrying. ${cleanError(error)}`, feedState: 'stale' });
    void reconcile();
    throw new Error('Leverage update outcome is unknown; refresh the account before retrying.');
  }
}

async function resolveAttempt(cloid: string) {
  const user = enabledIdentity();
  const attempt = attempts.get(cloid.toLowerCase());
  if (!attempt) throw new Error('No local order attempt exists for this client order ID');
  if (attempt.network !== network || normalizeAddress(attempt.principal) !== user) throw new Error('Order attempt belongs to a different network or principal');
  const current = snapshot.orders.find(order => order.cloid?.toLowerCase() === cloid.toLowerCase()
    || attempt.exchangeId !== null && order.id === attempt.exchangeId);
  if (current) { syncAttemptFromOrder(current); return attempts.get(cloid.toLowerCase()) ?? attempt; }
  const venue = adapter;
  if (!venue) throw new Error('Connect an account before checking order status');
  const result = await venue.readOrderStatus(cloid);
  const statusText = result.status;
  const order = result.order;
  if (order) syncAttemptFromOrder(order);
  const latest = attempts.get(cloid.toLowerCase()) ?? attempt;
  let updated = order ? latest : reconcileOrderAttempt(latest, [], statusText);
  if (statusText === 'unknown') {
    updated = { ...latest, updatedAt: Date.now(), message: latest.phase === 'partiallyFilled'
      ? `Observed ${latest.filledSize ?? 'some'} BTC filled; exchange status is still unknown and will not be resent`
      : 'No exchange status yet; request remains unknown and will not be resent' };
  }
  safeAttempt(updated);
  return updated;
}

async function vaultInfo(id: number) {
  const epoch = captureCredentialEpoch();
  if (!secureSigningAvailable()) {
    vaultStorageAvailable = null;
    sessionOnlyAvailable = false;
    const error = 'Agent signing is unavailable because Web Crypto, secure randomness, and a secure browser context are required';
    sendVaultState({ address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer,
      legacyNeedsBinding: false, storageAvailable: null, sessionOnlyAvailable: false, sessionOnly, error });
    result(id, { address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: null, sessionOnlyAvailable: false });
    return;
  }
  if (!secureVaultAvailable()) {
    vaultStorageAvailable = false;
    sessionOnlyAvailable = true;
    const error = 'Encrypted IndexedDB storage is unavailable; a dedicated session-only agent can stay in this tab';
    sendVaultState({ address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer,
      legacyNeedsBinding: false, storageAvailable: false, sessionOnlyAvailable: true, sessionOnly, error });
    result(id, { address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: false, sessionOnlyAvailable: true });
    return;
  }
  try {
    const info = await getAgentVaultInfo(epoch.network, epoch.principal, vaultOperationContext(epoch));
    assertCredentialEpochCurrent(epoch);
    if (!signer) agentAddress = info.address;
    vaultStorageAvailable = true;
    sessionOnlyAvailable = false;
    sendVaultState({ address: sessionOnly ? agentAddress : info.address, exists: sessionOnly || info.exists, unlocked: !!signer,
      legacyNeedsBinding: !sessionOnly && info.legacyNeedsBinding, storageAvailable: true, sessionOnlyAvailable: false,
      sessionOnly: false, error: info.error });
    result(id, { ...info, address: sessionOnly ? agentAddress : info.address, unlocked: !!signer, storageAvailable: true, sessionOnlyAvailable: false });
  } catch (error) {
    if (error instanceof SessionInvalidatedError) { result(id, undefined, error); return; }
    vaultStorageAvailable = false;
    sessionOnlyAvailable = true;
    const message = `Encrypted IndexedDB storage is unavailable; session-only mode is available. ${cleanError(error)}`;
    sendVaultState({ address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer,
      legacyNeedsBinding: false, storageAvailable: false, sessionOnlyAvailable: true, sessionOnly, error: message });
    result(id, { address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: false, sessionOnlyAvailable: true });
  }
}
async function handle(message: TradingWorkerRequest) {
  if (pendingLegacyBinding && !['vault-bind-legacy', 'vault-cancel-legacy-binding', 'vault-lock', 'vault-info', 'activity', 'dispose'].includes(message.type)) {
    cancelLegacyBinding(pendingLegacyBinding.token);
  }
  switch (message.type) {
    case 'configure':
      try {
        selectFixtureMode(message.fixtureMode);
        await configure(message.network, message.principal, message.inactivityMinutes);
        for (const attempt of message.attempts ?? []) {
          if (attempt.network !== network || normalizeAddress(attempt.principal) !== normalizeAddress(principal)
            || !/^0x[0-9a-f]{32}$/.test(attempt.cloid) || attempt.intent?.cloid?.toLowerCase() !== attempt.cloid.toLowerCase()) continue;
          const restored = attempt.phase === 'submitting'
            ? { ...attempt, phase: 'unknown' as const, updatedAt: Date.now(), message: 'The previous browser session ended during submission. Check this client order ID; do not resubmit.' }
            : attempt;
          safeAttempt(restored);
        }
        result(message.id, snapshot);
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'set-inactivity-timeout':
      if (!Number.isInteger(message.minutes) || message.minutes < MIN_INACTIVITY_MINUTES || message.minutes > MAX_INACTIVITY_MINUTES) {
        result(message.id, undefined, `Lock timeout must be ${MIN_INACTIVITY_MINUTES}–${MAX_INACTIVITY_MINUTES} minutes`); return;
      }
      inactivityMinutes = message.minutes; lastUserActivityAt = Date.now(); result(message.id, inactivityMinutes); return;
    case 'refresh': void reconcile(); result(message.id, true); return;
    case 'vault-info': await vaultInfo(message.id); return;
    case 'vault-generate':
      if (rejectFixtureExecution(message.id)) return;
      try {
        const epoch = beginCredentialOperation();
        const context = vaultOperationContext(epoch);
        if (!secureVaultAvailable()) throw new Error('Encrypted agent creation requires IndexedDB, Web Crypto, secure randomness, and a secure browser context');
        const info = await getAgentVaultInfo(epoch.network, epoch.principal, context);
        if (info.exists) throw new Error(info.legacyNeedsBinding
          ? 'An unscoped legacy key exists; bind it to an explicitly confirmed account or use Forget Device before creating a new key'
          : 'An encrypted agent already exists for this network and principal; remove it before replacing the key');
        assertCredentialEpochCurrent(epoch);
        const key = generatePrivateKey();
        const saved = await encryptAgentPrivateKey(key, message.passphrase, epoch.network, enabledIdentity(), context);
        assertCredentialEpochCurrent(epoch);
        agentAddress = saved.address; sessionOnlyAvailable = false;
        sendVaultState({ address: agentAddress, unlocked: false, exists: true, legacyNeedsBinding: false, storageAvailable: true, sessionOnlyAvailable: false }); result(message.id, saved);
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-import':
      if (rejectFixtureExecution(message.id)) return;
      try {
        const epoch = beginCredentialOperation();
        const context = vaultOperationContext(epoch);
        if (!secureVaultAvailable()) throw new Error('Encrypted agent import requires IndexedDB, Web Crypto, secure randomness, and a secure browser context');
        const info = await getAgentVaultInfo(epoch.network, epoch.principal, context);
        if (info.exists) throw new Error(info.legacyNeedsBinding
          ? 'An unscoped legacy key exists; bind it to an explicitly confirmed account or use Forget Device before importing a new key'
          : 'An encrypted agent already exists for this network and principal; remove it before replacing the key');
        assertCredentialEpochCurrent(epoch);
        if (!/^0x[0-9a-fA-F]{64}$/.test(message.privateKey)) throw new Error('Agent private key must be a 32-byte 0x-prefixed hex value');
        const agent = privateKeyToAccount(message.privateKey as `0x${string}`);
        if (normalizeAddress(agent.address) === enabledIdentity()) throw new Error('Agent address must be different from the account principal');
        const saved = await encryptAgentPrivateKey(message.privateKey as `0x${string}`, message.passphrase, epoch.network, enabledIdentity(), context);
        assertCredentialEpochCurrent(epoch);
        agentAddress = saved.address; sessionOnlyAvailable = false;
        sendVaultState({ address: agentAddress, unlocked: false, exists: true, legacyNeedsBinding: false, storageAvailable: true, sessionOnlyAvailable: false }); result(message.id, saved);
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-session-generate':
      if (rejectFixtureExecution(message.id)) return;
      try {
        if (!sessionOnlyAvailable || vaultStorageAvailable !== false) throw new Error('Session-only mode is available only when encrypted IndexedDB storage is unavailable and secure signing is available');
        result(message.id, await activateSessionAgent(generatePrivateKey()));
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-session-import':
      if (rejectFixtureExecution(message.id)) return;
      try {
        if (!sessionOnlyAvailable || vaultStorageAvailable !== false) throw new Error('Session-only mode is available only when encrypted IndexedDB storage is unavailable and secure signing is available');
        if (!/^0x[0-9a-fA-F]{64}$/.test(message.privateKey)) throw new Error('Agent private key must be a 32-byte 0x-prefixed hex value');
        result(message.id, await activateSessionAgent(message.privateKey as `0x${string}`));
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-unlock':
      if (rejectFixtureExecution(message.id)) return;
      try {
        if (!secureSigningAvailable()) throw new Error('Agent signing is unavailable because Web Crypto, secure randomness, and a secure browser context are required');
        result(message.id, await unlockSession(message.passphrase));
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-bind-legacy':
      try { result(message.id, await bindLegacyAgent(message)); }
      catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-cancel-legacy-binding':
      try { result(message.id, cancelLegacyBinding(message.token)); }
      catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-lock':
      await lockSession(true, false); result(message.id, true); return;
    case 'vault-remove':
      try {
        if (!principal) throw new Error('Connect the account whose encrypted agent should be removed');
        await lockSession(true, false);
        const epoch = captureCredentialEpoch();
        await removeEncryptedAgent(network, principal, vaultOperationContext(epoch));
        assertCredentialEpochCurrent(epoch);
        agentAddress = null;
        publishSnapshot({ agentAddress: null, agentAuthorized: false, agentValidUntil: null });
        sendVaultState({ address: null, unlocked: false, exists: false, legacyNeedsBinding: false,
          storageAvailable: vaultStorageAvailable ?? undefined, sessionOnlyAvailable, sessionOnly: false, releaseOwner: true });
        result(message.id, true);
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-forget':
      try {
        await lockSession(true, false);
        const epoch = captureCredentialEpoch();
        await removeAllEncryptedAgents(vaultOperationContext(epoch));
        assertCredentialEpochCurrent(epoch);
        agentAddress = null; sessionOnly = false;
        publishSnapshot({ agentAddress: null, agentAuthorized: false, agentValidUntil: null });
        sendVaultState({ address: null, unlocked: false, exists: false, legacyNeedsBinding: false,
          storageAvailable: vaultStorageAvailable ?? undefined, sessionOnlyAvailable, sessionOnly: false, releaseOwner: true });
        result(message.id, true);
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'submit-order':
      if (rejectFixtureExecution(message.id)) return;
      enqueueMutation(message.id, () => submitOrder(message));
      return;
    case 'modify-order':
      if (rejectFixtureExecution(message.id)) return;
      enqueueMutation(message.id, () => modifyOrder(message));
      return;
    case 'cancel-order':
      if (rejectFixtureExecution(message.id)) return;
      enqueueMutation(message.id, () => cancelOrder(message));
      return;
    case 'set-leverage':
      if (rejectFixtureExecution(message.id)) return;
      enqueueMutation(message.id, () => setLeverage(message));
      return;
    case 'order-status':
      try {
        if (!attempts.has(message.cloid.toLowerCase()) && message.attempt) {
          const restored = message.attempt;
          if (restored.cloid.toLowerCase() !== message.cloid.toLowerCase() || restored.network !== network || normalizeAddress(restored.principal) !== normalizeAddress(principal)) {
            throw new Error('Restored order attempt belongs to a different client order ID, network, or principal');
          }
          safeAttempt(restored);
        }
        try { result(message.id, await resolveAttempt(message.cloid)); } catch (error) { result(message.id, undefined, error); }
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'activity': lastUserActivityAt = Date.now(); return;
    case 'dispose':
      clearInterval(idleTimer); await disconnect(); await lockSession(); self.close(); return;
  }
}

idleTimer = setInterval(() => {
  if (signer && Date.now() - lastUserActivityAt >= inactivityMinutes * 60_000) {
    void lockSession(); publishSnapshot({ error: `Agent locked after ${inactivityMinutes} minutes of inactivity` });
  }
}, 10_000);

self.onmessage = (event: MessageEvent<TradingWorkerRequest>) => { void handle(event.data); };
