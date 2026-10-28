import { describe, expect, it } from 'vitest';
import type { PrimitiveRenderContext } from 'openalgo-charts';
import type { NormalizedExecution } from '../src/feed/footprint';
import type { CanonicalSeries } from '../src/feed/protocol';
import { ExecutionHoverRay } from '../src/chart/execution-hover-ray';
import { TickerExecutionHoverCoordinator } from '../src/ticker/hover';

const base = 1_704_067_200_000;
const execution = (venue: NormalizedExecution['venue'], market: NormalizedExecution['market'], nativeSymbol: string, id: string): NormalizedExecution => ({
  venue, market, nativeSymbol, granularity: 'aggregate-trade', executionId: `${venue}:${market}:${nativeSymbol}:${id}`,
  timeMs: base + 30_000, eventTimeMs: base + 30_010, price: 100_000, quantity: 1, side: 'buy',
});

describe('Trade Ticker chart hover', () => {
  it('projects only to every chart with the same venue, market and native instrument, and ignores stale-source leave', () => {
    const applied = new Map<string, (NormalizedExecution | null)[]>();
    const series = (venue: CanonicalSeries['venue'], market: CanonicalSeries['market']): CanonicalSeries => ({ venue, market, interval: '1m' });
    const target = (id: string, selected: CanonicalSeries) => ({
      series: () => selected,
      setExecutionHoverRay(value: NormalizedExecution | null) { applied.get(id)!.push(value); },
    });
    for (const id of ['binance-a', 'binance-b', 'spot', 'hyperliquid']) applied.set(id, []);
    const coordinator = new TickerExecutionHoverCoordinator();
    coordinator.registerChart('binance-a', target('binance-a', series('binance', 'perpetual')));
    coordinator.registerChart('binance-b', target('binance-b', series('binance', 'perpetual')));
    coordinator.registerChart('spot', target('spot', series('binance', 'spot')));
    coordinator.registerChart('hyperliquid', target('hyperliquid', series('hyperliquid', 'perpetual')));

    const first = execution('binance', 'perpetual', 'BTCUSDT', '1');
    coordinator.publish('ticker-a', first);
    expect(applied.get('binance-a')!.at(-1)).toBe(first);
    expect(applied.get('binance-b')!.at(-1)).toBe(first);
    expect(applied.get('spot')!.at(-1)).toBeNull();
    expect(applied.get('hyperliquid')!.at(-1)).toBeNull();

    const second = execution('hyperliquid', 'perpetual', 'BTC', '2');
    coordinator.publish('ticker-b', second);
    expect(applied.get('binance-a')!.at(-1)).toBeNull();
    expect(applied.get('hyperliquid')!.at(-1)).toBe(second);
    coordinator.publish('ticker-a', null);
    expect(applied.get('hyperliquid')!.at(-1)).toBe(second);
    coordinator.publish('ticker-b', null);
    expect(applied.get('hyperliquid')!.at(-1)).toBeNull();
  });

  it('commits one persistent ray to each matching open chart only', () => {
    const added = new Map<string, NormalizedExecution[]>();
    const series = (venue: CanonicalSeries['venue'], market: CanonicalSeries['market']): CanonicalSeries => ({ venue, market, interval: '1m' });
    const target = (id: string, selected: CanonicalSeries) => ({
      series: () => selected,
      setExecutionHoverRay() {},
      addExecutionRay(value: NormalizedExecution) { added.get(id)!.push(value); return true; },
    });
    for (const id of ['binance-a', 'binance-b', 'spot', 'hyperliquid']) added.set(id, []);
    const coordinator = new TickerExecutionHoverCoordinator();
    coordinator.registerChart('binance-a', target('binance-a', series('binance', 'perpetual')));
    coordinator.registerChart('binance-b', target('binance-b', series('binance', 'perpetual')));
    coordinator.registerChart('spot', target('spot', series('binance', 'spot')));
    coordinator.registerChart('hyperliquid', target('hyperliquid', series('hyperliquid', 'perpetual')));
    const trade = execution('binance', 'perpetual', 'BTCUSDT', 'saved');

    expect(coordinator.addExecutionRay(trade)).toBe(2);
    expect(added.get('binance-a')).toEqual([trade]);
    expect(added.get('binance-b')).toEqual([trade]);
    expect(added.get('spot')).toEqual([]);
    expect(added.get('hyperliquid')).toEqual([]);
  });

  it('maps the exact fractional execution time and price through current chart scales, drawing rightward', () => {
    const trade = execution('binance', 'perpetual', 'BTCUSDT', 'ray');
    const geometry: Array<[number, number, number, number]> = [];
    let path: Array<[number, number]> = [];
    const ctx = {
      save() {}, restore() {}, rect() {}, clip() {}, setLineDash() {}, fill() {}, arc() {}, fillText(){}, measureText(){return {width:80};},
      beginPath() { path = []; },
      moveTo(x: number, y: number) { path.push([x, y]); },
      lineTo(x: number, y: number) { path.push([x, y]); },
      stroke() { geometry.push([path[0]![0], path[0]![1], path[1]![0], path[1]![1]]); },
    } as unknown as CanvasRenderingContext2D;
    const rc = {
      timeScale: { visibleRange: () => ({ from: 0, to: 2 }), indexToX: (index: number) => 50 + index * 100 },
      priceScale: { priceToY: () => 100 },
      dataLayer: { length: 3, timeToIndexFloat: (seconds: number) => (seconds - base / 1000) / 60 },
      plotWidth: 500, plotHeight: 300, dpr: 2,
      theme: { buy: '#4d9963', sell: '#b75c5c', axisText: '#aaa' },
    } as unknown as PrimitiveRenderContext;
    const ray = new ExecutionHoverRay();
    ray.setExecution(trade);
    ray.draw(ctx, rc);

    expect(ray.autoscaleInfo()).toBeNull();
    expect(ray.diagnostics()).toMatchObject({ active: true, executionId: trade.executionId, geometry: {
      executionId: trade.executionId, timeMs: trade.timeMs, price: trade.price, logicalIndex: .5,
      anchorX: 100, startX: 100, endX: 500, y: 100,
    } });
    expect(geometry).toEqual([[200, 200, 1000, 200]]);
    ray.setExecution(null);
    expect(ray.diagnostics()).toEqual({ active: false, executionId: null, geometry: null });
  });
});
