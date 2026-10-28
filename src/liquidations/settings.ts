import { tickerConfig, validateTiers, type Tier, type Sound } from '../ticker/model';
import type { LiquidationVenue, LiquidatedSide } from './model';
export const LIQUIDATIONS_ID = 'native.liquidations';
export const LIQUIDATION_COLUMNS = ['time', 'venue', 'side', 'notional', 'price', 'quantity'] as const;
export interface BurstRule { windowMs: number; minimum: number; count: number; cooldownMs: number; alerts: boolean; sound: Sound; volume: number; toast: boolean }
export interface LiquidationSettings {
  version: 1; venues: LiquidationVenue[]; side: LiquidatedSide | 'BOTH'; minimum: number; units: 'BTC' | 'USDT';
  tiers: Tier[]; muted: boolean; columns: (typeof LIQUIDATION_COLUMNS)[number][];
  burst: BurstRule; markers: boolean; markerMinimum: number; markerDensity: number;
  legend: boolean; paneWeight: number;
}
const clamp = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function defaultLiquidationTiers(): Tier[] {
  return tickerConfig({}).tiers.map((t, i) => ({ ...t, id: `liq-tier-${i}`, buyColor: ['#367d94','#4ca7ca','#65c7e3'][i]!, sellColor: ['#995652','#c86b66','#e68a82'][i]!, sound: i === 2 ? 'alarm' : 'silent', toast: i === 2 }));
}
export function liquidationSettings(value: unknown): LiquidationSettings {
  const v = value && typeof value === 'object' ? value as Record<string, any> : {}, b = v.burst ?? {};
  let tiers = defaultLiquidationTiers(); try { if (v.tiers) tiers = validateTiers(v.tiers); } catch { /* recover corrupt layout */ }
  return { version: 1, venues: Array.isArray(v.venues) ? (['bybit','binance'] as const).filter(id => v.venues.includes(id)) : ['bybit','binance'],
    side: v.side === 'LONG' || v.side === 'SHORT' ? v.side : 'BOTH', minimum: clamp(v.minimum,0,0,1e12), units: v.units === 'BTC' ? 'BTC' : 'USDT',
    tiers, muted: v.muted === true, columns: LIQUIDATION_COLUMNS.filter(id => !Array.isArray(v.columns) || v.columns.includes(id)),
    burst: { windowMs: clamp(b.windowMs,12000,1000,300000), minimum: clamp(b.minimum,1000000,0,1e12), count: Math.round(clamp(b.count,3,2,4096)),
      cooldownMs: clamp(b.cooldownMs,60000,1000,3600000), alerts: b.alerts === true, sound: ['silent','bell','chime','alarm'].includes(b.sound) ? b.sound : 'chime', volume: clamp(b.volume,.5,0,1), toast: b.toast !== false },
    markers: v.markers === true, markerMinimum: clamp(v.markerMinimum,100000,0,1e12), markerDensity: Math.round(clamp(v.markerDensity,80,1,200)), legend: v.legend !== false,
    paneWeight: clamp(v.paneWeight,.28,.08,3) };
}
