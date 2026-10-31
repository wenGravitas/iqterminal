import { describe, expect, it, vi } from 'vitest';
import type { FootprintBarStats } from 'openalgo-charts/profile';
import { FootprintTotalsPane, footprintStatText, footprintTotalsPreferredHeight, type FootprintDeltaFlipPresentation } from '../src/chart/footprint-totals';
import type { FootprintAnalysisSummary } from '../src/chart/footprint-delta-flips';
import { footprintAnalysisSourceKey } from '../src/feed/protocol';
import { blendFootprintTotalsColor, FOOTPRINT_TOTALS_ROW_LABELS, footprintTotalsCellColor, footprintTotalsRowMax, footprintTotalsHighest, footprintTotalsTextColor } from '../src/chart/footprint-totals-style';

const stats: FootprintBarStats = {
  time: 60, volume: 12.345, bidVolume: 8, askVolume: 4.345, delta: -3.655,
  minDelta: -4, maxDelta: 0, deltaPct: -29.6, cvd: -22, trades: null,
  poc: 42_500, vah: 42_600, val: 42_400,
};
const flipSummary = (time: number, delta: number, overrides: Partial<FootprintAnalysisSummary> = {}): FootprintAnalysisSummary => {
  const fromMs = time * 1000, toMs = fromMs + 60_000;
  return { time, revision: 1, revisionSource: 'direct-accumulator', sourceKey: footprintAnalysisSourceKey('perpetual', '1m'), delta,
    quoteDelta: delta * 100, coverage: 'observed', gapBefore: false, ended: true, completionSource: 'accepted-execution-time', previewEligible: false,
    coverageEvidence: { provenance: 'direct-feed', fromMs, toMs, validated: true, complete: true, confirmedFromMs: fromMs, confirmedToMs: toMs,
      gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null }, ...overrides };
};
const flipPresentation = (overrides: Partial<FootprintDeltaFlipPresentation> = {}): FootprintDeltaFlipPresentation => ({
  enabled: true, target: 'delta-cell', lookback: 20, minimumStrength: .25, showLivePreview: true, ...overrides,
});

describe('Footprint Totals pane', () => {
  it('sizes the pane to its header, selected rows, and bottom rule', () => {
    expect(footprintTotalsPreferredHeight(0)).toBe(32);
    expect(footprintTotalsPreferredHeight(2)).toBe(68);
    expect(footprintTotalsPreferredHeight(4)).toBe(104);
    expect(footprintTotalsPreferredHeight(6)).toBe(140);
    expect(footprintTotalsPreferredHeight(4, 18)).toBe(104);
    expect(footprintTotalsPreferredHeight(12, 15)).toBe(167);
    expect(footprintTotalsPreferredHeight(4, 2)).toBe(64);
  });

  it('finds signed row peaks, includes zero, ignores missing values and keeps text readable in both themes', () => {
    expect(footprintTotalsHighest([{ ...stats, delta: -9 }, { ...stats, delta: -3 }, { ...stats, delta: -3 }], 'delta')).toBe(-3);
    expect(footprintTotalsHighest([{ ...stats, delta: -9 }, { ...stats, delta: 0 }], 'delta')).toBe(0);
    expect(footprintTotalsHighest([{ ...stats, trades: null }, { ...stats, trades: Number.NaN }], 'trades')).toBeNull();
    expect(footprintTotalsTextColor('#090909')).toBe('#dedede');
    expect(footprintTotalsTextColor('#f6f4ee')).toBe('#202934');
  });

  it('formats the same Footprint stats values and retains unknown row values as unavailable', () => {
    expect(footprintStatText(stats, 'volume')).toBe('12.3');
    expect(footprintStatText(stats, 'delta')).toBe('-3.65');
    expect(footprintStatText(stats, 'deltaPct')).toBe('-29.6%');
    expect(footprintStatText(stats, 'trades')).toBe('—');
  });

  it('matches the native footer row labels and per-row 10–50% color tint rules', () => {
    const colors = { background: '#111111', axisText: '#eeeeee', buy: '#55aa66', sell: '#dd5555' };
    expect(FOOTPRINT_TOTALS_ROW_LABELS).toMatchObject({
      volume: 'Total Volume', bidVolume: 'Total Bid Volume', askVolume: 'Total Ask Volume', cvd: 'Cumulative Delta',
    });
    expect(footprintTotalsCellColor('volume', 5, 10, colors)).toBe('rgb(83, 83, 83)');
    expect(footprintTotalsCellColor('bidVolume', 8, 8, colors)).toBe('rgb(119, 51, 51)');
    expect(footprintTotalsCellColor('askVolume', -4, 4, colors)).toBe('rgb(51, 94, 60)');
    expect(footprintTotalsCellColor('delta', 2, 4, colors)).toBe('rgb(37, 63, 43)');
    expect(footprintTotalsCellColor('delta', -2, 4, colors)).toBe('rgb(78, 37, 37)');
    expect(blendFootprintTotalsColor('#111111', '#eeeeee', .09)).toBe('rgb(37, 37, 37)');
    expect(footprintTotalsRowMax([stats, { ...stats, time: 120, volume: 32 }], 'volume')).toBe(32);
  });

  it('draws selected rows at the host candle time index and provides matching crosshair values', () => {
    const pane = new FootprintTotalsPane('totals');
    const requestUpdate = vi.fn(); pane.attached({ requestUpdate } as any);
    pane.setSettings(['volume', 'delta', 'trades'], 'btc'); pane.setStats([stats]);
    const labels: Array<{ text: string; x: number; y: number }> = [];
    const cells: Array<{ x: number; y: number; width: number; height: number; color: string }> = [];
    let fillStyle = '';
    const ctx: any = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect(x: number, y: number, width: number, height: number) { cells.push({ x, y, width, height, color: fillStyle }); }, moveTo() {}, lineTo() {}, stroke() {},
      fillText(text: string, x: number, y: number) { labels.push({ text, x, y }); },
      measureText(text: string) { return { width: text.length * 5 }; },
      set fillStyle(value: string) { fillStyle = value; }, set globalAlpha(_value: number) {}, set font(_value: string) {},
      set textBaseline(_value: string) {}, set textAlign(_value: string) {}, set strokeStyle(_value: string) {}, set lineWidth(_value: number) {},
    };
    pane.draw(ctx, {
      dpr: 1,
      theme: { background: '#111111', axisText: '#eeeeee', grid: '#333333', upColor: '#55aa66', downColor: '#dd5555' },
      plotWidth: 300, plotHeight: 100,
      dataLayer: { timeToIndex: (time: number) => time === stats.time ? 2 : undefined },
      timeScale: { barSpacing: 24, indexToX: (index: number) => index * 24 + 154 },
    } as any);
    expect(labels).toContainEqual({ text: '12.3', x: 202, y: 39 });
    expect(labels).toContainEqual({ text: 'Total Volume', x: 5, y: 39 });
    expect(cells).toContainEqual({ x: 190, y: 31, width: 23, height: 17, color: 'rgb(128, 128, 128)' });
    expect(pane.hoverSummary(60, 202, 39)).toMatchObject({ hoveredRow: 'volume', time: 60, units: 'btc', rows: [{ key: 'volume', value: 12.345 }, { key: 'delta', value: -3.655 }, { key: 'trades', value: null }] });
    expect(pane.hoverSummary(60, 100, 39)).toBeNull();
    expect(pane.hoverSummary(60, 202, 10)).toBeNull();
    expect(pane.hoverSummary(120, 202, 39)).toBeNull();
    expect(pane.tooltip(60)).toContain('Total Volume  12.3');
    expect(pane.tooltip(60)).toContain('Delta  -3.65');
    expect(pane.tooltip(60)).toContain('Trades  —');
    expect(pane.tooltip(61)).toBeNull();
    expect(pane.diagnostics()).toMatchObject({ mounted: true, rows: ['volume', 'delta', 'trades'], units: 'btc', statsBars: 1 });
    const outlines: number[][] = [];
    ctx.strokeRect = (...args: number[]) => outlines.push(args);
    pane.setSettings(['delta', 'trades'], 'btc', true);
    pane.setStats([{ ...stats, time: 60, delta: -3 }, { ...stats, time: 120, delta: -8 }, { ...stats, time: 180, delta: -3 }]);
    pane.draw(ctx, { dpr: 1, theme: { background: '#090909', axisText: '#858585', upColor: '#58a65c', downColor: '#ad5858' }, plotWidth: 400, plotHeight: 100,
      dataLayer: { timeToIndex: (time: number) => time / 60 }, timeScale: { barSpacing: 50, indexToX: (index: number) => 150 + index * 50 } } as any);
    expect(outlines).toEqual([[175.5, 30.5, 49, 17], [275.5, 30.5, 49, 17]]);
    expect(pane.diagnostics().highlightHighest).toBe(true);
    expect(requestUpdate).toHaveBeenCalled();
  });

  it('reassesses only candidates whose pair or reference window changed', () => {
    const pane = new FootprintTotalsPane('totals');
    pane.setSettings(['delta'], 'btc', false, flipPresentation());
    const summaries = Array.from({ length: 60 }, (_, index) => flipSummary(index * 60,
      index < 20 ? index + 1 : index === 20 ? -21 : 30));
    pane.setAnalysisSummaries(summaries);
    const initial = (pane.diagnostics() as any).deltaFlip.analysisEvaluations;
    expect((pane.diagnostics() as any).deltaFlip.highlighted).toBe(1);
    expect((pane as any).deltaFlips.get(1260)).toMatchObject({ strength: 2, strengthBand: 'strong' });
    pane.setAnalysisSummaries(summaries);
    expect((pane.diagnostics() as any).deltaFlip.analysisEvaluations).toBe(initial);
    pane.setSettings(['delta'], 'btc', true, flipPresentation());
    expect((pane.diagnostics() as any).deltaFlip.analysisEvaluations).toBe(initial);
    const baselineAfterPairs = (pane.diagnostics() as any).deltaFlip.baselineEvaluations;
    const pairRevision = summaries.map(summary => ({ ...summary }));
    pairRevision[21] = { ...pairRevision[21]!, revision: 2, delta: 31 };
    pane.setAnalysisSummaries(pairRevision);
    expect((pane.diagnostics() as any).deltaFlip.baselineEvaluations).toBe(baselineAfterPairs);
    const evaluationsAfterPairRevision = (pane.diagnostics() as any).deltaFlip.analysisEvaluations;
    const corrected = pairRevision.map(summary => ({ ...summary }));
    corrected[0] = { ...corrected[0]!, revision: 2, delta: 100 };
    pane.setAnalysisSummaries(corrected);
    const afterCorrection = (pane.diagnostics() as any).deltaFlip.analysisEvaluations;
    expect(afterCorrection).toBeGreaterThan(initial);
    expect(afterCorrection - evaluationsAfterPairRevision).toBeLessThanOrEqual(22);
    expect((pane.diagnostics() as any).deltaFlip.baselineEvaluations).toBe(baselineAfterPairs + 2);
    expect((pane as any).deltaFlips.get(1260)).toMatchObject({ strength: 21 / 11.5, strengthBand: 'medium' });
  });

  it('keeps scores stable across visible slices and exposes missing context after retention eviction', () => {
    const pane = new FootprintTotalsPane('totals');
    pane.setSettings(['delta'], 'btc', false, flipPresentation());
    const summaries = Array.from({ length: 22 }, (_, index) => flipSummary(index * 60, index < 20 ? 20 : index === 20 ? -40 : 60));
    pane.setAnalysisSummaries(summaries);
    expect((pane as any).deltaFlips.get(1260)).toMatchObject({ strength: 2, strengthBand: 'strong' });
    pane.setStats([{ ...stats, time: 1260, delta: 60 }]);
    pane.setStats([{ ...stats, time: 1260, delta: 60 }, { ...stats, time: 1320, delta: 20 }]);
    expect((pane as any).deltaFlips.get(1260)).toMatchObject({ strength: 2, strengthBand: 'strong' });
    pane.setAnalysisSummaries([...summaries, flipSummary(1320, 20), flipSummary(1380, 20)]);
    expect((pane as any).deltaFlips.get(1260)).toMatchObject({ strength: 2, strengthBand: 'strong' });
    pane.setAnalysisSummaries(summaries.slice(1));
    expect((pane as any).deltaFlips.get(1260)).toMatchObject({ strength: null, strengthBand: 'unavailable', unavailableReason: 'insufficient-history' });
  });

  it('draws graded and dashed live borders within the table and preserves highest markers', () => {
    const pane = new FootprintTotalsPane('totals');
    pane.setSettings(['volume', 'delta'], 'btc', true, flipPresentation({ target: 'whole-column' }));
    const history = Array.from({ length: 22 }, (_, index) => flipSummary(index * 60, index < 20 ? 20 : index === 20 ? -40 : 60));
    pane.setAnalysisSummaries(history);
    pane.setStats([{ ...stats, time: 1260, volume: 12, delta: 60 }]);
    const strokes: Array<{ rect: number[]; width: number; dash: number[]; color: string }> = [];
    const fills: number[][] = [], actions: Array<{ kind: string; values: number[] }> = [];
    let lineWidth = 1, strokeStyle = '', dash: number[] = [];
    const ctx: any = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect(...args: number[]) { fills.push(args); actions.push({ kind: 'fill', values: args }); }, moveTo() {}, lineTo() {}, stroke() {},
      strokeRect(...rect: number[]) { strokes.push({ rect, width: lineWidth, dash: [...dash], color: strokeStyle }); actions.push({ kind: 'strokeRect', values: rect }); },
      fillText() {}, measureText(text: string) { return { width: text.length * 5 }; },
      set fillStyle(_value: string) {}, set globalAlpha(_value: number) {}, set font(_value: string) {}, set textBaseline(_value: string) {}, set textAlign(_value: string) {},
      set strokeStyle(value: string) { strokeStyle = value; }, get lineWidth() { return lineWidth; }, set lineWidth(value: number) { lineWidth = value; }, setLineDash(value: number[]) { dash = value; } };
    const rc: any = { dpr: 1, theme: { background: '#111111', axisText: '#eeeeee', grid: '#333333', upColor: '#55aa66', downColor: '#dd5555' },
      plotWidth: 300, plotHeight: 100, dataLayer: { timeToIndex: (time: number) => time === 1260 ? 1 : undefined }, timeScale: { barSpacing: 24, indexToX: () => 190 } };
    pane.draw(ctx, rc);
    expect(strokes.filter(stroke => stroke.color.startsWith('rgb('))).toHaveLength(1);
    expect(strokes.find(stroke => stroke.color.startsWith('rgb('))).toMatchObject({ width: 2, dash: [], rect: [179, 31, 22, 34] });
    expect(fills.some(([x, y, width, height]) => x === 196 && y === 51 && width === 3 && height === 3)).toBe(true);
    const lastCellFill = actions.findIndex(action => action.kind === 'fill' && action.values[0] === 178 && action.values[1] === 49);
    const columnOutline = actions.findIndex(action => action.kind === 'strokeRect' && action.values[0] === 179);
    expect(columnOutline).toBeGreaterThan(lastCellFill);

    const live = history.map(summary => ({ ...summary }));
    live[21] = flipSummary(1260, 60, { coverage: 'partial', ended: false, completionSource: 'unknown', previewEligible: true,
      coverageEvidence: { provenance: 'direct-feed', fromMs: 1_260_000, toMs: 1_320_000, validated: true, complete: false,
        confirmedFromMs: 0, confirmedToMs: 1_290_000, gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } });
    pane.setSettings(['volume', 'delta'], 'btc', true, flipPresentation());
    pane.setAnalysisSummaries(live);
    strokes.length = 0; fills.length = 0; actions.length = 0;
    pane.draw(ctx, { ...rc, timeScale: { ...rc.timeScale, barSpacing: 2 } });
    expect(strokes.find(stroke => stroke.dash.length)?.dash).toEqual([3, 2]);
    expect(strokes.find(stroke => stroke.dash.length)?.width).toBeLessThanOrEqual(1);
    expect(fills.some(([, , width, height]) => width === height && width <= 3)).toBe(false);
  });
});
