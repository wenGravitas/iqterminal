import { footprintColumn } from './terminal-footprint';
import type { IPrimitive, PrimitiveRenderContext } from 'openalgo-charts';
import type { FootprintOptions } from 'openalgo-charts/profile';
import type { FootprintBar } from '../feed/protocol';

const DURATION_MS = 360;
const MAX_PULSES = 64;
interface Pulse { time: number; price: number; rowSize: number; side: 'bid' | 'ask'; started: number }

/** Transient feedback for increases in classified execution volume, never snapshots. */
export class FootprintActivity implements IPrimitive {
  private pulses = new Map<string, Pulse>();
  needsFrame = false;
  constructor(private options: () => FootprintOptions, private reducedMotion: () => boolean,
    private now: () => number = () => performance.now()) {}
  zOrder() { return 'top' as const; }
  autoscaleInfo() { return null; }
  clear() { this.pulses.clear(); this.needsFrame = false; }
  get size() { return this.pulses.size; }

  observe(previous: FootprintBar | undefined, next: FootprintBar) {
    if (this.reducedMotion()) { this.clear(); return; }
    if (previous && (next.revision <= previous.revision || next.rowSize !== previous.rowSize)) return;
    const prior = new Map(previous?.cells.map(cell => [cell.price, cell]));
    const started = this.now();
    for (const cell of next.cells) {
      const old = prior.get(cell.price);
      for (const side of ['bid', 'ask'] as const) {
        const volume = side === 'bid' ? cell.bidVol : cell.askVol;
        const oldVolume = side === 'bid' ? old?.bidVol ?? 0 : old?.askVol ?? 0;
        if (volume <= oldVolume) continue;
        const key = `${next.time}:${cell.price}:${side}`;
        this.pulses.delete(key);
        this.pulses.set(key, { time: next.time, price: cell.price, rowSize: next.rowSize, side, started });
        if (this.pulses.size > MAX_PULSES) this.pulses.delete(this.pulses.keys().next().value!);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.needsFrame = false;
    if (this.reducedMotion()) { this.clear(); return; }
    const now = this.now(), options = this.options(), dpr = rc.dpr;
    // Match the public 2.6.0 footprint column geometry; no private library state.
    const { column, gap, cells: width } = footprintColumn(options, rc.timeScale.barSpacing), half = width / 2;
    const footerRows = options.tableRows.length || (options.statsPosition === 'bottom' ? options.statsRows.length : 0);
    const height = Math.max(0, rc.plotHeight - footerRows * options.statsRowHeight);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, height * dpr); ctx.clip();
    for (const [key, pulse] of this.pulses) {
      const elapsed = now - pulse.started;
      if (elapsed >= DURATION_MS) { this.pulses.delete(key); continue; }
      const index = rc.dataLayer.timeToIndex(pulse.time);
      if (index === undefined) { this.pulses.delete(key); continue; }
      let x = rc.timeScale.indexToX(index) - column / 2;
      const a = rc.priceScale.priceToY(pulse.price + pulse.rowSize);
      const b = rc.priceScale.priceToY(pulse.price);
      const y = Math.min(a, b), rowHeight = Math.abs(b - a);
      let cellWidth = width;
      if (options.displayMode === 'bidask') {
        const gutter = Math.min(1, half * .08);
        if (pulse.side === 'ask') x += half + gap + gutter;
        cellWidth = half - gutter;
      }
      if (x + cellWidth < 0 || x >= rc.plotWidth || y + rowHeight <= 0 || y >= height) continue;
      this.needsFrame = true;
      const strength = Math.pow(1 - Math.max(0, elapsed) / DURATION_MS, 1.3);
      const color = rc.theme?.background === '#f6f4ee' ? pulse.side === 'bid' ? rc.theme.downColor : rc.theme.upColor
        : pulse.side === 'bid' ? '#f0aaa4' : '#b4e8b9';
      ctx.fillStyle = color; ctx.globalAlpha = .16 * strength;
      ctx.fillRect(x * dpr, y * dpr, cellWidth * dpr, rowHeight * dpr);
      const border = Math.min(2, rowHeight / 3, cellWidth / 3);
      ctx.strokeStyle = color; ctx.globalAlpha = strength; ctx.lineWidth = border * dpr;
      ctx.strokeRect((x + border / 2) * dpr, (y + border / 2) * dpr, Math.max(0, cellWidth - border) * dpr, Math.max(0, rowHeight - border) * dpr);
    }
    ctx.restore();
  }
}
