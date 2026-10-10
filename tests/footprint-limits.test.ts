import { afterEach, expect, it, vi } from 'vitest';
import { BinanceFootprintService, type FootprintTransport } from '../src/feed/footprint-service';
import { FOOTPRINT_MAX_PENDING, FOOTPRINT_MAX_RECENT_IDS } from '../src/feed/footprint';
import type { Event, FootprintRowTicks, Interval } from '../src/feed/protocol';

const base = 1_800_000_000_000;
const metadata = (tickSize = '0.10') => ({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'BTC', quoteAsset: 'USDT', marginAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize }] }] });
const record = (id: number) => ({ e: 'aggTrade', E: base + id + 1, T: base + id, s: 'BTCUSDT', st: 1, a: id, f: id * 3, l: id * 3 + 2, p: '83000.10', q: '0.004', m: false });
class Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open() { this.readyState = 1; this.onopen?.(); }
  sendRecord(id: number) { this.onmessage?.({ data: JSON.stringify(record(id)) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
const services: BinanceFootprintService[] = [];
afterEach(() => { for (const service of services.splice(0)) service.dispose(); vi.useRealTimers(); });
function setup(getMetadata: FootprintTransport['metadata'] = async () => metadata()) {
  vi.useFakeTimers(); vi.setSystemTime(base);
  const sockets: Socket[] = [], events: Event[] = [];
  const transport: FootprintTransport = {
    metadata: vi.fn(getMetadata), socket: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; },
    now: Date.now, setInterval, clearInterval, setTimeout, clearTimeout,
  };
  const service = new BinanceFootprintService(event => events.push(event), transport);
  services.push(service);
  return { service, transport, sockets, events };
}

it('bounds active configurations and shares one pending metadata request and execution socket', async () => {
  const { service, transport, sockets, events } = setup();
  const configurations: [Interval, FootprintRowTicks][] = [['1m', 1], ['1m', 2], ['1m', 5], ['1m', 10], ['1m', 20], ['1m', 50], ['5m', 10], ['15m', 10], ['1h', 10]];
  service.subscribe('matching-consumer', { venue: 'binance', market: 'perpetual', interval: '1m' }, 1);
  configurations.forEach(([interval, rowTicks], index) => service.subscribe(`consumer-${index}`, { venue: 'binance', market: 'perpetual', interval }, rowTicks));
  expect(transport.metadata).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(sockets).toHaveLength(1);
  expect(service.diagnostics().groups).toHaveLength(8);
  expect(service.diagnostics().subscribers).toBe(9);
  expect(events.some(event => event.type === 'footprint-status' && event.ids.includes('consumer-8') && event.status.state === 'failed')).toBe(true);
  service.unsubscribe('matching-consumer');
  for (let index = 0; index < 8; index++) service.unsubscribe(`consumer-${index}`);
  expect(service.diagnostics()).toMatchObject({ subscribers: 0, sockets: 0, pending: 0, recentIds: 0 });
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds burst ordering and ID retention, rejecting an expired duplicate without adding volume', async () => {
  const { service, sockets } = setup();
  service.subscribe('one', { venue: 'binance', market: 'perpetual', interval: '1m' }, 10);
  await vi.advanceTimersByTimeAsync(0);
  sockets[0]!.open();
  const count = FOOTPRINT_MAX_RECENT_IDS + FOOTPRINT_MAX_PENDING;
  for (let id = 1; id <= count; id++) {
    sockets[0]!.sendRecord(id);
    expect(service.diagnostics().pending).toBeLessThanOrEqual(FOOTPRINT_MAX_PENDING);
  }
  await vi.advanceTimersByTimeAsync(100);
  const before = service.diagnostics();
  expect(before.pending).toBe(0);
  expect(before.recentIds).toBe(FOOTPRINT_MAX_RECENT_IDS);
  expect(before.counters.accepted).toBe(count);
  expect(before.expiredIdFloor).toBeGreaterThanOrEqual(1);
  sockets[0]!.sendRecord(1);
  await vi.advanceTimersByTimeAsync(100);
  const after = service.diagnostics();
  expect(after.counters.accepted).toBe(count);
  expect(after.counters.late).toBe(1);
  expect(after.groups[0]!.classifiedVolume).toBe(before.groups[0]!.classifiedVolume);
  expect(after.groups[0]!.lateRecords).toBe(1);
});

it('rejects a cancelled metadata response after the last consumer closes and a new generation starts', async () => {
  const pending: { signal: AbortSignal; resolve: (raw: unknown) => void }[] = [];
  const { service, sockets } = setup(signal => new Promise(resolve => pending.push({ signal, resolve })));
  service.subscribe('old', { venue: 'binance', market: 'perpetual', interval: '1m' }, 10);
  service.unsubscribe('old');
  expect(pending[0]!.signal.aborted).toBe(true);
  service.subscribe('new', { venue: 'binance', market: 'perpetual', interval: '5m' }, 20);
  pending[0]!.resolve(metadata('0.01'));
  await vi.advanceTimersByTimeAsync(0);
  expect(sockets).toHaveLength(0);
  expect(service.diagnostics().tickSize).toBeNull();
  pending[1]!.resolve(metadata('0.10'));
  await vi.advanceTimersByTimeAsync(0);
  expect(sockets).toHaveLength(1);
  expect(service.diagnostics()).toMatchObject({ tickSize: 0.1, subscribers: 1 });
  service.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
