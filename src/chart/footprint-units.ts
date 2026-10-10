import type { FootprintBar } from '../feed/protocol';
export type FootprintUnits = 'btc' | 'usdt';

/** Display projection only; canonical volumes, execution OHLC and subscription identity stay in BTC. */
export function footprintForUnits(bar: FootprintBar, units: FootprintUnits): FootprintBar | null {
  if (units === 'btc') return bar;
  if (![bar.quoteDelta, bar.minQuoteDelta, bar.maxQuoteDelta].every(value => typeof value === 'number' && Number.isFinite(value))
    || bar.cells.some(cell => typeof cell.bidNotional !== 'number' || !Number.isFinite(cell.bidNotional) || cell.bidNotional < 0
      || typeof cell.askNotional !== 'number' || !Number.isFinite(cell.askNotional) || cell.askNotional < 0)) return null;
  return { ...bar, cells: bar.cells.map(cell => ({ ...cell, bidVol: cell.bidNotional!, askVol: cell.askNotional! })),
    delta: bar.quoteDelta!, minDelta: bar.minQuoteDelta!, maxDelta: bar.maxQuoteDelta! };
}
