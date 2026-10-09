import { type Candle, validCandle } from './protocol';
export const MAX_BARS = 5000;
// History has revision=0. Live has venue event time (Binance), or trade count
// (Hyperliquid lacks an event sequence). Equal revisions use last receipt; older
// revisions cannot roll a candle backward. Closed wins over forming at equality.
export function newer(a: Candle, b: Candle): boolean {
  return a.revision > b.revision || (a.revision === b.revision && (!b.closed || a.closed));
}
export class Reconciler {
  readonly bars = new Map<number, Candle>();
  merge(candles: Candle[]): Candle[] {
    const changed: Candle[] = [];
    for (const c of candles) {
      if (!validCandle(c)) continue;
      const old = this.bars.get(c.t);
      if (old && !newer(c,old)) continue;
      if (old && ['o','h','l','c','v','revision','closed'].every(k => old[k as keyof Candle] === c[k as keyof Candle])) continue;
      this.bars.set(c.t,c); changed.push(c);
    }
    if (this.bars.size > MAX_BARS) {
      const times = [...this.bars.keys()].sort((a,b)=>a-b);
      for (const t of times.slice(0,Math.max(changed.length<128?128:0,times.length-MAX_BARS))) this.bars.delete(t);
    }
    return changed.sort((a,b)=>a.t-b.t);
  }
  snapshot() { return [...this.bars.values()].sort((a,b)=>a.t-b.t); }
}
export class PatchQueue {
  private pending = new Map<number,Candle>();
  overflow = false;
  get size(){return this.pending.size;}
  add(c: Candle) {
    if (this.pending.size >= 512 && !this.pending.has(c.t)) { this.pending.clear(); this.overflow = true; }
    this.pending.set(c.t,c);
  }
  drain() { const result = [...this.pending.values()].sort((a,b)=>a.t-b.t); this.pending.clear(); return result; }
}
