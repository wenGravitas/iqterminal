export interface BuiltInStudy {
  id: string;
  title: string;
  description: string;
  source: string;
  capabilities: string[];
}

export const BUILT_IN_STUDIES: readonly BuiltInStudy[] = Object.freeze([
  {
    id: 'builtin.ema-overlay',
    title: 'EMA overlay',
    description: 'An editable exponential moving average over price.',
    capabilities: ['ohlcv'],
    source: `version 1

study("EMA overlay", overlay = true)

length = input(20, "Length", min = 1, max = 250)
lineColor = input(orange, "Line colour")
average = ema(close, length)

plot(average, "EMA", lineColor, width = 2)`,
  },
  {
    id: 'builtin.volume-histogram',
    title: 'Volume',
    description: 'Real candle volume in BTC, shown in a lower pane.',
    capabilities: ['ohlcv'],
    source: `version 1

study("Volume")

plot(volume, "Volume · BTC", aqua, style = "histogram")`,
  },
  {
    id: 'builtin.binance-depth-band',
    title: 'Binance depth band',
    description: 'Synchronized Binance BTCUSDT USD-M visible quote depth inside a percentage band. Values are 1-second samples, not traded volume or a time average.',
    capabilities: ['iqterminal.depth.series.v1', 'ohlcv'],
    source: `version 1

study("Binance depth band")

iq_depth_band_pct_v1 = input(0.05, "Depth band (%)", min = 0.01, max = 0.25, step = 0.01)
smooth = input(1, "Smoothing bars", min = 1, max = 120)
bid = input(iq_depth_bid_quote_v1, "Bid quote · USDT")
ask = input(iq_depth_ask_quote_v1, "Ask quote · USDT")
bidValue = ema(bid, smooth)
askValue = ema(ask, smooth)
bidPlot = plot(isNone(bid) ? none : bidValue, "Bid quote · USDT", lime, style = "line")
askPlot = plot(isNone(ask) ? none : askValue, "Ask quote · USDT", red, style = "line")`,
  },
]);

export function builtInById(id: string) {
  return BUILT_IN_STUDIES.find(study => study.id === id) ?? null;
}
