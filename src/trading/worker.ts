import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import Decimal from 'decimal.js';
import {
  encryptedAgentAddress, encryptAgentPrivateKey, decryptAgentPrivateKey, removeEncryptedAgent,
  secureSigningAvailable, secureVaultAvailable,
} from './vault';
import { HyperliquidTradingAdapter } from './hyperliquid-adapter';
import {
  isEvmAddress, marketIocLimit, normalizeAddress, orderFilledSize, orderPhaseFromStatus, positiveDecimal, reconcileOrderAttempt, validateOrderNotional, validatePrice, validateSize,
  type OrderAttempt, type OrderIntent, type OrderPhase, type TradingNetwork, type TradingOrder, type TradingSnapshot,
} from './model';
import type { TradingWorkerEvent, TradingWorkerRequest } from './protocol';
import type {
  TradingVenueAccount, TradingVenueAdapter, TradingVenueAuthorization, TradingVenueMarketMetadata,
  TradingVenueOrderResult, TradingVenueOrderType, TradingVenueUpdate,
} from './venue-adapter';

const MAX_FILLS = 50;
const MAX_ORDER_UPDATES = 150;
const MAX_TRACKED_FILL_IDS = 2_000;
const RECONCILE_MS = 20_000;
const DEFAULT_INACTIVITY_MINUTES = 15;
const MIN_INACTIVITY_MINUTES = 1;
const MAX_INACTIVITY_MINUTES = 120;
const FIXTURE_EXECUTION_DISABLED = 'Agent key handling and exchange actions are disabled while diagnostic fixture mode is selected';
const emptySnapshot = (network: TradingNetwork = 'testnet', principal = ''): TradingSnapshot => ({
  network, principal, feedState: 'disconnected', lastMessageAt: 0, lastSnapshotAt: 0,
  accountValue: null, marginUsed: null, withdrawable: null, totalNotional: null,
  positions: [], orders: [], fills: [], midPrice: null, markPrice: null, szDecimals: null, btcAsset: null,
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
let sessionGeneration = 0;
let reconcileBusyGeneration: number | null = null;
let wsRevision = 0;
const attempts = new Map<string, OrderAttempt>();
const recentUpdates = new Map<number, TradingOrder>();
const seenFillIds = new Set<string>();
const fillTotals = new Map<number, Decimal>();

function send(event: TradingWorkerEvent) { self.postMessage(event); }
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
function applyClearinghouse(account: TradingVenueAccount) {
  publishSnapshot({
    positions: account.positions,
    accountValue: account.accountValue, marginUsed: account.marginUsed,
    withdrawable: account.withdrawable, totalNotional: account.totalNotional,
    feedState: 'live', lastMessageAt: Date.now(), error: null,
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
function applyOpenOrders(orders: readonly TradingOrder[], mergeLive = true) {
  const incoming = new Map<number, TradingOrder>();
  for (const order of orders) if (!isTerminalPartialIocOrder(order)) { incoming.set(order.id, order); syncAttemptFromOrder(order); }
  if (mergeLive) for (const [id, order] of recentUpdates) {
    const phase = order.status.toLowerCase();
    if (isTerminalPartialIocOrder(order)) incoming.delete(id);
    else if (['open', 'resting', 'working', 'waitingfortrigger'].includes(phase)) incoming.set(id, order);
    else incoming.delete(id);
  }
  publishSnapshot({ orders: [...incoming.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ORDER_UPDATES), lastMessageAt: Date.now() });
}
function applyOrderUpdates(orders: readonly TradingOrder[]) {
  for (const order of orders) {
    if (isTerminalPartialIocOrder(order)) { recentUpdates.delete(order.id); continue; }
    syncAttemptFromOrder(order);
    recentUpdates.set(order.id, order);
    while (recentUpdates.size > MAX_ORDER_UPDATES) recentUpdates.delete(recentUpdates.keys().next().value!);
  }
  const next = new Map(snapshot.orders.map(order => [order.id, order]));
  for (const [id, order] of recentUpdates) {
    const phase = order.status.toLowerCase();
    if (isTerminalPartialIocOrder(order)) next.delete(id);
    else if (['open', 'resting', 'working', 'waitingfortrigger'].includes(phase)) next.set(id, order);
    else next.delete(id);
  }
  publishSnapshot({ orders: [...next.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ORDER_UPDATES), feedState: 'live', lastMessageAt: Date.now() });
}
function applyFills(fills: readonly TradingSnapshot['fills'][number][], replace = false) {
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
  publishSnapshot({ fills: recentFills, feedState: 'live', lastMessageAt: Date.now() });
}
function applyMeta(metadata: TradingVenueMarketMetadata) {
  if (metadata.instrumentId === null) { publishSnapshot({ btcAsset: null, szDecimals: null, error: 'BTC perpetual metadata is unavailable on this network' }); return; }
  if (metadata.sizeDecimals === null) { publishSnapshot({ btcAsset: metadata.instrumentId, szDecimals: null, error: 'BTC perpetual size precision is invalid' }); return; }
  publishSnapshot({ btcAsset: metadata.instrumentId, szDecimals: metadata.sizeDecimals, error: null });
}
function applyAgents(rows: readonly TradingVenueAuthorization[]) {
  const address = agentAddress;
  const match = address ? rows.find(item => normalizeAddress(item.address) === address) : undefined;
  const expires = match?.validUntil ?? null;
  const authorized = !!match && (expires === null || expires > Date.now());
  publishSnapshot({ agentAddress: address, agentAuthorized: authorized, agentValidUntil: authorized ? expires : null });
}

async function disconnect() {
  clearInterval(reconcileTimer); clearInterval(staleTimer);
  reconcileTimer = undefined; staleTimer = undefined;
  const oldAdapter = adapter; adapter = null;
  if (oldAdapter) await oldAdapter.disconnect();
}
function enabledIdentity() {
  if (!isEvmAddress(principal)) throw new Error('Enter a valid principal (master or sub-account) address first');
  return normalizeAddress(principal);
}

interface SessionEpoch { generation: number; network: TradingNetwork; principal: string }
interface SigningSession extends SessionEpoch {
  signer: AgentSigner;
  adapter: TradingVenueAdapter;
  agentAddress: string;
}
function captureEpoch(): SessionEpoch { return { generation: sessionGeneration, network, principal }; }
function assertEpochCurrent(epoch: SessionEpoch) {
  if (epoch.generation !== sessionGeneration || epoch.network !== network || epoch.principal !== principal
    || snapshot.network !== epoch.network || snapshot.principal !== epoch.principal) {
    throw new Error('Selected trading account changed while checking authorization; action was not signed');
  }
}
function captureSigningSession(): SigningSession {
  if (!adapter || !signer || !agentAddress) throw new Error('Unlock an authorized agent wallet before trading');
  return { ...captureEpoch(), signer, adapter, agentAddress };
}
function assertSigningSessionCurrent(session: SigningSession) {
  assertEpochCurrent(session);
  if (session.signer !== signer || session.adapter !== adapter || session.agentAddress !== agentAddress) {
    throw new Error('Signing session was locked or changed while checking authorization; action was not signed');
  }
}
async function reconcile() {
  const epoch = captureEpoch();
  const venue = adapter;
  if (!venue || !principal || reconcileBusyGeneration === epoch.generation) return;
  reconcileBusyGeneration = epoch.generation;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = wsRevision;
      const [account, agents] = await Promise.all([
        venue.readSnapshot(), agentAddress ? venue.readAuthorizations() : Promise.resolve([]),
      ]);
      if (epoch.generation !== sessionGeneration) return;
      if (revision !== wsRevision && attempt < 2) continue;
      applyClearinghouse(account.account);
      applyMeta(account.market);
      applyOpenOrders(account.orders, false);
      applyFills(account.fills, true);
      if (agentAddress) applyAgents(agents);
      publishSnapshot({ lastSnapshotAt: Date.now(), feedState: snapshot.lastMessageAt && Date.now() - snapshot.lastMessageAt <= 5_000 ? 'live' : 'connecting', error: null });
      return;
    }
  } catch (error) {
    if (epoch.generation === sessionGeneration) {
      publishSnapshot({ error: `Account refresh failed: ${cleanError(error)}`, feedState: snapshot.lastSnapshotAt ? 'stale' : 'failed' });
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
  const generation = ++sessionGeneration;
  // Invalidate pending authorization checks before teardown can yield.
  signer = null;
  adapter?.setSigningAccount(null);
  publishSnapshot({ agentAuthorized: false, agentValidUntil: null });
  send({ type: 'vault-state', address: agentAddress, unlocked: false, exists: agentAddress !== null });
  await disconnect();
  if (generation !== sessionGeneration) return;
  await lockSession(false);
  if (generation !== sessionGeneration) return;
  network = nextNetwork; principal = isEvmAddress(nextPrincipal) ? normalizeAddress(nextPrincipal) : '';
  recentUpdates.clear(); seenFillIds.clear(); fillTotals.clear();
  wsRevision++;
  snapshot = emptySnapshot(network, principal);
  publishSnapshot();
  if (!principal) return;
  const venue = new HyperliquidTradingAdapter();
  adapter = venue;
  publishSnapshot({ feedState: 'connecting', error: null });
  const onUpdate = (update: TradingVenueUpdate) => {
    if (generation !== sessionGeneration) return;
    wsRevision++; snapshot.lastMessageAt = Date.now();
    if (update.type === 'account') applyClearinghouse(update.value);
    else if (update.type === 'open-orders') applyOpenOrders(update.value, false);
    else if (update.type === 'order-updates') applyOrderUpdates(update.value);
    else if (update.type === 'fills') applyFills(update.value, update.snapshot);
    else if (update.type === 'mid-price') publishSnapshot({ midPrice: update.value, feedState: 'live', lastMessageAt: Date.now(), error: null });
    else if (update.type === 'mark-price') publishSnapshot({ markPrice: update.value, feedState: 'live', lastMessageAt: Date.now(), error: null });
  };
  const onError = (kind: string, error: unknown) => {
    if (generation === sessionGeneration) publishSnapshot({
      feedState: 'stale', error: `${kind} websocket subscription failed: ${cleanError(error)}`,
    });
  };
  const subscriptions = await venue.connect({ network, principal }, onUpdate, onError);
  if (generation !== sessionGeneration) {
    await venue.disconnect();
    return;
  }
  if (subscriptions.failedSubscriptions) {
    publishSnapshot({ feedState: subscriptions.activeSubscriptions ? 'stale' : 'failed', error: `${subscriptions.failedSubscriptions} Hyperliquid account websocket subscription(s) failed` });
  }
  reconcileTimer = setInterval(() => { if (generation === sessionGeneration) void reconcile(); }, RECONCILE_MS);
  staleTimer = setInterval(() => {
    if (generation !== sessionGeneration) return;
    if (snapshot.feedState === 'live' && Date.now() - snapshot.lastMessageAt > 12_000) publishSnapshot({ feedState: 'stale', error: 'Hyperliquid websocket is quiet; waiting for the next update' });
    if (snapshot.feedState === 'stale' && Date.now() - snapshot.lastSnapshotAt > RECONCILE_MS) void reconcile();
  }, 1_000);
  void reconcile();
}

async function lockSession(invalidate = true) {
  const generation = invalidate ? ++sessionGeneration : sessionGeneration;
  adapter?.setSigningAccount(null); signer = null;
  const discardedSessionOnly = sessionOnly;
  sessionOnly = false;
  const address = discardedSessionOnly ? null : await encryptedAgentAddress().catch(() => null);
  if (generation !== sessionGeneration) return;
  agentAddress = address;
  publishSnapshot({ agentAddress, agentAuthorized: false, agentValidUntil: null });
  send({ type: 'vault-state', address: agentAddress, unlocked: false, exists: agentAddress !== null, storageAvailable: vaultStorageAvailable ?? undefined, sessionOnly: false, sessionOnlyAvailable,
    error: discardedSessionOnly ? 'Session-only agent was discarded when locked; import or generate it again' : undefined });
}

async function unlockSession(passphrase: string) {
  const epoch = captureEpoch();
  const venue = adapter;
  if (!venue) throw new Error('Connect an account before unlocking the agent');
  const user = enabledIdentity();
  const restored = await decryptAgentPrivateKey(passphrase);
  assertEpochCurrent(epoch);
  if (adapter !== venue) throw new Error('Trading account changed while unlocking the agent');
  if (normalizeAddress(restored.address) === user) throw new Error('Agent address must be different from the account principal');
  const account = privateKeyToAccount(restored.privateKey);
  signer = account; agentAddress = account.address.toLowerCase();
  venue.setSigningAccount(account);
  const session = captureSigningSession();
  await refreshAgentAuthority(session);
  assertSigningSessionCurrent(session);
  send({ type: 'vault-state', address: agentAddress, unlocked: true, exists: true });
  lastUserActivityAt = Date.now();
  return { address: agentAddress, authorized: snapshot.agentAuthorized };
}

async function activateSessionAgent(privateKey: `0x${string}`) {
  if (!secureSigningAvailable()) throw new Error('Session-only signing requires Web Crypto, secure randomness, and a secure browser context');
  if (vaultStorageAvailable !== false || !sessionOnlyAvailable) throw new Error('Session-only agent mode is available only when encrypted browser storage is unavailable');
  const epoch = captureEpoch();
  const user = enabledIdentity();
  const venue = adapter;
  if (!venue) throw new Error('Connect an account before creating a session-only agent');
  const account = privateKeyToAccount(privateKey);
  if (normalizeAddress(account.address) === user) throw new Error('Agent address must be different from the account principal');
  signer = account; agentAddress = account.address.toLowerCase(); sessionOnly = true;
  venue.setSigningAccount(account);
  const session = captureSigningSession();
  try {
    await refreshAgentAuthority(session);
    assertSigningSessionCurrent(session);
  } catch (error) {
    await lockSession();
    throw error;
  }
  lastUserActivityAt = Date.now();
  send({ type: 'vault-state', address: agentAddress, unlocked: true, exists: true, storageAvailable: false, sessionOnly: true,
    error: snapshot.agentAuthorized ? undefined : 'Session-only agent is not authorized by this principal yet' });
  return { address: agentAddress, authorized: snapshot.agentAuthorized, sessionOnly: true };
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
  const session = captureSigningSession();
  const expected = enabledIdentity();
  if (expected === session.agentAddress) throw new Error('Agent and principal addresses must differ');
  const authorized = await refreshAgentAuthority(session);
  assertSigningSessionCurrent(session);
  if (!authorized) throw new Error('This agent is not currently authorized by the selected principal on this network');
  return session;
}

async function submitOrder(request: Extract<TradingWorkerRequest, { type: 'submit-order' }>) {
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
    if (!snapshot.midPrice || snapshot.feedState !== 'live' || Date.now() - snapshot.lastMessageAt > 5_000) throw new Error('Fresh live BTC mid price required for a protected market order');
    p = marketIocLimit(snapshot.midPrice, intent.side, request.slippageBps ?? 50, snapshot.szDecimals);
    type = { kind: 'limit', timeInForce: 'Ioc' };
  } else if (kind === 'takeProfit' || kind === 'stopLoss') {
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
  const sizeError = validateSize(request.size, snapshot.szDecimals); if (sizeError) throw new Error(sizeError);
  const priceError = validatePrice(request.price, snapshot.szDecimals); if (priceError) throw new Error(priceError);
  let type: TradingVenueOrderType;
  let price = request.price;
  if (current.trigger) {
    if (current.kind !== 'takeProfit' && current.kind !== 'stopLoss') throw new Error('This trigger order type cannot be modified safely');
    price = current.triggerMarket ? request.price : current.price;
    type = { kind: 'trigger', trigger: current.kind, triggerPrice: request.price, execution: current.triggerMarket ? 'market' : 'limit' };
  } else type = { kind: 'limit', timeInForce: 'Gtc' };
  try {
    await session.adapter.modifyOrder({
      instrument: 'BTC-PERP', instrumentId: snapshot.btcAsset, orderId: request.orderId, side: current.side,
      price, size: request.size, reduceOnly: current.reduceOnly, clientOrderId: current.cloid, type,
    });
    void reconcile(); return true;
  } catch (error) {
    publishSnapshot({ error: `Modify outcome unknown; it was not resent. Refresh the live order snapshot. ${cleanError(error)}`, feedState: 'stale' });
    throw new Error('Modify outcome is unknown; the action was not resent. Refresh order status before retrying.');
  }
}

async function cancelOrder(request: Extract<TradingWorkerRequest, { type: 'cancel-order' }>) {
  const session = await authorizeBeforeMutation();
  assertSigningSessionCurrent(session);
  if (snapshot.btcAsset === null) throw new Error('BTC perpetual metadata is not available');
  if (!snapshot.orders.some(order => order.id === request.orderId)) throw new Error('Order is no longer in the current BTC open-order snapshot; refresh before canceling');
  try { await session.adapter.cancelOrder(snapshot.btcAsset, request.orderId); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('Hyperliquid rejected cancellation:')) throw error;
    publishSnapshot({ error: `Cancel outcome unknown; it was not resent. Refresh the live order snapshot. ${cleanError(error)}`, feedState: 'stale' });
    throw new Error('Cancel outcome is unknown; the action was not resent. Refresh order status before retrying.');
  }
  void reconcile(); return true;
}

async function setLeverage(request: Extract<TradingWorkerRequest, { type: 'set-leverage' }>) {
  const session = await authorizeBeforeMutation();
  assertSigningSessionCurrent(session);
  if (snapshot.btcAsset === null) throw new Error('BTC perpetual metadata is not available');
  if (!Number.isSafeInteger(request.leverage) || request.leverage < 1 || request.leverage > 100) {
    throw new Error('Leverage must be a whole number from 1 to 100');
  }
  try {
    await session.adapter.setLeverage(snapshot.btcAsset, request.leverage, request.isCross ? 'cross' : 'isolated');
    void reconcile();
    return true;
  } catch (error) {
    publishSnapshot({ error: `Leverage update outcome is unknown; refresh the account before retrying. ${cleanError(error)}`, feedState: 'stale' });
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
  if (!secureSigningAvailable()) {
    vaultStorageAvailable = null;
    sessionOnlyAvailable = false;
    const error = 'Agent signing is unavailable because Web Crypto, secure randomness, and a secure browser context are required';
    send({ type: 'vault-state', address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: null, sessionOnlyAvailable: false, sessionOnly, error });
    result(id, { address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: null, sessionOnlyAvailable: false });
    return;
  }
  if (!secureVaultAvailable()) {
    vaultStorageAvailable = false;
    sessionOnlyAvailable = true;
    const error = 'Encrypted IndexedDB storage is unavailable; a dedicated session-only agent can stay in this tab';
    send({ type: 'vault-state', address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: false, sessionOnlyAvailable: true, sessionOnly, error });
    result(id, { address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: false, sessionOnlyAvailable: true });
    return;
  }
  try {
    const address = await encryptedAgentAddress(); vaultStorageAvailable = true;
    sessionOnlyAvailable = false;
    send({ type: 'vault-state', address, exists: address !== null, unlocked: !!signer, storageAvailable: true, sessionOnlyAvailable: false, sessionOnly: false });
    result(id, { address, exists: address !== null, unlocked: !!signer, storageAvailable: true, sessionOnlyAvailable: false });
  } catch (error) {
    vaultStorageAvailable = false;
    sessionOnlyAvailable = true;
    const message = `Encrypted IndexedDB storage is unavailable; session-only mode is available. ${cleanError(error)}`;
    send({ type: 'vault-state', address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: false, sessionOnlyAvailable: true, sessionOnly, error: message });
    result(id, { address: sessionOnly ? agentAddress : null, exists: !!sessionOnly, unlocked: !!signer, storageAvailable: false, sessionOnlyAvailable: true });
  }
}
async function handle(message: TradingWorkerRequest) {
  switch (message.type) {
    case 'configure':
      try { selectFixtureMode(message.fixtureMode); await configure(message.network, message.principal, message.inactivityMinutes); result(message.id, snapshot); } catch (error) { result(message.id, undefined, error); }
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
        if (!secureVaultAvailable()) throw new Error('Encrypted agent creation requires IndexedDB, Web Crypto, secure randomness, and a secure browser context');
        if (await encryptedAgentAddress()) throw new Error('An encrypted agent already exists; remove it before replacing the key');
        const key = generatePrivateKey();
        const saved = await encryptAgentPrivateKey(key, message.passphrase);
        agentAddress = saved.address; sessionOnlyAvailable = false; send({ type: 'vault-state', address: agentAddress, unlocked: false, exists: true, storageAvailable: true, sessionOnlyAvailable: false }); result(message.id, saved);
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'vault-import':
      if (rejectFixtureExecution(message.id)) return;
      try {
        if (!secureVaultAvailable()) throw new Error('Encrypted agent import requires IndexedDB, Web Crypto, secure randomness, and a secure browser context');
        if (await encryptedAgentAddress()) throw new Error('An encrypted agent already exists; remove it before replacing the key');
        if (!/^0x[0-9a-fA-F]{64}$/.test(message.privateKey)) throw new Error('Agent private key must be a 32-byte 0x-prefixed hex value');
        const saved = await encryptAgentPrivateKey(message.privateKey as `0x${string}`, message.passphrase);
        agentAddress = saved.address; sessionOnlyAvailable = false; send({ type: 'vault-state', address: agentAddress, unlocked: false, exists: true, storageAvailable: true, sessionOnlyAvailable: false }); result(message.id, saved);
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
      } catch (error) { result(message.id, undefined, error); send({ type: 'vault-state', address: agentAddress, unlocked: false, exists: agentAddress !== null, storageAvailable: vaultStorageAvailable, sessionOnlyAvailable, error: cleanError(error) }); }
      return;
    case 'vault-lock':
      await lockSession(); result(message.id, true); return;
    case 'vault-remove':
      try {
        await lockSession(); await removeEncryptedAgent(); agentAddress = null;
        publishSnapshot({ agentAddress: null, agentAuthorized: false, agentValidUntil: null });
        send({ type: 'vault-state', address: null, unlocked: false, exists: false, storageAvailable: vaultStorageAvailable ?? undefined, sessionOnlyAvailable, sessionOnly: false });
        result(message.id, true);
      } catch (error) { result(message.id, undefined, error); }
      return;
    case 'submit-order':
      if (rejectFixtureExecution(message.id)) return;
      try { result(message.id, await submitOrder(message)); } catch (error) { result(message.id, undefined, error); }
      return;
    case 'modify-order':
      if (rejectFixtureExecution(message.id)) return;
      try { result(message.id, await modifyOrder(message)); } catch (error) { result(message.id, undefined, error); }
      return;
    case 'cancel-order':
      if (rejectFixtureExecution(message.id)) return;
      try { result(message.id, await cancelOrder(message)); } catch (error) { result(message.id, undefined, error); }
      return;
    case 'set-leverage':
      if (rejectFixtureExecution(message.id)) return;
      try { result(message.id, await setLeverage(message)); } catch (error) { result(message.id, undefined, error); }
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
