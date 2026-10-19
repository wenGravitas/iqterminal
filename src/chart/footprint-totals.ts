import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { compactVol, type FootprintBarStats, type FootprintStatRow } from 'openalgo-charts/profile';

const ROW_LABELS: Record<FootprintStatRow, string> = {
  volume: 'Volume', bidVolume: 'Bid', askVolume: 'Ask', delta: 'Delta',
  minDelta: 'Min Δ', maxDelta: 'Max Δ', deltaPct: 'Delta %', cvd: 'CVD', trades: 'Trades',
};

export function footprintStatText(stats: FootprintBarStats, row: FootprintStatRow) {
  const value = stats[row];
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (row === 'deltaPct') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  if (row === 'trades') return Math.trunc(value).toLocaleString('en-US');
  const text = compactVol(value);
  return ['delta', 'minDelta', 'maxDelta', 'cvd'].includes(row) && value > 0 ? `+${text}` : text;
}

/** A compact per-candle totals table on a native pane, aligned to the host time scale. */
export class FootprintTotalsPane implements IPrimitive {
  private host?: PrimitiveHost;
  private rows: FootprintStatRow[] = ['volume', 'bidVolume', 'askVolume', 'delta'];
  private units: 'btc' | 'usdt' = 'btc';
  private stats: readonly FootprintBarStats[] = [];

  constructor(readonly id: string) {}
  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }

  setSettings(rows: readonly FootprintStatRow[], units: 'btc' | 'usdt') {
    const next = rows.filter(row => Object.hasOwn(ROW_LABELS, row)).slice(0, 9);
    if (JSON.stringify(next) === JSON.stringify(this.rows) && units === this.units) return;
    this.rows = [...next]; this.units = units; this.host?.requestUpdate();
  }

  setStats(stats: readonly FootprintBarStats[]) {
    this.stats = stats.slice(-300);
    this.host?.requestUpdate();
  }

  tooltip(time: number) {
    const row = this.stats.find(item => item.time === time);
    if (!row) return null;
    return [`Footprint Totals · ${this.units.toUpperCase()}`, ...this.rows.map(key => `${ROW_LABELS[key]}  ${footprintStatText(row, key)}`)].join('\n');
  }

  diagnostics() { return { mounted: Boolean(this.host), rows: [...this.rows], units: this.units, statsBars: this.stats.length, firstTime: this.stats[0]?.time ?? null, lastTime: this.stats.at(-1)?.time ?? null }; }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const dpr = rc.dpr, theme = rc.theme;
    const foreground = theme.axisText, separator = theme.grid;
    const width = rc.plotWidth * dpr, height = rc.plotHeight * dpr;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    ctx.fillStyle = theme.background; ctx.globalAlpha = .92; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1;
    ctx.font = `${Math.max(9, Math.round(10 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = foreground; ctx.globalAlpha = .86;
    ctx.fillText(`Footprint totals · ${this.units.toUpperCase()}`, 6 * dpr, 11 * dpr);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = separator; ctx.lineWidth = Math.max(1, dpr); ctx.beginPath();
    ctx.moveTo(0, 22 * dpr); ctx.lineTo(width, 22 * dpr);
    const rowHeight = this.rows.length ? Math.max(8, Math.min(20, (rc.plotHeight - 23) / this.rows.length)) : 0;
    this.rows.forEach((row, index) => {
      const y = (22 + rowHeight * (index + .5)) * dpr;
      ctx.fillStyle = foreground; ctx.globalAlpha = .72;
      ctx.textAlign = 'left'; ctx.fillText(ROW_LABELS[row], 6 * dpr, y);
      ctx.beginPath(); ctx.moveTo(0, (22 + (index + 1) * rowHeight) * dpr); ctx.lineTo(width, (22 + (index + 1) * rowHeight) * dpr); ctx.stroke();
    });

    const labelGutter = Math.min(72, Math.max(42, rc.plotWidth * .12));
    const slot = Math.max(1, rc.timeScale.barSpacing * dpr * .94);
    for (const stats of this.stats) {
      const index = rc.dataLayer.timeToIndex(stats.time);
      if (index === undefined) continue;
      const x = rc.timeScale.indexToX(index) * dpr;
      if (x < labelGutter * dpr || x < -slot || x > width + slot) continue;
      const left = Math.round(x - slot / 2), right = Math.round(x + slot / 2);
      ctx.save(); ctx.beginPath(); ctx.rect(left, 22 * dpr, Math.max(1, right - left), height - 22 * dpr); ctx.clip();
      this.rows.forEach((row, rowIndex) => {
        const value = footprintStatText(stats, row);
        const y = (22 + rowHeight * (rowIndex + .5)) * dpr;
        ctx.font = `${Math.max(9, Math.round(10 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center'; ctx.globalAlpha = value === '—' ? .45 : 1;
        ctx.fillStyle = row === 'delta' || row === 'minDelta' || row === 'maxDelta' || row === 'deltaPct' || row === 'cvd'
          ? stats[row] === null || stats[row] === undefined || stats[row] === 0 ? foreground : stats[row]! > 0 ? theme.upColor : theme.downColor
          : foreground;
        ctx.fillText(value, x, y, Math.max(1, right - left - 3 * dpr));
      });
      ctx.restore();
    }
    ctx.restore();
  }
}
