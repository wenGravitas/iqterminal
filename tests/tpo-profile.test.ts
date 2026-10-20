import { describe, expect, test } from 'vitest';
import { TpoProfilePrimitive } from '../src/chart/tpo-profile';
import { DAY_MS, type TpoSession } from '../src/indicators/tpo-engine';
import { DEFAULT_TPO_INDICATOR_SETTINGS, tpoIndicatorSettings } from '../src/indicators/tpo-settings';

const day = Date.UTC(2026, 0, 1);
const session: TpoSession = {
  day, bracketMinutes: 30, bracketCount: 48, rowTicks: 10, requestedRowTicks: 10, capacityLimited: false, tickSize: .1,
  rows: [
    { firstTick: 1_000, rowTicks: 10, brackets: [0, 1, 24, 47], count: 4 },
    { firstTick: 1_010, rowTicks: 10, brackets: [1, 47], count: 2 },
  ],
  poc: 99, vah: 102, val: 98, totalTpos: 6, valueAreaPercent: 70,
  openingRange: null, initialBalance: null, observedMinutes: 1_440, elapsedMinutes: 1_440, missingMinutes: 0,
  expectedMinutes: 1_440, futureMinutes: 0, gaps: 0, firstObserved: day, lastObserved: day + DAY_MS - 60_000, complete: true,
};

function render(mode: 'letters' | 'blocks', width: number, mapping: 'valid' | 'invalid-x' | 'invalid-y' = 'valid') {
  const fillText: Array<{ text: string; x: number; y: number; color: string }> = [];
  const fillRect: Array<{ x: number; y: number; width: number; color: string }> = [];
  const pathCoordinates: number[] = [];
  const ctx: any = {
    save() {}, restore() {}, setTransform() {}, beginPath() {}, rect() {}, clip() {}, moveTo(x: number, y: number) { pathCoordinates.push(x, y); }, lineTo(x: number, y: number) { pathCoordinates.push(x, y); }, stroke() {}, setLineDash() {},
    fillText(text: string, x: number, y: number) { fillText.push({ text, x, y, color: this.fillStyle }); },
    fillRect(x: number, y: number, rectWidth: number) { fillRect.push({ x, y, width: rectWidth, color: this.fillStyle }); },
  };
  const settings = tpoIndicatorSettings({ ...DEFAULT_TPO_INDICATOR_SETTINGS, profileMode: mode, shadeValueArea: false, highlightPoc: false, nakedEnabled: false });
  const primitive = new TpoProfilePrimitive(settings);
  primitive.setSnapshot([session], [], day + DAY_MS);
  primitive.draw(ctx, {
    dpr: 1, plotWidth: width, plotHeight: 240, theme: { axisText: '#333' },
    dataLayer: { timeToIndexFloat: (seconds: number) => (seconds - day / 1_000) / (DAY_MS / 1_000) * width },
    timeScale: { visibleRange: () => ({ from: 0, to: width }), indexToX: (index: number) => mapping === 'invalid-x' ? Number.NaN : index },
    priceScale: { priceToY: (price: number) => mapping === 'invalid-y' ? Number.NaN : 120 - (price - 100) * 12 },
  } as any);
  return { stats: primitive.diagnostics(), fillText, fillRect, pathCoordinates };
}

describe('native TPO bracket renderer', () => {
  test('letters pack each row from the day left edge and preserve ordinal slots', () => {
    const result = render('letters', 1_200);
    expect(result.stats.lettersDrawn).toBe(6);
    const fullRow = result.fillText.filter(label => label.y === 114);
    const halfRow = result.fillText.filter(label => label.y === 102);
    expect(fullRow.map(label => label.text)).toEqual(['A', 'B', 'a', 'x']);
    expect(halfRow.map(label => label.text)).toEqual(['B', 'x']);
    expect(fullRow.map(label => label.x)).toEqual([105, 315, 525, 735]);
    expect(halfRow.map(label => label.x)).toEqual([105, 315]);
    expect(fullRow.slice(1).map((label, i) => label.x - fullRow[i]!.x)).toEqual([210, 210, 210]);
    expect(new Set(result.fillText.map(label => label.color)).size).toBeGreaterThan(1);
    expect(result.stats.blockCells).toBe(0);
  });

  test('block rows pack contiguously from the day left edge with widths proportional to TPO counts', () => {
    const cells = render('blocks', 1_200);
    const fullRow = cells.fillRect.filter(cell => Math.floor(cell.y) === 108);
    const halfRow = cells.fillRect.filter(cell => Math.floor(cell.y) === 96);
    expect(cells.stats.blockCells).toBe(6);
    expect(cells.stats.silhouetteRows).toBe(0);
    expect(fullRow.map(cell => cell.x)).toEqual([0, 210, 420, 630]);
    expect(halfRow.map(cell => cell.x)).toEqual([0, 210]);
    expect(fullRow.slice(1).map((cell, i) => cell.x - fullRow[i]!.x)).toEqual([210, 210, 210]);
    const fullWidth = fullRow.reduce((sum, cell) => sum + cell.width + .5, 0);
    const halfWidth = halfRow.reduce((sum, cell) => sum + cell.width + .5, 0);
    expect(fullWidth / halfWidth).toBe(2);
    expect(new Set(cells.fillRect.map(cell => cell.color)).size).toBeGreaterThan(1);
  });

  test('falls back to proportional row silhouettes when zoomed out', () => {
    const silhouette = render('blocks', 16);
    expect(silhouette.stats.blockCells).toBe(0);
    expect(silhouette.stats.silhouetteRows).toBe(2);
    const rows = silhouette.fillRect.filter(cell => Math.floor(cell.y) === 108 || Math.floor(cell.y) === 96);
    expect(rows).toHaveLength(2);
    expect(Math.max(...rows.map(row => row.width)) / Math.min(...rows.map(row => row.width))).toBe(2);
  });

  test('skips sessions and profile primitives with non-finite mapped coordinates', () => {
    const invalidX = render('letters', 1_200, 'invalid-x');
    expect(invalidX.stats.geometry.sessions).toHaveLength(0);
    expect(invalidX.fillText).toHaveLength(0);
    expect(invalidX.fillRect).toHaveLength(0);

    const invalidY = render('letters', 1_200, 'invalid-y');
    expect(invalidY.stats.geometry.sessions).toHaveLength(1);
    expect(invalidY.stats.lettersDrawn).toBe(0);
    expect(invalidY.fillText).toHaveLength(0);
    expect(invalidY.fillRect).toHaveLength(0);
    expect(invalidY.pathCoordinates.every(Number.isFinite)).toBe(true);
  });
});
