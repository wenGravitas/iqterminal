import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { compactVol, type FootprintBarStats, type FootprintStatRow } from 'openalgo-charts/profile';
import { blendFootprintTotalsColor, FOOTPRINT_TOTALS_ROW_LABELS, footprintTotalsCellColor, footprintTotalsRowMax, footprintTotalsHighest, footprintTotalsTextColor } from './footprint-totals-style';
import { createFootprintDeltaFlipAnalyzer, DEFAULT_DELTA_FLIP_LOOKBACK, DEFAULT_DELTA_FLIP_MINIMUM_STRENGTH, MAX_FOOTPRINT_ANALYSIS_SUMMARIES, type DeltaFlipAssessment, type DeltaFlipBaselineCache, type FootprintAnalysisSummary } from './footprint-delta-flips';

type FootprintTotalsPresentation = { font: number; rowHeight: number; labelWidth: number; buyTextColor?: string; sellTextColor?: string };
export interface FootprintDeltaFlipPresentation {
  enabled: boolean;
  target: 'delta-cell' | 'whole-column';
  lookback: number;
  minimumStrength: number;
  showLivePreview: boolean;
}
const DEFAULT_FLIP_PRESENTATION: FootprintDeltaFlipPresentation = {
  enabled: false, target: 'delta-cell', lookback: DEFAULT_DELTA_FLIP_LOOKBACK,
  minimumStrength: DEFAULT_DELTA_FLIP_MINIMUM_STRENGTH, showLivePreview: true,
};
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
  private analysisSummaries: readonly FootprintAnalysisSummary[] = [];
  private analysisByTime = new Map<number, FootprintAnalysisSummary>();
  private analysisFingerprints = new Map<number, string>();
  private analysisEvaluations = 0;
  private deltaFlips = new Map<number, Extract<DeltaFlipAssessment, { kind: 'flip' }>>();
  private deltaFlipUnavailable = new Map<number, Extract<DeltaFlipAssessment, { kind: 'none' }>['reason']>();
  private deltaFlipBaselines: DeltaFlipBaselineCache = { entries: new Map(), evaluations: 0 };
  private deltaFlipSettings: FootprintDeltaFlipPresentation = { ...DEFAULT_FLIP_PRESENTATION };
  private presentation: FootprintTotalsPresentation = { font: 11, rowHeight: 18, labelWidth: 150 };

  constructor(readonly id: string) {}
  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }

  setSettings(rows: readonly FootprintStatRow[], units: 'btc' | 'usdt', highlightHighest = false, deltaFlip: FootprintDeltaFlipPresentation = DEFAULT_FLIP_PRESENTATION) {
    const next = rows.filter(row => Object.hasOwn(FOOTPRINT_TOTALS_ROW_LABELS, row)).slice(0, 9);
    const nextFlip = { ...deltaFlip };
    if (JSON.stringify(next) === JSON.stringify(this.rows) && units === this.units && highlightHighest === this.highlightHighest
      && JSON.stringify(nextFlip) === JSON.stringify(this.deltaFlipSettings)) return;
    const baselineConfigChanged = units !== this.units || nextFlip.lookback !== this.deltaFlipSettings.lookback;
    const flipConfigChanged = units !== this.units || JSON.stringify(nextFlip) !== JSON.stringify(this.deltaFlipSettings);
    this.rows = [...next]; this.units = units; this.highlightHighest = highlightHighest; this.deltaFlipSettings = nextFlip;
    if (baselineConfigChanged) this.deltaFlipBaselines.entries.clear();
    if (flipConfigChanged) this.recomputeDeltaFlips(); this.hoverGeometry = undefined; this.host?.requestUpdate();
  }

  setAnalysisSummaries(summaries: readonly FootprintAnalysisSummary[]) {
    const sorted = summaries.slice().sort((a, b) => a.time - b.time).slice(-MAX_FOOTPRINT_ANALYSIS_SUMMARIES);
    const nextByTime = new Map(sorted.map(summary => [summary.time, summary]));
    const nextFingerprints = new Map([...nextByTime].map(([time, summary]) => [time, summaryFingerprint(summary)]));
    const changed = new Set<number>();
    for (const [time, fingerprint] of this.analysisFingerprints) if (nextFingerprints.get(time) !== fingerprint) changed.add(time);
    for (const [time, fingerprint] of nextFingerprints) if (this.analysisFingerprints.get(time) !== fingerprint) changed.add(time);
    this.analysisSummaries = sorted;
    this.analysisByTime = nextByTime;
    this.analysisFingerprints = nextFingerprints;
    for (const time of this.deltaFlipBaselines.entries.keys()) if (!nextByTime.has(time)) this.deltaFlipBaselines.entries.delete(time);
    if (changed.size) {
      if (!this.deltaFlipSettings.enabled) this.deltaFlipBaselines.entries.clear();
      this.recomputeDeltaFlips(changed);
    }
    this.host?.requestUpdate();
  }

  analysisDemand() { return { enabled: this.deltaFlipSettings.enabled, lookback: this.deltaFlipSettings.lookback }; }

  private recomputeDeltaFlips(changedTimes?: ReadonlySet<number>) {
    if (!this.deltaFlipSettings.enabled) { this.deltaFlips.clear(); this.deltaFlipUnavailable.clear(); return; }
    const first = this.analysisSummaries[0];
    const intervalMs = first ? first.coverageEvidence.toMs - first.coverageEvidence.fromMs : 0;
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) { this.deltaFlips.clear(); this.deltaFlipUnavailable.clear(); this.deltaFlipBaselines.entries.clear(); return; }
    const intervalSeconds = intervalMs / 1000;
    const affected = new Set<number>();
    if (!changedTimes) for (const summary of this.analysisSummaries) affected.add(summary.time);
    else {
      for (const changed of changedTimes) {
        affected.add(changed);
        // A changed slot can be current, predecessor, or any one of the fixed
        // pre-pair reference candles for these later candidates.
        for (let offset = 1; offset <= this.deltaFlipSettings.lookback + 1; offset++) affected.add(changed + offset * intervalSeconds);
        // A changed slot j affects baseline windows for candidates j+2 .. j+N+1.
        // Pair-only changes reuse their unchanged cached reference median.
        for (let offset = 2; offset <= this.deltaFlipSettings.lookback + 1; offset++) this.deltaFlipBaselines.entries.delete(changed + offset * intervalSeconds);
      }
      for (const oldCandidate of this.deltaFlips.keys()) if (!this.analysisByTime.has(oldCandidate)) affected.add(oldCandidate);
      for (const oldCandidate of this.deltaFlipUnavailable.keys()) if (!this.analysisByTime.has(oldCandidate)) affected.add(oldCandidate);
    }
    const analyze = createFootprintDeltaFlipAnalyzer(this.analysisSummaries);
    for (const time of affected) {
      if (!this.analysisByTime.has(time)) { this.deltaFlips.delete(time); this.deltaFlipUnavailable.delete(time); continue; }
      this.analysisEvaluations++;
      const result = analyze(time, {
        intervalMs, units: this.units, lookback: this.deltaFlipSettings.lookback,
        minimumStrength: this.deltaFlipSettings.minimumStrength, showLivePreview: this.deltaFlipSettings.showLivePreview,
      }, this.deltaFlipBaselines);
      if (result.kind === 'flip') { this.deltaFlips.set(time, result); this.deltaFlipUnavailable.delete(time); }
      else { this.deltaFlips.delete(time); if (result.reason === 'preview-provenance-unknown') this.deltaFlipUnavailable.set(time, result.reason); else this.deltaFlipUnavailable.delete(time); }
    }
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
      deltaFlip: this.deltaFlips.get(time) ?? null,
      deltaFlipUnavailableReason: this.deltaFlipUnavailable.get(time) ?? null,
      deltaFlipMinimumStrength: this.deltaFlipSettings.minimumStrength,
      rows: this.rows.map(key => ({ key, label: FOOTPRINT_TOTALS_ROW_LABELS[key], value: stats[key] != null && Number.isFinite(stats[key]) ? stats[key]! : null })) };
  }

  diagnostics() { return { mounted: Boolean(this.host), rows: [...this.rows], units: this.units, highlightHighest: this.highlightHighest,
    deltaFlip: { ...this.deltaFlipSettings, summaries: this.analysisSummaries.length, candidates: this.deltaFlips.size, analysisEvaluations: this.analysisEvaluations,
      baselineEvaluations: this.deltaFlipBaselines.evaluations, cachedBaselines: this.deltaFlipBaselines.entries.size,
      highlighted: [...this.deltaFlips.values()].filter(flip => flip.strength !== null && flip.strength >= this.deltaFlipSettings.minimumStrength).length },
    statsBars: this.stats.length, firstTime: this.stats[0]?.time ?? null, lastTime: this.stats.at(-1)?.time ?? null, presentation: { ...this.presentation } }; }

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
    const tableRowsBottom = Math.min(rc.plotHeight, PANE_HEADER_HEIGHT + rowHeight * this.rows.length) * dpr;
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
      const flip = this.deltaFlips.get(stats.time);
      const highlightFlip = flip !== undefined && flip.strength !== null && flip.strength >= this.deltaFlipSettings.minimumStrength
        && ['small', 'medium', 'strong'].includes(flip.strengthBand);
      const peakMarkers: Array<{ left: number; top: number; height: number; borderWidth: number }> = [];
      this.rows.forEach((row, rowIndex) => {
        const top = (PANE_HEADER_HEIGHT + rowHeight * rowIndex) * dpr;
        const value = footprintStatText(stats, row);
        const numeric = stats[row];
        ctx.fillStyle = footprintTotalsCellColor(row, numeric, maxima.get(row) ?? 1, {
          background: theme.background, axisText: theme.axisText, buy, sell,
        });
        ctx.fillRect(left, top + dpr, Math.max(0, slot - dpr), Math.max(0, rowHeight * dpr - dpr));
        const markFlip = highlightFlip && (this.deltaFlipSettings.target === 'whole-column' || row === 'delta');
        const flipBorderWidth = markFlip && this.deltaFlipSettings.target === 'delta-cell' && row === 'delta'
          ? drawDeltaFlipOutline(ctx, left, top, slot, rowHeight * dpr, flip!, buy, sell, theme.background, dpr) : 0;
        const peak = this.highlightHighest && numeric != null && Number.isFinite(numeric) && numeric === highest.get(row);
        if (peak && !(highlightFlip && (this.deltaFlipSettings.target === 'whole-column' || row === 'delta'))) {
          ctx.strokeStyle = textColor;
          ctx.strokeRect(left + dpr / 2, top + dpr / 2, Math.max(0, slot - dpr), Math.max(0, rowHeight * dpr - dpr));
        } else if (peak && highlightFlip && (this.deltaFlipSettings.target === 'whole-column' || row === 'delta')) {
          peakMarkers.push({ left, top, height: rowHeight * dpr,
            borderWidth: this.deltaFlipSettings.target === 'whole-column' ? 0 : flipBorderWidth });
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
      let columnBorderWidth = 0;
      if (highlightFlip && this.deltaFlipSettings.target === 'whole-column') {
        columnBorderWidth = drawDeltaFlipOutline(ctx, left, tableTop, slot, tableRowsBottom - tableTop, flip!, buy, sell, theme.background, dpr);
      }
      for (const marker of peakMarkers) drawNeutralPeakMarker(ctx, marker.left, marker.top, slot, marker.height,
        marker.borderWidth || columnBorderWidth, theme.background, theme.axisText, dpr);
    }
    ctx.restore();
    ctx.restore();
  }
}

function drawDeltaFlipOutline(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  slot: number,
  height: number,
  flip: Extract<DeltaFlipAssessment, { kind: 'flip' }>,
  buy: string,
  sell: string,
  background: string,
  dpr: number,
) {
  if (height <= 0 || slot <= 0) return 0;
  const strong = flip.strengthBand === 'strong';
  const base = flip.direction === 'positive' ? buy : sell;
  ctx.save();
  ctx.strokeStyle = blendFootprintTotalsColor(background, base, flip.strengthBand === 'small' ? .48 : flip.strengthBand === 'medium' ? .82 : 1);
  ctx.lineWidth = Math.max(1, Math.floor(Math.min((strong ? 2 : 1) * dpr, Math.max(1, slot * .24))));
  ctx.setLineDash(flip.lifecycle === 'live' ? [3 * dpr, 2 * dpr] : []);
  const inset = ctx.lineWidth / 2;
  ctx.strokeRect(left + inset, top + inset, Math.max(0, slot - ctx.lineWidth), Math.max(0, height - ctx.lineWidth));
  const width = ctx.lineWidth;
  ctx.restore();
  return width;
}

function drawNeutralPeakMarker(ctx: CanvasRenderingContext2D, left: number, top: number, slot: number, height: number,
  borderWidth: number, background: string, axisText: string, dpr: number) {
  const available = Math.floor(Math.min(3 * dpr, slot - 2 * borderWidth - 2 * dpr, height - 2 * borderWidth - 2 * dpr));
  if (available < 1) return;
  const size = available;
  ctx.fillStyle = blendFootprintTotalsColor(background, axisText, .9);
  ctx.fillRect(left + slot - borderWidth - dpr - size, top + borderWidth + dpr, size, size);
}

function summaryFingerprint(summary: FootprintAnalysisSummary) {
  return JSON.stringify(summary);
}
