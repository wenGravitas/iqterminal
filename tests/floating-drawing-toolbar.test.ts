import { describe, expect, it } from 'vitest';
import { floatingDrawingToolbarSettings } from '../src/chart/floating-drawing-toolbar';
import { config } from '../src/panel';
const allowed = new Set(['horizontal-line', 'date-range', 'price-range']);
describe('floating drawing toolbar preferences', () => {
  it('starts hidden with only its implicit pointer and eraser and rejects malformed pins and coordinates', () => {
    expect(floatingDrawingToolbarSettings(null, allowed)).toEqual({ visible: false, tools: [], x: .55, y: .14 });
    expect(floatingDrawingToolbarSettings({ visible: 'true', tools: ['cursor', 'horizontal-line', null, 'bad', 'date-range', 'horizontal-line'], x: Infinity, y: -3 }, allowed))
      .toEqual({ visible: false, tools: ['horizontal-line', 'date-range'], x: .55, y: 0 });
  });
  it('keeps per-chart pin order, visibility and position through config and instrument changes', () => {
    const state = { visible: true, tools: ['price-range', 'horizontal-line'], x: .3, y: .8 };
    const original = config({ floatingDrawingToolbar: state });
    expect(config(JSON.parse(JSON.stringify(original))).floatingDrawingToolbar).toEqual(state);
    expect(config({ ...original, interval: '5m', venue: 'hyperliquid' }).floatingDrawingToolbar).toEqual(state);
    expect(config({}).floatingDrawingToolbar.tools).toEqual([]);
  });
});
