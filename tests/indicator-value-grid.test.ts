import { describe, expect, it, vi } from 'vitest';
import { PriceScale, type PrimitiveRenderContext } from 'openalgo-charts';
import { CVD_ID } from '../src/feed/cvd';
import { IndicatorValueGrid } from '../src/chart/indicator-value-grid';
import { nativeInstance, validateInstances } from '../src/indicators/model';

describe('indicator value grid', () => {
  it('uses readout ticks, clips before the CVD gutter and header, and disposes updates', () => {
    const scale = new PriceScale(); scale.setHeight(320); scale.setPriceRange({ min: -100, max: 200 });
    const rc = { readoutPriceScale: scale, plotWidth: 1000, plotHeight: 320, dpr: 2, theme: { grid: '#333333' } } as unknown as PrimitiveRenderContext;
    const ctx = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'setLineDash', 'moveTo', 'lineTo', 'stroke'].map(name => [name, vi.fn()])) as unknown as CanvasRenderingContext2D;
    const grid = new IndicatorValueGrid(), requestUpdate = vi.fn(); grid.attached({ requestUpdate } as any);
    grid.configure(true, true); grid.draw(ctx, rc);
    expect(grid.geometry.length).toBeGreaterThan(0);
    expect(grid.geometry).toEqual(scale.ticks(10).map(value => scale.priceToY(value)).filter(y => y >= 30 && y <= 312));
    expect(ctx.rect).toHaveBeenCalledWith(0, 60, 1704, 580);
    grid.configure(false, true); grid.draw(ctx, rc); expect(grid.geometry).toEqual([]);
    grid.detached(); requestUpdate.mockClear(); grid.configure(true, false); expect(requestUpdate).not.toHaveBeenCalled();
  });
  it('keeps legacy layouts enabled and persists explicit choices through validation', () => {
    const instance = nativeInstance(CVD_ID, {});
    expect(validateInstances([instance])[0]!.priceGrid !== false).toBe(true);
    expect(validateInstances([{ ...instance, priceGrid: false }])[0]!.priceGrid).toBe(false);
    expect(validateInstances([{ ...instance, priceGrid: 'false' }])[0]!.priceGrid !== false).toBe(true);
  });
});
