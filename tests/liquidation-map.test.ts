import { test, expect } from 'vitest';
import { mapSettings } from '../src/liquidation-map/model';
import { exposureRows, selectedCells } from '../src/liquidation-map/chart';
const cell = { low: 100, high: 110, quantity: 10, side: 'long' as const, venue: 'bybit' as const, kind: 'estimated' as const, scenario: 'a', leverage: 10, quote: 'USDT', nativePrice: 105, modelVersion: 'v1', riskVersion: 'r1' };
test('map and profile average alternative scenario stock rather than summing it', () => { const c = { at: 1, availableAt: 1, revision: 1, quality: [], cells: [cell, { ...cell, scenario: 'b', quantity: 20 }] }; expect(exposureRows(c, mapSettings(undefined), 'USDT').get(100)).toBe(15); });
test('native quote valuation excludes a different quote, base view retains explicit source price', () => { const c = { at: 1, availableAt: 1, revision: 1, quality: [], cells: [cell, { ...cell, kind: 'observed' as const, venue: 'hyperliquid' as const, quote: 'USD', leverage: null }] }; expect(selectedCells(c, mapSettings({ units: 'native-quote' }), 'USDT')).toHaveLength(1); expect(selectedCells(c, mapSettings(undefined), 'USDT')).toHaveLength(2); });
test('empty source and leverage selections persist without reverting to defaults', () => { expect(mapSettings({ venues: [], leverage: [] })).toMatchObject({ venues: [], leverage: [] }); });
import { vi } from 'vitest';
import { LiquidationMapPrimitive } from '../src/liquidation-map/chart';
test('resident horizontal navigation reuses native geometry and zoom invalidates it', () => { class Path {
    rect = vi.fn();
} vi.stubGlobal('Path2D', Path); try {
    let pan = 0, spacing = 7;
    const at = 1800000000000, p = new LiquidationMapPrimitive();
    p.settings = mapSettings({ profile: false });
    p.columns = [{ at: at + 120000, availableAt: at + 120000, revision: 1, quality: [], cells: [{ ...cell, kind: 'observed', leverage: null }] }];
    const fills: unknown[] = [], translations: number[] = [];
    const ctx = { save() { }, restore() { }, beginPath() { }, rect() { }, clip() { }, fill(path: unknown) { fills.push(path); }, fillText() { }, translate(x: number) { translations.push(x); } } as any;
    const rc = { dpr: 1, plotWidth: 500, plotHeight: 500, theme: { axisText: '#aaa' }, timeScale: { visibleRange: () => ({ from: 0, to: 20 }), get barSpacing() { return spacing; }, indexToX: (i: number) => 20 + i * spacing + pan }, dataLayer: { length: 21, indexToTimeFloat: (i: number) => at / 1000 + i * 60, timeToIndexFloat: (t: number) => (t - at / 1000) / 60 }, priceScale: { priceRange: () => ({ min: 0, max: 1000 }), priceToY: (price: number) => (1000 - price) / 2 } } as any;
    p.draw(ctx, rc);
    pan = 5;
    p.draw(ctx, rc);
    expect(fills).toHaveLength(2);
    expect(fills[1]).toBe(fills[0]);
    expect(translations).toContain(5);
    spacing = 14;
    p.draw(ctx, rc);
    expect(fills[2]).not.toBe(fills[0]);
}
finally {
    vi.unstubAllGlobals();
} });
import { packMap, unpackMap } from '../src/liquidation-map/wire';
test('transferable map buffers retain Float64 prices, scenarios and native quote identities', () => { const payload = { version: 1 as const, semantics: 'conditional-exposure' as const, columns: [{ at: 1800000000001, availableAt: 1800000000002, revision: 1, cells: [{ ...cell, nativePrice: 57942.123456789, quote: 'USDT' }], quality: ['subset'] }], sources: [], head: 1, next: null, from: 1, to: 2, resolution: 60000, priceWidth: 100, asOf: 1800000000003 }; const wire = packMap(payload); expect(wire.values.buffer).toBeInstanceOf(ArrayBuffer); expect(unpackMap({ ...payload, columns: [] }, wire)).toEqual(payload); });

import {mapColumnAt} from '../src/liquidation-map/model';
test('map and profile inspection use availability rather than a later event-time revision',()=>{
 const first={at:1,availableAt:10,revision:1,cells:[cell],quality:[]},later={at:2,availableAt:30,revision:2,cells:[cell],quality:[]};
 expect(mapColumnAt([first,later],9)).toBeUndefined();
 expect(mapColumnAt([first,later],20)).toBe(first);
 expect(mapColumnAt([first,later],30)).toBe(later);
 expect(mapColumnAt([first,later],Infinity)).toBe(later);
});
