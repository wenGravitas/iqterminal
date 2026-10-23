import { describe, expect, it } from 'vitest';
import { DEFAULT_DEPTH_MATRIX_SETTINGS, DepthMatrixBook, depthMatrixBarWidth, depthMatrixScaleTarget, depthMatrixSettings, formatDepthMatrixCellValue, formatDepthMatrixTooltipValue, matrixBucketBounds, matrixBucketIndex, normalizedBtcQuantity, smoothDepthMatrixScale, type MatrixRecord } from '../src/feed/depth-matrix';
import { restoreValue } from '../src/layout';
import { DepthMatrixFixtureService } from '../src/feed/depth-matrix-fixtures';

const now = 1_800_000_000_000;
function snapshot(patch: Partial<MatrixRecord> = {}): MatrixRecord {
  return { kind: 'snapshot', at: now, cursor: 10, epoch: 4,
    bids: [['99.80', '1.25'], ['99.50', '2.75']], asks: [['100.10', '3.5'], ['100.40', '1.5']],
    bookScope: { bidFloor: '99.50', askCeiling: '100.40', bidComplete: false, askComplete: false }, ...patch };
}

describe('absolute decimal matrix buckets', () => {
  it('uses exact [low, high) indexing for decimal widths and boundary prices', () => {
    expect(matrixBucketIndex('100.00', '0.25')).toBe('400');
    expect(matrixBucketIndex('100.249999999999', '0.25')).toBe('400');
    expect(matrixBucketIndex('100.25', '0.25')).toBe('401');
    expect(matrixBucketIndex('0.3', '0.1')).toBe('3');
    expect(matrixBucketIndex(100.25, 1e-7)).toBe('1002500000');
    expect(matrixBucketBounds('401', '0.25')).toEqual({ low: '100.25', high: '100.5' });
  });

  it('normalizes venue quantities to BTC and keeps an extensible bounded source list', () => {
    expect(normalizedBtcQuantity('2', 0.01)).toBe(0.02);
    const sources = ['binance-spot', 'binance-perpetual', 'bybit-spot', 'bybit-perpetual', 'hyperliquid-perpetual', 'aggregate:spot-perp'];
    const settings = depthMatrixSettings({ sources, columnWidth: 95, rowHeight: 65 });
    expect(settings.sources).toEqual(sources);
    expect(settings.columnWidth).toBe(95);
    expect(DEFAULT_DEPTH_MATRIX_SETTINGS.columnWidth).toBe(95);
    expect(depthMatrixSettings({ columnWidth: 64 }).columnWidth).toBe(65);
    expect(depthMatrixSettings({ columnWidth: 151 }).columnWidth).toBe(150);
    expect(depthMatrixSettings({ sources: [] }).sources).toEqual([]);
    expect(depthMatrixSettings({}).sources).toEqual(DEFAULT_DEPTH_MATRIX_SETTINGS.sources);
  });

  it('keeps small positive quantities visibly distinct from zero and preserves tooltip precision', () => {
    expect(formatDepthMatrixCellValue(0, 'btc')).toBe('0');
    expect(formatDepthMatrixCellValue(0.0000042, 'btc')).toBe('<0.001');
    expect(formatDepthMatrixCellValue(0.001001, 'btc')).toBe('0.001');
    expect(formatDepthMatrixCellValue(67.431, 'btc')).toBe('67.431');
    expect(formatDepthMatrixCellValue(501.469, 'btc')).toBe('501.469');
    expect(formatDepthMatrixCellValue(1_000.12, 'btc')).toBe('1000.12');
    expect(formatDepthMatrixCellValue(10_000.12, 'btc')).toBe('10000.1');
    expect(formatDepthMatrixCellValue(100_000.12, 'btc')).toBe('100000');
    expect(formatDepthMatrixCellValue(1_000_000.12, 'btc')).toBe('1.0m');
    expect(formatDepthMatrixCellValue(0.25, 'usdt')).toBe('<1');
    expect(formatDepthMatrixTooltipValue(0.000000001, 0.001)).toBe('<0.00000001 BTC / <0.01 USDT');
    expect(formatDepthMatrixTooltipValue(1.23456789, 1234.567)).toBe('1.23456789 BTC / 1234.57 USDT');
  });

  it('produces explicit deterministic Binance fixture columns and leaves other saved venues unavailable', () => {
    const events: import('../src/feed/protocol').Event[] = [];
    const service = new DepthMatrixFixtureService(event => events.push(event), () => now);
    service.command({ type: 'depth-matrix-subscribe', id: 'fixture', settings: depthMatrixSettings({
      sources: ['binance-spot', 'binance-perpetual', 'bybit-spot', 'bybit-perpetual', 'hyperliquid-perpetual'] }) });
    const event = events[0] as Extract<import('../src/feed/protocol').Event, { type: 'depth-matrix-batch' }>;
    expect(event.columns).toHaveLength(5);
    expect(event.columns.slice(0, 2).every(column => column.message.startsWith('Fixture:') && column.state === 'live' && column.ageMs === 230)).toBe(true);
    expect(event.columns.slice(2).every(column => column.state === 'unavailable' && column.rows.length === 0)).toBe(true);
    for (const column of event.columns.slice(0, 2)) {
      const mixed = column.rows.find(row => row.bidQuantity > 0 && row.askQuantity > 0);
      expect(mixed).toMatchObject({ bidCoverage: 'observed', askCoverage: 'observed' });
      expect(column.rows.some(row => row.bidCoverage === 'partial' && row.bidQuantity > 0)).toBe(true);
      expect(column.rows.some(row => row.askCoverage === 'partial' && row.askQuantity > 0)).toBe(true);
      expect(column.rows.some(row => row.bidQuantity > 0 && row.askQuantity === 0 && row.bidCoverage === 'observed' && row.askCoverage === 'known-empty')).toBe(true);
      expect(mixed!.bidNotional).toBeGreaterThan(0);
      expect(mixed!.askNotional).toBeGreaterThan(0);
    }
    service.command({ type: 'depth-matrix-unsubscribe', id: 'fixture' });
    expect(service.diagnostics()).toMatchObject({ activeWidgets: 0 });
  });

  it('restores source order and settings and uses a common full-cell denominator for global comparison', () => {
    const settings = depthMatrixSettings({ sources: ['binance-perpetual', 'binance-spot'], bucketWidth: '250', columnWidth: 130, unit: 'btc', scale: 'shared' });
    const layout = { grid: {}, panels: { 'depth-matrix-live': { contentComponent: 'depth-matrix', params: settings } } } as any;
    expect(restoreValue(JSON.stringify({ version: 5, layout }))).toEqual(layout);
    expect(restoreValue(JSON.stringify({ version: 4, layout }))).toBeNull();
    expect(settings.sources).toEqual(['binance-perpetual', 'binance-spot']);
    expect(depthMatrixSettings(undefined).columnWidth).toBe(95);

    const spotScale = depthMatrixScaleTarget([1, 2]), perpScale = depthMatrixScaleTarget([2, 4]);
    const globalScale = smoothDepthMatrixScale(Math.max(spotScale, perpScale));
    const available = 87;
    const mixedBucketBid = depthMatrixBarWidth(2, globalScale, available), mixedBucketAsk = depthMatrixBarWidth(2, globalScale, available);
    const singleSide = depthMatrixBarWidth(2, globalScale, available);
    expect([mixedBucketBid, mixedBucketAsk, singleSide]).toEqual([available / 2, available / 2, available / 2]);
    expect(depthMatrixBarWidth(2, spotScale, available)).toBe(available);
    expect(depthMatrixBarWidth(2, perpScale, available)).toBe(available / 2);
    expect(depthMatrixBarWidth(2, spotScale, available)).toBeGreaterThan(depthMatrixBarWidth(2, globalScale, available));
  });

  it('smooths scale decreases by elapsed data time and leaves it unchanged without new data', () => {
    const prior = 10, target = 2;
    expect(smoothDepthMatrixScale(target, prior, 0)).toBe(prior);
    expect(smoothDepthMatrixScale(target, prior, 1000)).toBeCloseTo(prior + (target - prior) * (1 - Math.exp(-1000 / 5000)), 8);
    expect(smoothDepthMatrixScale(target, prior, 5000)).toBeCloseTo(prior + (target - prior) * (1 - Math.exp(-1)), 8);
    expect(smoothDepthMatrixScale(12, prior, 0)).toBe(12);
  });
});

describe('depth matrix book and independent coverage', () => {
  it('keeps bid and ask liquidity in the same absolute row and labels each side independently', () => {
    const book = new DepthMatrixBook();
    expect(book.apply(snapshot({ bookScope: { bidFloor: '99.50', askCeiling: '101', bidComplete: false, askComplete: false } }))).toBe(true);
    const rows = book.project('99', '101', '1');
    const row100 = rows.find(row => row.low === '100')!;
    expect(row100).toMatchObject({ bidQuantity: 0, askQuantity: 5,
      bidCoverage: 'known-empty', askCoverage: 'partial' });
    expect(row100.askNotional).toBeCloseTo(500.95);
    const row99 = rows.find(row => row.low === '99')!;
    expect(row99).toMatchObject({ bidQuantity: 4, askQuantity: 0,
      bidCoverage: 'partial', askCoverage: 'known-empty' });
  });

  it('marks a bucket straddling the snapshot bound partial, never known empty', () => {
    const book = new DepthMatrixBook();
    book.apply(snapshot({ bids: [['99.80', '1.25']], bookScope: { bidFloor: '99.75', askCeiling: '100.40' } }));
    const row = book.project('99', '100', '1')[0]!;
    expect(row.bidQuantity).toBe(1.25);
    expect(row.bidCoverage).toBe('partial');
  });

  it('does not call truncated outer levels known-empty when returned levels begin inside advertised snapshot bounds', () => {
    const book = new DepthMatrixBook();
    book.apply(snapshot({ bids: [['198.50', '1'], ['199', '2']], asks: [['201', '3'], ['202', '4']],
      bookScope: { bidFloor: '100', askCeiling: '300', bidComplete: false, askComplete: false, bidTruncated: true, askTruncated: true } }));
    const rows = book.project('150', '220', '10');
    expect(rows.find(row => row.low === '150')).toMatchObject({ bidCoverage: 'unknown', askCoverage: 'known-empty' });
    expect(rows.find(row => row.low === '190')).toMatchObject({ bidQuantity: 3, bidCoverage: 'partial', askCoverage: 'known-empty' });
    expect(rows.find(row => row.low === '210')).toMatchObject({ bidCoverage: 'known-empty', askCoverage: 'unknown' });
  });

  it('applies a source contract factor before storing or aggregating BTC quantities', () => {
    const book = new DepthMatrixBook(0.01);
    book.apply(snapshot({ bids: [['99.80', '2']], asks: [['100.10', '3']],
      bookScope: { bidFloor: '99.80', askCeiling: '100.10', bidComplete: true, askComplete: true } }));
    const rows = book.project('99', '101', '1');
    expect(rows.find(row => row.low === '99')!.bidQuantity).toBe(0.02);
    expect(rows.find(row => row.low === '100')!.askQuantity).toBe(0.03);
  });

  it('marks empty bins inside the spread known-empty for both sides', () => {
    const book = new DepthMatrixBook();
    book.apply(snapshot());
    const row = book.project('99.9', '100', '0.1')[0]!;
    expect(row).toMatchObject({ bidQuantity: 0, askQuantity: 0, bidCoverage: 'known-empty', askCoverage: 'known-empty' });
  });

  it('applies absolute replacements and zero removals without changing the bucket origin', () => {
    const book = new DepthMatrixBook();
    book.apply(snapshot());
    expect(book.apply({ kind: 'delta', at: now + 1, cursor: 11, epoch: 4,
      bids: [['99.80', '2.5'], ['99.50', '0']], asks: [['100.10', '0'], ['100.20', '4']] })).toBe(true);
    const row = book.project('99', '101', '1').find(item => item.low === '99')!;
    expect(row.bidQuantity).toBe(2.5);
    expect(book.project('99', '101', '1').find(item => item.low === '100')!.askQuantity).toBe(5.5);
  });

  it('ignores replay duplicates and old snapshots without rewinding the current state', () => {
    const book = new DepthMatrixBook();
    book.apply(snapshot());
    expect(book.apply({ kind: 'delta', at: now + 1, cursor: 11, epoch: 4, bids: [['99.80', '2']] })).toBe(true);
    expect(book.apply(snapshot({ cursor: 10, bids: [['99.80', '99']] }))).toBe(true);
    expect(book.apply({ kind: 'delta', at: now, cursor: 11, epoch: 4, bids: [['99.80', '99']] })).toBe(true);
    expect(book.project('99', '100', '1')[0]!.bidQuantity).toBe(4.75);
  });

  it('clears the prior book on gaps, cursor skips, and epoch changes until a fresh snapshot', () => {
    const book = new DepthMatrixBook();
    book.apply(snapshot());
    expect(book.apply({ kind: 'delta', at: now + 1, cursor: 12, epoch: 4, bids: [['99.8', '9']] })).toBe(false);
    expect(book.state).toBe('gap');
    expect(book.project('99', '101', '1').every(row => row.bidQuantity === 0 && row.askQuantity === 0)).toBe(true);
    expect(book.apply({ kind: 'delta', at: now + 2, cursor: 13, epoch: 4, bids: [['99.8', '8']] })).toBe(false);
    expect(book.apply(snapshot({ at: now + 3, cursor: 2, epoch: 5 }))).toBe(true);
    expect(book.state).toBe('live');
    expect(book.apply({ kind: 'delta', at: now + 4, cursor: 3, epoch: 6, bids: [['99.8', '1']] })).toBe(false);
    expect(book.state).toBe('gap');
  });

  it('keeps stale/disconnected status separate from empty or missing liquidity', () => {
    const book = new DepthMatrixBook();
    book.apply(snapshot());
    book.setTransport('stale', 'No fresh depth head');
    const row = book.project('99', '101', '1').find(item => item.low === '99')!;
    expect(row.bidQuantity).toBeGreaterThan(0);
    expect(row.bidCoverage).toBe('stale');
    book.setTransport('disconnected', 'Socket closed');
    expect(book.project('99', '101', '1')[0]!.askCoverage).toBe('disconnected');
  });
});
