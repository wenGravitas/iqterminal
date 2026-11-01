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
});
