import { afterEach, it, expect, vi } from 'vitest';
import { BinanceDepthService, type DepthTransport } from '../src/feed/depth-service';
import { BinanceHeatmapService } from '../src/feed/heatmap-service';
import type { Event } from '../src/feed/protocol';
class Socket {
  readyState = 0; onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  update(U: number, u: number, pu: number) { this.onmessage?.({ data: JSON.stringify({ e: 'depthUpdate', s: 'BTCUSDT', U, u, pu, b: [], a: [] }) }); }
}
let depth: BinanceDepthService, heatmap: BinanceHeatmapService;
afterEach(() => { heatmap?.dispose(); depth?.dispose(); vi.useRealTimers(); });
async function setup() {
  vi.useFakeTimers(); let now = 1000000; const sockets: Socket[] = [], events: Event[] = [];
  const transport: DepthTransport = { now: () => now, setInterval, clearInterval, setTimeout, clearTimeout,
    snapshot: async () => ({ lastUpdateId: 100, bids: [[90, 2], [100, 20]], asks: [[110, 5], [120, 2]] }),
    socket: () => { const s = new Socket(); sockets.push(s); return s as unknown as WebSocket; } };
  depth = new BinanceDepthService(e => events.push(e), transport);
  heatmap = new BinanceHeatmapService(depth, e => events.push(e), { now: () => now, setInterval, clearInterval,
    metadata: async () => ({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'BTC', quoteAsset: 'USDT', marginAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] }) });
  const advance = async (ms: number) => { now += ms; await vi.advanceTimersByTimeAsync(ms); };
  return { sockets, events, advance };
}
it('shares book across studies/heatmaps and bounds unacknowledged replacement queues', async () => {
  const x = await setup(); depth.subscribe('study', .05);
  heatmap.subscribe('a', { rowPrice: 10, bucketMs: 500 }); heatmap.subscribe('b', { rowPrice: 10, bucketMs: 500 });
  expect(x.sockets).toHaveLength(1); x.sockets[0]!.open(); x.sockets[0]!.update(100, 101, 99); await x.advance(0);
  depth.unsubscribe('study'); expect(depth.diagnostics()).toMatchObject({ subscribers: 0, bookObservers: 1, sockets: 1 });
  for (let i = 1; i <= 200; i++) { x.sockets[0]!.update(101 + i, 101 + i, 100 + i); await x.advance(500); }
  expect(x.events.filter(e => e.type === 'heatmap-batch')).toHaveLength(1); // First envelope remains unacknowledged.
  const first = x.events.find(e => e.type === 'heatmap-batch')!;
  if (first.type !== 'heatmap-batch') throw new Error('missing');
  expect(heatmap.diagnostics().groups[0]!.pending).toBeLessThanOrEqual(240);
  heatmap.ack(first.key, first.generation + 1, first.batchId); expect(x.events.filter(e => e.type === 'heatmap-batch')).toHaveLength(1);
  heatmap.ack(first.key, first.generation, first.batchId);
  const newest = x.events.at(-1)!; expect(newest.type).toBe('heatmap-batch');
  if (newest.type === 'heatmap-batch') expect(newest.buckets.length).toBeGreaterThan(0);
  heatmap.unsubscribe('a'); expect(depth.diagnostics().sockets).toBe(1);
  depth.subscribe('study', .05); heatmap.unsubscribe('b'); expect(depth.diagnostics()).toMatchObject({ sockets: 1, bookObservers: 0, subscribers: 1 });
  depth.unsubscribe('study'); expect(depth.diagnostics().sockets).toBe(0);
});
it('rejects invalid tick widths and fifth resolutions; gaps do not reuse old book state', async () => {
  const x = await setup(); heatmap.subscribe('a', { rowPrice: 1.25, bucketMs: 500 }); await x.advance(0);
  for (let i = 1; i <= 4; i++) heatmap.subscribe(String(i), { rowPrice: 10 * i, bucketMs: 500 });
  expect(heatmap.diagnostics().configurations).toBe(4);
  expect(x.events.some(e => e.type === 'heatmap-batch' && e.status.state === 'failed' && /Four/.test(e.status.message))).toBe(true);
  const first = x.events.find(e => e.type === 'heatmap-batch')!; if (first.type !== 'heatmap-batch') throw new Error('missing');
  heatmap.ack(first.key, first.generation, first.batchId); await x.advance(500);
  expect(x.events.some(e => e.type === 'heatmap-batch' && /multiple/.test(e.status.message))).toBe(true);
});
it('keeps retained tiles but leaves sequence-gap/offline time empty and rejects old acknowledgements after disposal', async () => {
  const x = await setup(); heatmap.subscribe('a', { rowPrice: 10, bucketMs: 500 });
  x.sockets[0]!.open(); x.sockets[0]!.update(100, 101, 99); await x.advance(0);
  const ackAll = () => { for (const e of [...x.events]) if (e.type === 'heatmap-batch') heatmap.ack(e.key, e.generation, e.batchId); };
  ackAll(); await x.advance(500); ackAll();
  const before = x.events.filter(e => e.type === 'heatmap-batch').flatMap(e => e.type === 'heatmap-batch' ? e.buckets : []);
  expect(before.some(b => b.end > b.start)).toBe(true);
  const cutoff = Math.max(...before.map(b => b.end));
  x.sockets[0]!.update(104, 105, 103); await x.advance(1000); ackAll();
  const after = x.events.filter(e => e.type === 'heatmap-batch').flatMap(e => e.type === 'heatmap-batch' ? e.buckets : []);
  expect(after.every(b => b.end <= cutoff)).toBe(true);
  expect(x.sockets).toHaveLength(2);
  depth.setOnline(false); expect(depth.diagnostics().state).toBe('stale');
  heatmap.unsubscribe('a'); ackAll(); expect(heatmap.diagnostics()).toMatchObject({ consumers: 0, configurations: 0 });
  expect(depth.diagnostics()).toMatchObject({ sockets: 0, bookObservers: 0 });
});

it('shares matching fixed-boundary footprint and candle resolutions on one depth source', async () => {
  const x = await setup();
  heatmap.subscribe('candle', { rowPrice: 25, bucketMs: 500 });
  heatmap.subscribe('footprint-a', { rowPrice: 25, bucketMs: 500, rowAlignment: 'footprint' });
  heatmap.subscribe('footprint-b', { rowPrice: 25, bucketMs: 500, rowAlignment: 'footprint' });
  expect(heatmap.diagnostics()).toMatchObject({ consumers: 3, configurations: 1 });
  expect(x.sockets).toHaveLength(1);
  x.sockets[0]!.open(); x.sockets[0]!.update(100, 101, 99); await x.advance(0);
  // The second matching consumer requests another snapshot behind the first envelope.
  for (let pass = 0; pass < 2; pass++) for (const e of [...x.events]) if (e.type === 'heatmap-batch') heatmap.ack(e.key, e.generation, e.batchId);
  await x.advance(500);
  const bucketed = x.events.filter(e => e.type === 'heatmap-batch' && e.key === '25:500');
  expect(bucketed.some(e => e.type === 'heatmap-batch' && e.buckets.some(b => b.priceOffset === 0))).toBe(true);
  heatmap.unsubscribe('candle'); heatmap.unsubscribe('footprint-a');
  expect(heatmap.diagnostics()).toMatchObject({ consumers: 1, configurations: 1 });
  expect(depth.diagnostics().sockets).toBe(1);
  heatmap.unsubscribe('footprint-b'); expect(depth.diagnostics().sockets).toBe(0);
});
