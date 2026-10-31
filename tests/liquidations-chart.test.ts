import {describe,it,expect}from 'vitest';
import {liquidationMissingCoverage}from '../src/liquidations/chart';
import {liquidationCoverageText,liquidationElapsedRange}from '../src/liquidations/coverage';
import type {LiquidationCoverage,LiquidationSourceState}from '../src/liquidations/model';

const now=1_800_000_000_000;
function coverage(asOf?:number,overrides:Partial<LiquidationSourceState>={}):LiquidationCoverage{
 const source:LiquidationSourceState={venue:'bybit',state:'stale',observedFrom:now-120_000,verifiedThrough:now-20_000,lastEventAt:null,lastTrafficAt:now-20_000,gaps:[],message:'stale',rejected:0,dropped:0,reconnects:0,...overrides};
 return {sources:[source],...(asOf===undefined?{}:{asOf}),head:1,retentionDays:7,semantics:'reported-events-only'};
}

describe('liquidation missing coverage shading',()=>{
 it('keeps a stale source tail shaded through now despite an older asOf, then clears future time',()=>{
  const range={from:now-60_000,to:now+30_000};
  expect(liquidationMissingCoverage(range,coverage(now-3_600_000),['bybit'],now)).toEqual([{from:now-20_000,to:now}]);
  expect(liquidationMissingCoverage({from:now+1,to:now+30_000},coverage(now-3_600_000),['bybit'],now)).toEqual([]);
 });
 it('ignores future-only viewport margin in quality text but still reports elapsed gaps',()=>{
  const current=coverage(now-3_600_000,{state:'live',verifiedThrough:now});
  const future=liquidationElapsedRange({from:now+1,to:now+30_000},now);
  expect(future).toBeUndefined();
  expect(liquidationCoverageText(current,['bybit'],future?.from??now,future?.to??now)).not.toContain('Incomplete history');

  const past=liquidationElapsedRange({from:now-60_000,to:now+30_000},now)!;
  const withPastGap=coverage(now-3_600_000,{state:'live',verifiedThrough:now,gaps:[{from:now-30_000,to:now-20_000,reason:'disconnect'}]});
  expect(liquidationCoverageText(withPastGap,['bybit'],past.from,past.to)).toContain('Incomplete history / connection gaps');
 });
});
