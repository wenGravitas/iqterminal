import { describe, expect, test, vi } from 'vitest';
import { TpoService } from '../src/feed/tpo-service';
import { DEFAULT_TPO_SETTINGS, DAY_MS, MINUTE_MS } from '../src/indicators/tpo-engine';
import type { TileCache } from '../src/feed/history-tile-cache';
import type { TpoEvent, Series } from '../src/feed/protocol';

class MemoryCache implements TileCache {
  values = new Map<string, unknown>();
  async getMany(keys: string[]) { return new Map(keys.filter(key => this.values.has(key)).map(key => [key, this.values.get(key)])); }
  async putMany(entries: { key: string; value: unknown }[]) { for (const entry of entries) this.values.set(entry.key, entry.value); }
}

class DelayedCache extends MemoryCache {
  private releasePending?: () => void;
  private startedPending?: () => void;
  private gate?: Promise<void>;
  nextWriteStarted?: Promise<void>;
  delayNextWrite() {
    this.gate = new Promise(resolve => { this.releasePending = resolve; });
    this.nextWriteStarted = new Promise(resolve => { this.startedPending = resolve; });
  }
  releaseWrite() { this.releasePending?.(); }
  async putMany(entries: { key: string; value: unknown }[]) {
    if (this.gate) {
      const gate = this.gate; this.gate = undefined;
      this.startedPending?.();
      await gate;
    }
    await super.putMany(entries);
  }
}

const now = Date.UTC(2026, 0, 5, 12, 0);
const candle = (time: number, revision = 0) => ({ time, open: 100, high: 101, low: 99, close: 100.5, revision, closed: true });
async function waitForSnapshot(events: TpoEvent[]) {
  for (let i = 0; i < 200 && !events.some(event => event.type === 'tpo-snapshot'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(events.some(event => event.type === 'tpo-snapshot')).toBe(true);
}
async function waitForSnapshotCount(events: TpoEvent[], count: number) {
  for (let i = 0; i < 200 && events.filter(event => event.type === 'tpo-snapshot').length < count; i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(events.filter(event => event.type === 'tpo-snapshot')).toHaveLength(count);
}
async function waitForPatchCount(events: TpoEvent[], count: number) {
  for (let i = 0; i < 400 && events.filter(event => event.type === 'tpo-patch').length < count; i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(events.filter(event => event.type === 'tpo-patch')).toHaveLength(count);
}

function historicalFixture(now: number) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const repairedGap = today - DAY_MS + 30 * MINUTE_MS;
  const sourceProfileDay = today - 2 * DAY_MS;
  const minute = (time: number, revision = 0, crossesLevel = false) => {
    const day = Math.floor(time / DAY_MS) * DAY_MS;
    const price = day === sourceProfileDay ? 100 : 110;
    return { time, open: price, high: crossesLevel ? 120 : price + 1, low: crossesLevel ? 90 : price - 1, close: price, revision, closed: true };
  };
  const page = async (_series: Series, from: number, to: number) => {
    const bars = [];
    for (let time = from; time < to; time += MINUTE_MS) {
      if (time === repairedGap) continue;
      bars.push(minute(time));
    }
    return bars;
  };
  return { today, repairedGap, sourceProfileDay, minute, page };
}

describe('TPO worker service', () => {
  test('reuses bounded cached history across reload and only revalidates recent source pages', async () => {
    const cache = new MemoryCache();
    const firstPages: Array<{ market: string; from: number }> = [];
    const failedFroms = new Set<number>();
    const makeTransport = (pages: typeof firstPages) => ({ now: () => now, page: async (series: Series, from: number, to: number) => {
      pages.push({ market: series.market ?? 'perpetual', from });
      if (failedFroms.has(from)) throw new Error('temporary refresh failure');
      return from < to ? [candle(from)] : [];
    } });
    const firstEvents: TpoEvent[] = [];
    const first = new TpoService({ cache, transport: makeTransport(firstPages), emit: event => firstEvents.push(event) });
    first.subscribe('spot', { venue: 'binance', market: 'spot', interval: '15m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(firstEvents);
    expect(firstPages.length).toBeGreaterThan(100);
    expect(firstPages.every(page => page.market === 'spot')).toBe(true);
    first.dispose();

    const refreshPages: Array<{ market: string; from: number }> = [];
    const secondEvents: TpoEvent[] = [];
    const pageMs = 1_000 * MINUTE_MS;
    const failedFrom = Math.floor((now - 2 * DAY_MS) / pageMs) * pageMs;
    failedFroms.add(failedFrom);
    const second = new TpoService({ cache, transport: makeTransport(refreshPages), emit: event => secondEvents.push(event) });
    second.subscribe('spot-reloaded', { venue: 'binance', market: 'spot', interval: '1h' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(secondEvents);
    expect(refreshPages.length).toBeGreaterThan(0);
    expect(refreshPages.length).toBeLessThan(10);
    const ready = secondEvents.filter(event => event.type === 'tpo-snapshot').at(-1)!;
    expect(ready.status.cacheHits).toBeGreaterThan(100);
    expect(ready.status.state).toBe('partial');
    expect(ready.status.message).toContain('1 history page(s) failed');
    failedFroms.clear();
    const beforeRetry = refreshPages.length;
    second.retry('spot-reloaded');
    await waitForSnapshotCount(secondEvents, 2);
    expect(refreshPages.length - beforeRetry).toBeGreaterThan(100);
    second.dispose();
  });

  test('live current-minute patches recompute only the touched UTC day profile', async () => {
    const events: TpoEvent[] = [];
    const commands: any[] = [];
    const service = new TpoService({ cache: new MemoryCache(), emit: event => events.push(event), marketCommand: command => commands.push(command), transport: {
      now: () => now,
      page: async (_series, from, to) => from < to ? [candle(from)] : [],
    } });
    service.subscribe('live', { venue: 'hyperliquid', market: 'perpetual', interval: '5m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(events);
    const before = service.diagnostics().profileRecomputes;
    const id = commands.find(command => command.type === 'subscribe')!.id;
    service.marketEvent({ type: 'patch', key: 'test', ids: [id], candles: [{ t: Math.floor(now / MINUTE_MS) * MINUTE_MS, o: 100, h: 102, l: 99, c: 101, v: 0, revision: 1, closed: false }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(service.diagnostics().profileRecomputes - before).toBe(1);
    service.dispose();
  });

  test('UTC day rollover advances the rolling 90-day retention window', async () => {
    const events: TpoEvent[] = [];
    let clockNow = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS - 2 * MINUTE_MS;
    const service = new TpoService({ cache: new MemoryCache(), emit: event => events.push(event), transport: {
      now: () => clockNow,
      page: async (_series, from, to) => from < to ? [candle(from)] : [],
    } });
    service.subscribe('rolling-retention', { venue: 'binance', market: 'spot', interval: '15m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(events);
    const initial = events.find(event => event.type === 'tpo-snapshot')!;
    expect(initial.type).toBe('tpo-snapshot');
    if (initial.type !== 'tpo-snapshot') throw new Error('expected initial snapshot');
    const priorCount = service.diagnostics().groups[0]!.minutes;
    clockNow += 2 * MINUTE_MS;
    const current = Math.floor(clockNow / MINUTE_MS) * MINUTE_MS;
    const feedId = `tpo-feed:${initial.key}`;
    service.marketEvent({ type: 'patch', key: 'next-utc-day', ids: [feedId], candles: [{ t: current, o: 100, h: 102, l: 99, c: 101, v: 0, revision: 1, closed: false }] });
    await waitForPatchCount(events, 1);
    const updated = events.filter(event => event.type === 'tpo-patch').at(-1)!;
    expect(updated.type).toBe('tpo-patch');
    if (updated.type !== 'tpo-patch') throw new Error('expected live patch');
    expect(updated.status.coverageFrom).toBe(initial.status.coverageFrom + DAY_MS);
    expect(updated.status.coverageTo).toBeGreaterThan(initial.status.coverageTo);
    expect(service.diagnostics().groups[0]!.minutes).toBeLessThanOrEqual(priorCount + 1);
    service.dispose();
  });

  test('live TPO resumes after a 24-hour disconnect and marks unrepaired naked coverage unknown', async () => {
    const events: TpoEvent[] = [], commands: any[] = [];
    let clockNow = now;
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    const sourceDay = today - DAY_MS * 2;
    const initialEnd = Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    const service = new TpoService({ cache: new MemoryCache(), emit: event => events.push(event), marketCommand: command => commands.push(command), transport: {
      now: () => clockNow,
      page: async (_series, from, to) => {
        const bars = [];
        for (let time = from; time < Math.min(to, initialEnd); time += MINUTE_MS) {
          const price = Math.floor(time / DAY_MS) * DAY_MS === sourceDay ? 100 : 110;
          bars.push({ time, open: price, high: price + 1, low: price - 1, close: price, revision: 0, closed: time < Math.floor(now / MINUTE_MS) * MINUTE_MS });
        }
        return bars;
      },
    } });
    service.subscribe('disconnect-recovery', { venue: 'hyperliquid', market: 'perpetual', interval: '5m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(events);
    const initial = events.find(event => event.type === 'tpo-snapshot')!;
    expect(initial.type).toBe('tpo-snapshot');
    if (initial.type !== 'tpo-snapshot') throw new Error('expected initial snapshot');
    const levelBefore = initial.nakedLevels.find(level => level.originDay === sourceDay && level.kind === 'POC');
    expect(levelBefore?.state).toBe('active');
    clockNow += DAY_MS;
    const current = Math.floor(clockNow / MINUTE_MS) * MINUTE_MS;
    const feedId = commands.find(command => command.type === 'subscribe')!.id;
    service.marketEvent({ type: 'patch', key: 'after-disconnect', ids: [feedId], candles: [{ t: current, o: 110, h: 111, l: 109, c: 110, v: 0, revision: 1, closed: false }] });
    await waitForPatchCount(events, 1);
    const resumed = events.filter(event => event.type === 'tpo-patch').at(-1)!;
    expect(resumed.type).toBe('tpo-patch');
    if (resumed.type !== 'tpo-patch') throw new Error('expected resumed live patch');
    const levelAfter = resumed.nakedLevels.find(level => level.originDay === sourceDay && level.kind === 'POC');
    expect(levelAfter).toMatchObject({ state: 'unknown', firstTouch: null });
    expect(levelAfter?.missingMinutes).toBeGreaterThan(0);
    expect(resumed.status.missingMinutes).toBeGreaterThan(0);
    expect(resumed.status.coverageTo).toBeGreaterThan(initial.status.coverageTo);
    expect(service.diagnostics().groups[0]!.minutes).toBeLessThanOrEqual(5_000);
    service.dispose();
  });

  test('calculation setting updates reuse loaded minutes without restarting the source group', async () => {
    const events: TpoEvent[] = [];
    let pageCalls = 0;
    const service = new TpoService({ cache: new MemoryCache(), emit: event => events.push(event), transport: {
      now: () => now,
      page: async (_series, from, to) => { pageCalls++; return from < to ? [candle(from)] : []; },
    } });
    service.subscribe('settings', { venue: 'binance', market: 'spot', interval: '15m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(events);
    const pagesBeforeUpdate = pageCalls;
    const calculationsBeforeUpdate = service.diagnostics().profileRecomputes;
    service.updateSettings('settings', { ...DEFAULT_TPO_SETTINGS, bracketMinutes: 15 });
    await waitForSnapshotCount(events, 2);
    expect(pageCalls).toBe(pagesBeforeUpdate);
    expect(service.diagnostics().groups).toHaveLength(1);
    expect(service.diagnostics().profileRecomputes).toBeGreaterThan(calculationsBeforeUpdate);
    service.dispose();
  });

  test('historical candle corrections rebuild finitely and invalidate completed profile and naked caches', async () => {
    const cache = new MemoryCache(), events: TpoEvent[] = [], commands: any[] = [];
    const fixture = historicalFixture(now);
    const service = new TpoService({ cache, emit: event => events.push(event), marketCommand: command => commands.push(command), transport: {
      now: () => now, page: fixture.page,
    } });
    service.subscribe('revision', { venue: 'hyperliquid', market: 'perpetual', interval: '5m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(events);
    const before = service.diagnostics();
    const profileBefore = [...cache.values.entries()].filter(([key]) => key.startsWith('profile:')).map(([, value]) => JSON.stringify(value)).sort();
    const nakedBefore = [...cache.values.entries()].find(([key]) => key.startsWith('naked:'))?.[1];
    expect(profileBefore.length).toBeGreaterThan(0);
    expect(nakedBefore).toBeDefined();
    const feedId = commands.find(command => command.type === 'subscribe')!.id;
    const revisedAt = fixture.sourceProfileDay + 2 * 60 * MINUTE_MS;
    service.marketEvent({ type: 'patch', key: 'historical-correction', ids: [feedId], candles: [{ t: revisedAt, o: 100, h: 102, l: 99, c: 100.5, v: 0, revision: 1, closed: true }] });
    await waitForPatchCount(events, 1);
    const after = service.diagnostics();
    const profileAfter = [...cache.values.entries()].filter(([key]) => key.startsWith('profile:')).map(([, value]) => JSON.stringify(value)).sort();
    const nakedAfter = [...cache.values.entries()].find(([key]) => key.startsWith('naked:'))?.[1];
    expect(after.profileRecomputes).toBeGreaterThan(before.profileRecomputes);
    expect(after.nakedRecomputes).toBeGreaterThan(before.nakedRecomputes);
    expect(profileAfter).not.toEqual(profileBefore);
    expect(nakedAfter).not.toEqual(nakedBefore);
    service.dispose();
  });

  test('a missing historical minute repairs unknown naked levels after a full rescan', async () => {
    const events: TpoEvent[] = [], commands: any[] = [];
    const fixture = historicalFixture(now);
    const service = new TpoService({ cache: new MemoryCache(), emit: event => events.push(event), marketCommand: command => commands.push(command), transport: {
      now: () => now, page: fixture.page,
    } });
    service.subscribe('backfill', { venue: 'hyperliquid', market: 'perpetual', interval: '5m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(events);
    const initial = events.find(event => event.type === 'tpo-snapshot')!;
    const originLevel = initial.type === 'tpo-snapshot' ? initial.nakedLevels.find(level => level.originDay === fixture.sourceProfileDay && level.kind === 'POC') : undefined;
    expect(originLevel?.state).toBe('unknown');
    const feedId = commands.find(command => command.type === 'subscribe')!.id;
    const bar = fixture.minute(fixture.repairedGap, 1, true);
    service.marketEvent({ type: 'patch', key: 'historical-gap-repair', ids: [feedId], candles: [{ t: bar.time, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: 0, revision: 1, closed: true }] });
    await waitForPatchCount(events, 1);
    const updated = events.filter(event => event.type === 'tpo-patch').at(-1)!;
    const repaired = updated.type === 'tpo-patch' && updated.nakedLevels.find(level => level.originDay === fixture.sourceProfileDay && level.kind === 'POC');
    expect(repaired).toMatchObject({ state: 'tested', firstTouch: fixture.repairedGap, missingMinutes: 0 });
    service.dispose();
  });

  test('serializes live model writes and suppresses emissions after disposal during a delayed cache write', async () => {
    const cache = new DelayedCache(), events: TpoEvent[] = [], commands: any[] = [];
    const service = new TpoService({ cache, emit: event => events.push(event), marketCommand: command => commands.push(command), transport: {
      now: () => now, page: historicalFixture(now).page,
    } });
    service.subscribe('delayed', { venue: 'hyperliquid', market: 'perpetual', interval: '5m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(events);
    const feedId = commands.find(command => command.type === 'subscribe')!.id;
    const current = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    cache.delayNextWrite();
    service.marketEvent({ type: 'patch', key: 'blocked-live-write', ids: [feedId], candles: [{ t: current, o: 110, h: 200, l: 90, c: 110, v: 0, revision: 1, closed: false }] });
    await cache.nextWriteStarted;
    const patchCountAtDispose = events.filter(event => event.type === 'tpo-patch').length;
    service.dispose();
    cache.releaseWrite();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(events.filter(event => event.type === 'tpo-patch')).toHaveLength(patchCountAtDispose);
  });

  test('a newer live revision cannot be emitted before an older delayed model write', async () => {
    const cache = new DelayedCache(), events: TpoEvent[] = [], commands: any[] = [];
    const service = new TpoService({ cache, emit: event => events.push(event), marketCommand: command => commands.push(command), transport: {
      now: () => now, page: historicalFixture(now).page,
    } });
    service.subscribe('ordered-live', { venue: 'hyperliquid', market: 'perpetual', interval: '5m' }, DEFAULT_TPO_SETTINGS);
    await waitForSnapshot(events);
    const feedId = commands.find(command => command.type === 'subscribe')!.id;
    const current = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    cache.delayNextWrite();
    service.marketEvent({ type: 'patch', key: 'older-live-revision', ids: [feedId], candles: [{ t: current, o: 110, h: 200, l: 90, c: 110, v: 0, revision: 1, closed: false }] });
    await cache.nextWriteStarted;
    service.marketEvent({ type: 'patch', key: 'newer-live-revision', ids: [feedId], candles: [{ t: current, o: 110, h: 300, l: 80, c: 110, v: 0, revision: 2, closed: false }] });
    cache.releaseWrite();
    await waitForPatchCount(events, 2);
    const patches = events.filter(event => event.type === 'tpo-patch');
    const maxProfilePrice = (event: TpoEvent) => event.type === 'tpo-patch'
      ? Math.max(...event.sessions.flatMap(session => session.rows.map(row => (row.firstTick + row.rowTicks) * session.tickSize)))
      : 0;
    expect(maxProfilePrice(patches[0]!)).toBeLessThan(250);
    expect(maxProfilePrice(patches[1]!)).toBeGreaterThan(250);
    service.dispose();
  });
});

