import { canonicalFootprintRowPrice, canonicalSeries, duration, footprintTicksForPrice, marketOf, validFootprintRowPrice, type Event, type FootprintBar, type FootprintRowTicks, type FootprintStatus, type Interval, type Market, type Series } from './protocol';
import {
  FOOTPRINT_FLUSH_MS, FOOTPRINT_MAX_PENDING, FOOTPRINT_MAX_RECENT_IDS,
  DEFAULT_FOOTPRINT_LIMITS,
  FootprintAccumulator, parseBinanceAggTrade, parseBinanceSpotAggTrade, parseBinanceBtcUsdtTickSize,
  type AggTradeObservation, type AggTradeReject, type FootprintLimits,
} from './footprint';

type ExecutionConsumer = (trades: readonly AggTradeObservation[], status: import('./protocol').Status, liveSince: number, integrity?: {tickSize:number|null;qualityRevision:number;correctionTime?:number}) => void;
const AGG_TRADE_SOCKET: Record<Market,string> = {
  perpetual: 'wss://fstream.binance.com/market/ws/btcusdt@aggTrade',
  spot: 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade',
};
const EXCHANGE_INFO: Record<Market,string> = {
  perpetual: 'https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=BTCUSDT',
  spot: 'https://api.binance.com/api/v3/exchangeInfo?symbol=BTCUSDT',
};
const STALE_AFTER_MS = 15_000;
const MAX_ACTIVE_GROUPS = 8;

export interface FootprintTransport {
  metadata(signal: AbortSignal, market?: Market): Promise<unknown>;
  socket(url: string): WebSocket;
  now(): number;
  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const browserTransport: FootprintTransport = {
  async metadata(signal, market = 'perpetual') {
    const response = await fetch(EXCHANGE_INFO[market], { signal });
    if (!response.ok) throw new Error(`Binance ${market} exchangeInfo HTTP ${response.status}`);
    return response.json();
  },
  socket: url => new WebSocket(url),
  now: Date.now,
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: timer => globalThis.clearInterval(timer),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: timer => globalThis.clearTimeout(timer),
};

interface Group {
  key: string;
  market: Market;
  interval: Interval;
  rowPrice: number;
  rowTicks: FootprintRowTicks | null;
  configurationError?: string;
  generation: number;
  ids: Set<string>;
  accumulator?: FootprintAccumulator;
  collectionStartedAt: number;
  firstTradeAt: number | null;
  lastTradeAt: number | null;
  eventTime: number | null;
  lastUpdate: number;
  dirty: boolean;
  outages: number;
  unknownSideRecords: number;
  unknownSideVolume: number;
  lateRecords: number;
  buyVolume: number;
  sellVolume: number;
  inFlight?: { batchId: number; event: FootprintTransportEvent };
  pendingSnapshot: boolean;
  pendingBars: Map<number, FootprintBar>;
  pendingStatus?: FootprintStatus;
}

type FootprintTransportEvent = Extract<Event, { type: 'footprint-status' | 'footprint-snapshot' | 'footprint-patch' }>;

/** One public BTCUSDT aggTrade socket per market, shared by its configurations. */
export class BinanceFootprintService {
  private executionConsumers = new Map<string, ExecutionConsumer>();
  private liveSince = 0;
  private executionQualityRevision = 0;
  private executionCorrectionTime?:number;
  private executionIntegrity() { return {tickSize:this.tickSize,qualityRevision:this.executionQualityRevision,correctionTime:this.executionCorrectionTime}; }
  private hasConsumers() { return this.groups.size > 0 || this.executionConsumers.size > 0; }
  subscribeExecutions(id: string, consumer: ExecutionConsumer) {
    this.executionConsumers.set(id, consumer);
    consumer([], { state: this.state, message: this.message, lastUpdate: this.lastUpdate }, this.liveSince, this.executionIntegrity());
    if (!this.opened) void this.start();
    return () => { this.executionConsumers.delete(id); if (!this.hasConsumers()) this.stop(true); };
  }
  private groups = new Map<string, Group>();
  private clients = new Map<string, string>();
  private tickSize: number | null = null;
  private ws?: WebSocket;
  private abort?: AbortController;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private flushTimer?: ReturnType<typeof setInterval>;
  private checkTimer?: ReturnType<typeof setInterval>;
  private openingTimer?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private nextGeneration = 0;
  private nextBatchId = 0;
  private startPromise?: Promise<void>;
  private attempts = 0;
  private online = true;
  private dead = false;
  private opened = false;
  private state: FootprintStatus['state'] = 'loading';
  private message = 'Waiting for a footprint subscriber';
  private lastUpdate = 0;
  private firstTradeAt: number | null = null;
  private lastTradeAt: number | null = null;
  private lastEventTime: number | null = null;
  private lastTradeId = -1;
  private lastTradeTime = -1;
  private expiredIdFloor = -1;
  private pending = new Map<number, AggTradeObservation>();
  private pendingIds = new Set<number>();
  private recentIds = new Set<number>();
  private recentOrder: number[] = [];
  private outageOpen = false;
  private rejected: Record<AggTradeReject, number> = {
    market: 0, contract: 0, symbol: 0, 'maker-side': 0, 'trade-id': 0,
    time: 0, price: 0, quantity: 0,
  };
  private counters = {
    messages: 0, accepted: 0, duplicates: 0, late: 0, unknownSide: 0,
    invalidGrid: 0, pendingFlushes: 0, socketOpens: 0, reconnects: 0,
    capacityDrops: 0, aggregationBatches: 0, aggregationObservations: 0,
    aggregationTotalMs: 0, aggregationMaxMs: 0,
  };

  private readonly limits: FootprintLimits;

  constructor(
    private readonly emit: (event: Event) => void,
    private readonly transport: FootprintTransport = browserTransport,
    limits: Partial<FootprintLimits> = {},
    private readonly measureAggregation = false,
    private readonly market: Market = 'perpetual',
  ) {
    this.limits = {
      maxBars: boundedLimit(limits.maxBars, DEFAULT_FOOTPRINT_LIMITS.maxBars),
      maxCells: boundedLimit(limits.maxCells, DEFAULT_FOOTPRINT_LIMITS.maxCells),
      maxCellsPerBar: boundedLimit(limits.maxCellsPerBar, DEFAULT_FOOTPRINT_LIMITS.maxCellsPerBar),
    };
  }

  command(command: Extract<import('./protocol').Command, { type: `footprint-${string}` }>) {
    if (command.type === 'footprint-subscribe') this.subscribe(command.id, command.series, command.rowPrice);
    else if (command.type === 'footprint-unsubscribe') this.unsubscribe(command.id);
    else if (command.type === 'footprint-retry') this.retry();
    else if (command.type === 'footprint-ack') this.acknowledge(command.key, command.generation, command.batchId);
  }

  subscribe(id: string, input: Series, rowPrice: number) {
    const series = canonicalSeries(input);
    if (!id || !series || series.venue !== 'binance' || marketOf(series) !== this.market || this.dead) return;
    if (!validFootprintRowPrice(rowPrice)) {
      const safePrice = Number.isFinite(rowPrice) ? rowPrice : 0;
      const key = groupKey(this.market, series.interval, safePrice);
      this.emit({ type: 'footprint-status', key, ids: [id], generation: ++this.nextGeneration, batchId: ++this.nextBatchId,
        status: this.statusFor(null, 'failed', 'Enter a price level greater than $0 and no more than $10,000 USDT') });
      return;
    }
    rowPrice = canonicalFootprintRowPrice(rowPrice);
    this.unsubscribe(id);
    if (!this.groups.has(groupKey(this.market, series.interval, rowPrice)) && this.groups.size >= MAX_ACTIVE_GROUPS) {
      const key = groupKey(this.market, series.interval, rowPrice);
      this.emit({ type: 'footprint-status', key, ids: [id], generation: ++this.nextGeneration, batchId: ++this.nextBatchId, status: this.statusFor(null, 'failed', `Footprint is limited to ${MAX_ACTIVE_GROUPS} active configurations`) });
      return;
    }
    const key = groupKey(this.market, series.interval, rowPrice);
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key, market: this.market, interval: series.interval, rowPrice, rowTicks: this.tickSize === null ? null : footprintTicksForPrice(rowPrice, this.tickSize), generation: ++this.nextGeneration, ids: new Set(),
        collectionStartedAt: this.transport.now(), firstTradeAt: null, lastTradeAt: null, eventTime: null,
        lastUpdate: 0, dirty: false, outages: 0, unknownSideRecords: 0, unknownSideVolume: 0,
        lateRecords: 0, buyVolume: 0, sellVolume: 0, pendingSnapshot: false, pendingBars: new Map(),
      };
      if (this.tickSize !== null) this.resolveGroupGrid(group);
      this.groups.set(key, group);
    }
    group.ids.add(id);
    this.clients.set(id, key);
    this.queueStatus(group);
    if (group.accumulator?.barCount) this.queueSnapshot(group);
    if (!this.opened) void this.start();
  }

  unsubscribe(id: string) {
    const key = this.clients.get(id);
    this.clients.delete(id);
    if (!key) return;
    const group = this.groups.get(key);
    if (!group) return;
    group.ids.delete(id);
    if (group.ids.size) return;
    group.accumulator?.dispose();
    this.groups.delete(key);
    if (!this.hasConsumers()) this.stop(true);
  }

  retry() {
    if (!this.online || !this.hasConsumers() || this.dead) return;
    this.attempts = 0;
    this.start(true);
  }

  acknowledge(key: string, generation: number, batchId: number) {
    const group = this.groups.get(key);
    if (!group || group.generation !== generation || group.inFlight?.batchId !== batchId) return;
    group.inFlight = undefined;
    this.dispatchPending(group);
  }

  setOnline(online: boolean) {
    if (this.online === online || this.dead) return;
    this.online = online;
    if (!online) {
      this.epoch++;
      this.startPromise = undefined;
      this.abort?.abort();
      if (this.ws) this.markOutage();
      this.closeSocket();
      this.clearRetry();
      this.discardPending();
      this.setStatus('stale', `Offline · Binance ${this.market} aggTrade collection paused`);
    } else if (this.hasConsumers()) {
      this.attempts = 0;
      this.start();
    }
  }

  diagnostics() {
    return {
      subscribers: this.clients.size, executionConsumers: this.executionConsumers.size,
      groups: [...this.groups.values()].map(group => ({
        key: group.key, market: group.market, clients: group.ids.size, bars: group.accumulator?.barCount ?? 0,
        cells: group.accumulator?.cellCount ?? 0, rowPrice: group.rowPrice, rowTicks: group.rowTicks, maxBars: this.limits.maxBars,
        rowSize: this.tickSize === null || group.rowTicks === null ? null : this.tickSize * group.rowTicks,
        firstTradeAt: group.firstTradeAt, lastTradeAt: group.lastTradeAt,
        collectionStartedAt: group.collectionStartedAt,
        generation: group.generation,
        transportInFlight: group.inFlight !== undefined,
        transportInFlightBars: group.inFlight?.event.type === 'footprint-status' ? 0 : group.inFlight?.event.bars.length ?? 0,
        transportPendingBars: group.pendingBars.size,
        transportSnapshotPending: group.pendingSnapshot,
        outages: group.accumulator?.outages ?? 0,
        capacityDrops: group.accumulator?.drops ?? 0,
        buyVolume: group.buyVolume, sellVolume: group.sellVolume,
        classifiedVolume: group.buyVolume + group.sellVolume,
        unknownSideRecords: group.unknownSideRecords, unknownSideVolume: group.unknownSideVolume, lateRecords: group.lateRecords,
      })),
      sockets: this.ws && this.ws.readyState <= 1 ? 1 : 0,
      connected: this.opened,
      tickSize: this.tickSize,
      pending: this.pending.size,
      recentIds: this.recentIds.size,
      lastTradeId: this.lastTradeId < 0 ? null : this.lastTradeId,
      expiredIdFloor: this.expiredIdFloor < 0 ? null : this.expiredIdFloor,
      lastTradeTime: this.lastTradeAt,
      lastEventTime: this.lastEventTime,
      counters: { ...this.counters },
      rejected: { ...this.rejected },
      state: this.state,
    };
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.stop(true);
    for (const group of this.groups.values()) group.accumulator?.dispose();
    this.groups.clear();
    this.clients.clear(); this.executionConsumers.clear();
  }

  private start(force = false) {
    if (!force && this.startPromise) return this.startPromise;
    const pending = this.startOnce(force).finally(() => {
      if (this.startPromise === pending) this.startPromise = undefined;
    });
    this.startPromise = pending;
    return pending;
  }

  private async startOnce(force = false): Promise<void> {
    if (this.dead || !this.online || !this.hasConsumers()) return;
    if (force) {
      this.epoch++;
      this.abort?.abort();
      this.clearRetry();
      if (this.ws) { this.markOutage(); this.discardPending(); }
      this.closeSocket();
    } else if (this.ws && this.ws.readyState <= 1) return;
    this.epoch++;
    const epoch = this.epoch;
    const marketLabel = this.market === 'spot' ? 'Spot' : 'USD-M perpetual';
    this.setStatus('loading', this.tickSize === null ? `Loading Binance ${marketLabel} BTCUSDT tick size…` : `Connecting to Binance BTCUSDT ${marketLabel} aggTrade…`);
    try {
      if (this.tickSize === null) {
        const controller = new AbortController();
        this.abort = controller;
        const timer = this.transport.setTimeout(() => controller.abort(), 12_000);
        try {
          const raw = await this.transport.metadata(controller.signal, this.market);
          if (this.dead || epoch !== this.epoch || controller.signal.aborted) return;
          const tickSize = parseBinanceBtcUsdtTickSize(raw, this.market);
          if (tickSize === null) throw new Error(`Binance ${marketLabel} exchangeInfo did not contain a valid BTCUSDT PRICE_FILTER.tickSize`);
          this.tickSize = tickSize;
          for (const group of this.groups.values()) {
            if (group.rowTicks !== null || group.configurationError) continue;
            this.resolveGroupGrid(group);
            this.queueStatus(group);
          }
        } finally {
          this.transport.clearTimeout(timer);
          if (this.abort === controller) this.abort = undefined;
        }
      }
      if (this.dead || epoch !== this.epoch || !this.hasConsumers()) return;
      if (!this.executionConsumers.size && ![...this.groups.values()].some(group => group.accumulator)) return;
      if (!this.flushTimer) this.flushTimer = this.transport.setInterval(() => this.flush(), FOOTPRINT_FLUSH_MS);
      if (!this.checkTimer) this.checkTimer = this.transport.setInterval(() => this.check(), 1000);
      this.openSocket(epoch);
    } catch (error) {
      if (this.dead || epoch !== this.epoch || !this.online) return;
      const message = error instanceof Error ? error.message : 'Binance exchange metadata unavailable';
      this.setStatus('stale', `${message} · retrying`);
      this.scheduleRetry();
    }
  }

  private openSocket(epoch: number) {
    const socket = this.transport.socket(AGG_TRADE_SOCKET[this.market]);
    this.ws = socket;
    this.opened = false;
    this.openingTimer = this.transport.setTimeout(() => { if (socket.readyState === 0) socket.close(); }, 12_000);
    socket.onopen = () => {
      if (this.epoch !== epoch || this.ws !== socket) return;
      this.transport.clearTimeout(this.openingTimer!);
      this.openingTimer = undefined;
      this.opened = true; this.liveSince = this.transport.now();
      this.outageOpen = false;
      this.attempts = 0;
      this.counters.socketOpens++;
      this.setStatus('loading', `Connected · waiting for the first Binance ${this.market} aggregate trade; no classified history`);
    };
    socket.onmessage = event => {
      if (this.epoch !== epoch || this.ws !== socket) return;
      this.counters.messages++;
      let raw: unknown;
      try { raw = JSON.parse(String(event.data)); } catch { this.rejected.market++; return; }
      const parsed = this.market === 'spot' ? parseBinanceSpotAggTrade(raw) : parseBinanceAggTrade(raw);
      if ('ignored' in parsed) return;
      if ('rejected' in parsed) { this.rejected[parsed.rejected]++; return; }
      this.queue(parsed.trade);
    };
    socket.onerror = () => {
      if (this.epoch === epoch && this.ws === socket) this.setStatus('stale', `Binance ${this.market} aggTrade connection error · reconnecting`);
    };
    socket.onclose = () => {
      if (this.openingTimer) this.transport.clearTimeout(this.openingTimer);
      this.openingTimer = undefined;
      if (this.epoch !== epoch || this.ws !== socket || this.dead || !this.hasConsumers() || !this.online) return;
      this.ws = undefined;
      this.opened = false;
      this.discardPending();
      this.markOutage();
      this.counters.reconnects++;
      this.setStatus('stale', `Binance ${this.market} aggTrade disconnected · reconnecting; affected bars are marked gapped`);
      this.scheduleRetry();
    };
  }

  private queue(trade: AggTradeObservation) {
    if (this.recentIds.has(trade.id) || this.pendingIds.has(trade.id)) { this.counters.duplicates++; return; }
    if (trade.id <= this.expiredIdFloor || trade.timeMs < this.lastTradeTime) { this.markLate(trade); return; }
    trade.receivedAtMs ??= this.transport.now();
    this.pending.set(trade.id, trade);
    this.pendingIds.add(trade.id);
    if (this.pending.size >= FOOTPRINT_MAX_PENDING) {
      this.counters.pendingFlushes++;
      this.flushPending();
    }
  }

  private flush() {
    this.flushPending();
    const dirtyGroups = [...this.groups.values()].filter(group => group.dirty);
    for (const group of dirtyGroups) {
      const bars = group.accumulator?.drainDirty() ?? [];
      group.dirty = false;
      if (bars.length) this.queuePatch(group, bars);
      else this.queueStatus(group);
    }
  }

  private flushPending() {
    if (!this.pending.size) return;
    const batch = [...this.pending.values()].sort((a, b) => a.timeMs - b.timeMs || a.id - b.id);
    this.pending.clear();
    this.pendingIds.clear();
    const executions: AggTradeObservation[] = [];
    const startedAt = this.measureAggregation ? performance.now() : 0;
    try { for (const trade of batch) {
      if (trade.id <= this.expiredIdFloor || trade.timeMs < this.lastTradeTime) { this.markLate(trade); continue; }
      this.remember(trade.id);
      if (this.executionConsumers.size) executions.push(trade);
      this.lastTradeId = Math.max(this.lastTradeId, trade.id);
      this.lastTradeTime = trade.timeMs;
      this.lastTradeAt = trade.timeMs;
      this.lastEventTime = trade.eventTimeMs;
      this.lastUpdate = this.transport.now();
      // A quiet connection can recover without closing the socket. The outage
      // remains recorded on the affected bar, while the next fully observed
      // interval may start cleanly.
      this.outageOpen = false;
      let appliedAny = false;
      for (const group of this.groups.values()) {
        const result = group.accumulator?.ingest(trade);
        if (result === 'applied') {
          appliedAny = true;
          group.dirty = true;
          group.lastTradeAt = trade.timeMs;
          group.eventTime = trade.eventTimeMs;
          group.lastUpdate = this.lastUpdate;
          group.firstTradeAt ??= trade.timeMs;
          if (trade.side === 'buy') group.buyVolume += trade.quantity;
          else if (trade.side === 'sell') group.sellVolume += trade.quantity;
          group.outages = group.accumulator?.outages ?? 0;
        } else if (result === 'capacity') {
          group.dirty = true;
          group.lastTradeAt = trade.timeMs;
          group.eventTime = trade.eventTimeMs;
          group.lastUpdate = this.lastUpdate;
          group.outages = group.accumulator?.outages ?? 0;
        } else if (result === 'unknown-side') {
          group.unknownSideRecords++;
          group.unknownSideVolume += trade.quantity;
        } else if (result === 'invalid-grid') this.counters.invalidGrid++;
        else if (result === 'late') this.counters.late++;
        if (result === 'capacity') this.counters.capacityDrops++;
      }
      if (trade.side === 'unknown') this.counters.unknownSide++;
      if (appliedAny || this.executionConsumers.size) this.counters.accepted++;
      this.setStatus('live', this.liveMessage());
    }
      if (executions.length) for (const consumer of this.executionConsumers.values()) consumer(executions, { state: this.state, message: this.message, lastUpdate: this.lastUpdate }, this.liveSince, this.executionIntegrity());
    } finally {
      if (this.measureAggregation) {
        const elapsed = Math.max(0, performance.now() - startedAt);
        this.counters.aggregationBatches++;
        this.counters.aggregationObservations += batch.length;
        this.counters.aggregationTotalMs += elapsed;
        this.counters.aggregationMaxMs = Math.max(this.counters.aggregationMaxMs, elapsed);
      }
    }
  }

  private remember(id: number) {
    this.recentIds.add(id);
    this.recentOrder.push(id);
    if (this.recentOrder.length > FOOTPRINT_MAX_RECENT_IDS) {
      const expired = this.recentOrder.shift()!;
      this.recentIds.delete(expired);
      this.expiredIdFloor = Math.max(this.expiredIdFloor, expired);
    }
  }

  private discardPending() {
    for (const trade of this.pending.values()) this.markLate(trade);
    this.pending.clear();
    this.pendingIds.clear();
  }

  private markLate(trade: AggTradeObservation) {
    this.executionCorrectionTime=trade.timeMs;
    this.executionQualityRevision++;
    for (const consumer of this.executionConsumers.values()) consumer([], {state:this.state,message:this.message,lastUpdate:this.lastUpdate},this.liveSince,this.executionIntegrity());
    this.counters.late++;
    for (const group of this.groups.values()) {
      if (group.accumulator?.markCoverageGap(trade.timeMs)) {
        group.lateRecords++;
        group.dirty = true;
      }
    }
  }

  private check() {
    if (this.state === 'live' && this.lastUpdate && this.transport.now() - this.lastUpdate > STALE_AFTER_MS) {
      this.markOutage();
      this.setStatus('stale', `No valid Binance ${this.market} aggTrade observation for 15s · retained coverage marked gapped; waiting for reconnect or new trades`);
    }
  }

  private liveMessage() {
    const outages = Math.max(0, ...[...this.groups.values()].map(group => group.accumulator?.outages ?? 0));
    const drops = Math.max(0, ...[...this.groups.values()].map(group => group.accumulator?.drops ?? 0));
    const unknown = [...this.groups.values()].reduce((sum, group) => sum + group.unknownSideRecords, 0);
    const late = [...this.groups.values()].reduce((sum, group) => sum + group.lateRecords, 0);
    if (drops) return `Live · ${drops} aggregate observations rejected at the bounded ladder cap · coverage incomplete`;
    if (late) return `Live · ${late} late aggregate observation${late === 1 ? '' : 's'} discarded; affected retained bars are marked gapped`;
    if (outages) return `Live · ${outages} observation outage${outages === 1 ? '' : 's'} marked in bar coverage`;
    if (unknown) return `Live · ${unknown} aggregate observation${unknown === 1 ? '' : 's'} excluded because aggressor side is unknown`;
    return `Live · partial first interval; Binance ${this.market} aggTrade observations only`;
  }

  private setStatus(state: FootprintStatus['state'], message: string) {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    for (const consumer of this.executionConsumers.values()) consumer([], { state, message, lastUpdate: this.lastUpdate }, this.liveSince, this.executionIntegrity());
    for (const group of this.groups.values()) this.emitStatus(group);
  }

  private emitStatus(group: Group) {
    this.queueStatus(group);
  }

  private queueStatus(group: Group) {
    group.pendingStatus = this.statusFor(group);
    this.dispatchPending(group);
  }

  private queueSnapshot(group: Group) {
    group.pendingSnapshot = true;
    group.pendingBars.clear();
    group.pendingStatus = this.statusFor(group);
    this.dispatchPending(group);
  }

  private queuePatch(group: Group, bars: FootprintBar[]) {
    const retentionStart = group.accumulator?.oldestTime ?? null;
    if (retentionStart === null) {
      group.pendingSnapshot = true;
      group.pendingBars.clear();
    } else if (!group.pendingSnapshot) {
      for (const time of group.pendingBars.keys()) if (time < retentionStart) group.pendingBars.delete(time);
      for (const bar of bars) if (bar.time >= retentionStart) group.pendingBars.set(bar.time, bar);
      while (group.pendingBars.size > this.limits.maxBars) {
        let oldest = Infinity;
        for (const time of group.pendingBars.keys()) oldest = Math.min(oldest, time);
        group.pendingBars.delete(oldest);
      }
    }
    group.pendingStatus = this.statusFor(group);
    this.dispatchPending(group);
  }

  private dispatchPending(group: Group) {
    if (group.inFlight || !group.ids.size) return;
    let event: FootprintTransportEvent;
    const generation = group.generation;
    const batchId = ++this.nextBatchId;
    if (group.pendingSnapshot) {
      const bars = group.accumulator?.snapshot() ?? [];
      group.pendingSnapshot = false;
      group.pendingBars.clear();
      event = {
        type: 'footprint-snapshot', key: group.key, ids: [...group.ids], generation, batchId,
        bars, retentionStart: group.accumulator?.oldestTime ?? null,
        status: group.pendingStatus ?? this.statusFor(group),
      };
      group.pendingStatus = undefined;
    } else if (group.pendingBars.size) {
      const bars = [...group.pendingBars.values()].sort((a, b) => a.time - b.time);
      group.pendingBars.clear();
      event = {
        type: 'footprint-patch', key: group.key, ids: [...group.ids], generation, batchId,
        bars, retentionStart: group.accumulator?.oldestTime ?? null,
        status: group.pendingStatus ?? this.statusFor(group),
      };
      group.pendingStatus = undefined;
    } else if (group.pendingStatus) {
      event = {
        type: 'footprint-status', key: group.key, ids: [...group.ids], generation, batchId,
        status: group.pendingStatus,
      };
      group.pendingStatus = undefined;
    } else return;
    group.inFlight = { batchId, event };
    this.emit(event);
  }

  private markOutage() {
    if (this.outageOpen) return;
    this.outageOpen = true;
    this.executionCorrectionTime=undefined;
    this.executionQualityRevision++;
    for (const group of this.groups.values()) {
      group.accumulator?.markGap(this.transport.now());
      group.outages = group.accumulator?.outages ?? 0;
      group.dirty = Boolean(group.accumulator?.barCount);
    }
  }

  private statusFor(group: Group | null, state = this.state, message = this.message): FootprintStatus {
    if (group?.configurationError) { state = 'failed'; message = group.configurationError; }
    const accumulator = group?.accumulator;
    const outages = accumulator?.outages ?? 0;
    const drops = accumulator?.drops ?? 0;
    const unknownSideRecords = group?.unknownSideRecords ?? 0;
    const coverage: FootprintStatus['coverage'] = drops ? 'capacity-limited'
      : unknownSideRecords ? 'unclassified' : outages || (group?.lateRecords ?? 0) > 0 ? 'gapped' : !group?.firstTradeAt ? 'waiting' : 'partial';
    return {
      state, message, lastUpdate: group?.lastUpdate ?? this.lastUpdate,
      tickSize: this.tickSize, rowSize: this.tickSize === null || !group || group.rowTicks === null ? null : this.tickSize * group.rowTicks,
      collectionStartedAt: group?.collectionStartedAt ?? null,
      firstTradeAt: group?.firstTradeAt ?? null, lastTradeAt: group?.lastTradeAt ?? null,
      eventTime: group?.eventTime ?? null, outages,
      lateRecords: group?.lateRecords ?? 0,
      capacityDrops: drops, unknownSideRecords, unknownSideVolume: group?.unknownSideVolume ?? 0,
      coverage, retentionStart: accumulator?.oldestTime ?? null,
    };
  }

  private resolveGroupGrid(group: Group) {
    if (this.tickSize === null) return;
    const rowTicks = footprintTicksForPrice(group.rowPrice, this.tickSize);
    if (rowTicks === null) {
      group.rowTicks = null;
      group.configurationError = `Price level $${formatPrice(group.rowPrice)} USDT must be an exact multiple of the BTCUSDT tick size $${formatPrice(this.tickSize)}. Choose a matching price level.`;
      group.accumulator?.dispose();
      group.accumulator = undefined;
      return;
    }
    group.configurationError = undefined;
    group.rowTicks = rowTicks;
    group.accumulator ??= new FootprintAccumulator(group.interval, this.tickSize, rowTicks, this.limits);
  }

  private scheduleRetry() {
    if (this.retryTimer || this.dead || !this.online || !this.hasConsumers()) return;
    this.attempts++;
    if (this.attempts > 5) {
      this.setStatus('failed', `Binance ${this.market} aggTrade repeatedly failed · use Retry`);
      return;
    }
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts, 5)) * .75;
    this.retryTimer = this.transport.setTimeout(() => {
      this.retryTimer = undefined;
      this.counters.reconnects++;
      this.start();
    }, wait);
  }

  private clearRetry() {
    if (this.retryTimer) this.transport.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private closeSocket() {
    this.opened = false;
    if (this.openingTimer) this.transport.clearTimeout(this.openingTimer);
    this.openingTimer = undefined;
    const socket = this.ws;
    this.ws = undefined;
    if (socket) {
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      socket.close();
    }
  }

  private stop(clearGroups: boolean) {
    this.epoch++;
    this.startPromise = undefined;
    this.abort?.abort();
    this.abort = undefined;
    this.clearRetry();
    this.closeSocket();
    if (this.flushTimer) this.transport.clearInterval(this.flushTimer);
    if (this.checkTimer) this.transport.clearInterval(this.checkTimer);
    this.flushTimer = undefined;
    this.checkTimer = undefined;
    this.pending.clear(); this.pendingIds.clear();
    this.recentIds.clear(); this.recentOrder = [];
    this.lastTradeId = -1; this.lastTradeTime = -1; this.expiredIdFloor = -1; this.outageOpen = false;
    this.firstTradeAt = null; this.lastTradeAt = null; this.lastEventTime = null; this.lastUpdate = 0;
    if (clearGroups) {
      for (const group of this.groups.values()) group.accumulator?.dispose();
      this.groups.clear(); this.clients.clear();
    }
  }
}

function groupKey(market: Market, interval: Interval, rowPrice: number) {
  return `binance:${market}:BTCUSDT:footprint:${interval}:p${canonicalFootprintRowPrice(rowPrice)}`;
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 }).format(value) : '—';
}

function boundedLimit(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isInteger(value) || value < 1) throw new RangeError('Footprint retention limits must be positive integers');
  return Math.min(value, maximum);
}
