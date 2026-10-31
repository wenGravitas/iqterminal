import type {LiquidationCoverage,LiquidationVenue} from './model';
export interface LiquidationTimeRange{from:number;to:number}
/** A live chart's evaluated interval ends now, even when its viewport extends into the future. */
export function liquidationElapsedRange(range:LiquidationTimeRange,now=Date.now()):LiquidationTimeRange|undefined{
 const to=Math.min(range.to,now);return range.from<to?{from:range.from,to}:undefined;
}
export function liquidationCoverageText(coverage:LiquidationCoverage,venues:readonly LiquidationVenue[],from:number,to:number,truncated=false){
 if(!venues.length)return 'No liquidation venues selected';
 const states=venues.map(v=>coverage.sources.find(s=>s.venue===v));const notes:string[]=[];
 if(venues.includes('binance'))notes.push('Binance sampled · cumulative snapshots may overlap');
 if(states.some(s=>!s))notes.push('Source history unavailable');
 else{
  if(states.some(s=>s!.state!=='live'))notes.push('Source disconnected / stale');
  if(from<to&&states.some(s=>from<s!.observedFrom||to>s!.verifiedThrough+15000||s!.gaps.some(g=>g.from<to&&g.to>from)))notes.push('Incomplete history / connection gaps');
 }
 if(truncated)notes.push('Bounded result · earlier reports may be omitted');
 notes.push('Reported events only · quiet ≠ no liquidations');return notes.join(' · ');
}
