import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { compactVol, type FootprintBarStats, type FootprintStatRow } from 'openalgo-charts/profile';
import { blendFootprintTotalsColor, FOOTPRINT_TOTALS_ROW_LABELS, footprintTotalsCellColor, footprintTotalsRowMax, footprintTotalsHighest, footprintTotalsTextColor } from './footprint-totals-style';

type FootprintTotalsPresentation = { font: number; rowHeight: number; labelWidth: number; buyTextColor?: string; sellTextColor?: string };
const PANE_HEADER_HEIGHT = 30;
const TABLE_BOTTOM_RULE_HEIGHT = 2;

/** Header, selected table rows and the bottom rule, in CSS pixels. */
export function footprintTotalsPreferredHeight(rowCount: number, rowHeight = 18) {
  const safeRowCount = Math.max(0, Math.min(9, Math.floor(Number.isFinite(rowCount) ? rowCount : 0)));
  const safeRowHeight = Number.isFinite(rowHeight) ? Math.max(8, rowHeight) : 18;
  return Math.ceil(PANE_HEADER_HEIGHT + safeRowCount * safeRowHeight + TABLE_BOTTOM_RULE_HEIGHT);
}

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
  private highlightHighest = false;
  private hoverGeometry?: { width: number; labelWidth: number; rowHeight: number; slot: number; columns: Map<number, number> };
  private stats: readonly FootprintBarStats[] = [];
  private presentation: FootprintTotalsPresentation = { font: 11, rowHeight: 18, labelWidth: 150 };

  constructor(readonly id: string) {}
  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }

  setSettings(rows: readonly FootprintStatRow[], units: 'btc' | 'usdt', highlightHighest = false) {
    const next = rows.filter(row => Object.hasOwn(FOOTPRINT_TOTALS_ROW_LABELS, row)).slice(0, 9);
    if (JSON.stringify(next) === JSON.stringify(this.rows) && units === this.units && highlightHighest === this.highlightHighest) return;
    this.rows = [...next]; this.units = units; this.highlightHighest = highlightHighest; this.hoverGeometry = undefined; this.host?.requestUpdate();
  }

  setPresentation(presentation: Partial<FootprintTotalsPresentation>) {
    const next = { ...this.presentation, ...presentation };
    if (JSON.stringify(next) === JSON.stringify(this.presentation)) return;
    this.presentation = next; this.hoverGeometry = undefined; this.host?.requestUpdate();
  }

  setStats(stats: readonly FootprintBarStats[]) {
    this.stats = stats.slice(-300); this.hoverGeometry = undefined;
    this.host?.requestUpdate();
  }

  preferredHeight() { return footprintTotalsPreferredHeight(this.rows.length, this.presentation.rowHeight); }

  tooltip(time: number) {
    const row = this.stats.find(item => item.time === time);
    if (!row) return null;
    return [`Footprint Totals · ${this.units.toUpperCase()}`, ...this.rows.map(key => `${FOOTPRINT_TOTALS_ROW_LABELS[key]}  ${footprintStatText(row, key)}`)].join('\n');
  }

  hoverSummary(time: number, x: number, y: number) {
    const geometry = this.hoverGeometry;
    if (!geometry || x < geometry.labelWidth || x >= geometry.width || y < PANE_HEADER_HEIGHT || geometry.rowHeight <= 0) return null;
    const index = Math.floor((y - PANE_HEADER_HEIGHT) / geometry.rowHeight), key = this.rows[index];
    const center = geometry.columns.get(time), stats = this.stats.find(row => row.time === time);
    if (!key || center === undefined || !stats || x < center - geometry.slot / 2 || x >= center + geometry.slot / 2) return null;
    const top = PANE_HEADER_HEIGHT + index * geometry.rowHeight;
    return { time, units: this.units, hoveredRow: key, left: center, top, bottom: top + geometry.rowHeight,
      rows: this.rows.map(key => ({ key, label: FOOTPRINT_TOTALS_ROW_LABELS[key], value: stats[key] != null && Number.isFinite(stats[key]) ? stats[key]! : null })) };
  }

  diagnostics() { return { mounted: Boolean(this.host), rows: [...this.rows], units: this.units, highlightHighest: this.highlightHighest, statsBars: this.stats.length, firstTime: this.stats[0]?.time ?? null, lastTime: this.stats.at(-1)?.time ?? null, presentation: { ...this.presentation } }; }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const dpr = rc.dpr, theme = rc.theme;
    const width = rc.plotWidth * dpr, height = rc.plotHeight * dpr;
    const labelWidth = Math.min(this.presentation.labelWidth, rc.plotWidth) * dpr;
    const headerHeight = Math.min(PANE_HEADER_HEIGHT, rc.plotHeight) * dpr;
    const availableHeight = Math.max(0, rc.plotHeight - PANE_HEADER_HEIGHT);
    const rowHeight = this.rows.length
      ? Math.max(8, Math.min(this.presentation.rowHeight, availableHeight / this.rows.length))
      : 0;
    const tableTop = headerHeight;
    const tableBottom = Math.min(rc.plotHeight, PANE_HEADER_HEIGHT + rowHeight * this.rows.length + TABLE_BOTTOM_RULE_HEIGHT) * dpr;
    const buy = this.presentation.buyTextColor ?? theme.upColor;
    const sell = this.presentation.sellTextColor ?? theme.downColor;
    const grid = blendFootprintTotalsColor(theme.background, theme.axisText, .25);
    const labelBackground = blendFootprintTotalsColor(theme.background, theme.axisText, .09);
    const slot = Math.max(1, rc.timeScale.barSpacing * dpr);
    const visible = this.stats.flatMap(stats => {
      const index = rc.dataLayer.timeToIndex(stats.time);
      if (index === undefined) return [];
      const x = rc.timeScale.indexToX(index) * dpr;
      return x + slot / 2 <= labelWidth || x - slot / 2 > width ? [] : [{ stats, x }];
    });
    this.hoverGeometry = { width: rc.plotWidth, labelWidth: labelWidth / dpr, rowHeight, slot: slot / dpr,
      columns: new Map(visible.map(({ stats, x }) => [stats.time, x / dpr])) };
    const textColor = footprintTotalsTextColor(theme.background);
    const highest = this.highlightHighest ? new Map(this.rows.map(row => [row, footprintTotalsHighest(visible.map(item => item.stats), row)])) : new Map();
    const maxima = new Map(this.rows.map(row => [row, footprintTotalsRowMax(visible.map(item => item.stats), row)]));

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    ctx.fillStyle = theme.background; ctx.fillRect(0, 0, width, height);
    ctx.font = `${Math.max(11, this.presentation.font) * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.background; ctx.fillRect(0, tableTop, width, height - tableTop);
    // Leave any manually expanded pane area as plain chart background.
    ctx.fillStyle = labelBackground; ctx.fillRect(0, tableTop, labelWidth, Math.max(0, tableBottom - tableTop));
    ctx.strokeStyle = grid; ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(0, tableTop); ctx.lineTo(width, tableTop); ctx.stroke();

    this.rows.forEach((row, index) => {
      const top = (PANE_HEADER_HEIGHT + rowHeight * index) * dpr;
      const y = top + rowHeight * dpr / 2;
      ctx.fillStyle = textColor;
      ctx.textAlign = 'left';
      ctx.fillText(FOOTPRINT_TOTALS_ROW_LABELS[row], 5 * dpr, y);
      ctx.beginPath(); ctx.moveTo(0, top + rowHeight * dpr); ctx.lineTo(width, top + rowHeight * dpr); ctx.stroke();
    });

    ctx.beginPath(); ctx.moveTo(labelWidth, tableTop); ctx.lineTo(labelWidth, tableBottom); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(labelWidth, tableTop, Math.max(0, width - labelWidth), Math.max(0, tableBottom - tableTop)); ctx.clip();
    for (const { stats, x } of visible) {
      const left = x - slot / 2, right = x + slot / 2;
      this.rows.forEach((row, rowIndex) => {
        const top = (PANE_HEADER_HEIGHT + rowHeight * rowIndex) * dpr;
        const value = footprintStatText(stats, row);
        const numeric = stats[row];
        ctx.fillStyle = footprintTotalsCellColor(row, numeric, maxima.get(row) ?? 1, {
          background: theme.background, axisText: theme.axisText, buy, sell,
        });
        ctx.fillRect(left, top + dpr, Math.max(0, slot - dpr), Math.max(0, rowHeight * dpr - dpr));
        const peak = this.highlightHighest && numeric != null && Number.isFinite(numeric) && numeric === highest.get(row);
        if (peak) {
          ctx.strokeStyle = textColor;
          ctx.strokeRect(left + dpr / 2, top + dpr / 2, Math.max(0, slot - dpr), Math.max(0, rowHeight * dpr - dpr));
        }
        // Show values only in full visible candle columns.
        const fontSize = Math.max(11, this.presentation.font) * dpr;
        ctx.font = `${peak ? '600 ' : ''}${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        if (left >= labelWidth && right <= width && rowHeight >= 9 && ctx.measureText(value).width <= slot - dpr * 3) {
          ctx.fillStyle = textColor;
          ctx.textAlign = 'center';
          ctx.fillText(value, x, top + rowHeight * dpr / 2);
        }
      });
    }
    ctx.restore();
    ctx.restore();
  }
}
