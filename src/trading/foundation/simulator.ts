import Decimal from 'decimal.js';
import { accountScope, type AccountAllocation, type ExecutionAccount, type RiskReservation, type TradePlan } from './domain.ts';
import { ReservationBook } from './risk.ts';

export type ChildPhase = 'submitted' | 'acknowledged' | 'partly-filled' | 'unprotected' | 'protected' | 'exiting' | 'confirmed-flat' | 'rejected' | 'unknown' | 'detached';
export interface SimChild {
  id: string; accountId: string; scope: string; venue: string; phase: ChildPhase; quantity: string;
  filled: string; remaining: string; stopAcknowledged: string; stopCoveragePercent: string;
  entryWorking: boolean; detached: boolean; lastSequence: number; reason: string;
}
export interface SimEvent {
  id: string; childId: string; sequence: number;
  kind: 'ack' | 'reject' | 'timeout' | 'fill' | 'protection' | 'exit' | 'manual-close' | 'reconcile-flat' | 'cancel-entry';
  quantity?: string;
}
export interface SimulationState {
  version: 1; planId: string; emergencyStopped: boolean; children: SimChild[];
  reservations: RiskReservation[]; events: SimEvent[]; seenIds: string[];
}
/** Deterministic lifecycle rehearsal; it makes no queue-priority or profitability claims. */
export class GroupSimulator {
  private stateValue: SimulationState;
  private book: ReservationBook;
  constructor(plan: TradePlan, allocations: AccountAllocation[], accounts: ExecutionAccount[], saved?: SimulationState) {
    if (saved) {
      if (saved.version !== 1 || saved.planId !== plan.id) throw Error('Simulator restart does not match plan');
      this.stateValue = structuredClone(saved); this.book = new ReservationBook(saved.reservations); return;
    }
    if (allocations.some(a => accounts.find(x => x.id === a.accountId)?.mode !== 'simulated')) throw Error('Only explicitly simulated accounts may run a rehearsal');
    this.book = new ReservationBook();
    this.book.reserve(allocations.filter(a => a.status === 'ready'), accounts);
    this.stateValue = { version: 1, planId: plan.id, emergencyStopped: false, children: allocations.map(a => ({
      id: `${plan.id}:${a.accountId}:entry`, accountId: a.accountId, scope: a.scope, venue: a.venue,
      phase: a.status === 'ready' ? 'submitted' : 'rejected', quantity: a.size, filled: '0', remaining: '0', stopAcknowledged: '0',
      stopCoveragePercent: a.stopCoveragePercent, entryWorking: a.status === 'ready', detached: false, lastSequence: -1,
      reason: a.status === 'ready' ? 'Simulated request submitted; no venue order exists' : a.reasons.join('; '),
    })), reservations: this.book.all, events: [], seenIds: [] };
  }
  get state(): SimulationState { this.stateValue.reservations = this.book.all; return structuredClone(this.stateValue); }
  apply(event: SimEvent) {
    if (this.stateValue.seenIds.includes(event.id)) return;
    const child = this.stateValue.children.find(c => c.id === event.childId);
    if (!child) throw Error('Event belongs to another plan/account');
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) throw Error('Event needs an authoritative account sequence');
    // Out-of-order cumulative snapshots cannot roll authoritative state backwards.
    if (event.sequence <= child.lastSequence) return;
    const amount = new Decimal(event.quantity ?? '0');
    if (!amount.isFinite() || amount.lt(0)) throw Error('Event quantity must be nonnegative');
    if (event.kind === 'fill' && (amount.gt(child.quantity) || amount.lt(child.filled))) throw Error('Cumulative fill exceeds allocation or moves backwards');
    if (event.kind === 'reconcile-flat' && (new Decimal(child.remaining).gt(0) || child.entryWorking)) throw Error('Cannot confirm flat while exposure or working entry remains');
    child.lastSequence = event.sequence;
    this.stateValue.seenIds.push(event.id); this.stateValue.seenIds = this.stateValue.seenIds.slice(-1_000);
    this.stateValue.events.push({ ...event }); this.stateValue.events = this.stateValue.events.slice(-1_000);
    const reservationId = `${this.stateValue.planId}:${child.accountId}`;
    switch (event.kind) {
      case 'ack': if (child.phase === 'submitted' || child.phase === 'unknown') child.phase = 'acknowledged'; break;
      case 'timeout': child.phase = 'unknown'; child.reason = 'Acknowledgment lost; reservation held, no automatic resubmission'; this.book.mark(reservationId, 'unknown'); break;
      case 'reject':
        child.entryWorking = false;
        if (new Decimal(child.remaining).gt(0)) { child.phase = 'unprotected'; child.reason = 'Entry remainder rejected; confirmed fill still requires protection'; }
        else { child.phase = 'rejected'; child.reason = 'Simulated follower rejected: insufficient margin'; this.book.release(reservationId, true); }
        break;
      case 'fill': {
        // Cumulative fills: duplicates and delayed events cannot increase allocation.
        if (amount.gt(child.quantity) || amount.lt(child.filled)) throw Error('Cumulative fill exceeds allocation or moves backwards');
        const additional = amount.minus(child.filled);
        child.filled = amount.toFixed(); child.remaining = new Decimal(child.remaining).plus(additional).toFixed();
        child.entryWorking = amount.lt(child.quantity) && !this.stateValue.emergencyStopped && !child.detached;
        this.book.mark(reservationId, 'filled'); this.updateProtection(child); break;
      }
      case 'protection': child.stopAcknowledged = Decimal.min(amount, child.remaining).toFixed(); this.updateProtection(child); break;
      case 'cancel-entry': child.entryWorking = false; if (new Decimal(child.remaining).isZero()) { child.phase = 'confirmed-flat'; this.book.release(reservationId, true); } else this.updateProtection(child); break;
      case 'exit': {
        // Reduce-only venue semantics cap racing TP/SL at the actual remaining size.
        child.remaining = Decimal.max(new Decimal(child.remaining).minus(amount), 0).toFixed();
        child.stopAcknowledged = Decimal.min(child.stopAcknowledged, child.remaining).toFixed();
        if (new Decimal(child.remaining).isZero()) { child.entryWorking = false; child.phase = 'exiting'; child.reason = 'Exit filled; awaiting authoritative flat snapshot'; }
        else this.updateProtection(child);
        break;
      }
      case 'manual-close': child.detached = true; child.entryWorking = false; child.remaining = '0'; child.stopAcknowledged = '0'; child.phase = 'detached'; child.reason = 'External close observed; follower detached until explicitly rejoined'; this.book.release(reservationId, true); break;
      case 'reconcile-flat':
        if (new Decimal(child.remaining).gt(0) || child.entryWorking) throw Error('Cannot confirm flat while exposure or working entry remains');
        child.phase = child.detached ? 'detached' : 'confirmed-flat'; child.reason = 'Simulated authoritative snapshot confirms no position or working entry'; this.book.release(reservationId, true); break;
    }
    this.stateValue.reservations = this.book.all;
  }
  private updateProtection(child: SimChild) {
    const remaining = new Decimal(child.remaining);
    if (!remaining.gt(0)) return;
    child.phase = new Decimal(child.stopAcknowledged).gte(remaining) ? 'protected'
      : new Decimal(child.filled).lt(child.quantity) ? 'partly-filled' : 'unprotected';
    child.reason = `${child.stopAcknowledged} stop acknowledged / ${child.remaining} open; ${child.entryWorking ? 'entry remainder working' : 'entry stopped'}`;
  }
  emergencyStop() {
    // Caller persists state before issuing cancellation/reduction events.
    this.stateValue.emergencyStopped = true;
    for (const child of this.stateValue.children) { child.entryWorking = false; if (new Decimal(child.remaining).gt(0)) child.phase = 'exiting'; }
  }
  summary() {
    const c = this.stateValue.children;
    return { protected: c.filter(x => x.phase === 'protected').length, rejected: c.filter(x => x.phase === 'rejected').length,
      unknown: c.filter(x => x.phase === 'unknown').length, confirmedFlat: c.filter(x => x.phase === 'confirmed-flat' || x.phase === 'detached').length,
      allFlat: c.every(x => x.phase === 'confirmed-flat' || x.phase === 'detached' || x.phase === 'rejected') };
  }
}

export function rehearsalAccounts(): ExecutionAccount[] {
  const principal = `0x${'1'.repeat(40)}`;
  return [
    { id: 'sim-hl-day', name: 'Hyperliquid Day Trading', environment: 'testnet', mode: 'simulated', identity: { venue: 'hyperliquid', principal, executionAddress: null } },
    { id: 'sim-hl-swing', name: 'Hyperliquid Swing', environment: 'testnet', mode: 'simulated', identity: { venue: 'hyperliquid', principal, executionAddress: `0x${'2'.repeat(40)}` } },
    { id: 'sim-lighter-scalp', name: 'Lighter Scalping', environment: 'testnet', mode: 'simulated', identity: { venue: 'lighter', owner: principal, accountIndex: 1, apiKeyIndex: 2 } },
    { id: 'sim-lighter-second', name: 'Lighter Reserve', environment: 'testnet', mode: 'simulated', identity: { venue: 'lighter', owner: principal, accountIndex: 2, apiKeyIndex: 2 } },
  ].map(a => ({ ...a, policy: { maxRiskCash: '500', maxGrossNotional: '100000', maxLeverage: '5' } })) as ExecutionAccount[];
}
export function simulatedSnapshot(account: ExecutionAccount, now: number) {
  const equity = ({ 'sim-hl-day': '2000', 'sim-hl-swing': '10000', 'sim-lighter-scalp': '4000', 'sim-lighter-second': '6000' } as Record<string, string>)[account.id] ?? '2000';
  return { accountId: account.id, scope: accountScope(account), environment: account.environment, venue: account.identity.venue,
    asOf: now, equity, availableMargin: equity, grossNotional: '0', positions: [], orders: [], fills: [], ordersComplete: true,
    tier: 'simulated', marginMode: 'cross' as const, imposedDelayMs: 0, permission: 'simulated' as const };
}
