import { describe, expect, it } from 'vitest';
import { indicatorInfoText } from '../src/indicators/info';
import { COMPOSITION_SMA_ID, NET_LONGS_ID, NET_SHORTS_ID } from '../src/indicators/model';
import { CVD_ID } from '../src/feed/cvd';
import { LIQUIDATIONS_ID } from '../src/liquidations/settings';
import { OPEN_INTEREST_ID } from '../src/indicators/open-interest-data';

function instance(definitionId: string, settings: Record<string, unknown> = {}, script?: { scriptId: string }) {
  return { definitionId, settings, ...(script ? { script } : {}) } as Parameters<typeof indicatorInfoText>[0];
}

describe('indicator info copy', () => {
  it('explains reported liquidations and their approximate coverage in plain language', () => {
    const text = indicatorInfoText(instance(LIQUIDATIONS_ID));
    expect(text).toContain('reported by exchanges');
    expect(text).toContain('miss or overlap');
    expect(text).toContain('approximate');
    expect(text).not.toMatch(/bankruptcy|sampled cumulative|BTCUSDT/);
  });

  it('states that estimated positioning is not an actual position count', () => {
    for (const id of [NET_LONGS_ID, NET_SHORTS_ID]) {
      expect(indicatorInfoText(instance(id))).toContain('not actual position counts');
    }
  });

  it('explains open interest without confusing it with a long/short estimate', () => {
    const text = indicatorInfoText(instance(OPEN_INTEREST_ID));
    expect(text).toContain('open futures positions');
    expect(text).toContain('in BTC');
    expect(text).toContain('does not separate longs from shorts');
  });

  it('uses the selected output and length for SMA copy, and retains its gap rule', () => {
    const text = indicatorInfoText(instance(COMPOSITION_SMA_ID, { length: 12 }), { inputName: 'Open Interest Total (BTC)' });
    expect(text).toContain('last 12 values from Open Interest Total (BTC)');
    expect(text).toContain('Missing values leave gaps');
  });

  it('describes CVD in terms of completed trades and selected exchanges', () => {
    expect(indicatorInfoText(instance(CVD_ID, { units: 'usdt' }))).toContain('completed trades on selected exchanges');
  });

  it('does not infer a custom study purpose from its title or description', () => {
    const custom = { ...instance('script:local.user-study', {}, { scriptId: 'local.user-study' }), script: {
      scriptId: 'local.user-study', title: 'Liquidations', description: 'Actual reports and BTCUSDT data',
    } } as Parameters<typeof indicatorInfoText>[0];
    const text = indicatorInfoText(custom);
    expect(text).toContain('No description is available for this custom indicator');
    expect(text).not.toMatch(/liquidation|BTCUSDT|actual reports/i);
  });

  it('gives an unavailable unknown indicator a clear explanation', () => {
    expect(indicatorInfoText(instance('native.removed-indicator'), { unavailable: true }))
      .toBe('This indicator cannot be shown in the current chart.');
  });
});
