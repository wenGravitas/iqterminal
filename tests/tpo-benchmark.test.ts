import { describe, expect, test } from 'vitest';
import { TpoService } from '../src/feed/tpo-service';
import { MINUTE_MS, DEFAULT_TPO_SETTINGS } from '../src/indicators/tpo-engine';
import type { TileCache } from '../src/feed/history-tile-cache';
import type { TpoEvent, Series } from '../src/feed/protocol';

class MemoryCache implements TileCache {
  values = new Map<string, unknown>();
  async getMany(keys: string[]) { return new Map(keys.filter(key => this.values.has(key)).map(key => [key, this.values.get(key)])); }
  async putMany(entries: { key: string; value: unknown }[]) { for (const entry of entries) this.values.set(entry.key, entry.value); }
}

const now = Date.UTC(2026, 0, 5, 12, 0);
const candle = (time: number, revision = 0) => ({ time, open: 100, high: 101, low: 99, close: 100.5, revision, closed: true });
async function waitForSnapshots(events: TpoEvent[], count: number) {
  for (let i = 0; i < 1_000 && events.filter(event => event.type === 'tpo-snapshot').length < count; i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(events.filter(event => event.type === 'tpo-snapshot')).toHaveLength(count);
}

describe('TPO bounded 90-day worker evidence', () => {
  test('loads 90 UTC days, reuses cached profiles and patches only the developing day', async () => {
    const events: TpoEvent[] = [], cache = new MemoryCache(), commands: any[] = [];
    let pageCalls = 0;
    const transport = { now: () => now, page: async (_series: Series, from: number, to: number) => {
      pageCalls++;
      const bars = [];
      for (let time = from; time < to; time += MINUTE_MS) bars.push(candle(time));
      return bars;
    } };
    const first = new TpoService({ cache, emit: event => events.push(event), marketCommand: command => commands.push(command), transport });
    const start = performance.now();
    first.subscribe('ninety-day-pass-1', { venue: 'binance', market: 'spot', interval: '15m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshots(events, 1);
    const freshMs = performance.now() - start, firstDiagnostics = first.diagnostics();
    expect(firstDiagnostics.groups).toHaveLength(1);
    expect(firstDiagnostics.groups[0]!.minutes).toBeGreaterThan(129_000);
    expect(firstDiagnostics.pagesFetched).toBeGreaterThan(100);
    const freshSnapshot = events.filter(event => event.type === 'tpo-snapshot').at(-1) as Extract<TpoEvent, { type: 'tpo-snapshot' | 'tpo-patch' }>;
    expect(freshSnapshot.sessions.length).toBeGreaterThan(80);
    first.dispose();

    const reloadEvents: TpoEvent[] = [], second = new TpoService({ cache, emit: event => reloadEvents.push(event), marketCommand: command => commands.push(command), transport });
    const callsBeforeReload = pageCalls, reloadStart = performance.now();
    second.subscribe('ninety-day-pass-2', { venue: 'binance', market: 'spot', interval: '1h' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshots(reloadEvents, 1);
    const reloadMs = performance.now() - reloadStart, reloaded = second.diagnostics();
    expect(reloaded.pagesFetched).toBeLessThan(10);
    expect(pageCalls - callsBeforeReload).toBeLessThan(10);
    expect(reloaded.cacheHits).toBeGreaterThan(100);
    expect(reloaded.profileRecomputes).toBeLessThan(firstDiagnostics.profileRecomputes);

    const beforeLivePatch = reloaded.profileRecomputes;
    const sourceFeedId = commands.find(command => command.type === 'subscribe')!.id;
    second.marketEvent({ type: 'patch', key: 'tpo-benchmark', ids: [sourceFeedId], candles: [{ t: Math.floor(now / MINUTE_MS) * MINUTE_MS, o: 100, h: 102, l: 99, c: 101, v: 0, revision: 2, closed: false }] });
    await new Promise(resolve => setTimeout(resolve, 10));
    const developing = second.diagnostics();
    expect(developing.profileRecomputes - beforeLivePatch).toBe(1);
    expect(developing.livePatches).toBe(1);
    console.info(`[TPO 90d local fixture] fresh=${freshMs.toFixed(1)}ms (${firstDiagnostics.pagesFetched} pages, ${firstDiagnostics.profileRecomputes} profile calculations); cached reload=${reloadMs.toFixed(1)}ms (${reloaded.pagesFetched} recent pages, ${reloaded.profileRecomputes} calculations); developing-minute patch=1 profile calculation`);
    second.dispose();
  }, 30_000);
});
