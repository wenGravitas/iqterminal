import { depthMatrixSettings, depthMatrixSourceDefinition, depthMatrixSourceLabel, DepthMatrixBook, matrixBucketBounds, matrixBucketIndex, matrixDefaultViewport,
  type DepthMatrixColumn, type DepthMatrixSettings, type DepthMatrixViewport, type MatrixRecord } from './depth-matrix';
import type { Command, Event } from './protocol';

type MatrixCommand = Extract<Command, { type: 'depth-matrix-subscribe' | 'depth-matrix-settings' | 'depth-matrix-viewport' | 'depth-matrix-unsubscribe' | 'depth-matrix-retry' }>;
type MatrixBatch = Extract<Event, { type: 'depth-matrix-batch' }>;
interface FixtureSubscription { settings: DepthMatrixSettings; viewport?: DepthMatrixViewport }

const FIXTURE_MESSAGE = 'Fixture: deterministic development book; no exchange connection.';

/** Explicit DEV-only matrix books. The worker selects this service only after `initFixture`. */
export class DepthMatrixFixtureService {
  private subscriptions = new Map<string, FixtureSubscription>();
  constructor(private emit: (event: MatrixBatch) => void, private now = Date.now) {}

  command(command: MatrixCommand) {
    if (command.type === 'depth-matrix-unsubscribe') { this.subscriptions.delete(command.id); return; }
    if (command.type === 'depth-matrix-subscribe') {
      this.subscriptions.set(command.id, { settings: depthMatrixSettings(command.settings) });
    } else if (command.type === 'depth-matrix-settings') {
      const sub = this.subscriptions.get(command.id); if (!sub) return;
      const next = depthMatrixSettings(command.settings);
      if (next.bucketWidth !== sub.settings.bucketWidth) sub.viewport = undefined;
      sub.settings = next;
    } else if (command.type === 'depth-matrix-viewport') {
      const sub = this.subscriptions.get(command.id); if (!sub || !validViewport(command.viewport)) return;
      sub.viewport = { ...command.viewport };
    }
    const sub = this.subscriptions.get(command.id);
    if (sub) this.publish(command.id, sub);
  }

  diagnostics() { return { fixture: true, activeWidgets: this.subscriptions.size }; }
  dispose() { this.subscriptions.clear(); }

  private publish(id: string, sub: FixtureSubscription) {
    const settings = sub.settings, emittedAt = this.now(), at = emittedAt - 230;
    const books = settings.sources.map(source => fixtureColumn(source, settings, at, emittedAt, sub.viewport));
    const mid = books.find(column => column.mid !== null)?.mid;
    const viewport = sub.viewport ?? matrixDefaultViewport(mid === undefined ? null : Number(mid), settings.bucketWidth);
    this.emit({ type: 'depth-matrix-batch', ids: [id], settings, viewport, columns: books, emittedAt });
  }
}

function fixtureColumn(source: string, settings: DepthMatrixSettings, at: number, now: number, viewport?: DepthMatrixViewport): DepthMatrixColumn {
  const definition = depthMatrixSourceDefinition(source);
  if (!definition?.supported || !definition.market) return {
    source, label: depthMatrixSourceLabel(source), state: 'unavailable',
    message: 'No synchronized live BTC depth source is configured.', rows: [], bestBid: null, bestAsk: null, mid: null,
    quantityUnit: 'BTC', notionalUnit: 'USDT', lastAt: 0, ageMs: null, cursor: 0, epoch: null,
  };
  const width = Number(settings.bucketWidth);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(width * 2.5)) return {
    source, label: depthMatrixSourceLabel(source), state: 'unavailable', message: 'Fixture bucket width is outside the safe numeric range.',
    rows: [], bestBid: null, bestAsk: null, mid: null, quantityUnit: 'BTC', notionalUnit: 'USDT', lastAt: 0, ageMs: null, cursor: 0, epoch: null,
  };
  const bucket = matrixBucketIndex(83_500, settings.bucketWidth) ?? '835';
  const bounds = matrixBucketBounds(bucket, settings.bucketWidth)!;
  const low = Number(bounds.low), bidBase = low + width * .42, askBase = low + width * .58;
  const bidNear = low >= width ? low - width * .5 : low + width * .14;
  const bidFar = low >= width * 2 ? low - width * 1.5 : low + width * .08;
  const askNear = low + width * 1.5, askFar = low + width * 2.5;
  const isSpot = definition.market === 'spot';
  const record: MatrixRecord = {
    kind: 'snapshot', at, cursor: 100, epoch: 'dev-fixture-depth-v1',
    bids: [[String(bidBase), isSpot ? '1.25' : '2.5'], [String(bidNear), '0.0000042'], [String(bidFar), '3.75']],
    asks: [[String(askBase), isSpot ? '2.5' : '1.75'], [String(askNear), '0.75'], [String(askFar), '0.0000084']],
    bookScope: { bidFloor: String(Math.max(0, bidFar - width * .2)), askCeiling: String(askFar + width * .2),
      bidComplete: true, askComplete: true },
  };
  const book = new DepthMatrixBook(definition.quantityToBtc); book.apply(record);
  const referenceMid = book.quote.mid;
  const visible = viewport ?? matrixDefaultViewport(referenceMid, settings.bucketWidth);
  return { source, label: definition.label, state: 'live', message: FIXTURE_MESSAGE,
    rows: book.project(visible.low, visible.high, settings.bucketWidth), bestBid: book.quote.bestBid, bestAsk: book.quote.bestAsk,
    mid: referenceMid === null ? null : String(referenceMid), quantityUnit: 'BTC', notionalUnit: 'USDT',
    lastAt: at, ageMs: Math.max(0, now - at), cursor: book.lastCursor, epoch: book.lastEpoch };
}

function validViewport(viewport: DepthMatrixViewport) {
  return typeof viewport?.low === 'string' && typeof viewport.high === 'string'
    && matrixBucketIndex(viewport.low, '0.00000001') !== null && matrixBucketIndex(viewport.high, '0.00000001') !== null;
}
