import { afterEach, describe, expect, it, vi } from 'vitest';
import { CvdDataController } from '../src/indicators/cvd-data';
import { OpenInterestDataController } from '../src/indicators/open-interest-data';
import { ChartNumericOutputRegistry } from '../src/scripts/output-registry';
import type { Candle, Series } from '../src/feed/protocol';

const series: Series = { venue: 'binance', market: 'perpetual', interval: '1m' };
const base = 1_800_000_000_000;
function candles(): Candle[] {
  return Array.from({ length: 4 }, (_, index) => ({ t: base + index * 60_000, o: 100, h: 102, l: 99, c: 101, v: 1,
    revision: 1, closed: index < 3 }));
}

afterEach(() => vi.unstubAllGlobals());

describe('native candle-aligned output projection', () => {
  it('skips full CVD and Open Interest projections for forming OHLC revisions and detects timeline, close, and context changes', () => {
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const registry = new ChartNumericOutputRegistry('chart'), feed = {} as any;
    const cvd = new CvdDataController('chart', 'cvd', feed, registry, {}, series, () => base + 250_000);
    const oi = new OpenInterestDataController('chart', 'oi', feed, registry, {}, series, () => base + 250_000);
    const projectCvd = vi.spyOn(cvd.model, 'projectNumericOutputs'), buildOi = vi.spyOn(oi as any, 'buildFrame');
    const bars = candles();
    cvd.setHostCandles(bars); oi.setHostCandles(bars);
    let cvdCalls = projectCvd.mock.calls.length, oiCalls = buildOi.mock.calls.length;
    const registryRevision = registry.latestRevision();
    const last = bars.at(-1)!;

    for (let revision = 2; revision <= 21; revision++) {
      last.c += 0.25; last.h = Math.max(last.h, last.c); last.revision = revision;
      cvd.setHostCandles(bars); oi.setHostCandles(bars);
    }
    expect(projectCvd).toHaveBeenCalledTimes(cvdCalls);
    expect(buildOi).toHaveBeenCalledTimes(oiCalls);
    expect(registry.latestRevision()).toBe(registryRevision);

    // A replacement snapshot with an interior timestamp correction keeps the
    // edge key stable, so the controller must inspect its timestamps.
    const corrected = bars.map(candle => ({ ...candle }));
    corrected[1]!.t += 15_000;
    cvd.setHostCandles(corrected); oi.setHostCandles(corrected);
    cvdCalls++; oiCalls++;
    expect(projectCvd).toHaveBeenCalledTimes(cvdCalls);
    expect(buildOi).toHaveBeenCalledTimes(oiCalls);
    expect(registry.get('output:oi:openInterestTotalBtc')?.times).toEqual(corrected.map(candle => candle.t));

    // Historical backfill inserts a candle without changing the first or last
    // time. The changed length must rebuild the output timeline.
    const backfilled = [...corrected.slice(0, 2), { ...corrected[1]!, t: corrected[1]!.t + 30_000 }, ...corrected.slice(2)];
    cvd.setHostCandles(backfilled); oi.setHostCandles(backfilled);
    cvdCalls++; oiCalls++;
    expect(projectCvd).toHaveBeenCalledTimes(cvdCalls);
    expect(buildOi).toHaveBeenCalledTimes(oiCalls);
    expect(registry.get('output:oi:openInterestTotalBtc')?.times).toEqual(backfilled.map(candle => candle.t));

    // Closing the forming candle and changing timeframe both rebuild the
    // native output projection even though candle OHLC is otherwise irrelevant.
    const closed = backfilled.map(candle => ({ ...candle })); closed.at(-1)!.closed = true;
    cvd.setHostCandles(closed); oi.setHostCandles(closed);
    cvdCalls++; oiCalls++;
    expect(projectCvd).toHaveBeenCalledTimes(cvdCalls);
    expect(buildOi).toHaveBeenCalledTimes(oiCalls);

    const fiveMinute: Series = { ...series, interval: '5m' };
    cvd.configure({}, fiveMinute); oi.configure({}, fiveMinute);
    cvdCalls++; // CVD publishes on configure; OI rebuilds on the new host grid below.
    cvd.setHostCandles(closed); oi.setHostCandles(closed);
    cvdCalls++; oiCalls++;
    expect(projectCvd).toHaveBeenCalledTimes(cvdCalls);
    expect(buildOi).toHaveBeenCalledTimes(oiCalls);
    expect(registry.get('output:oi:openInterestTotalBtc')?.times).toEqual(closed.map(candle => candle.t));

    cvd.dispose(); oi.dispose();
  });

  it('does not reproject or invalidate CVD for repeated failure/as-of-only polls', () => {
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const registry = new ChartNumericOutputRegistry('chart'), feed = {} as any;
    const cvd = new CvdDataController('chart', 'cvd', feed, registry, {}, series, () => base + 60_000);
    cvd.setHostCandles(candles().slice(0, 1));
    const project = vi.spyOn(cvd.model, 'projectNumericOutputs'), listener = vi.fn();
    cvd.subscribe(listener);
    const coverage = { from: base, to: base + 60_000, gaps: [] };
    const update = (source: any) => (cvd as any).receive({ type: 'cvd-batch', ids: ['test'], generation: 1, batchId: 1, series: [source] });
    const unavailable = { source: 'binance:spot', points: [], snapshot: false, removeBefore: base, coverage,
      status: 'unavailable', message: 'Signed history unavailable: Incomplete JSON response', asOf: 0 };

    update(unavailable);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cvd.model.sources.get('binance:spot')?.status).toBe('unavailable');
    const point = { time: base + 60_000, period: Math.floor(base / 86_400_000) * 86_400_000,
      base: 12, quote: 1_000_000, observed: true, available: true, partial: false, reset: true };
    update({ ...unavailable, points: [point], snapshot: true, status: 'live', message: 'Signed history available', asOf: base + 60_000 });
    const spotOutput = registry.get('output:cvd:cvdVenueBinanceSpotBtc');
    expect(spotOutput?.quality).toBe('complete');
    update({ ...unavailable, points: [], status: 'stale', message: 'Signed history unavailable: timeout', asOf: base + 60_000 });
    expect(registry.get('output:cvd:cvdVenueBinanceSpotBtc')?.quality).toBe('stale');
    expect(listener).toHaveBeenCalledTimes(3);

    const calls = project.mock.calls.length, revision = cvd.demandDiagnostics().dataRevision;
    const publications = cvd.demandDiagnostics().outputPublications;
    update({ ...unavailable, points: [], status: 'stale', message: 'Signed history unavailable: incomplete JSON response', asOf: base + 120_000 });
    expect(cvd.model.sources.get('binance:spot')?.message).toBe('Signed history unavailable: incomplete JSON response');
    expect(project).toHaveBeenCalledTimes(calls);
    expect(cvd.demandDiagnostics().dataRevision).toBe(revision);
    expect(cvd.demandDiagnostics().outputPublications).toBe(publications);
    expect(listener).toHaveBeenCalledTimes(3);
    cvd.dispose();
  });
});
