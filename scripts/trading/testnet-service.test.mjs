import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestnetService, authorizeRequest, clientOrderId, validateConfiguration, lighterChildEnvironment, atomicWriteLedger, validateLedger } from './testnet-service.mjs';
import { rehearsalAccounts, simulatedSnapshot } from '../../src/trading/foundation/simulator.ts';

const account = { ...rehearsalAccounts()[0], mode: 'read-only' };
const configuration = { accounts: [account], credentialEnvs: { [account.id]: 'IQ_TEST_DEDICATED_AGENT' } };
const token = 'test-only-random-token-never-a-wallet-secret';
const origin = 'http://127.0.0.1:4173';
let port = 19850;
function testPlan() { return { id: 'plan-1', version: 1, base: 'BTC', side: 'buy', entry: '100000', stop: '99000', risk: { mode: 'equity-percent', value: '0.5' }, stopMode: 'absolute', targets: [], stopPercent: '100', slippageBps: '0', maxDriftBps: '50', maxDelayMs: 30_000, createdAt: Date.now() }; }
async function harness(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'iq-testnet-service-')), ledgerPath = join(directory, 'ledger.json');
  let submitted = 0, canceled = 0, modified = 0, lastModified;
  let activeConfiguration = options.configuration ?? configuration;
  const snapshot = { ...simulatedSnapshot(account, Date.now()), permission: 'testnet-authorized', orders: options.orders ?? [] };
  const adapter = {
    readAccount: async () => ({ ...snapshot, asOf: Date.now() }),
    readMarket: async () => ({ spec: { venue: 'hyperliquid', environment: 'testnet', base: 'BTC', quote: 'USDC', payoff: 'linear', marketId: 0, sizeDecimals: 5, priceDecimals: 1, significantFigures: null, minSize: '0.00001', minNotional: '10', maxLeverage: '5', makerFeeBps: '0', takerFeeBps: '0' }, quote: { venue: 'hyperliquid', environment: 'testnet', base: 'BTC', bid: '100000', ask: '100000', mark: '100000', triggerSource: 'Fixture', asOf: Date.now() } }),
    submit: async intent => { submitted++; if (options.uncertain) throw Error('Accepted at venue, ACK lost'); return { intentId: intent.id, status: 'acknowledged', orderId: '123', transactionId: null, message: 'Fixture acknowledgment' }; },
    cancel: async (_order, id) => { canceled++; return { intentId: id, status: 'acknowledged', orderId: '123', transactionId: null, message: 'Fixture cancel acknowledgment' }; },
    modify: async (intent, order) => { modified++; lastModified = intent; return { intentId: intent.id, status: 'acknowledged', orderId: order.orderId, transactionId: null, message: 'Fixture native modify' }; },
    reconcile: async () => { options.onTerminal?.(snapshot); return options.terminal ? 'terminal' : 'unknown'; }, dispose() {},
  };
  const selectedPort = port++;
  let service = await createTestnetService({ configuration: activeConfiguration, token, origin, port: selectedPort, ledgerPath, adapterFactory: () => adapter });
  const request = (path, body, overrides = {}) => fetch(`http://127.0.0.1:${selectedPort}${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...overrides }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { request, ledgerPath, submitted: () => submitted, canceled: () => canceled, modified: () => modified, lastModified: () => lastModified, snapshot,
    restart: async (nextConfiguration = activeConfiguration) => { await service.close(); activeConfiguration = nextConfiguration; service = await createTestnetService({ configuration: activeConfiguration, token, origin, port: selectedPort, ledgerPath, adapterFactory: () => adapter }); },
    close: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('service configuration refuses mainnet, simulation and missing credential scope', () => {
  for (const change of [{ environment: 'mainnet' }, { mode: 'simulated' }]) assert.throws(() => validateConfiguration({ ...configuration, accounts: [{ ...account, ...change }] }));
  assert.throws(() => validateConfiguration({ accounts: [account] }));
});
test('exact Host + Origin + bearer authentication rejects foreign origins and DNS rebinding', () => {
  const request = { headers: { host: '127.0.0.1:8789', origin, authorization: `Bearer ${token}` } };
  assert.equal(authorizeRequest(request, token, origin, '127.0.0.1:8789'), true);
  for (const change of [{ host: 'evil.example:8789' }, { origin: 'https://evil.example' }, { authorization: 'Bearer wrong' }, { origin: undefined }]) assert.equal(authorizeRequest({ headers: { ...request.headers, ...change } }, token, origin, '127.0.0.1:8789'), false);
});
test('venue client IDs use independent 128-bit hex and 48-bit integer representations', () => {
  assert.match(clientOrderId('hyperliquid', 'same-intent'), /^0x[\da-f]{32}$/);
  assert.ok(BigInt(clientOrderId('lighter', 'same-intent')) <= 281474976710655n);
  assert.equal(clientOrderId('lighter', 'same-intent'), clientOrderId('lighter', 'same-intent'));
});
test('signer process receives exactly its key and public indices, never another account credential', () => {
  const lighter = { ...rehearsalAccounts()[2], mode: 'read-only' };
  const env = lighterChildEnvironment(lighter, 'fixture-dedicated-key', { PATH: '/usr/bin', OTHER_PRIVATE_KEY: 'excluded', IQ_TRADING_TESTNET_TOKEN: 'excluded', IQ_TEST_DEDICATED_AGENT: 'excluded' });
  assert.equal(env.IQ_LIGHTER_API_KEY_INDEX, '2'); assert.equal(env.IQ_LIGHTER_ACCOUNT_INDEX, '1'); assert.equal(env.IQ_LIGHTER_API_PRIVATE_KEY, 'fixture-dedicated-key');
  assert.equal(env.OTHER_PRIVATE_KEY, undefined); assert.equal(env.IQ_TRADING_TESTNET_TOKEN, undefined);
  assert.equal(env.IQ_TEST_DEDICATED_AGENT, undefined);
});
test('requests reject missing auth, unknown accounts, mainnet confirmation and unsupported routes', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/v1/accounts', undefined, { Authorization: 'Bearer wrong' })).status, 403);
    for (const body of [{ accountId: 'other', confirmation: 'TESTNET' }, { accountId: account.id, confirmation: 'MAINNET' }]) assert.equal((await h.request('/v1/commands', { operation: 'place', idempotencyKey: 'one', plan: testPlan(), ...body })).status, 400);
    assert.equal((await h.request('/withdraw', {})).status, 400); assert.equal(h.submitted(), 0);
  } finally { await h.close(); }
});
test('persisted idempotency survives reload; credentials never enter ledger', async () => {
  const h = await harness(), body = { operation: 'place', accountId: account.id, confirmation: 'TESTNET', idempotencyKey: 'once', plan: testPlan() };
  try {
    const first = await (await h.request('/v1/commands', body)).json(); assert.equal(first.status, 'acknowledged');
    await h.restart(); const second = await (await h.request('/v1/commands', body)).json(); assert.equal(second.intentId, 'once'); assert.equal(h.submitted(), 1);
    assert.equal((await h.request('/v1/commands', { ...body, kind: 'post-only' })).status, 400);
    const disk = await readFile(h.ledgerPath, 'utf8'); assert.ok(!disk.includes(token)); assert.ok(!disk.includes('IQ_TEST_DEDICATED_AGENT')); assert.ok(!disk.includes('privateKey'));
  } finally { await h.close(); }
});
test('lost ACK is unknown after restart and a new id cannot spend its reservation', async () => {
  const h = await harness({ uncertain: true }), body = { operation: 'place', accountId: account.id, confirmation: 'TESTNET', idempotencyKey: 'unknown', plan: testPlan() };
  try {
    assert.equal((await (await h.request('/v1/commands', body)).json()).status, 'unknown'); await h.restart();
    assert.equal((await (await h.request('/v1/commands', body)).json()).status, 'unknown'); assert.equal(h.submitted(), 1);
    assert.equal((await h.request('/v1/commands', { ...body, idempotencyKey: 'same-plan-retry' })).status, 400);
    assert.equal((await h.request('/v1/commands', { ...body, idempotencyKey: 'retry', plan: { ...body.plan, id: 'plan-2' } })).status, 400); assert.equal(h.submitted(), 1);
  } finally { await h.close(); }
});
test('emergency cancel needs known account order but no fresh chart or quote', async () => {
  const order = { accountId: account.id, symbol: 'BTC', orderId: '123', clientOrderId: '0x11111111111111111111111111111111', size: '0.01', price: '100000', side: 'buy', reduceOnly: false, status: 'open' };
  const h = await harness({ orders: [order] });
  try {
    const body = { operation: 'cancel', accountId: account.id, orderId: '123', confirmation: 'TESTNET', idempotencyKey: 'cancel' };
    assert.equal((await (await h.request('/v1/commands', body)).json()).status, 'acknowledged'); assert.equal(h.canceled(), 1);
    assert.equal((await h.request('/v1/commands', { ...body, idempotencyKey: 'wrong', orderId: '999' })).status, 400);
  } finally { await h.close(); }
});
test('only authoritative terminal order AND flat account release a reservation', async () => {
  const h = await harness({ terminal: true });
  try {
    await h.request('/v1/commands', { operation: 'place', accountId: account.id, confirmation: 'TESTNET', idempotencyKey: 'entry', plan: testPlan() });
    h.snapshot.positions = [{ symbol: 'BTC', size: '0.01' }];
    const open = await (await h.request('/v1/reconcile', { accountId: account.id, intentId: 'entry' })).json(); assert.ok(open.risk);
    h.snapshot.positions = [];
    const flat = await (await h.request('/v1/reconcile', { accountId: account.id, intentId: 'entry' })).json(); assert.equal(flat.risk, null); assert.equal(flat.reconciledFlat, true);
  } finally { await h.close(); }
});
test('renaming an execution account across restart cannot bypass a lost-ACK reservation', async () => {
  const h = await harness({ uncertain: true }), p = testPlan();
  try {
    await h.request('/v1/commands', { operation: 'place', accountId: account.id, confirmation: 'TESTNET', idempotencyKey: 'uncertain', plan: p });
    const renamed = { ...account, id: 'renamed-account', name: 'Recreated account' };
    h.snapshot.accountId = renamed.id;
    await h.restart({ accounts: [renamed], credentialEnvs: { [renamed.id]: 'IQ_TEST_DEDICATED_AGENT' } });
    const result = await h.request('/v1/commands', { operation: 'place', accountId: renamed.id, confirmation: 'TESTNET', idempotencyKey: 'renamed-retry', plan: p });
    assert.equal(result.status, 400); assert.match((await result.json()).error, /unresolved entry reservation/); assert.equal(h.submitted(), 1);
  } finally { await h.close(); }
});
test('native modification preserves client ID and reserves max original/replacement instead of double spending', async () => {
  const limited = { ...account, policy: { ...account.policy, maxRiskCash: '10' } }, h = await harness({ configuration: { accounts: [limited], credentialEnvs: configuration.credentialEnvs } }), p = testPlan();
  try {
    const entry = await (await h.request('/v1/commands', { operation: 'place', accountId: account.id, confirmation: 'TESTNET', idempotencyKey: 'entry', plan: p })).json();
    h.snapshot.orders = [{ accountId: account.id, orderId: '123', clientOrderId: entry.clientOrderId, symbol: 'BTC', size: '0.01', price: '100000', side: 'buy', reduceOnly: false }];
    const result = await (await h.request('/v1/commands', { operation: 'modify', accountId: account.id, orderId: '123', confirmation: 'TESTNET', idempotencyKey: 'modify', plan: { ...p, stop: '98000' } })).json();
    assert.equal(result.status, 'acknowledged'); assert.equal(h.modified(), 1); assert.equal(h.lastModified().clientOrderId, entry.clientOrderId);
    const disk = JSON.parse(await readFile(h.ledgerPath, 'utf8')); assert.equal(disk.intents.entry.risk, '10'); assert.equal(disk.intents.modify.risk, null); assert.equal(disk.intents.modify.reservationRootId, 'entry');
  } finally { await h.close(); }
});
test('terminal observation must precede the fresh snapshot used for flat release', async () => {
  const h = await harness({ terminal: true, onTerminal: snapshot => { snapshot.positions = [{ symbol: 'BTC', size: '0.01' }]; } });
  try {
    await h.request('/v1/commands', { operation: 'place', accountId: account.id, confirmation: 'TESTNET', idempotencyKey: 'entry', plan: testPlan() });
    const result = await (await h.request('/v1/reconcile', { accountId: account.id, intentId: 'entry' })).json();
    assert.equal(result.accountFlat, false); assert.ok(result.risk); assert.notEqual(result.reconciledFlat, true);
  } finally { await h.close(); }
});
test('atomic ledger durability syncs the file and renamed parent directory before dispatch can proceed', async () => {
  const events = [];
  await atomicWriteLedger('/private/ledger.json', { version: 1, intents: {} }, {
    open: async path => ({ writeFile: async () => events.push('write-file'), sync: async () => events.push(path.endsWith('.tmp') ? 'sync-file' : 'sync-directory'), close: async () => {} }),
    rename: async () => events.push('rename'),
  });
  assert.deepEqual(events, ['write-file', 'sync-file', 'rename', 'sync-directory']);
});
test('malformed ledgers fail closed and initialization releases the local writer lock', async () => {
  for (const intents of [[], null, { broken: null }, { broken: [] }, { broken: { scope: 'missing-fields' } }]) assert.throws(() => validateLedger({ version: 1, intents }, [account]));
  const directory = await mkdtemp(join(tmpdir(), 'iq-ledger-malformed-')), ledgerPath = join(directory, 'ledger.json');
  try {
    await writeFile(ledgerPath, JSON.stringify({ version: 1, intents: [] }));
    await assert.rejects(createTestnetService({ configuration, token, origin, port: port++, ledgerPath, adapterFactory: () => { throw Error('must not initialize'); } }), /Invalid durable/);
    await assert.rejects(access(`${ledgerPath}.lock`));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('account ID cannot be repointed to another native execution scope with unresolved history', async () => {
  const h = await harness({ uncertain: true });
  try {
    await h.request('/v1/commands', { operation: 'place', accountId: account.id, confirmation: 'TESTNET', idempotencyKey: 'entry', plan: testPlan() });
    const disk = JSON.parse(await readFile(h.ledgerPath, 'utf8'));
    assert.throws(() => validateLedger(disk, [{ ...account, identity: { ...account.identity, executionAddress: `0x${'9'.repeat(40)}` } }]), /repointed/);
  } finally { await h.close(); }
});
