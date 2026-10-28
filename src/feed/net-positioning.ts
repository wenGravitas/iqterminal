export type NetPositioningMethod = 'price-oi' | 'aggressor-flow-oi';
export type NetPositioningVenue = 'binance' | 'hyperliquid' | 'bybit';
export type NetPositioningSide = 'longs' | 'shorts';

export interface NetPositioningObservation {
  version: number;
  method: NetPositioningMethod;
  status: 'available' | 'unavailable';
  reason?: string;
  venue: NetPositioningVenue;
  market: 'perpetual';
  nativeSymbol: 'BTCUSDT' | 'BTC';
  units: string;
  startTimeMs: number;
  endTimeMs: number;
  attributionTimeMs: number;
  resolutionMs: number | null;
  direction: number | null;
  oiDeltaBtcDecimal: string | null;
  netLongsBtcDecimal: string | null;
  netShortsBtcDecimal: string | null;
  unclassifiedBtcDecimal: string | null;
  qualityFlags: string[];
  provenance: {
    openInterestStart?: { openInterestBtcDecimal?: string; sourceTimeMs?: number; receivedAtMs?: number; sourceTimeQuality?: string; quality?: string };
    openInterestEnd?: { openInterestBtcDecimal?: string; sourceTimeMs?: number; receivedAtMs?: number; sourceTimeQuality?: string; quality?: string };
    priceStart?: { price?: number; sourceTimeMs?: number; receivedAtMs?: number; priceDecimal?: string } | null;
    priceEnd?: { price?: number; sourceTimeMs?: number; receivedAtMs?: number; priceDecimal?: string } | null;
    maxPriceAgeMs?: number | null;
    tradeCoverage?: { fromMs?: number; toMs?: number; complete?: boolean; gap?: boolean } | null;
    aggressorBuyBtcDecimal?: string | null;
    aggressorSellBtcDecimal?: string | null;
    tradeCount?: number | null;
    [key: string]: unknown;
  };
}

export interface NetPositioningUnitVerification {
  status: 'verified' | 'inferred' | 'unverified';
  units?: string;
  evidence?: string[];
  sources?: string[];
}

export interface NetPositioningFeedStatus {
  state?: 'live' | 'stale' | 'error' | 'starting' | string;
  source?: string;
  error?: string | null;
  lastObservedAt?: number | null;
  expectedIntervalMs?: number;
  collectionStartedAt?: number | null;
  stale?: boolean;
  unitVerification?: NetPositioningUnitVerification;
}

export interface NetPositioningPayload {
  version: 1;
  method: NetPositioningMethod;
  market: 'perpetual';
  nativeSymbol: 'BTC';
  units: 'BTC';
  unitVerification: Partial<Record<NetPositioningVenue, NetPositioningUnitVerification>>;
  from: number;
  to: number;
  venues: NetPositioningVenue[];
  intervals: NetPositioningObservation[];
  truncated: boolean;
  feeds: Partial<Record<NetPositioningVenue, NetPositioningFeedStatus>>;
  pendingIntervals: number;
  history: string;
  semantics: string;
}

export interface NetVenueCandle {
  venue: NetPositioningVenue;
  netLongsBtc: number;
  netShortsBtc: number;
  unclassifiedBtc: number;
  oiDeltaBtc: number;
  netLongsBtcDecimal: string;
  netShortsBtcDecimal: string;
  unclassifiedBtcDecimal: string;
  oiDeltaBtcDecimal: string;
  aggressorBuyBtc: number | null;
  aggressorSellBtc: number | null;
  flowAvailableIntervals: number;
  flowUnavailableIntervals: number;
  availableIntervals: number;
  unavailableIntervals: number;
  minResolutionMs: number | null;
  maxResolutionMs: number | null;
  observations: NetPositioningObservation[];
}

export interface NetPositioningCandle {
  timeMs: number;
  venues: Partial<Record<NetPositioningVenue, NetVenueCandle>>;
}

interface ExactDecimal { units: bigint; scale: number }
const decimalPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

function parseDecimal(value: string | null): ExactDecimal | null {
  if (value === null || value.length > 80) return null;
  const match = decimalPattern.exec(value);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, '');
  const units = BigInt(digits || '0') * (match[1] ? -1n : 1n);
  return { units, scale: fraction.length };
}

function addDecimal(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  const scale = Math.max(a.scale, b.scale);
  const left = a.units * 10n ** BigInt(scale - a.scale);
  const right = b.units * 10n ** BigInt(scale - b.scale);
  return { units: left + right, scale };
}

function decimalNumber(value: ExactDecimal) {
  return Number(decimalString(value));
}

function decimalString(value: ExactDecimal) {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, '0');
  if (!value.scale) return `${negative ? '-' : ''}${digits}`;
  const point = digits.length - value.scale;
  const fraction = digits.slice(point).replace(/0+$/, '');
  return `${negative ? '-' : ''}${digits.slice(0, point)}${fraction ? `.${fraction}` : ''}`;
}

function zero() { return { units: 0n, scale: 0 }; }
function isVenue(value: unknown): value is NetPositioningVenue { return value === 'binance' || value === 'hyperliquid' || value === 'bybit'; }
function candleOpenForEnd(endTimeMs: number, intervalMs: number) {
  // Attribute by the interval's effective end timestamp to the host candle [open, close).
  return Math.floor(endTimeMs / intervalMs) * intervalMs;
}

/** Incremental four-hour store shared by both side panes for one method. */
export class NetPositioningHistory {
  private readonly intervals = new Map<string, NetPositioningObservation>();
  private readonly intervalByteSize = new Map<string, number>();
  private readonly byCandle = new Map<number, Map<NetPositioningVenue, Map<string, NetPositioningObservation>>>();
  private readonly candles = new Map<number, NetPositioningCandle>();
  private latest?: NetPositioningPayload;
  readonly stats = { snapshots: 0, patches: 0, intervalUpdates: 0, candleRebuilds: 0, historyIntervals: 0, bytes: 0 };

  constructor(readonly method: NetPositioningMethod, public candleIntervalMs: number) {
    if (!Number.isSafeInteger(candleIntervalMs) || candleIntervalMs <= 0) throw new RangeError('Invalid host candle interval');
  }

  setCandleInterval(intervalMs: number, requestedVenues: readonly NetPositioningVenue[] = ['binance', 'hyperliquid', 'bybit']) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new RangeError('Invalid host candle interval');
    if (intervalMs === this.candleIntervalMs) return [];
    const rows = [...this.intervals.values()];
    this.candleIntervalMs = intervalMs;
    this.intervals.clear(); this.intervalByteSize.clear(); this.byCandle.clear(); this.candles.clear(); this.stats.bytes = 0;
    const changed = this.upsert(rows, requestedVenues);
    this.updateStats();
    return changed;
  }

  replace(payload: NetPositioningPayload, requestedVenues: readonly NetPositioningVenue[]) {
    if (payload.method !== this.method) return [];
    this.intervals.clear(); this.intervalByteSize.clear(); this.byCandle.clear(); this.candles.clear(); this.stats.bytes = 0; this.latest = payload;
    this.stats.snapshots++;
    const changed = this.upsert(payload.intervals, requestedVenues);
    changed.push(...this.prune(payload.to - 4 * 60 * 60_000));
    this.updateStats();
    return changed;
  }

  apply(payload: NetPositioningPayload, changedRows: readonly NetPositioningObservation[], requestedVenues: readonly NetPositioningVenue[]) {
    if (payload.method !== this.method) return [];
    this.latest = payload; this.stats.patches++;
    const changed = this.upsert(changedRows, requestedVenues);
    changed.push(...this.prune(payload.to - 4 * 60 * 60_000));
    this.updateStats();
    return changed;
  }

  private upsert(rows: readonly NetPositioningObservation[], requestedVenues: readonly NetPositioningVenue[]) {
    const touched = new Set<string>();
    const selected = new Set(requestedVenues);
    for (const row of rows) {
      if (row.method !== this.method || !isVenue(row.venue) || !selected.has(row.venue)
        || !Number.isSafeInteger(row.endTimeMs) || row.attributionTimeMs !== row.endTimeMs
        || !Number.isSafeInteger(row.startTimeMs) || row.startTimeMs >= row.endTimeMs) continue;
      const key = `${row.venue}:${row.endTimeMs}`;
      const previous = this.intervals.get(key);
      if (previous && shallowSignature(previous) === shallowSignature(row)) continue;
      const signature = shallowSignature(row);
      this.stats.bytes += signature.length - (this.intervalByteSize.get(key) ?? 0);
      this.intervalByteSize.set(key, signature.length);
      this.intervals.set(key, row);
      const timeMs = candleOpenForEnd(row.endTimeMs, this.candleIntervalMs);
      let byVenue = this.byCandle.get(timeMs);
      if (!byVenue) this.byCandle.set(timeMs, byVenue = new Map());
      let venueRows = byVenue.get(row.venue);
      if (!venueRows) byVenue.set(row.venue, venueRows = new Map());
      venueRows.set(key, row);
      touched.add(`${timeMs}:${row.venue}`);
      this.stats.intervalUpdates++;
    }
    const changed: NetPositioningCandle[] = [];
    for (const item of touched) {
      const split = item.lastIndexOf(':');
      const timeMs = Number(item.slice(0, split)), venue = item.slice(split + 1) as NetPositioningVenue;
      const venues = this.candles.get(timeMs)?.venues ?? {};
      const next = { timeMs, venues: { ...venues } };
      const source = this.byCandle.get(timeMs)?.get(venue);
      if (source?.size) next.venues[venue] = aggregateVenue(venue, source.values());
      else delete next.venues[venue];
      if (Object.keys(next.venues).length) this.candles.set(timeMs, next);
      else this.candles.delete(timeMs);
      changed.push(next); this.stats.candleRebuilds++;
    }
    return changed;
  }

  private prune(cutoffMs: number) {
    const touched = new Set<string>();
    for (const [timeMs, venues] of this.byCandle) for (const [venue, rows] of venues) {
      for (const [key, row] of rows) if (row.endTimeMs < cutoffMs) {
        rows.delete(key); this.intervals.delete(key);
        this.stats.bytes -= this.intervalByteSize.get(key) ?? 0; this.intervalByteSize.delete(key);
        touched.add(`${timeMs}:${venue}`);
      }
      if (!rows.size) venues.delete(venue);
      if (!venues.size) this.byCandle.delete(timeMs);
    }
    while (this.intervals.size > 2_000) {
      const first = [...this.intervals.entries()].reduce<[string, NetPositioningObservation] | undefined>((oldest, item) =>
        !oldest || item[1].endTimeMs < oldest[1].endTimeMs ? item : oldest, undefined);
      if (!first) break;
      const [key, row] = first; this.intervals.delete(key);
      this.stats.bytes -= this.intervalByteSize.get(key) ?? 0; this.intervalByteSize.delete(key);
      const timeMs = candleOpenForEnd(row.endTimeMs, this.candleIntervalMs);
      const venueMap = this.byCandle.get(timeMs), venueRows = venueMap?.get(row.venue);
      venueRows?.delete(key);
      if (venueRows?.size === 0) venueMap?.delete(row.venue);
      if (venueMap && !venueMap.size) this.byCandle.delete(timeMs);
      touched.add(`${timeMs}:${row.venue}`);
    }
    const changed: NetPositioningCandle[] = [];
    for (const item of touched) {
      const split = item.lastIndexOf(':');
      const timeMs = Number(item.slice(0, split)), venue = item.slice(split + 1) as NetPositioningVenue;
      const existing = this.candles.get(timeMs), venues = { ...(existing?.venues ?? {}) };
      const source = this.byCandle.get(timeMs)?.get(venue);
      if (source?.size) venues[venue] = aggregateVenue(venue, source.values());
      else delete venues[venue];
      const next = { timeMs, venues };
      if (Object.keys(venues).length) this.candles.set(timeMs, next);
      else this.candles.delete(timeMs);
      changed.push(next); this.stats.candleRebuilds++;
    }
    return changed;
  }

  private updateStats() {
    this.stats.historyIntervals = this.intervals.size;
  }

  snapshot() { return [...this.candles.values()].sort((a, b) => a.timeMs - b.timeMs); }
  get(timeMs: number) { return this.candles.get(timeMs); }
  metadata() { return this.latest; }
  diagnostics() { return { ...this.stats, candleCount: this.candles.size, method: this.method, candleIntervalMs: this.candleIntervalMs }; }
  clear() { this.intervals.clear(); this.intervalByteSize.clear(); this.byCandle.clear(); this.candles.clear(); this.latest = undefined; this.stats.bytes = 0; this.updateStats(); }
}

function shallowSignature(row: NetPositioningObservation) {
  return [row.version, row.status, row.reason ?? '', row.oiDeltaBtcDecimal ?? '', row.netLongsBtcDecimal ?? '', row.netShortsBtcDecimal ?? '',
    row.unclassifiedBtcDecimal ?? '', row.direction ?? '', row.resolutionMs ?? '', row.qualityFlags.join(','),
    JSON.stringify(row.provenance)].join('|');
}

function aggregateVenue(venue: NetPositioningVenue, rows: Iterable<NetPositioningObservation>): NetVenueCandle {
  let netLongs = zero(), netShorts = zero(), unclassified = zero(), oiDelta = zero();
  let availableIntervals = 0, unavailableIntervals = 0, minResolutionMs: number | null = null, maxResolutionMs: number | null = null;
  let aggressorBuy = zero(), aggressorSell = zero(), flowAvailableIntervals = 0, flowUnavailableIntervals = 0;
  const observations: NetPositioningObservation[] = [];
  for (const row of rows) {
    observations.push(row);
    if (row.status !== 'available') { unavailableIntervals++; flowUnavailableIntervals++; continue; }
    const values = [parseDecimal(row.netLongsBtcDecimal), parseDecimal(row.netShortsBtcDecimal), parseDecimal(row.unclassifiedBtcDecimal), parseDecimal(row.oiDeltaBtcDecimal)];
    if (values.some(value => value === null)) { unavailableIntervals++; flowUnavailableIntervals++; continue; }
    netLongs = addDecimal(netLongs, values[0]!); netShorts = addDecimal(netShorts, values[1]!);
    unclassified = addDecimal(unclassified, values[2]!); oiDelta = addDecimal(oiDelta, values[3]!); availableIntervals++;
    const buy = parseDecimal(row.provenance.aggressorBuyBtcDecimal ?? null), sell = parseDecimal(row.provenance.aggressorSellBtcDecimal ?? null);
    if (buy && sell && row.provenance.tradeCoverage?.complete === true) {
      aggressorBuy = addDecimal(aggressorBuy, buy); aggressorSell = addDecimal(aggressorSell, sell); flowAvailableIntervals++;
    } else flowUnavailableIntervals++;
    if (row.resolutionMs !== null && Number.isFinite(row.resolutionMs)) {
      minResolutionMs = minResolutionMs === null ? row.resolutionMs : Math.min(minResolutionMs, row.resolutionMs);
      maxResolutionMs = maxResolutionMs === null ? row.resolutionMs : Math.max(maxResolutionMs, row.resolutionMs);
    }
  }
  observations.sort((a, b) => a.endTimeMs - b.endTimeMs);
  return { venue, netLongsBtc: decimalNumber(netLongs), netShortsBtc: decimalNumber(netShorts), unclassifiedBtc: decimalNumber(unclassified), oiDeltaBtc: decimalNumber(oiDelta),
    netLongsBtcDecimal: decimalString(netLongs), netShortsBtcDecimal: decimalString(netShorts), unclassifiedBtcDecimal: decimalString(unclassified), oiDeltaBtcDecimal: decimalString(oiDelta),
    aggressorBuyBtc: flowAvailableIntervals ? decimalNumber(aggressorBuy) : null, aggressorSellBtc: flowAvailableIntervals ? decimalNumber(aggressorSell) : null,
    flowAvailableIntervals, flowUnavailableIntervals, availableIntervals, unavailableIntervals, minResolutionMs, maxResolutionMs, observations };
}

export interface NetPositioningRequest {
  methods: NetPositioningMethod[];
  venues: NetPositioningVenue[];
}

export type NetPositioningEvent =
  | { type: 'net-positioning-snapshot'; ids: string[]; payload: NetPositioningPayload }
  | { type: 'net-positioning-patch'; ids: string[]; payload: NetPositioningPayload; intervals: NetPositioningObservation[] }
  | { type: 'net-positioning-error'; ids: string[]; method: NetPositioningMethod; message: string; at: number };

/** Estimated notional: sum each classified interval quantity × its recorded ending price.
 * A missing price makes quote conversion unavailable, never zero or a current-price substitute.
 */
const quoteProjectionCache = new WeakMap<NetVenueCandle, Partial<Record<NetPositioningSide, number | null>>>();
export function netPositioningQuote(data: NetVenueCandle, side: NetPositioningSide): number | null {
  let cached = quoteProjectionCache.get(data);
  if (cached && side in cached) return cached[side]!;
  const result = projectNetPositioningQuote(data, side);
  if (!cached) { cached = {}; quoteProjectionCache.set(data, cached); }
  cached[side] = result; return result;
}
function projectNetPositioningQuote(data: NetVenueCandle, side: NetPositioningSide): number | null {
  let total = 0, available = 0;
  for (const row of data.observations) {
    if (row.status !== 'available') continue;
    const quantity = side === 'longs' ? row.netLongsBtcDecimal : row.netShortsBtcDecimal;
    if (quantity === null || !Number.isFinite(Number(quantity))) continue;
    const source = row.provenance.priceEnd;
    const price = source?.priceDecimal != null ? Number(source.priceDecimal) : source?.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
    total += Number(quantity) * price; available++;
  }
  return available === data.availableIntervals && available > 0 && Number.isFinite(total) ? total : null;
}
