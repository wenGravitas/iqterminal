import type { IndicatorInstance } from './model';
import {
  COMPOSITION_SMA_ID, FOOTPRINT_ID, FOOTPRINT_TOTALS_ID, HEATMAP_ID,
  NET_LONGS_ID, NET_SHORTS_ID, ORDER_WALLS_ID,
  TPO_ID,
} from './model';
import { CVD_ID } from '../feed/cvd';
import { LIQUIDATIONS_ID } from '../liquidations/settings';
import { EFFORT_RESULT_ID } from '../effort-result/settings';
import { MARKET_CONDITIONS_ID } from '../market-conditions/settings';
import { OPEN_INTEREST_ID } from './open-interest-data';
import { DAILY_VWAP_ID } from './daily-vwap';
import { TRADE_BUBBLES_ID } from '../trade-bubbles/model';

export interface IndicatorInfoOptions {
  /** Include a source name only when it is the actual selected numeric input. */
  inputName?: string;
  availabilityNote?: string;
  unavailable?: boolean;
}

/** Short user-facing explanations. Built-in meaning is tied to stable definition IDs. */
export function indicatorInfoText(instance: Pick<IndicatorInstance, 'definitionId' | 'settings' | 'script'>,
  options: IndicatorInfoOptions = {}) {
  const settings = instance.settings;
  let explanation: string;
  switch (instance.definitionId) {
    case LIQUIDATIONS_ID:
      explanation = 'Shows forced position closures reported by exchanges. Binance reports can miss or overlap events, so totals are approximate. A quiet chart does not prove there were none.';
      break;
    case NET_LONGS_ID:
      explanation = 'Estimates changes in long positions from market data. These are estimates, not actual position counts.';
      break;
    case NET_SHORTS_ID:
      explanation = 'Estimates changes in short positions from market data. These are estimates, not actual position counts.';
      break;
    case OPEN_INTEREST_ID:
      explanation = 'Tracks the size of open futures positions at selected exchanges, in BTC. It does not separate longs from shorts.';
      break;
    case CVD_ID:
      explanation = 'Tracks buying and selling pressure from completed trades on selected exchanges.';
      break;
    case COMPOSITION_SMA_ID: {
      const length = Number.isInteger(settings.length) ? Math.max(1, Math.min(250, settings.length as number)) : 20;
      explanation = `Averages the last ${length} values from ${options.inputName || 'the selected data'}. Missing values leave gaps until enough values are available.`;
      break;
    }
    case DAILY_VWAP_ID:
      explanation = `Shows the average price weighted by candle volume${settings.bands === false ? '.' : ', with bands showing how far price moves from it.'} It restarts at UTC midnight.`;
      break;
    case EFFORT_RESULT_ID:
      explanation = 'Highlights heavy buying or selling when price moves little. It is a rough guide, not a trading signal.';
      break;
    case MARKET_CONDITIONS_ID:
      explanation = 'Summarizes recent volatility and trading conditions from completed candles. It is an estimate, not a forecast.';
      break;
    case TRADE_BUBBLES_ID:
      explanation = 'Shows trades as circles: larger circles mean larger trades. The minimum size setting filters which trades appear.';
      break;
    case FOOTPRINT_ID: {
      const rowPrice = Number.isFinite(settings.rowPrice) && (settings.rowPrice as number) > 0 ? settings.rowPrice as number : 25;
      explanation = `Shows buying and selling volume at each price level within a candle. Rows group prices in $${rowPrice.toLocaleString('en-US')} steps.`;
      break;
    }
    case FOOTPRINT_TOTALS_ID:
      explanation = 'Shows the selected volume figures for each candle, such as total volume and the difference between buying and selling.';
      break;
    case HEATMAP_ID:
      explanation = 'Shows buy and sell orders waiting in the order book. These orders can change or disappear before they trade.';
      break;
    case ORDER_WALLS_ID:
      explanation = 'Highlights large buy and sell orders waiting in the order book. They can change or disappear before they trade.';
      break;
    case TPO_ID:
      explanation = 'Shows where price spent more time during each UTC day, using one-minute candles. It marks the opening range and the day’s busy price area.';
      break;
    default:
      explanation = scriptInfo(instance.script?.scriptId) ?? (options.unavailable
        ? 'This indicator cannot be shown in the current chart.'
        : 'No description is available for this indicator.');
  }
  if (options.unavailable && !explanation.includes('cannot be shown')) {
    explanation += ' This indicator cannot be shown in the current chart.';
  }
  if (options.availabilityNote) explanation += ` ${options.availabilityNote}`;
  return explanation;
}

function scriptInfo(scriptId?: string) {
  switch (scriptId) {
    case 'builtin.ema-overlay':
      return 'Smooths candle closing prices to show their direction over time.';
    case 'builtin.volume-histogram':
      return 'Shows the BTC volume traded in each candle.';
    case 'builtin.binance-depth-band':
      return 'Shows Binance buy and sell orders waiting near the price. They may change before they trade.';
    default:
      return scriptId ? 'No description is available for this custom indicator.' : undefined;
  }
}
