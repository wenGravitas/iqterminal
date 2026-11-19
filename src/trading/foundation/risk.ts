import Decimal from 'decimal.js';
import { accountScope, type AccountAllocation, type ExecutionAccount, type ExecutionQuote, type ExecutionSnapshot, type InstrumentSpec, type RiskReservation, type TradePlan } from './domain.ts';

function amount(value: string, zero = false): Decimal {
  if (typeof value !== 'string' || value.length > 64 || !/^(?:\d+\.?\d*|\.\d+)$/.test(value)) throw Error('Use ordinary decimal amounts without exponent notation');
  const d = new Decimal(value);
  if (!d.isFinite() || (zero ? d.lt(0) : d.lte(0))) throw Error('Amount must be positive');
  return d;
}
export function quantizeSize(value: string, spec: InstrumentSpec) {
  return amount(value, true).toDecimalPlaces(spec.sizeDecimals, Decimal.ROUND_DOWN).toFixed();
}
export function validateInstrumentOrder(size: string, price: string, spec: InstrumentSpec) {
  const s = amount(size), p = amount(price);
  if (s.decimalPlaces() > spec.sizeDecimals || p.decimalPlaces() > spec.priceDecimals
    || spec.significantFigures !== null && !p.isInteger() && p.sd() > spec.significantFigures) throw Error('Order does not match current venue size/price precision');
  if (s.lt(spec.minSize) || s.mul(p).lt(spec.minNotional)) throw Error('Order is below the venue minimum size or notional');
}
export function previewAllocation(account: ExecutionAccount, snapshot: ExecutionSnapshot, spec: InstrumentSpec, quote: ExecutionQuote,
  plan: TradePlan, reservations: RiskReservation[] = [], now = Date.now()): AccountAllocation {
  const result: AccountAllocation = { accountId: account.id, scope: accountScope(account), planId: plan.id, base: plan.base,
    venue: account.identity.venue, environment: account.environment, requestedRisk: '0', executableRisk: '0', size: '0',
    entry: plan.entry, stop: plan.stop, notional: '0', margin: '0', estimatedFees: '0', stopCoveragePercent: plan.stopPercent,
    targets: plan.targets, status: 'blocked', reasons: [] };
  try {
    if (snapshot.accountId !== account.id || snapshot.scope !== result.scope || snapshot.environment !== account.environment
      || snapshot.venue !== account.identity.venue || spec.venue !== result.venue || quote.venue !== result.venue
      || spec.environment !== account.environment || quote.environment !== account.environment || spec.base !== plan.base || quote.base !== plan.base) throw Error('Account, instrument, quote or environment mismatch');
    if (!Number.isFinite(snapshot.asOf) || now < snapshot.asOf || now - snapshot.asOf > 15_000
      || !Number.isFinite(quote.asOf) || now < quote.asOf || now - quote.asOf > 5_000) throw Error('Refresh account and execution-venue quote before previewing new risk');
    if (!snapshot.ordersComplete) throw Error('Working orders are not fully known; authenticated account reconciliation is required');
    if (!Number.isSafeInteger(plan.maxDelayMs) || plan.maxDelayMs < 1 || plan.maxDelayMs > 60_000
      || !Number.isFinite(plan.createdAt) || now - plan.createdAt > plan.maxDelayMs || now < plan.createdAt) throw Error('Plan entry window expired; review a new plan');
    if (!['BTC', 'ETH'].includes(plan.base) || !['buy', 'sell'].includes(plan.side)
      || !['absolute', 'relative-distance'].includes(plan.stopMode) || !['fixed-cash', 'equity-percent'].includes(plan.risk.mode)) throw Error('Unsupported plan contract');
    const equity = amount(snapshot.equity), available = amount(snapshot.availableMargin, true);
    const reference = amount(plan.side === 'buy' ? quote.ask : quote.bid), entry = amount(plan.entry), stop = amount(plan.stop);
    const drift = amount(plan.maxDriftBps, true), slippage = amount(plan.slippageBps, true);
    if (drift.gt(1_000) || slippage.gt(1_000)) throw Error('Price drift and slippage bounds must be between 0 and 1,000 basis points');
    if (reference.minus(entry).abs().div(entry).mul(10_000).gt(drift)) throw Error('Destination execution price exceeds the plan price bound');
    const localEntry = plan.stopMode === 'relative-distance' ? reference : entry;
    const localStop = plan.stopMode === 'relative-distance' ? localEntry.plus(stop.minus(entry)) : stop;
    if (localStop.lte(0) || (plan.side === 'buy' ? localStop.gte(localEntry) : localStop.lte(localEntry))) throw Error('Stop must bound loss on the chosen side');
    const stopPercent = amount(plan.stopPercent, true);
    if (stopPercent.gt(100)) throw Error('Stop coverage cannot exceed 100%');
    let targetTotal = new Decimal(0);
    if (plan.targets.length > 8) throw Error('At most eight target allocations are supported');
    for (const target of plan.targets) {
      const percent = amount(target.percent), targetPrice = amount(target.price);
      targetTotal = targetTotal.plus(percent);
      if (plan.side === 'buy' ? targetPrice.lte(localEntry) : targetPrice.gte(localEntry)) throw Error('Targets must be on the profitable side of this account entry');
    }
    if (targetTotal.gt(100)) throw Error('Take-profit allocations exceed 100%; stop coverage is counted separately');
    const requested = plan.risk.mode === 'fixed-cash' ? amount(plan.risk.value) : equity.mul(amount(plan.risk.value)).div(100);
    if (plan.risk.mode === 'equity-percent' && amount(plan.risk.value).gt(100)) throw Error('Risk percentage exceeds account equity');
    result.requestedRisk = requested.toFixed();
    const scoped = reservations.filter(r => r.scope === result.scope);
    if (scoped.some(r => r.base === plan.base && r.planId !== plan.id)) throw Error('Another controlling plan already owns this account and instrument');
    if (snapshot.positions.some(p => p.symbol === plan.base && !new Decimal(p.size).isZero())
      || snapshot.orders.some(o => o.symbol === plan.base && !o.reduceOnly)) throw Error('Account/instrument must be flat with no working entry before plan replication');
    if (snapshot.positions.some(p => !new Decimal(p.size).isZero() && !scoped.some(r => r.base === p.symbol))
      || snapshot.orders.some(o => !o.reduceOnly && o.symbol !== plan.base && !scoped.some(r => r.base === o.symbol))) throw Error('Account-wide risk is unknown for external exposure; a gross notional cap alone does not bound loss');
    const reservedRisk = Decimal.sum(0, ...scoped.map(r => r.risk)), reservedMargin = Decimal.sum(0, ...scoped.map(r => r.margin));
    if (requested.plus(reservedRisk).gt(account.policy.maxRiskCash)) throw Error('Requested risk exceeds the remaining account risk limit');
    // Linear USDC contracts only. Fees and adverse entry/exit provision reduce quantity.
    const feeRate = amount(spec.takerFeeBps, true).div(10_000), slipRate = slippage.div(10_000);
    const lossPerUnit = localEntry.minus(localStop).abs().plus(localEntry.plus(localStop).mul(feeRate.plus(slipRate)));
    const size = requested.div(lossPerUnit).toDecimalPlaces(spec.sizeDecimals, Decimal.ROUND_DOWN);
    validateInstrumentOrder(size.toFixed(), localEntry.toFixed(), spec);
    validateInstrumentOrder(size.toFixed(), localStop.toFixed(), spec);
    // Missing configured leverage uses a conservative 1x margin estimate, never the venue maximum.
    const leverage = Decimal.min(amount(account.policy.maxLeverage), amount(spec.maxLeverage), amount(snapshot.leverageByInstrument?.[plan.base] ?? '1'));
    const notional = size.mul(localEntry), margin = notional.div(leverage);
    const fees = size.mul(localEntry.plus(localStop)).mul(feeRate), risk = size.mul(lossPerUnit);
    if (margin.plus(reservedMargin).gt(available)) throw Error('Insufficient available margin after existing reservations');
    if (amount(snapshot.grossNotional, true).plus(Decimal.sum(0, ...scoped.map(r => r.notional))).plus(notional).gt(account.policy.maxGrossNotional)) throw Error('Aggregate gross account exposure exceeds its limit');
    Object.assign(result, { size: size.toFixed(), entry: localEntry.toFixed(), stop: localStop.toFixed(), notional: notional.toFixed(),
      margin: margin.toFixed(), executableRisk: risk.toFixed(), estimatedFees: fees.toFixed(), status: 'ready' });
    if (stopPercent.lt(100)) result.reasons.push(`${new Decimal(100).minus(stopPercent).toFixed()}% of the position has no planned stop coverage`);
  } catch (error) { result.reasons.push(error instanceof Error ? error.message : 'Risk inputs are unavailable'); }
  return result;
}

/** Atomic within one command owner; service persists this state before dispatch. */
export class ReservationBook {
  private values = new Map<string, RiskReservation>();
  constructor(saved: RiskReservation[] = []) { for (const r of saved) this.values.set(r.id, { ...r }); }
  get all() { return [...this.values.values()].map(r => ({ ...r })); }
  reserve(allocations: AccountAllocation[], accounts: ExecutionAccount[]) {
    const next = new Map(this.values);
    for (const a of allocations) {
      if (a.status !== 'ready') throw Error('Blocked allocations cannot reserve risk');
      const account = accounts.find(x => x.id === a.accountId);
      if (!account || accountScope(account) !== a.scope) throw Error('Reservation account mismatch');
      const id = `${a.planId}:${a.accountId}`;
      if (next.has(id)) {
        const existing = next.get(id)!;
        if (existing.risk !== a.executableRisk || existing.margin !== a.margin || existing.base !== a.base) throw Error('Idempotency key reused with changed allocation');
        continue;
      }
      const scoped = [...next.values()].filter(r => r.scope === a.scope);
      if (scoped.some(r => r.base === a.base)) throw Error('Account/instrument already has a controlling plan');
      if (Decimal.sum(a.executableRisk, ...scoped.map(r => r.risk)).gt(account.policy.maxRiskCash)) throw Error('Concurrent plan exceeds risk budget');
      next.set(id, { id, accountId: a.accountId, scope: a.scope, base: a.base, planId: a.planId, risk: a.executableRisk, margin: a.margin, notional: a.notional, phase: 'reserved' });
    }
    this.values = next;
  }
  mark(id: string, phase: RiskReservation['phase']) { const r = this.values.get(id); if (r) this.values.set(id, { ...r, phase }); }
  release(id: string, authoritativeTerminal: boolean) {
    if (!authoritativeTerminal) throw Error('Uncertain execution retains its risk reservation until authoritative reconciliation');
    this.values.delete(id);
  }
}
