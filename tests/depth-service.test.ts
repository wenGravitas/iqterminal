import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceDepthService, type DepthTransport } from '../src/feed/depth-service';
import { type DepthDiff, type DepthSnapshot } from '../src/feed/depth-book';
import { type Event } from '../src/feed/protocol';

const snapshot: DepthSnapshot = { lastUpdateId: 100, bids: [['100', '2'], ['99', '3'], ['90', '1']], asks: [['100.1', '4'], ['101', '5'], ['110', '2']] };
const depth = (U: number, u: number, pu: number): DepthDiff => ({ U, u, pu, b: [], a: [] });
class Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  update(event: DepthDiff) { this.onmessage?.({ data: JSON.stringify({ e: 'depthUpdate', s: 'BTCUSDT', ...event }) }); }
}
let service: BinanceDepthService;
afterEach(() => { service?.dispose(); vi.useRealTimers(); });

function setup(snapshotLoad: DepthTransport['snapshot'] = async () => snapshot) {
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  const events: Event[] = [];
  let now = 1_800_000_000_000;
  const transport: DepthTransport = {
    snapshot: vi.fn(snapshotLoad),
    socket: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; },
    now: () => now,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  service = new BinanceDepthService(event => events.push(event), transport);
  return { sockets, events, transport, advance: async (ms: number) => { now += ms; await vi.advanceTimersByTimeAsync(ms); } };
}

describe('shared Binance depth service', () => {
  it('uses one socket/book for same-band subscribers and sends bounded real sample history', async () => {
    const x = setup();
    service.subscribe('script-a', 0.05);
    service.subscribe('script-b', 0.05);
    expect(x.sockets).toHaveLength(1);
    x.sockets[0].open();
    x.sockets[0].update(depth(100, 101, 99));
    await x.advance(0);
    expect(x.events.some(event => event.type === 'depth-status' && event.status.state === 'live')).toBe(true);
    await x.advance(1000);
    const sample = x.events.find(event => event.type === 'depth-sample');
    expect(sample).toMatchObject({ type: 'depth-sample', ids: ['script-a', 'script-b'], observation: { bandPercent: 0.05, bidCovered: true, askCovered: true } });
    service.subscribe('script-c', 0.05);
    const history = x.events.at(-1);
    expect(history).toMatchObject({ type: 'depth-history', ids: ['script-c'], bandPercent: 0.05, observations: [{ bidBase: 2, askBase: 4 }] });
    expect(service.diagnostics()).toMatchObject({ subscribers: 3, sockets: 1, state: 'live', synthetic: false });
    service.unsubscribe('script-a');
    service.unsubscribe('script-b');
    expect(service.diagnostics().sockets).toBe(1);
    service.unsubscribe('script-c');
    expect(service.diagnostics()).toMatchObject({ subscribers: 0, sockets: 0 });
  });

  it('shares one socket across bands and keeps it alive while an attachment changes bands', async () => {
    const x = setup();
    service.subscribe('script-a', 0.05);
    x.sockets[0].open();
    x.sockets[0].update(depth(100, 101, 99));
    await x.advance(0);
    service.subscribe('script-b', 0.2);
    expect(x.sockets).toHaveLength(1);
    await x.advance(1000);
    expect(x.events.filter(event => event.type === 'depth-sample').map(event => event.type === 'depth-sample' ? event.observation.bandPercent : null).sort((a,b)=>a!-b!)).toEqual([0.05, 0.2]);
    expect(service.diagnostics()).toMatchObject({ subscribers: 2, sockets: 1, state: 'live', samples: 1 });
    service.unsubscribe('script-a');
    expect(service.diagnostics()).toMatchObject({ subscribers: 1, sockets: 1, state: 'live' });
    await x.advance(1000);
    expect(x.events.filter(event => event.type === 'depth-sample' && event.observation.bandPercent === 0.2)).toHaveLength(2);
    service.unsubscribe('script-b');
    expect(service.diagnostics()).toMatchObject({ subscribers: 0, sockets: 0 });
  });

  it('drops book trust across a sequence gap and reconnects before sampling again', async () => {
    let snapshots = 0;
    const x = setup(async () => ({ ...snapshot, lastUpdateId: snapshots++ === 0 ? 100 : 104 }));
    service.subscribe('script-a', 0.05);
    x.sockets[0].open();
    x.sockets[0].update(depth(100, 101, 99));
    await x.advance(0);
    await x.advance(1000);
    const priorSamples = x.events.filter(event => event.type === 'depth-sample').length;
    x.sockets[0].update(depth(103, 104, 102));
    expect(x.events.some(event => event.type === 'depth-status' && event.status.state === 'syncing')).toBe(true);
    await x.advance(1000);
    expect(x.events.filter(event => event.type === 'depth-sample')).toHaveLength(priorSamples);
    await x.advance(500);
    expect(x.sockets).toHaveLength(2);
    x.sockets[1].open();
    x.sockets[1].update(depth(104, 105, 103));
    await x.advance(0);
    await x.advance(1000);
    expect(x.events.filter(event => event.type === 'depth-sample').length).toBeGreaterThan(priorSamples);
  });

  it('bounds every snapshot retry, including a hung request after an unbridged snapshot', async () => {
    let calls = 0, retrySignal: AbortSignal | undefined;
    const x = setup(signal => {
      if (++calls === 1) return Promise.resolve(snapshot);
      retrySignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Snapshot timeout')), { once: true }));
    });
    service.subscribe('script-a', .05); x.sockets[0].open();
    // No bridging diff yet: first snapshot schedules another snapshot attempt.
    await x.advance(250); expect(calls).toBe(2);
    await x.advance(12000); expect(retrySignal?.aborted).toBe(true);
    expect(x.sockets[0].readyState).toBe(3);
    expect(service.diagnostics().state).toBe('syncing');
    await x.advance(500); expect(x.sockets).toHaveLength(2);
  });

  it('ignores stale snapshot completion after the final subscriber leaves', async () => {
    let resolve!: (value: DepthSnapshot) => void;
    const x = setup(() => new Promise<DepthSnapshot>(r => { resolve = r; }));
    service.subscribe('script-a', 0.05);
    x.sockets[0].open();
    service.unsubscribe('script-a');
    resolve(snapshot);
    await x.advance(0);
    expect(service.diagnostics()).toMatchObject({ subscribers: 0, sockets: 0, state: 'syncing' });
    expect(x.events.some(event => event.type === 'depth-status' && event.status.state === 'live')).toBe(false);
  });
});
