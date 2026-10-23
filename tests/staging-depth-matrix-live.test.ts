import { describe, expect, it } from 'vitest';
import { DEFAULT_DEPTH_MATRIX_SETTINGS, matrixBucketBounds, matrixBucketIndex } from '../src/feed/depth-matrix';
import { StagingDepthMatrixService } from '../src/feed/staging-depth-matrix';
import type { DepthHeadNotice, StagingHeatmapService } from '../src/feed/staging-heatmap';

const live = process.env.IQTERM_RUN_LIVE_DEPTH_MATRIX === '1';
describe.skipIf(!live)('live staging Depth Matrix compact endpoint', () => {
  it('follows both durable heads through the compact current-book API', async () => {
    const origin = process.env.IQTERM_DEPTH_MATRIX_ORIGIN ?? 'http://127.0.0.1:5173';
    const heads = new Map<string, { market: 'spot' | 'perpetual'; callback: (notice: DepthHeadNotice) => void }>();
    let latestEvent: any;
    const headsSeen = new Map<'spot'|'perpetual', number>([['spot', 0], ['perpetual', 0]]);
    const latestHeads = new Map<'spot'|'perpetual', number>();
    const sockets: WebSocket[] = [];
    const requestTimes: number[] = [];
    const headSource = { observeDepthHeads(id: string, market: 'spot' | 'perpetual', _after: number, callback: (notice: DepthHeadNotice) => void) {
      heads.set(id, { market, callback });
      return () => heads.delete(id);
    } };
    const request: typeof fetch = async (input, init) => {
      const url = new URL(String(input), origin);
      const started = performance.now();
      const response = await fetch(url, init);
      if (url.pathname.endsWith('/depth-matrix')) requestTimes.push(performance.now() - started);
      return response;
    };
    const service = new StagingDepthMatrixService(headSource as unknown as StagingHeatmapService, value => { latestEvent = value; }, request);
    try {
      const [perpetualHealth, spotHealth] = await Promise.all([
        fetch(new URL('/market-data/v1/health', origin)).then(r => r.json()),
        fetch(new URL('/market-data/v1/health?market=spot', origin)).then(r => r.json()),
      ]) as any[];
      expect(perpetualHealth.depth.status.state).toBe('live');
      expect(spotHealth.depth.status.state).toBe('live');
      service.command({ type: 'depth-matrix-subscribe', id: 'live-check', settings: {
        ...DEFAULT_DEPTH_MATRIX_SETTINGS, sources: ['binance-spot', 'binance-perpetual'],
      } });
      for (const market of ['spot', 'perpetual'] as const) {
        const url = new URL('/market-data/v1/stream', origin.replace(/^http/, 'ws'));
        if (market === 'spot') url.searchParams.set('market', 'spot');
        const socket = new WebSocket(url.href);
        sockets.push(socket);
        socket.onopen = () => socket.send(JSON.stringify({ type: 'subscribe', version: 1, channel: 'depth', after: 0, ...(market === 'spot' ? { market: 'spot' } : {}) }));
        socket.onmessage = message => {
          try {
            const value = JSON.parse(String(message.data));
            if (value.type === 'depth-head' && value.watermark) {
              headsSeen.set(market, (headsSeen.get(market) ?? 0) + 1);
              latestHeads.set(market, value.watermark.cursor);
              heads.get(`depth-matrix:${market}`)?.callback({ type: 'head', cursor: value.watermark.cursor, at: value.watermark.at, epoch: value.watermark.epoch });
              socket.send(JSON.stringify({ type: 'ack', cursor: value.watermark.cursor }));
            } else if (value.type === 'reset') heads.get(`depth-matrix:${market}`)?.callback({ type: 'reset', message: value.reason ?? 'collector reset' });
          } catch { /* Ignore non-contract frames. */ }
        };
      }
      const loaded = await waitFor(() => latestEvent?.columns?.length === 2 && latestEvent.columns.every((column: any) => column.state === 'live'), 25_000);
      expect(loaded, JSON.stringify({ diagnostics: service.diagnostics(), columns: latestEvent?.columns?.map((c: any) => ({ source: c.source, state: c.state, message: c.message, cursor: c.cursor })) })).toBe(true);
      for (const column of latestEvent.columns) assertColumn(column);
      const initialCursors = new Map(latestEvent.columns.map((column: any) => [column.source, column.cursor]));
      const followedHeads = await waitFor(() => (headsSeen.get('spot') ?? 0) > 1 && (headsSeen.get('perpetual') ?? 0) > 1
        && latestEvent?.columns?.every((column: any) => column.state === 'live' && Date.now() - column.lastAt <= 5_000
          && column.cursor > Number(initialCursors.get(column.source))), 25_000);
      expect(followedHeads, JSON.stringify({ headsSeen: Object.fromEntries(headsSeen), latestHeads: Object.fromEntries(latestHeads), diagnostics: service.diagnostics(), columns: latestEvent?.columns?.map((c: any) => ({ source: c.source, state: c.state, lastAt: c.lastAt, ageMs: c.ageMs, cursor: c.cursor, latestHead: latestHeads.get(c.source === 'binance-spot' ? 'spot' : 'perpetual') })) })).toBe(true);
      for (const column of latestEvent.columns) {
        expect(column.quantityUnit).toBe('BTC');
        assertColumn(column);
      }
      const sorted = [...requestTimes].sort((a, b) => a - b);
      const quantile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
      console.log('Live compact depth matrix profile', JSON.stringify({ headsSeen: Object.fromEntries(headsSeen), requestCount: requestTimes.length,
        requestMs: { p50: quantile(.5), p95: quantile(.95), max: sorted.at(-1) ?? 0 }, markets: service.diagnostics().markets }));
    } finally { service.dispose(); for (const socket of sockets) socket.close(); }
  }, 60_000);
});

function assertColumn(column: any) {
  expect(column.rows.length).toBeGreaterThan(0);
  expect(column.rows.length).toBeLessThanOrEqual(2_000);
  let prior: bigint | null = null;
  for (const row of column.rows) {
    const index = BigInt(row.index), bounds = matrixBucketBounds(index, DEFAULT_DEPTH_MATRIX_SETTINGS.bucketWidth);
    expect(bounds).toEqual({ low: row.low, high: row.high });
    expect(matrixBucketIndex(row.low, DEFAULT_DEPTH_MATRIX_SETTINGS.bucketWidth)).toBe(row.index);
    if (prior !== null) expect(index).toBe(prior + 1n);
    expect(row.bidQuantity).toBeGreaterThanOrEqual(0);
    expect(row.askQuantity).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(row.bidNotional) && Number.isFinite(row.askNotional)).toBe(true);
    prior = index;
  }
}

async function waitFor(predicate: () => boolean, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return true; await new Promise(resolve => setTimeout(resolve, 20)); }
  return predicate();
}
