import { describe, expect, it } from 'vitest';
import { accountScope, assertIntentScope, type ExecutionAccount, type InstrumentSpec, type OrderIntent, type TradePlan } from '../src/trading/foundation/domain';
import { restoreRegistry, validateRegistry } from '../src/trading/foundation/accounts';
import { previewAllocation, ReservationBook } from '../src/trading/foundation/risk';
import { GroupSimulator, rehearsalAccounts, simulatedSnapshot } from '../src/trading/foundation/simulator';
import { lighterInteger, validateTestnetIntent } from '../src/trading/foundation/testnet-adapters';
import { PublicTradingAdapter, ReadBudget } from '../src/trading/foundation/public-adapters';
import { executionIdentityDescription } from '../src/trading/foundation/confirmation';

const now = 1_000_000, accounts = rehearsalAccounts();
function plan(overrides: Partial<TradePlan> = {}): TradePlan {
  return { id: 'plan-1', version: 1, base: 'BTC', side: 'buy', entry: '100000', stop: '99000', risk: { mode: 'equity-percent', value: '0.5' },
    stopMode: 'absolute', targets: [{ price: '102000', percent: '50' }, { price: '103000', percent: '50' }], stopPercent: '100',
    slippageBps: '0', maxDriftBps: '50', maxDelayMs: 30_000, createdAt: now, ...overrides };
}
function spec(account = accounts[0]): InstrumentSpec {
  return { venue: account.identity.venue, environment: 'testnet', base: 'BTC', quote: 'USDC', payoff: 'linear', marketId: 1, sizeDecimals: 5, priceDecimals: 1,
    significantFigures: null, minSize: '0.00001', minNotional: '10', maxLeverage: '5', makerFeeBps: '0', takerFeeBps: '0',
    capabilities: { limit: true, protectedIoc: true, postOnly: true, modify: true, reduceOnly: true, conditionalExits: true, nativeTwap: false, signing: 'none' } };
}
function quote(a = accounts[0]) { return { venue: a.identity.venue, environment: a.environment, base: 'BTC' as const, bid: '100000', ask: '100000', mark: '100000', triggerSource: 'Simulated mark', asOf: now }; }
function allocation(a = accounts[0], p = plan()) { return previewAllocation(a, simulatedSnapshot(a, now), spec(a), quote(a), p, [], now); }
function intent(a = accounts[0]): OrderIntent {
  return { id: 'intent-1', planId: 'plan-1', accountId: a.id, scope: accountScope(a), environment: 'testnet', venue: a.identity.venue, base: 'BTC', side: 'buy',
    size: '0.01', price: '100000', kind: 'limit', reduceOnly: false, clientOrderId: '0x11111111111111111111111111111111', expiresAt: Date.now() + 30_000 };
}

describe('named execution accounts and group boundaries', () => {
  it('confirms exact public execution identity even when account names match', () => {
    const a = { ...accounts[0], name: 'Same' }, b = { ...accounts[1], name: 'Same' };
    expect(executionIdentityDescription(a)).toContain('Master execution'); expect(executionIdentityDescription(b)).toContain('Subaccount 0x2222222222222222222222222222222222222222');
    expect(executionIdentityDescription(a)).not.toBe(executionIdentityDescription(b));
    expect(executionIdentityDescription(accounts[2])).toContain('Account index 1 · API-key index 2');
  });
  it('keeps named strategies distinct only with actual native identities', () => {
    const r = validateRegistry({ version: 1, accounts, groups: [{ id: 'group', name: 'All', accountIds: accounts.map(a => a.id) }], selectedId: 'group' });
    expect(new Set(r.accounts.map(accountScope)).size).toBe(4);
  });
  it('rejects duplicate accounts disguised by workspace names', () => {
    expect(() => validateRegistry({ version: 1, accounts: [accounts[0], { ...accounts[0], id: 'other', name: 'Different name' }], groups: [], selectedId: null })).toThrow(/registered twice/);
  });
  it('rejects unknown members, nested groups and cycles', () => {
    for (const ids of [['missing'], ['g'], [accounts[0].id, accounts[0].id]]) expect(() => validateRegistry({ version: 1, accounts, groups: [{ id: 'g', name: 'Cyclic', accountIds: ids }], selectedId: 'g' })).toThrow();
  });
  it('rejects mixed mainnet/testnet and real/simulation groups', () => {
    const other = { ...accounts[1], environment: 'mainnet' as const };
    expect(() => validateRegistry({ version: 1, accounts: [accounts[0], other], groups: [{ id: 'g', name: 'Mixed', accountIds: [accounts[0].id, other.id] }], selectedId: 'g' })).toThrow(/one environment/);
  });
  it('allowlists public persistence and never retains incidental key fields', () => {
    const contaminated = { ...accounts[0], privateKey: 'DO-NOT-PERSIST', token: 'DO-NOT-PERSIST', identity: { ...accounts[0].identity, privateKey: 'DO-NOT-PERSIST' } };
    expect(JSON.stringify(validateRegistry({ version: 1, accounts: [contaminated], groups: [], selectedId: null }))).not.toContain('DO-NOT-PERSIST');
  });
  it('corrupt saved configuration starts empty and read-only', () => { expect(restoreRegistry('{')).toEqual({ version: 1, accounts: [], groups: [], selectedId: null }); });
  it('rejects invalid key index, identity and selected account', () => {
    const a = { ...accounts[2], identity: { ...accounts[2].identity, apiKeyIndex: 0 } } as ExecutionAccount;
    expect(() => validateRegistry({ version: 1, accounts: [a], groups: [], selectedId: null })).toThrow(/API-key/);
  });
});

describe('shared allocation and reservations', () => {
  it('calculates each venue/account from its own equity', () => { expect(accounts.map(a => allocation(a).size)).toEqual(['0.01', '0.05', '0.02', '0.03']); });
  it('fees and slippage reduce quantity and rounding never exceeds risk', () => {
    const s = { ...spec(), takerFeeBps: '4.5' };
    const a = previewAllocation(accounts[0], simulatedSnapshot(accounts[0], now), s, quote(), plan({ slippageBps: '50' }), [], now);
    expect(a.status).toBe('ready'); expect(Number(a.size)).toBeLessThan(0.01); expect(Number(a.executableRisk)).toBeLessThanOrEqual(Number(a.requestedRisk));
  });
  it('counts complete TP and complete SL as independent alternative paths', () => { expect(allocation().status).toBe('ready'); expect(allocation(accounts[0], plan({ stopPercent: '50' })).reasons[0]).toMatch(/50%.*no planned stop/); });
  it('rejects target overallocation, wrong stop side and exponent amounts', () => {
    for (const p of [plan({ targets: [{ price: '102000', percent: '101' }] }), plan({ stop: '101000' }), plan({ risk: { mode: 'fixed-cash', value: '1e2' } })]) expect(allocation(accounts[0], p).status).toBe('blocked');
  });
  it('blocks stale data, unknown working orders, scope mismatch and stale entries', () => {
    const snap = simulatedSnapshot(accounts[0], now);
    for (const s of [{ ...snap, asOf: now - 15_001 }, { ...snap, ordersComplete: false }, { ...snap, accountId: accounts[1].id }]) expect(previewAllocation(accounts[0], s, spec(), quote(), plan(), [], now).status).toBe('blocked');
    expect(allocation(accounts[0], plan({ createdAt: now - 30_001 })).reasons[0]).toMatch(/expired/);
  });
  it('blocks current BTC exposure but includes ETH gross exposure in account cap', () => {
    const snap = simulatedSnapshot(accounts[0], now), exposure = { symbol: 'BTC', size: '0.1', entryPrice: '100000', notional: '10000', unrealizedPnl: '0' };
    expect(previewAllocation(accounts[0], { ...snap, positions: [exposure] }, spec(), quote(), plan(), [], now).reasons[0]).toMatch(/must be flat/);
    expect(previewAllocation(accounts[0], { ...snap, grossNotional: '99999', positions: [{ ...exposure, symbol: 'ETH' }] }, spec(), quote(), plan(), [], now).reasons[0]).toMatch(/gross/);
  });
  it('never silently caps risk for margin or policy limits', () => {
    expect(allocation(accounts[0], plan({ risk: { mode: 'fixed-cash', value: '501' } })).reasons[0]).toMatch(/risk limit/);
    expect(previewAllocation(accounts[0], { ...simulatedSnapshot(accounts[0], now), availableMargin: '1' }, spec(), quote(), plan(), [], now).reasons[0]).toMatch(/margin/);
  });
  it('enforces destination drift and recalculates relative stop distance', () => {
    expect(previewAllocation(accounts[0], simulatedSnapshot(accounts[0], now), spec(), { ...quote(), ask: '101000' }, plan(), [], now).status).toBe('blocked');
    const a = previewAllocation(accounts[0], simulatedSnapshot(accounts[0], now), spec(), { ...quote(), ask: '100100' }, plan({ stopMode: 'relative-distance' }), [], now);
    expect(a.entry).toBe('100100'); expect(a.stop).toBe('99100');
  });
  it('atomically prevents concurrent plans using the same account/instrument', () => {
    const book = new ReservationBook(); book.reserve([allocation()], accounts); const before = book.all;
    expect(() => book.reserve([allocation(accounts[1]), allocation(accounts[0], plan({ id: 'other' }))], accounts)).toThrow(/controlling plan/);
    expect(book.all).toEqual(before);
  });
  it('holds unknown reservations through restart until authoritative terminal state', () => {
    const book = new ReservationBook(); book.reserve([allocation()], accounts); book.mark('plan-1:sim-hl-day', 'unknown');
    const restored = new ReservationBook(book.all); expect(() => restored.release('plan-1:sim-hl-day', false)).toThrow(/reconciliation/);
    expect(restored.all[0].phase).toBe('unknown'); restored.release('plan-1:sim-hl-day', true); expect(restored.all).toHaveLength(0);
  });
});

describe('deterministic grouped lifecycle', () => {
  function simulator() { return new GroupSimulator(plan(), accounts.map(a => allocation(a)), accounts); }
  it.each([[0, 1], [2, 3], [0, 2], [2, 0]])('replicates venue route %i → %i with distinct child IDs and allocations', (leader, follower) => {
    const selected = [accounts[leader], accounts[follower]], sim = new GroupSimulator(plan(), selected.map(a => allocation(a)), selected);
    expect(sim.state.children).toHaveLength(2); expect(sim.state.children[0].id).not.toBe(sim.state.children[1].id);
    expect(sim.state.children[0].quantity).not.toBe(sim.state.children[1].quantity);
  });
  it('partial fill is not protected until exact stop acknowledgment', () => {
    const sim = simulator(), id = sim.state.children[0].id;
    sim.apply({ id: 'fill', childId: id, sequence: 1, kind: 'fill', quantity: '0.005' }); expect(sim.state.children[0].phase).toBe('partly-filled');
    sim.apply({ id: 'protect', childId: id, sequence: 2, kind: 'protection', quantity: '0.005' }); expect(sim.state.children[0].phase).toBe('protected');
    sim.apply({ id: 'cancel', childId: id, sequence: 3, kind: 'cancel-entry' }); expect(sim.state.children[0].stopAcknowledged).toBe('0.005'); expect(sim.state.children[0].phase).toBe('protected');
  });
  it('duplicate/delayed cumulative events cannot create exposure twice', () => {
    const sim = simulator(), childId = sim.state.children[0].id, event = { id: 'fill', childId, sequence: 2, kind: 'fill' as const, quantity: '0.005' };
    sim.apply(event); sim.apply(event); sim.apply({ ...event, id: 'old', sequence: 1, quantity: '0.003' }); expect(sim.state.children[0].remaining).toBe('0.005');
  });
  it('racing reduce-only target and stop cannot reverse exposure', () => {
    const sim = simulator(), childId = sim.state.children[0].id;
    sim.apply({ id: 'fill', childId, sequence: 1, kind: 'fill', quantity: '0.01' });
    sim.apply({ id: 'tp', childId, sequence: 2, kind: 'exit', quantity: '0.01' }); sim.apply({ id: 'sl', childId, sequence: 3, kind: 'exit', quantity: '0.01' });
    expect(sim.state.children[0].remaining).toBe('0'); expect(sim.summary().allFlat).toBe(false);
    sim.apply({ id: 'flat', childId, sequence: 4, kind: 'reconcile-flat' }); expect(sim.state.children[0].phase).toBe('confirmed-flat');
  });
  it('rejected and unknown followers remain explicit exceptions', () => {
    const sim = simulator(); sim.apply({ id: 'reject', childId: sim.state.children[0].id, sequence: 1, kind: 'reject' }); sim.apply({ id: 'timeout', childId: sim.state.children[1].id, sequence: 1, kind: 'timeout' });
    expect(sim.summary()).toMatchObject({ rejected: 1, unknown: 1, allFlat: false }); expect(sim.state.reservations).toHaveLength(3);
  });
  it('manual follower close detaches instead of reopening on repeated actions', () => {
    const sim = simulator(), childId = sim.state.children[0].id;
    sim.apply({ id: 'manual', childId, sequence: 1, kind: 'manual-close' }); expect(sim.state.children[0]).toMatchObject({ detached: true, entryWorking: false, phase: 'detached' });
  });
  it('emergency stop survives restart and racing fills remain exposed until reconciled', () => {
    const sim = simulator(), childId = sim.state.children[0].id; sim.emergencyStop();
    const restored = new GroupSimulator(plan(), [], accounts, sim.state); expect(restored.state.emergencyStopped).toBe(true);
    restored.apply({ id: 'racing-fill', childId, sequence: 1, kind: 'fill', quantity: '0.005' }); expect(restored.state.children[0].entryWorking).toBe(false);
    expect(() => restored.apply({ id: 'false-flat', childId, sequence: 2, kind: 'reconcile-flat' })).toThrow(/Cannot confirm flat/);
  });
});

describe('real-adapter input boundaries', () => {
  it('rejects wrong network, wrong account, wrong subaccount and uncertified symbol', () => {
    for (const change of [{ environment: 'mainnet' }, { accountId: accounts[1].id }, { scope: accountScope(accounts[1]) }, { base: 'SOL' }]) expect(() => assertIntentScope(accounts[0], { ...intent(), ...change } as OrderIntent)).toThrow();
  });
  it('rejects mainnet signing before native signer invocation', () => {
    const a = { ...accounts[0], environment: 'mainnet' as const, mode: 'read-only' as const };
    expect(() => validateTestnetIntent(a, { ...intent(a), environment: 'mainnet' }, { ...spec(a), environment: 'mainnet' })).toThrow(/testnet/);
  });
  it('uses exact Lighter integer conversion and rejects truncation/overflow', () => {
    expect(lighterInteger('0.12345', 5, '9223372036854775807')).toBe('12345');
    expect(() => lighterInteger('0.000001', 5, '100000')).toThrow(/exactly/); expect(() => lighterInteger('4294967296', 0, '4294967295')).toThrow();
  });
  it('reserves read capacity and never retries after read budget exhaustion', () => { const budget = new ReadBudget(); for (let n = 0; n < 40; n++) budget.take(now); expect(() => budget.take(now)).toThrow(/emergency/); expect(() => budget.take(now + 60_001)).not.toThrow(); });
  it('Lighter owner/account mismatch fails closed, never falls back to fixtures', async () => {
    const a = { ...accounts[2], mode: 'read-only' as const };
    const adapter = new PublicTradingAdapter(a, async () => new Response(JSON.stringify({ code: 200, accounts: [{ account_index: 1, l1_address: `0x${'9'.repeat(40)}` }] })));
    await expect(adapter.readAccount()).rejects.toThrow(/does not belong/); adapter.dispose();
  });
});
