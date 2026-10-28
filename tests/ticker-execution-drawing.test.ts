import { describe, expect, it } from 'vitest';
import { drawingSettingsSchema, getDrawingTool, registerBuiltinDrawingTools } from 'openalgo-charts/draw';
import type { DrawContext } from 'openalgo-charts/draw';
import { executionRayLabel } from '../src/ticker/execution-drawing';
import { registerIQDrawingLabelRenderers } from '../src/chart/drawing-labels';
import type { NormalizedExecution } from '../src/feed/footprint';

const execution: NormalizedExecution = {
  venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade',
  executionId: 'binance:perpetual:BTCUSDT:agg:17', timeMs: Date.UTC(2026, 9, 19, 11, 24, 5, 123), eventTimeMs: Date.UTC(2026, 9, 19, 11, 24, 5, 130),
  price: 82500, quantity: 0.25, quoteNotionalText: '20625', side: 'buy',
};

describe('ticker execution drawing', () => {
  it('formats venue, side, reported print, price, size, notional and UTC time', () => {
    expect(executionRayLabel(execution)).toBe('BINANCE PERP · BUY · AGG PRINT\n0.25 BTC @ 82,500 USDT · 20,625 USDT · 11:24:05.123 UTC');
    expect(executionRayLabel({ ...execution, venue: 'hyperliquid', market: 'perpetual', nativeSymbol: 'BTC', granularity: 'individual-trade', side: 'unknown' }))
      .toContain('HYPERLIQUID PERP · UNKNOWN · TRADE');
  });

  it('registers native ray text and renders its editable text.value on the ray', () => {
    registerBuiltinDrawingTools();
    registerIQDrawingLabelRenderers();
    expect(drawingSettingsSchema('horizontal-ray').fields.some(field => field.path === 'text.value' && field.label === 'Text on ray')).toBe(true);

    const texts: string[] = [];
    const ctx = {
      save() {}, restore() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {},
      measureText(text: string) { return { width: text.length * 6 } as TextMetrics; },
      fillText(text: string) { texts.push(text); },
    } as unknown as CanvasRenderingContext2D;
    const label = executionRayLabel(execution);
    const context: DrawContext = {
      ctx,
      rc: { dpr: 1, plotWidth: 800, plotHeight: 400, theme: { background: '#090909' } } as DrawContext['rc'],
      pts: [{ x: 40, y: 100 }],
      drawing: { id: 'saved-ray', tool: 'horizontal-ray', points: [{ time: execution.timeMs / 1000, price: execution.price }], style: { color: '#58a65c' }, text: { value: label }, props: { iqterminal: { version: 1 }, iqterminalLabelState: 'unset' }, paneIndex: 0, zIndex: 0 },
      style: { color: '#58a65c', lineWidth: 1, showLabels: false }, selected: false, formatPrice: () => '',
    };

    getDrawingTool('horizontal-ray').draw(context);
    expect(texts).toEqual(['BN[P] 0.25 BTC']);
    texts.length=0;getDrawingTool('horizontal-ray').draw({...context,pts:[{x:900,y:100}]});expect(texts).toEqual([]);
    getDrawingTool('horizontal-ray').draw({...context,drawing:{...context.drawing,props:{iqterminalLabelState:'custom',iqterminalLabel:'BINANCE PERP personal note'}}});expect(texts).toEqual(['BINANCE PERP personal note']);
  });
});
