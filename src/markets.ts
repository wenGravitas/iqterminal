import { instruments, type ConnectionKey } from './feed/protocol';
/** Capability catalogue is independent of widget placement and persisted selections. */
export const markets = Object.entries(instruments).map(([id, info]) => ({ id: id as ConnectionKey, ...info,
  venue: id.startsWith('binance:') ? 'Binance' : 'Hyperliquid', marketType: id.endsWith(':spot') ? 'Spot' : 'Perpetual',
  candles: true, executions: id === 'binance:spot' || id === 'binance:perpetual' }));
export function marketName(id: string) { return markets.find(m => m.id === id)?.label ?? id; }
export function executionMarkets(value: unknown): ConnectionKey[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is ConnectionKey => markets.some(m => m.id === id && m.executions)))].slice(0, 8) : [];
}
