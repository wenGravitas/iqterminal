import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Decimal from 'decimal.js';
import { HttpTransport, InfoClient } from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';
import { HyperliquidTradingAdapter } from '../src/trading/hyperliquid-adapter.ts';
import { safePublicError, executionOptIn, assertTestnetEnvironment, buildAcceptancePlan } from './hyperliquid-testnet-acceptance-core.mjs';
import { runAcceptanceSequence } from './hyperliquid-testnet-acceptance-sequence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TESTNET_API_URL = 'https://api.hyperliquid-testnet.xyz';
const TESTNET_RPC_URL = 'https://rpc.hyperliquid-testnet.xyz';
const CONNECT_TIMEOUT_MS = 20_000;
const PREFLIGHT_TIMEOUT_MS = 90_000;

function pause(ms) { return new Promise(resolvePromise => setTimeout(resolvePromise, ms)); }

async function withPreflightDeadline(promise, label, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`${label} exceeded the bounded testnet preflight deadline.`);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded the bounded testnet preflight deadline.`)), remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(100);
  }
  throw new Error(`${label} was not confirmed within ${CONNECT_TIMEOUT_MS} ms.`);
}

function fixedTestnetInfoClient() {
  const transport = new HttpTransport({ isTestnet: true, apiUrl: TESTNET_API_URL, rpcUrl: TESTNET_RPC_URL, timeout: 15_000 });
  if (transport.isTestnet !== true || new URL(transport.apiUrl).href !== `${TESTNET_API_URL}/`) {
    throw new Error('The Info API transport did not resolve to the fixed Hyperliquid testnet endpoint.');
  }
  return new InfoClient({ transport });
}

async function run() {
  const preflightDeadline = Date.now() + PREFLIGHT_TIMEOUT_MS;
  const envFile = resolve(ROOT, '.env.development');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const optedIn = executionOptIn(process.argv.slice(2), process.env);
  assertTestnetEnvironment(process.env);

  let privateKey = process.env.HYPERLIQUID_API_PRIVATE_KEY;
  if (!privateKey || !/^0x[\da-f]{64}$/i.test(privateKey)) throw new Error('HYPERLIQUID_API_PRIVATE_KEY is missing or malformed; its value was not displayed.');
  let signingAccount;
  try { signingAccount = privateKeyToAccount(privateKey); } catch { throw new Error('The configured key is not a valid EVM signing key; its value was not displayed.'); }
  privateKey = '';
  delete process.env.HYPERLIQUID_API_PRIVATE_KEY;

  const agentAddress = signingAccount.address;
  const info = fixedTestnetInfoClient();
  console.log(JSON.stringify({ phase: 'testnet-read-only-preflight', stage: 'identity-and-agent-role', network: 'testnet' }));
  const role = await withPreflightDeadline(info.userRole({ user: agentAddress }), 'Testnet identity check', preflightDeadline);
  if (role.role !== 'agent' || !role.data?.user) {
    throw new Error(`The derived key has testnet role ${role.role}; only an authorized dedicated agent key is accepted. Principal/master keys are refused.`);
  }
  const principal = role.data.user.toLowerCase();
  console.log(JSON.stringify({ phase: 'testnet-read-only-preflight', stage: 'account-authorization-and-btc-market', network: 'testnet' }));
  const [authorizations, state, orders, frontendOrders, meta, mids, metaAndCtxs] = await withPreflightDeadline(Promise.all([
    info.extraAgents({ user: principal }), info.clearinghouseState({ user: principal, dex: '' }),
    info.openOrders({ user: principal, dex: '' }), info.frontendOpenOrders({ user: principal, dex: '' }),
    info.meta({ dex: '' }), info.allMids({ dex: '' }), info.metaAndAssetCtxs({ dex: '' }),
  ]), 'Testnet account and market checks', preflightDeadline);
  const authorization = authorizations.find(item => item.address.toLowerCase() === agentAddress.toLowerCase());
  if (!authorization || authorization.validUntil !== null && authorization.validUntil <= Date.now()) {
    throw new Error('The derived agent is not currently authorized for the resolved testnet principal.');
  }
  const positions = (state.assetPositions ?? []).map(row => row.position ?? row).filter(position => Number(position.szi ?? 0) !== 0);
  if (positions.length || orders.length || frontendOrders.length) {
    throw new Error('The account is not empty; the runner will not change pre-existing positions or orders.');
  }

  const btcIndex = meta.universe.findIndex(asset => asset.name === 'BTC');
  const contextIndex = metaAndCtxs[0]?.universe?.findIndex(asset => asset.name === 'BTC') ?? -1;
  if (btcIndex < 0 || contextIndex < 0 || meta.universe[btcIndex].szDecimals !== metaAndCtxs[0].universe[contextIndex].szDecimals) {
    throw new Error('Live testnet BTC metadata is missing or inconsistent.');
  }
  const btc = meta.universe[btcIndex];
  const markPrice = metaAndCtxs[1]?.[contextIndex]?.markPx;
  const midPrice = mids.BTC;
  const plan = buildAcceptancePlan({ markPrice, midPrice, szDecimals: btc.szDecimals });
  const accountValue = state.marginSummary?.accountValue;
  if (!accountValue || new Decimal(accountValue).lt('15')) throw new Error('The account value is below the runner’s $15 position cap.');

  const adapter = new HyperliquidTradingAdapter();
  let connected = false;
  const stream = { account: false, orders: false, mid: false, mark: false, errors: 0 };
  const onUpdate = update => {
    if (update.type === 'account') stream.account = true;
    if (update.type === 'open-orders') stream.orders = true;
    if (update.type === 'mid-price' && update.value) stream.mid = true;
    if (update.type === 'mark-price' && update.value) stream.mark = true;
  };
  const onFeedError = () => { stream.errors++; };
  try {
    console.log(JSON.stringify({ phase: 'testnet-read-only-preflight', stage: 'adapter-subscriptions', network: 'testnet' }));
    const subscription = await withPreflightDeadline(adapter.connect({ network: 'testnet', principal }, onUpdate, onFeedError), 'Testnet adapter connection', preflightDeadline);
    connected = true;
    await withPreflightDeadline(waitFor(() => stream.account && stream.orders && stream.mid && stream.mark && stream.errors === 0, 'testnet account/order/price subscriptions'), 'Testnet account/order/price streams', preflightDeadline);
    const snapshot = await withPreflightDeadline(adapter.readSnapshot(), 'Testnet adapter snapshot', preflightDeadline);
    const expectedInstrumentId = typeof btc.index === 'number' ? btc.index : btcIndex;
    if (!Number.isSafeInteger(expectedInstrumentId) || snapshot.market.instrumentId !== expectedInstrumentId || snapshot.market.sizeDecimals !== btc.szDecimals) {
      throw new Error('The trading adapter metadata differs from the live testnet BTC metadata.');
    }
    if (snapshot.account.positions.length || snapshot.orders.length) throw new Error('The account changed after read-only preflight; no order was sent.');

    const preflight = {
      network: 'testnet', agent: agentAddress, principal,
      authorization: { name: authorization.name, validUntil: authorization.validUntil === null ? null : new Date(authorization.validUntil).toISOString() },
      account: { accountValue, marginUsed: state.marginSummary?.totalMarginUsed ?? null, totalNotional: state.marginSummary?.totalNtlPos ?? null, positions: 0, openOrders: 0 },
      market: { markPrice, midPrice, sizeDecimals: btc.szDecimals, maxLeverage: btc.maxLeverage, instrumentId: snapshot.market.instrumentId },
      websocket: { activeSubscriptions: subscription.activeSubscriptions, account: stream.account, orders: stream.orders, mid: stream.mid, mark: stream.mark, errors: stream.errors },
      executionOptIn: optedIn,
      plan,
    };
    console.log(JSON.stringify({ phase: optedIn ? 'preflight-ready-for-testnet-execution' : 'read-only-dry-run', ...preflight }, null, 2));
    if (!optedIn) return;

    adapter.setSigningAccount(signingAccount);
    const result = await runAcceptanceSequence({ adapter, info, principal, agentAddress, instrumentId: snapshot.market.instrumentId,
      szDecimals: btc.szDecimals, markPrice, plan,
      onProgress: progress => console.log(JSON.stringify({ phase: 'testnet-acceptance-progress', ...progress })) });
    console.log(JSON.stringify({ phase: result.ok ? 'testnet-acceptance-complete' : 'testnet-acceptance-stopped', ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
    if (!result.ok || result.cleanupVerified !== true) return;

    await adapter.disconnect();
    connected = false;
    Object.assign(stream, { account: false, orders: false, mid: false, mark: false, errors: 0 });
    const reconnect = await adapter.connect({ network: 'testnet', principal }, onUpdate, onFeedError);
    connected = true;
    await waitFor(() => stream.account && stream.orders && stream.mid && stream.mark && stream.errors === 0, 'post-testnet account/order/price resubscription');
    const afterReconnect = await adapter.readSnapshot();
    const [remainingOrders, remainingFrontendOrders] = await Promise.all([
      info.openOrders({ user: principal, dex: '' }), info.frontendOpenOrders({ user: principal, dex: '' }),
    ]);
    const signedBtcPosition = afterReconnect.account.positions[0]
      ? (afterReconnect.account.positions[0].side === 'long' ? afterReconnect.account.positions[0].size : `-${afterReconnect.account.positions[0].size}`) : '0';
    const reconnectResult = { activeSubscriptions: reconnect.activeSubscriptions, failedSubscriptions: reconnect.failedSubscriptions,
      stream, signedBtcPosition, btcOrders: afterReconnect.orders.length, accountOpenOrders: remainingOrders.length, frontendOpenOrders: remainingFrontendOrders.length };
    console.log(JSON.stringify({ phase: 'testnet-adapter-reconnect', ...reconnectResult }, null, 2));
    if (reconnect.failedSubscriptions || signedBtcPosition !== '0' || afterReconnect.orders.length || remainingOrders.length || remainingFrontendOrders.length) process.exitCode = 1;
  } finally {
    // Disconnect even if connect timed out; this invalidates its generation and cancels late results.
    await adapter.disconnect();
    adapter.setSigningAccount(null);
  }
}

run().catch(error => {
  console.error(JSON.stringify({ phase: 'testnet-acceptance-stopped-before-or-during-preflight', error: safePublicError(error) }, null, 2));
  process.exitCode = 1;
});
