import { describe, expect, it } from 'vitest';
import type { Drawing } from 'openalgo-charts/draw';
import { captureDrawingSettings, drawingSettingsPatch, iqDrawingSettingsSchema, sameDrawingSetting } from '../src/chart/drawing-settings';

const darkPalette = { background: '#090909', lineColor: '#26a69a', upColor: '#089981', downColor: '#f23645' };

function drawing(tool: string, overrides: Partial<Drawing> = {}): Drawing {
  return {
    id: `${tool}-1`, tool, points: [{ time: 60, price: 100 }], paneIndex: 0, zIndex: 0, style: {},
    ...overrides,
  };
}

describe('native drawing settings capture', () => {
  it('shows effective horizontal-line defaults without writing them into the saved drawing', () => {
    const source = drawing('horizontal-line', { style: { showLabels: true }, props: { iqterminalLabelState: 'unset', iqterminalAnalysisInterval: '1m' } });
    const settings = captureDrawingSettings(source, iqDrawingSettingsSchema(source.tool), darkPalette);

    expect(settings).toMatchObject({
      'style.color': darkPalette.lineColor,
      'style.lineWidth': 1.5,
      'style.lineStyle': 'solid',
      'style.showLabels': true,
      'text.color': darkPalette.lineColor,
      'text.fontSize': 11,
      'intervals.from': '',
      'intervals.to': '',
      'props.iqterminalLabelState': 'unset',
      'props.iqterminalLabel': '',
      'props.iqterminalAnalysisInterval': '1m',
    });
    expect(source.style).toEqual({ showLabels: true });
  });

  it('uses native rectangle, Fibonacci, and text tool defaults', () => {
    const rectangle = captureDrawingSettings(drawing('rectangle'), undefined, darkPalette);
    expect(rectangle).toMatchObject({
      'style.color': darkPalette.lineColor,
      'style.fill': true,
      'style.fillColor': darkPalette.lineColor,
      'style.fillOpacity': 0.12,
      'text.fontSize': 11,
      'text.value': '',
      'text.color': darkPalette.lineColor,
    });

    const fib = captureDrawingSettings(drawing('fib-retracement'), undefined, darkPalette);
    expect(fib['style.levels']).toEqual([
      { ratio: 0, color: '#787b86' }, { ratio: 0.236, color: '#f23645' }, { ratio: 0.382, color: '#ff9800' },
      { ratio: 0.5, color: '#4caf50' }, { ratio: 0.618, color: '#089981' }, { ratio: 0.786, color: '#00bcd4' }, { ratio: 1, color: '#787b86' },
    ]);
    expect(fib).toMatchObject({ 'style.fill': true, 'style.showLabels': true, 'style.fillOpacity': 0.06, 'text.fontSize': 11 });
    expect(fib['style.fillColor']).toBeUndefined();
    expect(fib['text.color']).toBeUndefined();

    const text = captureDrawingSettings(drawing('text'), undefined, darkPalette);
    expect(text).toMatchObject({ 'text.value': 'Text', 'text.fontSize': 14, 'text.color': darkPalette.lineColor });
  });

  it('uses the native Callout content and default font size', () => {
    const callout = drawing('callout');
    const schema = iqDrawingSettingsSchema('callout');
    const settings = captureDrawingSettings(callout, schema, darkPalette);

    expect(schema.textIsContent).toBe(true);
    expect(settings).toMatchObject({
      'style.color': darkPalette.lineColor,
      'text.value': 'Note',
      'text.fontSize': 12,
      'text.color': darkPalette.lineColor,
    });
    expect(callout.text).toBeUndefined();
  });

  it('preserves explicit false, zero, and empty settings over effective defaults', () => {
    const source = drawing('horizontal-line', {
      style: { color: '#abcdef', lineWidth: 0, lineStyle: 'dotted', showLabels: false },
      text: { value: '', color: '', fontSize: 0, background: false },
      intervals: { from: '', to: '1h' },
      props: { iqterminalLabelState: 'custom', iqterminalLabel: '', iqterminalAnalysisInterval: '' },
    });
    const settings = captureDrawingSettings(source, iqDrawingSettingsSchema(source.tool), darkPalette);

    expect(settings).toMatchObject({
      'style.color': '#abcdef', 'style.lineWidth': 0, 'style.lineStyle': 'dotted', 'style.showLabels': false,
      'text.color': '', 'text.fontSize': 0,
      'intervals.from': '', 'intervals.to': '1h',
      'props.iqterminalLabelState': 'custom', 'props.iqterminalLabel': '', 'props.iqterminalAnalysisInterval': '',
    });
  });

  it('patches only changed fields and compares Fibonacci level arrays by value', () => {
    const source = drawing('horizontal-line', { style: { color: '#26a69a', lineWidth: 1.5, showLabels: true }, props: { note: 'keep' } });
    const patch = drawingSettingsPatch(source, { 'style.lineWidth': 2.5 });
    expect(patch.style).toMatchObject({ color: '#26a69a', lineWidth: 2.5, showLabels: true });
    expect(patch.props).toBeUndefined();
    expect(sameDrawingSetting([{ ratio: 0.5, color: '#00aaff' }], [{ ratio: 0.5, color: '#00aaff' }])).toBe(true);
    expect(sameDrawingSetting([{ ratio: 0.5, color: '#00aaff' }], [{ ratio: 0.5, color: '#ff0000' }])).toBe(false);
    expect(sameDrawingSetting('', undefined)).toBe(true);
    expect(sameDrawingSetting([], undefined)).toBe(true);
    expect(sameDrawingSetting(false, undefined)).toBe(false);
    expect(sameDrawingSetting(0, undefined)).toBe(false);
  });
});
