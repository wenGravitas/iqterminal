import { intervals, type Interval } from '../feed/protocol';
export const MARKET_CONDITIONS_ID = 'native.market-conditions';
export const REGIMES = ['COMPRESSION','NORMAL','EXPANDING','EXTREME'] as const;
export const BANDS = ['DEAD','CHOPPY','DEVELOPING','TRADEABLE','STRONG'] as const;
export const EVENTS = ['compression-exit','expansion','extreme','score-above','score-below','classification','combined'] as const;
export type Regime = typeof REGIMES[number];
export type Band = typeof BANDS[number];
export type AlertEvent = typeof EVENTS[number];
export const DEFAULT_CONDITIONS = {
  mode: 'compact' as 'compact'|'detailed'|'dashboard', component: 'both' as 'both'|'volatility'|'tradeability',
  source: 'chart', timeframes: ['5m','15m','30m','1h','4h','1d'] as Interval[], density: 'compact' as 'compact'|'detailed',
  atrPeriod: 14, atrLookback: 500, bbwPeriod: 20, bbwMultiplier: 2, bbwLookback: 500,
  compressionAtr: 20, compressionBbw: 20, extreme: 90, expansionWindow: 3, exitLookback: 5,
  regimeConfirmation: 2, regimeHysteresis: 3, hvEnabled: false, hvPeriods: [20,50,100],
  erPeriod: 20, chopPeriod: 14, efficiencyWeight: 40, volatilityWeight: 35, choppinessWeight: 25,
  bands: [25,45,65,85], scoreConfirmation: 1, scoreHysteresis: 2,
  suitabilityLow: 15, suitabilityGood: 35, suitabilityHigh: 90, suitabilityExtreme: 25,
  minVolatility: 15, lowVolatilityCap: 35, minEfficiency: .15, lowEfficiencyCap: 45, warningPercentile: 95,
  plotAtr: false, plotBbw: false, plotEr: false, plotChop: false, plotHv: false, referenceLines: [25,45,65,85], shading: true,
  scoreColor: '#58a65c', atrColor: '#91bfc8', bbwColor: '#bf9ac9', erColor: '#d4b56b', chopColor: '#b1aaa0', hvColor: '#91bfc8',
  compressionColor: '#75b9ce', normalColor: '#858585', expandingColor: '#58a65c', extremeColor: '#cf6a6a',
  deadColor: '#cf6a6a', choppyColor: '#d79461', developingColor: '#d4c577', tradeableColor: '#58a65c', strongColor: '#75c8cf',
  alertEvents: [] as AlertEvent[], alertAbove: 65, alertBelow: 45, combinedThreshold: 65,
  alertConfirmation: 1, alertHysteresis: 2, alertSound: false,
};
export type ConditionsSettings = typeof DEFAULT_CONDITIONS;
export function conditionsSettings(value: unknown): ConditionsSettings {
  const r = value && typeof value === 'object' ? value as Record<string,unknown> : {};
  const s = structuredClone(DEFAULT_CONDITIONS);
  for (const key of Object.keys(s) as (keyof ConditionsSettings)[]) {
    const d = s[key], v = r[key];
    if (typeof d === 'number' && typeof v === 'number' && Number.isFinite(v)) (s as any)[key] = v;
    if (typeof d === 'boolean' && typeof v === 'boolean') (s as any)[key] = v;
    if (key.endsWith('Color') && typeof v === 'string' && /^#[\da-f]{6}$/i.test(v)) (s as any)[key] = v;
  }
  for (const key of ['atrPeriod','bbwPeriod','erPeriod','chopPeriod'] as const) s[key] = Math.round(Math.max(2,Math.min(200,s[key])));
  for (const key of ['atrLookback','bbwLookback'] as const) s[key] = Math.round(Math.max(20,Math.min(750,s[key])));
  for (const key of ['expansionWindow','exitLookback','regimeConfirmation','scoreConfirmation','alertConfirmation'] as const) s[key] = Math.round(Math.max(1,Math.min(20,s[key])));
  for (const key of ['compressionAtr','compressionBbw','extreme','regimeHysteresis','scoreHysteresis','suitabilityLow','suitabilityGood','suitabilityHigh','suitabilityExtreme','minVolatility','lowVolatilityCap','lowEfficiencyCap','warningPercentile','alertAbove','alertBelow','combinedThreshold','alertHysteresis'] as const) s[key] = Math.max(0,Math.min(100,s[key]));
  s.minEfficiency = Math.max(0,Math.min(1,s.minEfficiency)); s.bbwMultiplier = Math.max(.1,Math.min(10,s.bbwMultiplier));
  for (const key of ['efficiencyWeight','volatilityWeight','choppinessWeight'] as const) s[key] = Math.max(0,Math.min(1000,s[key]));
  if (!s.efficiencyWeight && !s.volatilityWeight && !s.choppinessWeight) { s.efficiencyWeight=40;s.volatilityWeight=35;s.choppinessWeight=25; }
  s.suitabilityLow=Math.min(98,s.suitabilityLow);s.suitabilityGood=Math.max(s.suitabilityLow+1,Math.min(99,s.suitabilityGood));s.suitabilityHigh=Math.max(s.suitabilityGood,Math.min(99,s.suitabilityHigh));
  const numbers=(v:unknown,min:number,max:number)=>Array.isArray(v)?[...new Set(v.filter((x):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max))].sort((a,b)=>a-b):null;
  const bands=numbers(r.bands,1,99); if(bands?.length===4)s.bands=bands;
  const refs=numbers(r.referenceLines,0,100);if(refs)s.referenceLines=refs.slice(0,8);
  const hv=numbers(r.hvPeriods,2,200);if(hv?.length)s.hvPeriods=hv.slice(0,3).map(Math.round);
  if(Array.isArray(r.timeframes)){const valid=[...new Set(r.timeframes.filter((v):v is Interval=>intervals.includes(v as Interval)))];if(valid.length)s.timeframes=valid.slice(0,7);}
  if(Array.isArray(r.alertEvents))s.alertEvents=[...new Set(r.alertEvents.filter((v):v is AlertEvent=>EVENTS.includes(v as AlertEvent)))];
  if(r.mode==='detailed'||r.mode==='dashboard')s.mode=r.mode;
  if(r.component==='volatility'||r.component==='tradeability')s.component=r.component;
  if(r.density==='detailed')s.density='detailed';
  if(['binance:spot','binance:perpetual','hyperliquid:perpetual'].includes(String(r.source)))s.source=String(r.source);
  return s;
}
export const CALC_KEYS = ['atrPeriod','atrLookback','bbwPeriod','bbwMultiplier','bbwLookback','compressionAtr','compressionBbw','extreme','expansionWindow','exitLookback','regimeConfirmation','regimeHysteresis','hvEnabled','hvPeriods','erPeriod','chopPeriod','efficiencyWeight','volatilityWeight','choppinessWeight','bands','scoreConfirmation','scoreHysteresis','suitabilityLow','suitabilityGood','suitabilityHigh','suitabilityExtreme','minVolatility','lowVolatilityCap','minEfficiency','lowEfficiencyCap','warningPercentile'] as const;
export const calculationKey=(s:ConditionsSettings)=>JSON.stringify(CALC_KEYS.map(k=>s[k]));
export function warmupBars(s:ConditionsSettings){return Math.max(s.atrPeriod+s.atrLookback,s.bbwPeriod+s.bbwLookback,s.erPeriod+1,s.chopPeriod,s.hvEnabled?Math.max(...s.hvPeriods)+1:0)+Math.max(s.expansionWindow,s.exitLookback)+Math.max(s.regimeConfirmation,s.scoreConfirmation);}
