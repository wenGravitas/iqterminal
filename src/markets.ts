import { instruments, type ConnectionKey } from './feed/protocol';
/** Capability catalogue is independent of widget placement and persisted selections. */
export const markets = Object.entries(instruments).map(([id, info]) => ({ id: id as ConnectionKey, ...info,
  venue: id.startsWith('binance:') ? 'Binance' : id.startsWith('bybit:') ? 'Bybit' : 'Hyperliquid', marketType: id.endsWith(':spot') ? 'Spot' : 'Perpetual',
  candles: id !== 'bybit:perpetual', liquidations: id === 'bybit:perpetual' || id === 'binance:perpetual', executions: id === 'binance:spot' || id === 'binance:perpetual' || id === 'bybit:perpetual' }));
export function marketName(id: string) { return markets.find(m => m.id === id)?.label ?? id; }
export function executionMarkets(value: unknown): ConnectionKey[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is ConnectionKey => markets.some(m => m.id === id && m.executions)))].slice(0, 8) : [];
}

/** Runtime capabilities for projected exposure are supplied by the server,
 * alongside this existing catalogue; availability never creates a candle venue. */
export interface ProjectedExposureCapability {
 instrumentId:string;venue:string;pool:string;product:'linear-perpetual';nativeSymbol:string;
 base:string;quote:string;settlement:string;contractMultiplier:number;quantityUnit:'base'|'contracts';
 observedPositions:boolean;estimationInputs:boolean;marks:boolean;riskRules:'reported'|'verified'|'unavailable';
 historyFrom:number|null;scope:'observed-subset'|'model-scenarios'|'unavailable';
}
