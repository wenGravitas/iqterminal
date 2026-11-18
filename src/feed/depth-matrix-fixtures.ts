import {projectOrderBook} from '../order-book/projection';
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
      sub.settings = next;if(command.viewport&&validViewport(command.viewport))sub.viewport={...command.viewport};
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
    this.emit({ type: 'depth-matrix-batch', ids: [id], settings, viewport, columns: books, orderBook:projectOrderBook(books,settings.sources,settings.bucketWidth,settings.referenceAnchor,emittedAt), emittedAt });
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
  const rows=book.project(visible.low, visible.high, settings.bucketWidth);
  const anchor=settings.referenceAnchor,origin=anchor?matrixBucketIndex(anchor.price,settings.bucketWidth):null;
  const cumulative=anchor&&origin!==null?{version:1 as const,reference:anchor.price,referenceIndex:origin,cursor:book.lastCursor,epoch:book.lastEpoch,at,
    rows:rows.map(row=>{
      const side=(side:'bid'|'ask')=>{
        if(side==='bid'?BigInt(row.index)>BigInt(origin):BigInt(row.index)<BigInt(origin))return null;
        const originEdge=matrixBucketBounds(origin,settings.bucketWidth)!,lo=side==='bid'?Number(row.low):Number(originEdge.low),hi=side==='bid'?Number(originEdge.high):Number(row.high);
        const levels=(side==='bid'?record.bids:record.asks) as readonly (readonly [string,string])[];
        let quantity=0,notional=0;for(const [p,q] of levels)if(Number(p)>=lo&&Number(p)<hi){quantity+=Number(q);notional+=Number(p)*Number(q);}
        const boundary=Number(side==='bid'?record.bookScope!.bidFloor:record.bookScope!.askCeiling);
        const complete=side==='bid'?lo>=boundary:hi<=boundary,overlap=side==='bid'?hi>boundary:lo<boundary;
        return {quantity,notional,coverage:complete?'exact' as const:overlap||quantity>0?'lower-bound' as const:'unknown' as const};
      };return {index:row.index,bid:side('bid'),ask:side('ask')};})}:undefined;
  return { source, label: definition.label, state: 'live', message: FIXTURE_MESSAGE,
    rows,...(cumulative?{cumulative}:{}), bestBid: book.quote.bestBid, bestAsk: book.quote.bestAsk,
    mid: referenceMid === null ? null : String(referenceMid), quantityUnit: 'BTC', notionalUnit: 'USDT',
    lastAt: at, ageMs: Math.max(0, now - at), cursor: book.lastCursor, epoch: book.lastEpoch };
}

function validViewport(viewport: DepthMatrixViewport) {
  return typeof viewport?.low === 'string' && typeof viewport.high === 'string'
    && matrixBucketIndex(viewport.low, '0.00000001') !== null && matrixBucketIndex(viewport.high, '0.00000001') !== null;
}
