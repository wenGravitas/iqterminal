export const EFFORT_RESULT_ID = 'native.effort-result';
export const DETECTOR_VERSION = 'er-1';
export const DEFAULT_EFFORT = { latenessMs:500, effort:.95, dominance:.30, unknownFraction:.01, progress:.25, endpoint:.25, range:1, concentration:.50, persistentParts:3, partFraction:.10, durationFraction:1/3, outcomeSeconds:120, cooldownSeconds:60, retentionDays:30, pane:false, candidateAlerts:false, outcomeAlerts:false, sound:false };
export type EffortSettings = typeof DEFAULT_EFFORT;
const bounds:Partial<Record<keyof EffortSettings,[number,number]>>={latenessMs:[0,5000],effort:[.5,1],dominance:[0,1],unknownFraction:[0,.01],progress:[0,1],endpoint:[0,1],range:[.1,2],concentration:[.1,1],persistentParts:[3,6],partFraction:[.01,1/3],durationFraction:[1/3,1],outcomeSeconds:[3,600],cooldownSeconds:[1,600],retentionDays:[1,90]};
export function effortSettings(raw:unknown):EffortSettings { const v=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};const r={...v,...(v.calculation as object??{}),...(v.presentation as object??{}),...(v.notifications as object??{})} as Record<string,unknown>;const s={...DEFAULT_EFFORT};for(const k of Object.keys(s) as (keyof EffortSettings)[]){const v=r[k],d=s[k];if(typeof d==='boolean')(s as any)[k]=v===true;else if(typeof v==='number'&&Number.isFinite(v)){const [lo,hi]=bounds[k]!;(s as any)[k]=Math.max(lo,Math.min(hi,v));}}s.persistentParts=Math.round(s.persistentParts);s.latenessMs=Math.round(s.latenessMs);return s; }
export function calculationSettings(s:EffortSettings){const {pane,candidateAlerts,outcomeAlerts,sound,retentionDays,...calculation}=s;return calculation;}
export function calculationKey(s:EffortSettings){return JSON.stringify(calculationSettings(s));}
export interface EffortSource { venue:string;market:string;nativeSymbol:string;quantityUnit:'BTC';priceMode:'trade-price-proxy';clockMode:'exchange-execution';granularity:'aggregate-trade';tickSize:number }
export const BINANCE_EFFORT:EffortSource={venue:'binance',market:'perpetual',nativeSymbol:'BTCUSDT',quantityUnit:'BTC',priceMode:'trade-price-proxy',clockMode:'exchange-execution',granularity:'aggregate-trade',tickSize:.1};
export function sourceKey(s:EffortSource,settings:EffortSettings){return `${DETECTOR_VERSION}:rolling-24h:30s:${JSON.stringify(s)}:${calculationKey(settings)}`;}

export function effortRecord(s:EffortSettings){return {calculation:calculationSettings(s),presentation:{pane:s.pane},notifications:{candidateAlerts:s.candidateAlerts,outcomeAlerts:s.outcomeAlerts,sound:s.sound},retentionDays:s.retentionDays};}
