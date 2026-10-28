import { describe, expect, it } from 'vitest';
import { MatrixRowExpansion, MatrixRowLayout, MATRIX_COLLAPSE_DELAY_MS, matrixCurrentBucket, matrixExactPrice, matrixDetailValue, matrixSideWall, usableMatrixMid } from '../src/depth-matrix-presentation';
import { depthMatrixSettings, formatDepthMatrixCellValue, type DepthMatrixColumn, type MatrixRow } from '../src/feed/depth-matrix';

const row = (index: string, bid = 0, ask = 0): MatrixRow => ({ index, low: String(Number(index) * 100), high: String((Number(index) + 1) * 100), bidQuantity: bid, askQuantity: ask, bidNotional: bid * 81600, askNotional: ask * 81600, bidCoverage: 'observed', askCoverage: 'observed' });
const column = (source: string, rows: MatrixRow[], mid = '81679'): DepthMatrixColumn => ({ source, rows, mid, state: 'live', message: 'Synchronized depth', label: source, bestBid: '81678', bestAsk: '81680', quantityUnit: 'BTC', notionalUnit: 'USDT', lastAt: 1, ageMs: 0, cursor: 1, epoch: 1 });

describe('matrix shared row layout', () => {
  it('shares mixed rows across venues, asks and bids remain separate canonical data', () => {
    const rows = [row('818'), row('817'), row('816'), row('815')];
    const expansion = new MatrixRowExpansion();
    const layout = expansion.layout(rows, [column('binance-spot', [row('817', 1, 2)]), column('binance-perpetual', [row('816', 3, 4)])], 0);
    expect(layout.positions.map(row => [row.top, row.height])).toEqual([[0,28],[28,36],[64,36],[100,28]]);
    expect(layout.height).toBe(128);
    for (const [index, position] of layout.positions.entries()) {
      expect(layout.at(position.top)).toBe(index);
      expect(layout.at(position.top + position.height - .01)).toBe(index);
    }
    expect(layout.at(128)).toBe(-1);
    expect(layout.at(-1)).toBe(-1);
    expect(layout.visible(30, 100)).toEqual([1,3]);
    expect(layout.visible(500, 600)).toEqual([0,0]);
  });
  it('expands immediately, contracts after a bounded grace period and expires departed buckets', () => {
    const rows = [row('817'),row('816')], expansion = new MatrixRowExpansion();
    expect(expansion.layout(rows,[column('binance-spot',[row('817',1,2)])],0).height).toBe(64);
    expect(expansion.layout(rows,[],10).height).toBe(64);
    expect(expansion.nextExpiry).toBe(10 + MATRIX_COLLAPSE_DELAY_MS);
    expect(expansion.layout(rows,[],1009).height).toBe(64);
    expect(expansion.layout(rows,[],1010).height).toBe(56);
    expect(expansion.nextExpiry).toBeUndefined();
    expansion.layout(rows,[column('binance-spot',[row('817',1,2)])],2000);
    expansion.layout([row('816')],[],2001);
    expect(expansion.layout(rows,[],2002).height).toBe(56);
  });
  it('holds expansion when the opposite side returns during the grace period', () => {
    const expansion = new MatrixRowExpansion(), rows = [row('816')], mixed = [column('binance-spot',[row('816',1,2)])];
    expansion.layout(rows,mixed,0); expansion.layout(rows,[],20);
    expect(expansion.layout(rows,mixed,900).height).toBe(36);
    expect(expansion.nextExpiry).toBeUndefined();
    expect(expansion.layout(rows,[],2000).height).toBe(36);
    expect(expansion.layout(rows,[],3000).height).toBe(28);
  });
  it('preserves the top visible bucket and pixel offset through height changes and adjacent pages', () => {
    const rows = [row('819'),row('818'),row('817'),row('816')], normal = new MatrixRowLayout(rows);
    const anchor = normal.anchor(61)!; expect(anchor).toEqual({index:'817',offset:5});
    const expanded = new MatrixRowLayout(rows, new Set(['819']));
    expect(expanded.offset(anchor)).toBe(69);
    const nextPage = new MatrixRowLayout([row('817'),row('816'),row('815')],new Set(['817']));
    expect(nextPage.offset(anchor)).toBe(5);
    expect(nextPage.anchor(nextPage.offset(anchor)!)).toEqual(anchor);
  });
});

describe('matrix reference and formatting', () => {
  it('preserves every provided decimal digit and tiny canonical amounts in details', () => {
    expect(matrixExactPrice('81679.123456789123456')).toBe('81,679.123456789123456');
    expect(matrixExactPrice('81600.00000001')).toBe('81,600.00000001');
    expect(matrixDetailValue(1.25, 8, false)).toBe('1.25000000');
    expect(matrixDetailValue(123456.123456789, 2)).toBe('123,456.123456789');
    expect(matrixDetailValue(1e-25, 8, false)).toBe('1e-25');
  });
  it('migrates legacy source order once, preserves explicit choice and leaves removed references empty', () => {
    expect(depthMatrixSettings(undefined).referenceSourceId).toBe('binance-spot');
    const legacy = depthMatrixSettings({sources:['bybit-spot','binance-perpetual','binance-spot']});
    expect(legacy.referenceSourceId).toBe('binance-perpetual');
    expect(depthMatrixSettings({...legacy,sources:[...legacy.sources].reverse()}).referenceSourceId).toBe('binance-perpetual');
    const removed = depthMatrixSettings({...legacy,sources:['binance-spot']});
    expect(removed.referenceSourceId).toBeNull();
    expect(depthMatrixSettings(JSON.parse(JSON.stringify(removed))).referenceSourceId).toBeNull();
    expect(depthMatrixSettings({sources:['bybit-spot']}).referenceSourceId).toBeNull();
  });
  it('requires the venue own live valid midpoint and uses exact upper-bound buckets', () => {
    const spot = column('binance-spot',[]);
    expect(matrixCurrentBucket(spot,'100')).toBe('816');
    expect(matrixCurrentBucket({...spot,mid:'81700'},'100')).toBe('817');
    for (const state of ['stale','syncing','gap','disconnected','unavailable'] as const) {
      expect(usableMatrixMid({...spot,state})).toBe(false);
      expect(matrixCurrentBucket({...spot,state},'100')).toBeNull();
    }
    for (const mid of [null,'NaN','0','-1']) expect(usableMatrixMid({...spot,mid})).toBe(false);
  });
  it('formats about three significant figures with clean suffix boundaries and nonzero tiny values', () => {
    for (const [input,output] of [[116.986,'117'],[98.826,'98.8'],[15.582,'15.6'],[536.874,'537'],[999.4,'999'],[999.5,'1k'],[999499,'999k'],[999500,'1m'],[1e9,'1b'],[.001001,'.001']] as const)
      expect(formatDepthMatrixCellValue(input,'btc')).toBe(output === '.001' ? '0.001' : output);
    expect(formatDepthMatrixCellValue(1e-10,'btc')).toBe('<0.001');
    expect(formatDepthMatrixCellValue(.1,'usdt')).toBe('<1');
    expect(formatDepthMatrixCellValue(9876543,'usdt')).toBe('9.88m');
  });
  it('qualifies walls per side in BTC regardless of notional label mode', () => {
    const absolute = depthMatrixSettings({wallMode:'absolute',wallThreshold:100,unit:'usdt'});
    expect(matrixSideWall(117,10,absolute)).toBe(true);
    expect(matrixSideWall(15.6,10,absolute)).toBe(false);
    const relative = {...absolute,wallMode:'relative' as const,wallThreshold:2.5};
    expect(matrixSideWall(30,10,relative)).toBe(true);
    expect(matrixSideWall(20,10,relative)).toBe(false);
    expect(matrixSideWall(30,0,relative)).toBe(false);
    expect(matrixSideWall(30,10,{...relative,wallMode:'off'})).toBe(false);
  });
});
