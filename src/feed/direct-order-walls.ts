import { OrderWallDetector, orderWallsSettings,
  type OrderWallDepthRecord, type OrderWallMarket, type OrderWallRequest,
  type OrderWallStatus, type OrderWallsSettings } from './order-walls';
import type { BinanceDepthBook } from './depth-book';
import type { BinanceDepthService } from './depth-service';
import type { Command, Event } from './protocol';

type WallCommand = Extract<Command, { type: 'order-wall-subscribe' | 'order-wall-unsubscribe' | 'order-wall-settings' | 'order-wall-viewport' }>;
interface Subscription {
  id: string; key: string; market: OrderWallMarket; settings: OrderWallsSettings;
  from: number; to: number; detector: OrderWallDetector; release?: () => void;
  autoPriceWidth: number;
  cursor: number; epoch?: number; priorBids?: Map<number, number>; priorAsks?: Map<number, number>;
  firstObserved?: number; batch: number;
}

/** Live-only adapter over the already shared USD-M depth synchronizer. It opens no socket. */
export class DirectOrderWallsService {
  private subscriptions = new Map<string, Subscription>();
  private fixture = false;
  private disposed = false;
  constructor(private depth: BinanceDepthService, private emit: (event: Event) => void, private now = Date.now) {}

  setFixture(value: boolean) {
    this.fixture = value;
    if (value) for (const sub of this.subscriptions.values()) {
      sub.release?.(); sub.release = undefined;
      this.unavailable(sub, 'Order Walls require a live Binance depth feed; fixture candles are not a depth fallback.');
    }
  }

  command(command: WallCommand) {
    if (command.type === 'order-wall-subscribe') this.subscribe(command.id, command.request);
    else if (command.type === 'order-wall-unsubscribe') this.unsubscribe(command.id);
    else if (command.type === 'order-wall-settings') this.updateSettings(command.id, command.settings);
    else this.updateViewport(command.id, command.from, command.to, command.autoPriceWidth);
  }

  private subscribe(id: string, request: OrderWallRequest) {
    this.unsubscribe(id);
    const settings = orderWallsSettings(request.settings), sub: Subscription = {
      id, market: request.market, key: `${request.market}:${detectKey(settings)}`, settings,
      from: request.from, to: request.to, autoPriceWidth: request.autoPriceWidth ?? 50,
      detector: new OrderWallDetector(settings, .1, request.autoPriceWidth ?? 50), cursor: 0, batch: 0,
    };
    this.subscriptions.set(id, sub);
    if (request.market !== 'binance-perp') {
      this.unavailable(sub, request.market === 'hyperliquid'
        ? 'Hyperliquid BTC depth is unavailable from the connected market-data source.'
        : 'Binance Spot depth history is available only through the staging observation API.');
      return;
    }
    if (this.fixture) { this.unavailable(sub, 'Order Walls require a live Binance depth feed; fixture candles are not a depth fallback.'); return; }
    sub.release = this.depth.observeBook(id, (book, at, epoch) => this.onBook(sub, book, at, epoch));
  }

  private unsubscribe(id: string) {
    const sub = this.subscriptions.get(id); if (!sub) return;
    this.subscriptions.delete(id); sub.release?.();
  }

  private updateSettings(id: string, raw: OrderWallsSettings) {
    const sub = this.subscriptions.get(id); if (!sub) return;
    const settings = orderWallsSettings(raw), changed = detectKey(settings) !== detectKey(sub.settings);
    sub.settings = settings; sub.key = `${sub.market}:${detectKey(settings)}`;
    if (changed) {
      // Direct mode has no retained raw history to replay. Re-seed the current confirmed
      // book and mark the wall start as left-censored instead of fabricating an inception.
      sub.detector = new OrderWallDetector(settings, .1, sub.autoPriceWidth);
      if (sub.priorBids && sub.priorAsks && sub.epoch !== undefined) {
        const at = this.now();
        this.apply(sub, { kind: 'snapshot', at, cursor: ++sub.cursor, epoch: sub.epoch,
          bids: [...sub.priorBids], asks: [...sub.priorAsks], bookScope: { bidComplete: false, askComplete: false } });
      }
      this.publish(sub, 'snapshot', sub.detector.snapshot(), this.status(sub));
    } else this.publish(sub, 'patch', [], this.status(sub));
  }

  private updateViewport(id: string, from: number, to: number, autoPriceWidth?: number) {
    const sub = this.subscriptions.get(id); if (!sub || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return;
    sub.from = from; sub.to = to;
    if (sub.settings.aggregation === 'auto' && Number.isFinite(autoPriceWidth) && autoPriceWidth! >= .1
      && autoPriceWidth !== sub.autoPriceWidth) {
      sub.autoPriceWidth = autoPriceWidth!;
      sub.detector = new OrderWallDetector(sub.settings, .1, sub.autoPriceWidth);
      if (sub.priorBids && sub.priorAsks && sub.epoch !== undefined) {
        const at = this.now();
        this.apply(sub, { kind: 'snapshot', at, cursor: ++sub.cursor, epoch: sub.epoch,
          bids: [...sub.priorBids], asks: [...sub.priorAsks], bookScope: { bidComplete: false, askComplete: false } });
      }
      this.publish(sub, 'snapshot', sub.detector.snapshot(), this.status(sub));
      return;
    }
    this.publish(sub, 'patch', [], this.status(sub));
  }

  private onBook(sub: Subscription, book: BinanceDepthBook | null, at: number, epoch: number) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub) return;
    if (!book) {
      if (sub.priorBids && sub.priorAsks) {
        const gap: OrderWallDepthRecord = { kind: 'gap', at, cursor: ++sub.cursor, epoch: sub.epoch ?? epoch,
          reason: this.depth.getStatus().message };
        const patches = sub.detector.processBatch([gap]); sub.priorBids = undefined; sub.priorAsks = undefined;
        const state = this.depth.getStatus().state === 'stale' ? 'stale' : 'gap';
        this.publish(sub, 'patch', patches, this.status(sub, state, gap.reason));
      } else {
        const depthStatus = this.depth.getStatus();
        this.publish(sub, 'patch', [], this.status(sub, depthStatus.state === 'stale' ? 'stale' : 'loading', depthStatus.message));
      }
      return;
    }
    const levels = collectBook(book), nextEpoch = sub.epoch !== epoch || !sub.priorBids || !sub.priorAsks;
    const record: OrderWallDepthRecord = nextEpoch
      ? { kind: 'snapshot', at, cursor: ++sub.cursor, epoch, bids: levels.bids, asks: levels.asks, bookScope: levels.scope }
      : { kind: 'delta', at, cursor: ++sub.cursor, epoch,
          bids: diffLevels(sub.priorBids!, levels.bidMap), asks: diffLevels(sub.priorAsks!, levels.askMap), bookScope: levels.scope };
    sub.epoch = epoch; sub.priorBids = levels.bidMap; sub.priorAsks = levels.askMap;
    sub.firstObserved ??= at;
    const patches = this.apply(sub, record);
    this.publish(sub, nextEpoch ? 'snapshot' : 'patch', nextEpoch ? sub.detector.snapshot(at) : patches, this.status(sub));
  }

  private apply(sub: Subscription, record: OrderWallDepthRecord) { return sub.detector.processBatch([record]); }

  private status(sub: Subscription, forced?: OrderWallStatus['state'], message?: string): OrderWallStatus {
    const detected = sub.detector.status(sub.from, sub.to), depthStatus = this.depth.getStatus();
    const coverage = { from: Math.max(sub.from, sub.firstObserved ?? sub.to), to: Math.min(sub.to, this.now()),
      complete: false, partial: true, reason: 'Direct USD-M mode has live depth only; persisted wall history is unavailable.' };
    return { ...detected, state: forced ?? detected.state, ...(message ? { message } : {}),
      retentionStart: sub.firstObserved, coverage,
      bookScope: { ...detected.bookScope!, maxLevelsPerSide: 5_000 },
      ...(depthStatus.lastUpdate ? { lastConfirmedAt: detected.lastConfirmedAt ?? depthStatus.lastUpdate } : {}) };
  }

  private publish(sub: Subscription, kind: 'snapshot'|'patch', data: unknown[], status: OrderWallStatus) {
    const payload = kind === 'patch' ? (data as Array<{ id:string; segment:import('./order-walls').OrderWallSegment|null; valuePoints?:import('./order-walls').OrderWallValuePoint[] }>).map(patch => patch.segment
      ? { ...patch, segment: { ...patch.segment, valueRuns: [] } } : patch) : data;
    this.emit({ type: 'order-wall-batch', ids: [sub.id], key: sub.key, generation: 0, batchId: ++sub.batch,
      kind, ...(kind === 'snapshot' ? { segments: payload } : { patches: payload }), status } as Event);
  }
  private unavailable(sub: Subscription, message: string) {
    this.publish(sub, 'snapshot', [], { state: 'unavailable', message,
      coverage: { from: sub.from, to: sub.to, complete: false, partial: true, reason: message } });
  }

  diagnostics() { return { subscriptions: this.subscriptions.size, socketsOwned: 0, liveMode: !this.fixture }; }
  dispose() { this.disposed = true; for (const id of [...this.subscriptions.keys()]) this.unsubscribe(id); }
}

function collectBook(book: BinanceDepthBook) {
  const bids = new Map<number, number>(), asks = new Map<number, number>();
  book.visitLevels((side, price, size) => (side === 'bid' ? bids : asks).set(price, size));
  const topBids = new Map([...bids].sort(([a], [b]) => b - a).slice(0, 5_000));
  const topAsks = new Map([...asks].sort(([a], [b]) => a - b).slice(0, 5_000));
  return { bidMap: topBids, askMap: topAsks, bids: [...topBids] as Array<[number, number]>, asks: [...topAsks] as Array<[number, number]>,
    scope: { maxLevelsPerSide: 5_000, bidComplete: false, askComplete: false,
      ...(book.snapshotBidBoundary !== null ? { bidFloor: book.snapshotBidBoundary } : {}),
      ...(book.snapshotAskBoundary !== null ? { askCeiling: book.snapshotAskBoundary } : {}) } };
}
function diffLevels(previous: Map<number, number>, current: Map<number, number>): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const [price, size] of current) if (previous.get(price) !== size) result.push([price, size]);
  for (const price of previous.keys()) if (!current.has(price)) result.push([price, 0]);
  return result;
}
function detectKey(settings: OrderWallsSettings) { return JSON.stringify([settings.method, settings.thresholdUsd,
  settings.relativeFloorUsd, settings.relativePercentile, settings.exitRatio, settings.minDurationMs, settings.aggregation]); }
