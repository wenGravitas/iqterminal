export interface WidgetDefinition { id: string; component: string; singletonId: string | null; existing(): boolean; label: string; category: string; icon: string; description: string; singleton: boolean; create(): void; unavailable(): string | null }
export interface WidgetActions {
  chart(): void; comparison(): void; ticker(): void; liquidations(): void; depth(): void;
  trading(): void; positions(): void; orders(): void; orderHistory(): void; tradeHistory(): void;
  watches(): void; journal(): void; editor(): void; count(component: string): number; has(id: string): boolean;
}

export function widgetRegistry(actions: WidgetActions): WidgetDefinition[] {
  const limit = (component: string, max = 8) => () => actions.count(component) >= max ? `Maximum ${max} ${component} widgets in this workspace` : null;
  const charts = () => actions.count('candle') + actions.count('market-comparison') >= 8 ? 'Maximum 8 chart contexts in this workspace' : null;
  const specs: [string, string, string, string, string, boolean, () => void, () => string | null][] = [
    ['chart', 'Chart', 'Charts', 'chart', 'Native candle and footprint chart', false, actions.chart, charts],
    ['comparison', 'Market Comparison', 'Charts', 'wave', 'Compare market percentage changes', false, actions.comparison, charts],
    ['ticker', 'Trade Ticker', 'Orderflow', 'bars', 'Executed trades and retained tape', false, actions.ticker, limit('trade-ticker')],
    ['liquidations', 'Liquidations', 'Orderflow', 'target', 'Liquidation event tape', false, actions.liquidations, limit('liquidation-ticker')],
    ['depth', 'Depth Matrix', 'Liquidity', 'grid', 'Synchronized depth columns', false, actions.depth, limit('depth-matrix')],
    ['trading', 'Hyperliquid Trading', 'Trading', 'market', 'Open the global trading account panel', true, actions.trading, () => null],
    ['positions', 'Positions', 'Trading', 'layers', 'Current account positions', true, actions.positions, () => null],
    ['orders', 'Open Orders', 'Trading', 'layers', 'Current account open orders', true, actions.orders, () => null],
    ['order-history', 'Order History', 'Trading', 'bars', 'Local order attempt history', true, actions.orderHistory, () => null],
    ['trade-history', 'Trade History', 'Trading', 'bars', 'Recent account fills', true, actions.tradeHistory, () => null],
    ['watches', 'Level Watch', 'Monitoring', 'target', 'Shared Level Watch monitoring', true, actions.watches, () => null],
    ['journal', 'Journal', 'Tools', 'notes', 'Daily Markdown trading diary and chart attachments', true, actions.journal, () => null],
    ['editor', 'OpenScript Editor', 'Tools', 'chart', 'Edit the global script library for an active chart', true, actions.editor, () => actions.count('candle') || actions.has('script-editor') ? null : 'Open a chart to select an editor target'],
  ];
  const components: Record<string, string> = {
    chart: 'candle', comparison: 'market-comparison', ticker: 'trade-ticker', liquidations: 'liquidation-ticker', depth: 'depth-matrix',
    trading: 'hyperliquid-trading', positions: 'hyperliquid-trading-positions', orders: 'hyperliquid-trading-open-orders',
    'order-history': 'hyperliquid-trading-order-history', 'trade-history': 'hyperliquid-trading-trade-history',
    watches: 'level-watch', journal: 'global-journal', editor: 'script-editor',
  };
  const singletons: Record<string, string> = {
    trading: 'hyperliquid-trading', positions: 'hyperliquid-positions', orders: 'hyperliquid-open-orders',
    'order-history': 'hyperliquid-order-history', 'trade-history': 'hyperliquid-trade-history',
    watches: 'level-watch', journal: 'global-journal', editor: 'script-editor',
  };
  return specs.map(([id, label, category, icon, description, singleton, create, unavailable]) => ({
    id, component: components[id]!, singletonId: singletons[id] ?? null,
    existing: () => Boolean(singletons[id] && actions.has(singletons[id]!)),
    label, category, icon, description, singleton, create, unavailable,
  }));
}
