/** Local acceptance service only. No production endpoint, custody API or background copier. */
import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { privateKeyToAccount } from 'viem/accounts';
import Decimal from 'decimal.js';
import { validateRegistry } from '../../src/trading/foundation/accounts.ts';
import { accountScope } from '../../src/trading/foundation/domain.ts';
import { HyperliquidTestnetAdapter, LighterTestnetAdapter, PreDispatchRejectedError } from '../../src/trading/foundation/testnet-adapters.ts';
import { previewAllocation } from '../../src/trading/foundation/risk.ts';

export function validateConfiguration(configuration) {
  const registry = validateRegistry({ version: 1, accounts: configuration.accounts, groups: [], selectedId: null });
  if (!registry.accounts.length || registry.accounts.some(a => a.environment !== 'testnet' || a.mode !== 'read-only')) throw Error('Only explicitly allowlisted real testnet accounts are accepted');
  for (const account of registry.accounts) if (!/^[A-Z][A-Z0-9_]{0,100}$/.test(configuration.credentialEnvs?.[account.id] ?? '')) throw Error('Each testnet account requires a credential environment variable name');
  return { ...configuration, accounts: registry.accounts };
}
export function authorizeRequest(request, token, origin, host) {
  if (request.headers.host !== host || request.headers.origin !== origin) return false;
  const supplied = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function clientOrderId(venue, id) {
  const hash = createHash('sha256').update(id).digest('hex');
  return venue === 'hyperliquid' ? `0x${hash.slice(0, 32)}` : BigInt(`0x${hash.slice(0, 12)}`).toString();
}
export async function atomicWriteLedger(ledgerPath, ledger, io = { open, rename }) {
  const temporary = `${ledgerPath}.tmp`, f = await io.open(temporary, 'w', 0o600);
  try { await f.writeFile(JSON.stringify(ledger)); await f.sync(); } finally { await f.close(); }
  await io.rename(temporary, ledgerPath);
  const directory = await io.open(dirname(ledgerPath), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
export function validateLedger(ledger, accounts) {
  if (!ledger || ledger.version !== 1 || !ledger.intents || typeof ledger.intents !== 'object' || Array.isArray(ledger.intents)
    || Object.keys(ledger.intents).length > 10_000) throw Error('Invalid durable intent ledger');
  const identifier = /^[\w:-]{1,100}$/, decimal = /^(?:\d+\.?\d*|\.\d+)$/;
  for (const [id, record] of Object.entries(ledger.intents)) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || !identifier.test(id) || record.intentId !== id
      || typeof record.accountId !== 'string' || !/^[\w-]{1,80}$/.test(record.accountId)
      || typeof record.scope !== 'string' || !/^(?:hyperliquid:testnet:0x[\da-f]{40}|lighter:testnet:\d+)$/.test(record.scope)
      || record.environment !== 'testnet' || !['place', 'modify', 'cancel'].includes(record.operation)
      || !['acknowledged', 'rejected', 'unknown'].includes(record.status) || !/^[\da-f]{64}$/.test(record.signature)
      || !['BTC', 'ETH'].includes(record.base) || !Number.isFinite(record.createdAt) || record.createdAt < 0
      || record.planId !== null && (typeof record.planId !== 'string' || !identifier.test(record.planId))
      || record.clientOrderId !== null && !(record.scope.startsWith('hyperliquid:') ? /^0x[\da-f]{32}$/.test(record.clientOrderId) : /^\d{1,15}$/.test(record.clientOrderId) && BigInt(record.clientOrderId) <= 281474976710655n)) throw Error('Invalid durable intent record');
    for (const name of ['risk', 'margin', 'notional', 'authorizedRisk']) if (record[name] !== null && (typeof record[name] !== 'string' || record[name].length > 64 || !decimal.test(record[name]) || !new Decimal(record[name]).isFinite())) throw Error('Invalid durable risk reservation');
    if (['risk', 'margin', 'notional'].some(name => record[name] === null) && !['risk', 'margin', 'notional'].every(name => record[name] === null)) throw Error('Incomplete durable risk reservation');
    if (record.reservationRootId !== null) {
      const root = ledger.intents[record.reservationRootId];
      if (!root || root.intentId === id || root.scope !== record.scope || root.base !== record.base || root.reservationRootId !== null) throw Error('Invalid durable replacement reservation');
    }
    const current = accounts.find(a => a.id === record.accountId);
    if (current && accountScope(current) !== record.scope) throw Error('Stored account ID cannot be repointed to another execution identity');
  }
  return ledger;
}
export function lighterChildEnvironment(account, key, source = process.env) {
  const i = account.identity;
  // Only platform configuration is inherited; credential environment names are user-defined.
  const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR'].filter(name => typeof source[name] === 'string').map(name => [name, source[name]]));
  Object.assign(env, { IQ_LIGHTER_ACCOUNT_INDEX: String(i.accountIndex), IQ_LIGHTER_API_KEY_INDEX: String(i.apiKeyIndex), IQ_LIGHTER_API_PRIVATE_KEY: key });
  return env;
}
function lighterBridge(account, key, python) {
  const env = lighterChildEnvironment(account, key);
  const child = spawn(python, [fileURLToPath(new URL('./lighter-signing-worker.py', import.meta.url))], { env, stdio: ['pipe', 'pipe', 'ignore'] });
  let pending = null, dead = false, lane = Promise.resolve();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const p = pending; pending = null; if (!p) return; clearTimeout(p.timer); try { const result = JSON.parse(line); if (result.unknown) p.reject(Error('Signer outcome unknown')); else p.resolve(result); } catch { p.reject(Error('Invalid signer response')); } });
  const fail = () => { dead = true; if (pending) { clearTimeout(pending.timer); pending.reject(Error('Signer disconnected; outcome unknown')); pending = null; } };
  child.on('error', fail); child.on('exit', fail);
  const send = command => {
    const next = lane.catch(() => {}).then(() => new Promise((resolve, reject) => {
      if (dead) { reject(Error('Signer unavailable')); return; }
      if (command.operation !== 'orders' && command.operation !== 'history' && command.operation !== 'cancel' && (!Number.isFinite(command.expiresAt) || command.expiresAt <= Date.now())) { reject(new PreDispatchRejectedError('Plan expired in signer queue')); return; }
      const timer = setTimeout(() => { pending = null; child.kill(); dead = true; reject(Error('Signer timed out; outcome unknown')); }, 20_000);
      pending = { resolve, reject, timer }; child.stdin.write(`${JSON.stringify(command)}\n`);
    })); lane = next; return next;
  };
  return { send, close: () => { lines.close(); child.stdin.end(); child.kill(); } };
}
export async function createTestnetService({ configuration, token, origin = 'http://127.0.0.1:4173', port = 8789, ledgerPath, adapterFactory, python = process.env.IQ_LIGHTER_PYTHON ?? 'python3' }) {
  configuration = validateConfiguration(configuration);
  if (typeof token !== 'string' || token.length < 32 || token.length > 512) throw Error('Use a random service token of at least 32 characters');
  const originURL = new URL(origin);
  if (originURL.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(originURL.hostname) || originURL.origin !== origin) throw Error('Testnet service origin must be one exact loopback HTTP origin');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Invalid loopback service port');
  if (!ledgerPath) throw Error('A private durable intent ledger path is required');
  if (!adapterFactory) for (const account of configuration.accounts) if (!process.env[configuration.credentialEnvs[account.id]]) throw Error(`Missing configured testnet credential for ${account.name}`);
  await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const lock = await open(`${ledgerPath}.lock`, 'wx', 0o600); await lock.writeFile(String(process.pid));
  let ledger;
  try { ledger = JSON.parse(await readFile(ledgerPath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') ledger = { version: 1, intents: {} }; else { await lock.close(); await unlink(`${ledgerPath}.lock`); throw error; } }
  try { validateLedger(ledger, configuration.accounts); }
  catch (error) { await lock.close(); await unlink(`${ledgerPath}.lock`); throw error; }
  const persist = () => atomicWriteLedger(ledgerPath, ledger);
  const bridges = [], adapters = new Map();
  try { for (const account of configuration.accounts) {
    if (adapterFactory) { adapters.set(account.id, adapterFactory(account)); continue; }
    const key = process.env[configuration.credentialEnvs[account.id]];
    if (!key) throw Error(`Missing configured testnet credential for ${account.name}`);
    if (account.identity.venue === 'hyperliquid') adapters.set(account.id, new HyperliquidTestnetAdapter(account, privateKeyToAccount(key)));
    else { const bridge = lighterBridge(account, key, python); bridges.push(bridge); adapters.set(account.id, new LighterTestnetAdapter(account, bridge.send)); }
  } } catch (error) { for (const a of adapters.values()) a.dispose(); for (const b of bridges) b.close(); await lock.close(); await unlink(`${ledgerPath}.lock`); throw error; }
  let commandLane = Promise.resolve();
  const host = `127.0.0.1:${port}`;
  async function command(body) {
    const { operation, accountId, idempotencyKey, plan, orderId } = body;
    if (!['place', 'modify', 'cancel'].includes(operation) || body.confirmation !== 'TESTNET'
      || typeof idempotencyKey !== 'string' || !/^[\w:-]{1,100}$/.test(idempotencyKey)) throw Error('A scoped testnet command, confirmation and unique idempotency key are required');
    const account = configuration.accounts.find(a => a.id === accountId), adapter = adapters.get(accountId);
    if (!account || !adapter) throw Error('Account is not in the testnet service allowlist');
    if (operation !== 'cancel' && (!plan || typeof plan.id !== 'string' || !/^[\w:-]{1,100}$/.test(plan.id) || !['BTC', 'ETH'].includes(plan.base))) throw Error('A valid native instrument plan is required');
    const signature = createHash('sha256').update(JSON.stringify({ operation, accountId, plan, orderId, kind: body.kind, reduceOnly: body.reduceOnly, size: body.size, triggerPrice: body.triggerPrice, slippageBps: body.slippageBps })).digest('hex');
    const prior = ledger.intents[idempotencyKey];
    if (prior) { if (prior.signature !== signature) throw Error('Idempotency key reused with a different command'); return prior; }
    if (Object.keys(ledger.intents).length >= 10_000) throw Error('Intent ledger limit reached; review/archive reconciled testnet history before accepting more commands');
    const scope = accountScope(account), snapshot = await adapter.readAccount(undefined, operation === 'cancel' || body.reduceOnly === true);
    if (snapshot.scope !== scope || !snapshot.ordersComplete) throw Error('Fresh complete account snapshot does not match the configured execution identity');
    if (account.identity.venue === 'lighter' && operation !== 'cancel' && body.reduceOnly !== true && !/^standard$/i.test(snapshot.tier)) throw Error('Foundation Lighter signing requires verified Standard tier; other fee tiers await account-specific fee certification');
    const known = snapshot.orders.find(o => o.orderId === String(orderId));
    if (operation !== 'place' && !known) throw Error('Only an authoritative known order in this account can be changed or canceled');
    if (known && !['BTC', 'ETH'].includes(known.symbol)) throw Error('Only certified BTC/ETH perpetual orders can be changed');
    if (operation === 'place' && body.reduceOnly !== true && Object.values(ledger.intents).some(x => x.scope === scope && x.base === plan?.base && x.risk && x.status !== 'rejected')) throw Error('This account/instrument has an unresolved entry reservation; reconcile it before creating another intent');
    let intent, allocation, reservationRoot;
    if (operation === 'modify' && body.reduceOnly !== true) {
      reservationRoot = Object.values(ledger.intents).find(x => x.scope === scope && x.risk && !x.reservationRootId
        && x.base === known.symbol && x.clientOrderId === known.clientOrderId);
      if (!reservationRoot || reservationRoot.planId !== plan?.id) throw Error('Modify requires the original controlling plan and its persisted reservation');
      if (Object.values(ledger.intents).some(x => x.reservationRootId === reservationRoot.intentId && x.status === 'unknown')) throw Error('Prior modification outcome remains unknown; reconcile before another modification');
    }
    if (operation !== 'cancel') {
      const market = await adapter.readMarket(plan?.base);
      if (body.reduceOnly === true) {
        const position = snapshot.positions.find(p => p.symbol === plan.base), amount = new Decimal(body.size ?? '0');
        if (!position || !amount.gt(0) || amount.gt(new Decimal(position.size).abs()) || (new Decimal(position.size).gt(0) ? plan.side !== 'sell' : plan.side !== 'buy')) throw Error('Reduce-only command exceeds confirmed position or uses wrong side');
        intent = { id: idempotencyKey, planId: plan.id, accountId, scope: accountScope(account), environment: 'testnet', venue: account.identity.venue,
          base: plan.base, side: plan.side, size: amount.toFixed(), price: plan.entry, kind: body.kind ?? 'ioc', reduceOnly: true, triggerPrice: body.triggerPrice, clientOrderId: known?.clientOrderId ?? clientOrderId(account.identity.venue, idempotencyKey), expiresAt: plan.createdAt + plan.maxDelayMs };
      } else {
        if (operation === 'modify') snapshot.orders = snapshot.orders.filter(o => o.orderId !== known.orderId);
        // Reserve against all unresolved intents, including timeout/crash before acknowledgment.
        const reservations = Object.values(ledger.intents).filter(x => x.scope === scope && x.risk && x.status !== 'rejected' && x !== reservationRoot).map(x => ({ id: x.intentId, accountId: x.accountId, scope: x.scope, base: x.base, planId: x.planId, risk: x.risk, margin: x.margin, notional: x.notional, phase: 'unknown' }));
        allocation = previewAllocation(account, snapshot, market.spec, market.quote, plan, reservations);
        if (allocation.status !== 'ready') throw Error(allocation.reasons.join('; '));
        if (reservationRoot && new Decimal(allocation.requestedRisk).gt(reservationRoot.authorizedRisk ?? reservationRoot.risk)) throw Error('Modification exceeds the original authorized risk budget; material increases require a new reviewed plan after reconciliation');
        if (!['limit', 'post-only'].includes(body.kind ?? 'limit')) throw Error('Foundation testnet entries are limit/post-only only; rehearsals do not arm a managed copier');
        intent = { id: idempotencyKey, planId: plan.id, accountId, scope: accountScope(account), environment: 'testnet', venue: account.identity.venue,
          base: plan.base, side: plan.side, size: allocation.size, price: allocation.entry, kind: body.kind ?? 'limit', reduceOnly: false, clientOrderId: known?.clientOrderId ?? clientOrderId(account.identity.venue, idempotencyKey), expiresAt: plan.createdAt + plan.maxDelayMs };
      }
    }
    const record = { intentId: idempotencyKey, accountId, signature, operation, scope: accountScope(account), environment: 'testnet',
      planId: plan?.id ?? null, base: plan?.base ?? known?.symbol, clientOrderId: intent?.clientOrderId ?? known.clientOrderId,
      status: 'unknown', message: 'Persisted before signing; reconcile after crash/timeout', orderId: known?.orderId ?? null,
      risk: reservationRoot ? null : allocation?.executableRisk ?? null, margin: reservationRoot ? null : allocation?.margin ?? null, notional: reservationRoot ? null : allocation?.notional ?? null,
      authorizedRisk: allocation?.requestedRisk ?? null, reservationRootId: reservationRoot?.intentId ?? null, createdAt: Date.now() };
    if (reservationRoot) {
      // Replacement and original cannot both consume the full budget, yet either can still be effective until reconciled.
      reservationRoot.risk = Decimal.max(reservationRoot.risk, allocation.executableRisk).toFixed();
      reservationRoot.margin = Decimal.max(reservationRoot.margin, allocation.margin).toFixed();
      reservationRoot.notional = Decimal.max(reservationRoot.notional, allocation.notional).toFixed();
    }
    ledger.intents[idempotencyKey] = record; await persist();
    try { Object.assign(record, operation === 'cancel' ? await adapter.cancel(known, idempotencyKey) : operation === 'modify' ? await adapter.modify(intent, known) : await adapter.submit(intent)); }
    catch (error) { record.status = error instanceof PreDispatchRejectedError ? 'rejected' : 'unknown'; record.message = error instanceof PreDispatchRejectedError ? 'Plan expired before dispatch; no new order was sent' : 'Submission outcome unknown; inspect authoritative orders/fills and the venue interface. Do not retry.'; }
    await persist(); return record;
  }
  async function reconcile(body) {
    const record = ledger.intents[body.intentId];
    const account = configuration.accounts.find(a => a.id === body.accountId);
    if (!record || !account || record.scope !== accountScope(account)) throw Error('Reconciliation intent/account mismatch');
    const adapter = adapters.get(account.id);
    const terminal = await adapter.reconcile(record.clientOrderId, record.base);
    // Observe terminal state first, then obtain a fresh full snapshot; a pre-terminal flat read may predate a racing fill.
    const snapshot = await adapter.readAccount();
    if (snapshot.scope !== record.scope) throw Error('Reconciliation account identity changed');
    const baseFlat = !snapshot.positions.some(p => p.symbol === record.base && !new Decimal(p.size).isZero()) && !snapshot.orders.some(o => o.symbol === record.base);
    if (terminal === 'terminal' && baseFlat && snapshot.ordersComplete) {
      const rootId = record.reservationRootId ?? record.intentId;
      for (const related of Object.values(ledger.intents).filter(x => x.scope === record.scope && (x.intentId === rootId || x.reservationRootId === rootId))) {
        related.risk = null; related.margin = null; related.notional = null; related.reconciledFlat = true; related.message = 'Authoritative terminal order and fresh account snapshot confirm flat; reservation released';
      }
      await persist();
    }
    return { ...record, reconciliation: terminal, accountFlat: baseFlat };
  }
  const server = createServer(async (request, response) => {
    const cors = request.headers.origin === origin && request.headers.host === host;
    if (cors) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS' && cors) { response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type'); response.setHeader('Access-Control-Allow-Methods', 'GET,POST'); response.writeHead(204); response.end(); return; }
    if (!authorizeRequest(request, token, origin, host)) { response.writeHead(403); response.end(JSON.stringify({ error: 'Loopback host, allowed origin and service authentication required' })); return; }
    try {
      if (request.method === 'GET' && request.url === '/v1/accounts') {
        const state = await Promise.all(configuration.accounts.map(async account => ({ account, snapshot: await adapters.get(account.id).readAccount() })));
        response.end(JSON.stringify({ environment: 'testnet', accounts: state, intents: Object.values(ledger.intents) })); return;
      }
      if (request.method !== 'POST' || !['/v1/commands', '/v1/reconcile'].includes(request.url) || !request.headers['content-type']?.startsWith('application/json')) throw Error('Unsupported testnet service route');
      let data = ''; for await (const chunk of request) { data += chunk; if (data.length > 32_000) throw Error('Command too large'); }
      const body = JSON.parse(data);
      const next = commandLane.catch(() => {}).then(() => request.url === '/v1/reconcile' ? reconcile(body) : command(body)); commandLane = next;
      response.end(JSON.stringify(await next));
    } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: String(error.message ?? 'Command rejected').slice(0, 300) })); }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { for (const a of adapters.values()) a.dispose(); for (const b of bridges) b.close(); await lock.close(); await unlink(`${ledgerPath}.lock`); throw error; }
  return { server, close: async () => { await new Promise(resolve => server.close(resolve)); await commandLane.catch(() => {}); for (const a of adapters.values()) a.dispose(); for (const b of bridges) b.close(); await lock.close(); await unlink(`${ledgerPath}.lock`); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const configuration = JSON.parse(await readFile(process.env.IQ_TRADING_TESTNET_CONFIG, 'utf8'));
  const service = await createTestnetService({ configuration, token: process.env.IQ_TRADING_TESTNET_TOKEN,
    origin: process.env.IQ_TRADING_TESTNET_ORIGIN, port: Number(process.env.IQ_TRADING_TESTNET_PORT ?? 8789), ledgerPath: process.env.IQ_TRADING_TESTNET_LEDGER });
  process.stdout.write('Testnet signing service listening on loopback. Credentials and bearer token are not logged.\n');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void service.close().then(() => process.exit(0)); });
}
