import { describe, expect, it } from 'vitest';
import { calculateUtcKeyLevels, DEFAULT_KEY_LEVELS } from '../src/indicators/key-levels';
import type { Candle } from '../src/feed/protocol';
import { keyLevelRayX } from '../src/chart/key-levels';
const day = 86_400_000;
const c=(t:number,o:number,h:number,l:number,closed=true):Candle=>({t,o,h,l,c:o,v:1,revision:1,closed});
describe('UTC key levels',()=>{
  it('uses previous completed UTC daily high/low and a forming current-day open',()=>{
    const now=4*day+12_345;
    const levels=calculateUtcKeyLevels([c(3*day,90,110,80),c(4*day,101,105,99,false)],now);
    expect(levels).toEqual([
      {id:'previous-high',label:'PDH',price:110,startTime:4*day/1000},
      {id:'previous-low',label:'PDL',price:80,startTime:4*day/1000},
      {id:'today-open',label:'DO',price:101,startTime:4*day/1000},
    ]);
  });
  it('rolls at UTC midnight independent of supplied chart bars or timezone',()=>{
    const now=5*day+100;
    const levels=calculateUtcKeyLevels([c(4*day,101,120,95,false),c(5*day,113,114,112,false)],now);
    expect(levels.map(x=>x.id)).toEqual(['today-open']);
    expect(levels[0]?.price).toBe(113);
  });
  it('omits missing, unclosed previous candles and invalid timestamps; respects toggles',()=>{
    expect(calculateUtcKeyLevels([c(3*day,90,110,80,false),c(4*day,101,105,99,false)],4*day+1)).toEqual([{id:'today-open',label:'DO',price:101,startTime:4*day/1000}]);
    expect(calculateUtcKeyLevels([],4*day+1)).toEqual([]);
    expect(calculateUtcKeyLevels([c(3*day+1000,90,110,80),c(4*day,101,105,99,false)],4*day+1)).toEqual([{id:'today-open',label:'DO',price:101,startTime:4*day/1000}]);
    expect(calculateUtcKeyLevels([c(3*day,90,110,80),c(4*day,101,105,99,false)],4*day+1,{...DEFAULT_KEY_LEVELS,todayOpen:false}).map(x=>x.id)).toEqual(['previous-high','previous-low']);
  });
  it('uses the interpolated time index for a ray start in a viewport data gap',()=>{
    expect(keyLevelRayX(250,100,800,2.5,index=>index*100)).toBe(250);
    expect(keyLevelRayX(50,100,800,undefined,index=>index*100)).toBe(0);
  });
});
