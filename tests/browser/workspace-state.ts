/** Existing browser scenarios use an explicit saved two-chart workspace.
 * Fresh-start tests override storageState, so they exercise the actual defaults.
 */
export function twoChartWorkspaceState(baseURL: string) {
  const ids = ['chart-binance', 'chart-hyperliquid'];
  const layout = {
    grid: {
      root: { type: 'branch', data: ids.map((id, index) => ({ type: 'leaf', data: { views: [id], activeView: id, id: String(index + 1) }, size: 680 })), size: 700 },
      width: 1366, height: 700, orientation: 'HORIZONTAL',
    },
    panels: Object.fromEntries(ids.map((id, index) => [id, {
      id, contentComponent: 'candle', tabComponent: 'compact-chart', title: 'Candles',
      params: { venue: index === 0 ? 'binance' : 'hyperliquid', market: 'perpetual', interval: '1m', type: 'candle', studies: [] },
      minimumHeight: 140, minimumWidth: 220,
    }])),
    activeGroup: '2',
  };
  return { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [
    { name: 'basis.layout.v1', value: JSON.stringify({ version: 5, layout }) },
    ...ids.map(id => ({ name: `iqterminal:object-tree-sidebar:v1:${id}`, value: JSON.stringify({ version: 1, width: 280, collapsed: false }) })),
  ] }] };
}
