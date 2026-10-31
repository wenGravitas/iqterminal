import { describe, expect, it } from 'vitest';
import { ConnectionActivityLog, MAX_CONNECTION_ACTIVITY, summarizeMonitoredFeeds } from '../src/connection-status-model';
import type { MonitoredFeedStatus } from '../src/feed/observed-status';

const feed = (patch: Partial<MonitoredFeedStatus> = {}): MonitoredFeedStatus => ({
  key: 'candles:chart-a', kind: 'candles', source: 'binance:spot', label: 'BTCUSDT · 1m', mode: 'direct',
  state: 'live', message: 'Native candle stream', lastUpdate: 1_000, observed: true, ...patch,
});

describe('monitored feed status', () => {
  it('keeps idle neutral and only marks active observed failures as degraded', () => {
    expect(summarizeMonitoredFeeds([], true, false)).toMatchObject({ state: 'idle', active: 0, failed: 0 });
    expect(summarizeMonitoredFeeds([], false, false)).toMatchObject({ state: 'offline' });
    expect(summarizeMonitoredFeeds([feed()], true, false)).toMatchObject({ state: 'live', live: 1 });
    expect(summarizeMonitoredFeeds([feed({ state: 'stale' })], true, false)).toMatchObject({ state: 'pending', pending: 1 });
    expect(summarizeMonitoredFeeds([feed({ state: 'failed' })], true, false)).toMatchObject({ state: 'failed', failed: 1 });
    expect(summarizeMonitoredFeeds([feed(), feed({ key: 'comparison:x', state: 'failed' })], true, false)).toMatchObject({ state: 'pending', live: 1, failed: 1 });
    expect(summarizeMonitoredFeeds([feed({ state: 'partial' })], true, false)).toMatchObject({ state: 'pending', live: 0, pending: 1 });
    expect(summarizeMonitoredFeeds([feed()], true, true)).toMatchObject({ state: 'fixture' });
    expect(summarizeMonitoredFeeds([feed({ mode: 'fixture' })], false, true)).toMatchObject({ state: 'offline', label: 'Browser offline' });
  });

  it('records state/message changes, not heartbeats or last-update timestamps', () => {
    const log = new ConnectionActivityLog();
    log.update([feed({ state: 'starting', observed: false })], true, 10);
    expect(log.snapshot()).toEqual([]);
    log.update([feed({ lastUpdate: 1_000 })], true, 20);
    log.update([feed({ lastUpdate: 2_000 })], true, 30);
    expect(log.snapshot()).toMatchObject([{ from: 'Starting', to: 'Live', detail: 'Native candle stream', at: 20 }]);
    log.update([feed({ state: 'stale', message: 'No valid candle update for 15s', lastUpdate: 2_000 })], true, 40);
    expect(log.snapshot()).toHaveLength(2);
    expect(log.snapshot()[0]).toMatchObject({ from: 'Live', to: 'Stale', at: 40 });
    log.update([], true, 50);
    expect(log.snapshot()[0]).toMatchObject({ from: 'Stale', to: 'Idle', detail: 'No active subscription', at: 50 });
    log.update([], false, 60);
    expect(log.snapshot()[0]).toMatchObject({ source: 'browser', from: 'Online', to: 'Offline' });
  });

  it('keeps only the newest 100 observed transitions in order', () => {
    const log = new ConnectionActivityLog();
    log.update([feed()], true, 1);
    for (let index = 0; index < MAX_CONNECTION_ACTIVITY + 5; index++) {
      const state = index % 2 ? 'live' : 'stale';
      log.update([feed({ state, message: `Observed ${index}` })], true, index + 2);
    }
    const rows = log.snapshot();
    expect(rows).toHaveLength(MAX_CONNECTION_ACTIVITY);
    expect(rows[0]).toMatchObject({ detail: `Observed ${MAX_CONNECTION_ACTIVITY + 4}`, at: MAX_CONNECTION_ACTIVITY + 6 });
    expect(rows.at(-1)?.at).toBeGreaterThan(1);
    log.clear();
    expect(log.snapshot()).toEqual([]);
  });
});
