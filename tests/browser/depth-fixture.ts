import type { Page } from '@playwright/test';
/** Test-only wire transport; production has no synthetic liquidity path. Actual feed worker/services remain intact. */
export async function installDepthFixture(page: Page, historyBuckets = 0, dense = false) {
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((p: any) => p.bars === 5000));
  const worker = page.workers()[0]!;
  await worker.evaluate(({ historyBuckets, dense }) => {
    const realNow = Date.now.bind(Date);
    let clock = historyBuckets ? realNow() - historyBuckets * 500 : 0;
    if (historyBuckets) Date.now = () => clock || realNow();
    const nativeFetch = self.fetch.bind(self), NativeSocket = self.WebSocket;
    const probe = (self as any).__heatmapFixture = { sockets: 0, active: 0, diffs: 0, pause: false, frames: [] as any[], socket: null as any, populate: () => { if (!historyBuckets) return; for (let i = 0; i < historyBuckets; i++) { clock += 500; probe.socket?.update(); } clock = 0; } };
    self.fetch = async (input: any, options: any) => {
      const address = String(input);
      if (address.includes('/depth?')) return new Response(JSON.stringify(dense ? { lastUpdateId: 100,
        bids: Array.from({length:1000}, (_, i) => [83499.9-i*.1, .1+(i%31)/10]),
        asks: Array.from({length:1000}, (_, i) => [83500+i*.1, .1+(i%29)/10]) } : { lastUpdateId: 100,
        bids: [[82700, 1], [82990, 20], [82980, 10], [82970, 5]], asks: [[83000, 25], [83010, 10], [83020, 5], [83300, 1]] }));
      if (address.includes('/exchangeInfo')) return new Response(JSON.stringify({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'BTC', quoteAsset: 'USDT', marginAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] }));
      return nativeFetch(input, options);
    };
    const post = self.postMessage.bind(self);
    self.postMessage = (message: any, ...args: any[]) => {
      if (message.type === 'heatmap-batch' && message.buckets.length) { probe.frames.push(message); if (probe.frames.length > 4) probe.frames.shift(); }
      return (post as any)(message, ...args);
    };
    class DepthSocket {
      readyState = 0; onopen: (() => void) | null = null; onmessage: ((e: any) => void) | null = null;
      onclose: (() => void) | null = null; onerror: (() => void) | null = null; timer?: ReturnType<typeof setInterval>;
      constructor() {
        probe.sockets++; probe.active++; probe.socket = this;
        setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); this.update(); this.timer = setInterval(() => this.update(), 100); }, 20);
      }
      last = 99;
      update() {
        if (probe.pause) return;
        const u = this.last === 99 ? 101 : this.last + 1, U = this.last === 99 ? 100 : u;
        this.onmessage?.({ data: JSON.stringify({ e: 'depthUpdate', s: 'BTCUSDT', U, u, pu: this.last, b: [[dense ? 83499.9 : 82990, probe.diffs++ % 2 ? 20 : 30]], a: [] }) }); this.last = u;
      }
      close() { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this.timer); probe.active--; this.onclose?.(); }
      send() {}
    }
    self.WebSocket = class extends NativeSocket {};
    const make = self.WebSocket;
    self.WebSocket = new Proxy(make, { construct(target, args) { return String(args[0]).includes('@depth') ? new DepthSocket() : Reflect.construct(target, args); } }) as any;
  }, { historyBuckets, dense });
  return worker;
}
