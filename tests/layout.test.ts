import { describe, expect, it } from 'vitest';
import { restoreValue } from '../src/layout';

describe('layout persistence', () => {
  const layoutFor = (params: unknown) => ({
    grid: {},
    panels: {
      'hyperliquid-trading': {
        id: 'hyperliquid-trading',
        contentComponent: 'hyperliquid-trading',
        tabComponent: 'default',
        title: 'Trading · HL BTC',
        minimumHeight: 220,
        minimumWidth: 280,
        params,
      },
    },
  });

  it('restores the Dockview wire shape when undefined params are omitted by JSON serialization', () => {
    const saved = JSON.stringify({ version: 7, layout: layoutFor(undefined) });
    const wire = JSON.parse(saved);

    expect(wire.layout.panels['hyperliquid-trading']).not.toHaveProperty('params');
    expect(restoreValue(saved)).toEqual(wire.layout);
  });

  it('accepts only omitted or empty plain trading-panel params', () => {
    expect(restoreValue(JSON.stringify({ version: 7, layout: layoutFor({}) }))).toEqual(layoutFor({}));

    for (const params of [null, [], ['value'], 'malformed', { privateKey: 'not-a-key' }, { principal: 'not-a-principal' }]) {
      expect(restoreValue(JSON.stringify({ version: 7, layout: layoutFor(params) }))).toBeNull();
    }
  });

  it('restores the four version 8 trading activity widgets and rejects mismatched or parameterized panels', () => {
    const views = ['positions', 'open-orders', 'order-history', 'trade-history'] as const;
    const ids = ['hyperliquid-positions', 'hyperliquid-open-orders', 'hyperliquid-order-history', 'hyperliquid-trade-history'] as const;
    const panels = Object.fromEntries(views.map((view, index) => [ids[index], {
      id: ids[index], contentComponent: `hyperliquid-trading-${view}`, tabComponent: 'default', title: view, params: {},
    }]));
    const layout = { grid: {}, panels };
    expect(restoreValue(JSON.stringify({ version: 8, layout }))).toEqual(layout);
    expect(restoreValue(JSON.stringify({ version: 7, layout }))).toBeNull();

    const mismatched = structuredClone(layout);
    (mismatched.panels as Record<string, any>)['hyperliquid-positions'].contentComponent = 'hyperliquid-trading-open-orders';
    expect(restoreValue(JSON.stringify({ version: 8, layout: mismatched }))).toBeNull();
    const parameterized = structuredClone(layout);
    (parameterized.panels as Record<string, any>)['hyperliquid-positions'].params = { principal: '0xnot-layout-data' };
    expect(restoreValue(JSON.stringify({ version: 8, layout: parameterized }))).toBeNull();
  });
});
