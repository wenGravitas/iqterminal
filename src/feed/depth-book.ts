/**
 * Binance USD-M diff-depth synchronizer.
 *
 * Snapshot coverage is deliberately immutable for one synchronization epoch.
 * A stream can add levels outside a REST snapshot, but it cannot prove that all
 * intervening levels were present; therefore the original outer levels remain
 * the conservative edge of what this book may call complete.
 */
export interface DepthLevel { price: number; size: number }
export interface DepthSnapshot {
  lastUpdateId: number;
  bids: readonly (readonly [string | number, string | number])[];
  asks: readonly (readonly [string | number, string | number])[];
}
export interface DepthDiff {
  U: number;
  u: number;
  pu: number;
  b: readonly (readonly [string | number, string | number])[];
  a: readonly (readonly [string | number, string | number])[];
}
export interface DepthMeasurement {
  sampledAt: number;
  mid: number;
  bandPercent: number;
  bidBase: number | null;
  bidQuote: number | null;
  askBase: number | null;
  askQuote: number | null;
  bidCovered: boolean;
  askCovered: boolean;
}

export const DEPTH_BANDS_PERCENT = Object.freeze(Array.from({ length: 25 }, (_, i) => (i + 1) / 100));

function validSequence(value: number) { return Number.isSafeInteger(value) && value >= 0; }
function pairs(values: readonly (readonly [string | number, string | number])[]) {
  return values.map(([price, size]) => [Number(price), Number(size)] as const)
    .filter(([price, size]) => Number.isFinite(price) && price > 0 && Number.isFinite(size) && size >= 0);
}

export class BinanceDepthBook {
  private readonly bidLevels = new Map<number, number>();
  private readonly askLevels = new Map<number, number>();
  private buffered: DepthDiff[] = [];
  private last = 0;
  private synced = false;
  private failed = false;
  private bidBoundary: number | null = null;
  private askBoundary: number | null = null;
  private receivedAt = 0;
  private epochStart = 0;

  constructor(private readonly maxBufferedEvents = 20_000) {}

  get state(): 'syncing' | 'live' | 'failed' { return this.failed ? 'failed' : this.synced ? 'live' : 'syncing'; }
  get lastUpdateId() { return this.last; }
  get snapshotStartedAt() { return this.epochStart; }
  get snapshotBidBoundary() { return this.bidBoundary; }
  get snapshotAskBoundary() { return this.askBoundary; }
  get lastReceivedAt() { return this.receivedAt; }
  get bufferedCount() { return this.buffered.length; }

  beginSync() {
    this.synced = false;
    this.failed = false;
    this.last = 0;
    this.epochStart = 0;
    this.bidBoundary = null;
    this.askBoundary = null;
    this.bidLevels.clear();
    this.askLevels.clear();
    this.buffered = [];
  }

  markFailed() {
    this.synced = false;
    this.failed = true;
    this.bidLevels.clear();
    this.askLevels.clear();
  }

  push(diff: DepthDiff, receivedAt: number): 'buffered' | 'applied' | 'gap' | 'invalid' {
    if (!validSequence(diff.U) || !validSequence(diff.u) || !validSequence(diff.pu) || diff.u < diff.U) return 'invalid';
    this.receivedAt = receivedAt;
    if (!this.synced) {
      if (this.buffered.length >= this.maxBufferedEvents) {
        this.buffered = [];
        return 'gap';
      }
      this.buffered.push(diff);
      return 'buffered';
    }
    if (diff.pu !== this.last) {
      this.synced = false;
      this.bidLevels.clear();
      this.askLevels.clear();
      this.bidBoundary = null;
      this.askBoundary = null;
      this.buffered = [diff];
      return 'gap';
    }
    this.apply(diff);
    this.last = diff.u;
    return 'applied';
  }

  /** Apply a REST snapshot after its corresponding websocket events were buffered. */
  applySnapshot(snapshot: DepthSnapshot, sampledAt: number): boolean {
    if (!validSequence(snapshot.lastUpdateId)) return false;
    const bids = pairs(snapshot.bids).filter(([, size]) => size > 0);
    const asks = pairs(snapshot.asks).filter(([, size]) => size > 0);
    if (!bids.length || !asks.length) return false;
    this.bidLevels.clear();
    this.askLevels.clear();
    for (const [price, size] of bids) this.bidLevels.set(price, size);
    for (const [price, size] of asks) this.askLevels.set(price, size);
    this.bidBoundary = Math.min(...bids.map(([price]) => price));
    this.askBoundary = Math.max(...asks.map(([price]) => price));
    this.last = snapshot.lastUpdateId;
    this.epochStart = sampledAt;

    const pending = this.buffered;
    this.buffered = [];
    const relevant = pending.filter(event => event.u >= snapshot.lastUpdateId);
    const firstIndex = relevant.findIndex(event => event.U <= snapshot.lastUpdateId && event.u >= snapshot.lastUpdateId);
    if (firstIndex < 0) {
      // Keep events received after this snapshot so a newer snapshot can bridge them.
      this.buffered = pending;
      this.synced = false;
      return false;
    }
    let expectedPrevious = snapshot.lastUpdateId;
    for (let index = firstIndex; index < relevant.length; index++) {
      const event = relevant[index];
      if (index === firstIndex) {
        if (event.U > expectedPrevious || event.u < expectedPrevious) return this.rejectBridge();
      } else if (event.pu !== expectedPrevious) {
        return this.rejectBridge();
      }
      this.apply(event);
      expectedPrevious = event.u;
    }
    this.last = expectedPrevious;
    this.synced = true;
    this.failed = false;
    this.receivedAt = Math.max(this.receivedAt, sampledAt);
    return true;
  }

  measure(bandPercent: number, sampledAt: number): DepthMeasurement | null {
    if (!this.synced || !Number.isFinite(bandPercent) || bandPercent <= 0 || !Number.isFinite(sampledAt)) return null;
    const bestBid = maxKey(this.bidLevels);
    const bestAsk = minKey(this.askLevels);
    if (bestBid === null || bestAsk === null || bestBid >= bestAsk) return null;
    const mid = (bestBid + bestAsk) / 2;
    const bidLow = mid * (1 - bandPercent / 100);
    const askHigh = mid * (1 + bandPercent / 100);
    const bidCovered = this.bidBoundary !== null && bidLow >= this.bidBoundary;
    const askCovered = this.askBoundary !== null && askHigh <= this.askBoundary;
    const bid = bidCovered ? sum(this.bidLevels, price => price >= bidLow && price <= mid) : null;
    const ask = askCovered ? sum(this.askLevels, price => price >= mid && price <= askHigh) : null;
    return {
      sampledAt, mid, bandPercent,
      bidBase: bid?.base ?? null,
      bidQuote: bid?.quote ?? null,
      askBase: ask?.base ?? null,
      askQuote: ask?.quote ?? null,
      bidCovered,
      askCovered,
    };
  }

  private rejectBridge() {
    this.synced = false;
    this.bidLevels.clear();
    this.askLevels.clear();
    this.bidBoundary = null;
    this.askBoundary = null;
    return false;
  }

  private apply(event: DepthDiff) {
    applySide(this.bidLevels, event.b);
    applySide(this.askLevels, event.a);
  }
}

function applySide(target: Map<number, number>, raw: readonly (readonly [string | number, string | number])[]) {
  for (const [price, size] of pairs(raw)) {
    if (size === 0) target.delete(price);
    else target.set(price, size);
  }
}
function maxKey(levels: Map<number, number>) {
  let value: number | null = null;
  for (const price of levels.keys()) if (value === null || price > value) value = price;
  return value;
}
function minKey(levels: Map<number, number>) {
  let value: number | null = null;
  for (const price of levels.keys()) if (value === null || price < value) value = price;
  return value;
}
function sum(levels: Map<number, number>, include: (price: number) => boolean) {
  let base = 0;
  let quote = 0;
  for (const [price, size] of levels) {
    if (include(price)) { base += size; quote += price * size; }
  }
  return { base, quote };
}
