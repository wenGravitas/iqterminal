import { type Candle, validCandle } from '../feed/protocol';
import { newer } from '../feed/reconcile';
import { BANDS, type Band, type ConditionsSettings, type Regime } from './settings';
export interface ConditionsPoint {
  t:number; atr:number|null; atrPercent:number|null; atrRank:number|null; bbw:number|null; bbwRank:number|null;
  er:number|null; chop:number|null; hv:Record<string,number>; score:number|null; regime:Regime|null; band:Band|null;
  warning:boolean; ready:boolean; count:number;
}
const finite=(v:number)=>Number.isFinite(v)?v:null;
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
export function trueRange(c:Candle,previous?:number){return previous===undefined?c.h-c.l:Math.max(c.h-c.l,Math.abs(c.h-previous),Math.abs(c.l-previous));}
export function efficiency(closes:readonly number[]){let path=0;for(let i=1;i<closes.length;i++)path+=Math.abs(closes[i]-closes[i-1]);return path?Math.min(1,Math.abs(closes.at(-1)!-closes[0])/path):0;}
export function choppiness(bars:readonly Candle[],trs:readonly number[]){const range=Math.max(...bars.map(b=>b.h))-Math.min(...bars.map(b=>b.l));return range<=0?100:clamp(100*Math.log10(trs.reduce((a,b)=>a+b,0)/range)/Math.log10(bars.length));}
export function standardDeviation(values:readonly number[]){const mean=values.reduce((a,b)=>a+b,0)/values.length;return Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length);}
export function bandWidth(closes:readonly number[],multiplier:number){const middle=closes.reduce((a,b)=>a+b,0)/closes.length;return middle?finite(100*2*multiplier*standardDeviation(closes)/Math.abs(middle)):null;}
export function historicalVolatility(closes:readonly number[],step:number){const returns:number[]=[];for(let i=1;i<closes.length;i++){if(closes[i]<=0||closes[i-1]<=0)return null;returns.push(Math.log(closes[i]/closes[i-1]));}return finite(100*standardDeviation(returns)*Math.sqrt(365*86400000/step));}
/** Strict rank against previous N observations. Binary search + insert/evict, never sort the window per update. */
export class RollingRank {
  private sorted:number[]=[];private fifo:number[]=[];
  constructor(readonly capacity:number){}
  private lower(v:number){let l=0,h=this.sorted.length;while(l<h){const m=(l+h)>>>1;if(this.sorted[m]<v)l=m+1;else h=m;}return l;}
  push(v:number){const rank=this.fifo.length===this.capacity?100*this.lower(v)/this.capacity:null;this.sorted.splice(this.lower(v),0,v);this.fifo.push(v);if(this.fifo.length>this.capacity){const old=this.fifo.shift()!;this.sorted.splice(this.lower(old),1);}return rank;}
}
export function suitability(rank:number,s:ConditionsSettings){if(rank<=s.suitabilityLow)return 0;if(rank<s.suitabilityGood)return 100*(rank-s.suitabilityLow)/(s.suitabilityGood-s.suitabilityLow);if(rank<=s.suitabilityHigh)return 100;return 100-(100-s.suitabilityExtreme)*(rank-s.suitabilityHigh)/(100-s.suitabilityHigh);}
export function composite(er:number,chop:number,rank:number,s:ConditionsSettings){const total=s.efficiencyWeight+s.volatilityWeight+s.choppinessWeight;let score=(100*er*s.efficiencyWeight+suitability(rank,s)*s.volatilityWeight+(100-chop)*s.choppinessWeight)/total;if(rank<s.minVolatility)score=Math.min(score,s.lowVolatilityCap);if(er<s.minEfficiency)score=Math.min(score,s.lowEfficiencyCap);return clamp(score);}
export function scoreBand(score:number,s:ConditionsSettings):Band{return BANDS[s.bands.filter(t=>score>=t).length];}
export class Confirmation<T> {
  value:T|null=null;private pending:T|null=null;private count=0;
  next(candidate:T,period:number){if(candidate===this.value){this.pending=null;this.count=0;return this.value;}if(candidate!==this.pending){this.pending=candidate;this.count=0;}if(++this.count>=period){this.value=candidate;this.pending=null;this.count=0;}return this.value;}
}
export function classifyRegime(atr:number,bbw:number,history:readonly ConditionsPoint[],previous:Regime|null,s:ConditionsSettings):Regime {
  if(atr>=s.extreme || previous==='EXTREME'&&atr>=s.extreme-s.regimeHysteresis)return 'EXTREME';
  const margin=previous==='COMPRESSION'?s.regimeHysteresis:0;
  if(atr<=s.compressionAtr+margin&&bbw<=s.compressionBbw+margin)return 'COMPRESSION';
  const compare=history.at(-s.expansionWindow);
  const exited=history.slice(-s.exitLookback).some(p=>p.atrRank!==null&&p.bbwRank!==null&&(p.atrRank<=s.compressionAtr&&atr>s.compressionAtr || p.bbwRank<=s.compressionBbw&&bbw>s.compressionBbw));
  if(compare?.atrRank!==null&&compare?.atrRank!==undefined&&compare.bbwRank!==null&&atr>compare.atrRank&&bbw>compare.bbwRank&&exited)return 'EXPANDING';
  return 'NORMAL';
}
/** Appends are incremental. Only explicit closed-bar changes/backfill replay bounded retained history. */
export class ConditionsEngine {
  readonly candles=new Map<number,Candle>();points:ConditionsPoint[]=[];processed=0;rebuilds=0;
  private window:Candle[]=[];private trs:number[]=[];private count=0;private atr:number|null=null;private atrSeed=0;
  private atrRanks:RollingRank;private bbwRanks:RollingRank;private regime=new Confirmation<Regime>();private band=new Confirmation<Band>();
  private recent:ConditionsPoint[]=[];private previous?:Candle;
  constructor(readonly settings:ConditionsSettings,readonly step:number){this.atrRanks=new RollingRank(settings.atrLookback);this.bbwRanks=new RollingRank(settings.bbwLookback);}
  private reset(){this.window=[];this.trs=[];this.count=0;this.atr=null;this.atrSeed=0;this.atrRanks=new RollingRank(this.settings.atrLookback);this.bbwRanks=new RollingRank(this.settings.bbwLookback);this.regime=new Confirmation();this.band=new Confirmation();this.recent=[];this.previous=undefined;}
  update(input:readonly Candle[]){
    const changed:Candle[]=[];let replay=false;const last=this.points.at(-1)?.t??-Infinity;
    for(const c of input){if(!validCandle(c)||!Number.isFinite(new Date(c.t).getTime()))continue;const old=this.candles.get(c.t);if(old&&(!newer(c,old)||old.closed&&!c.closed))continue;
      if(old&&['o','h','l','c','closed'].every(k=>old[k as keyof Candle]===c[k as keyof Candle])){this.candles.set(c.t,{...c});continue;}
      this.candles.set(c.t,{...c});if(c.closed){changed.push(c);if(c.t<=last)replay=true;}
    }
    if(!changed.length){
      if(this.candles.size>5128){const times=[...this.candles.keys()].sort((a,b)=>a-b);for(const t of times.slice(0,times.length-5000))this.candles.delete(t);}
      return {changed:[] as ConditionsPoint[],reset:false,corrected:false};
    }
    changed.sort((a,b)=>a.t-b.t);
    if(replay){this.rebuilds++;this.reset();this.points=[];for(const c of [...this.candles.values()].filter(c=>c.closed).sort((a,b)=>a.t-b.t))this.points.push(this.append(c));}
    else for(const c of changed)this.points.push(this.append(c));
    // Retain at most 5000 points; rolling state remains continuous when old display history is evicted.
    let trimmed=false;
    if(this.points.length>5000){trimmed=true;const removed=this.points.splice(0,Math.max(128,this.points.length-5000));for(const p of removed)this.candles.delete(p.t);}
    return {changed:replay?this.points:this.points.slice(-changed.length),reset:replay||trimmed,corrected:replay};
  }
  private append(c:Candle):ConditionsPoint {
    const s=this.settings;if(this.previous&&c.t-this.previous.t!==this.step)this.reset();
    const tr=trueRange(c,this.previous?.c);this.count++;this.processed++;
    if(this.atr===null){this.atrSeed+=(tr-this.atrSeed)/this.count;if(this.count===s.atrPeriod)this.atr=this.atrSeed;}else this.atr+=(tr-this.atr)/s.atrPeriod;
    this.window.push(c);this.trs.push(tr);const max=Math.max(s.bbwPeriod,s.erPeriod+1,s.chopPeriod,...s.hvPeriods.map(n=>n+1));if(this.window.length>max){this.window.shift();this.trs.shift();}
    const closes=this.window.map(b=>b.c),atrPercent=this.atr!==null&&c.c>0?finite(100*this.atr/c.c):null;
    const bbw=this.count>=s.bbwPeriod?bandWidth(closes.slice(-s.bbwPeriod),s.bbwMultiplier):null;
    const atrRank=atrPercent===null?null:this.atrRanks.push(atrPercent),bbwRank=bbw===null?null:this.bbwRanks.push(bbw);
    const er=this.count>s.erPeriod?efficiency(closes.slice(-s.erPeriod-1)):null;
    const chop=this.count>=s.chopPeriod?finite(choppiness(this.window.slice(-s.chopPeriod),this.trs.slice(-s.chopPeriod))):null;
    const hv:Record<string,number>={};if(s.hvEnabled)for(const n of s.hvPeriods)if(this.count>n){const v=historicalVolatility(closes.slice(-n-1),this.step);if(v!==null)hv[n]=v;}
    const score=atrRank!==null&&er!==null&&chop!==null?finite(composite(er,chop,atrRank,s)):null;
    let regime:Regime|null=null,band:Band|null=null;
    if(atrRank!==null&&bbwRank!==null&&this.recent.filter(p=>p.atrRank!==null&&p.bbwRank!==null).length>=Math.max(s.expansionWindow,s.exitLookback))regime=this.regime.next(classifyRegime(atrRank,bbwRank,this.recent,this.regime.value,s),s.regimeConfirmation);
    if(score!==null){let candidate=scoreBand(score,s);if(this.band.value){const index=BANDS.indexOf(this.band.value),lower=s.bands[index-1]??0,upper=s.bands[index]??100;if(score>=lower-s.scoreHysteresis&&score<upper+s.scoreHysteresis)candidate=this.band.value;}band=this.band.next(candidate,s.scoreConfirmation);}
    const p:ConditionsPoint={t:c.t,atr:this.atr===null?null:finite(this.atr),atrPercent,atrRank,bbw,bbwRank,er,chop,hv,score,regime,band,warning:atrRank!==null&&atrRank>s.warningPercentile,ready:regime!==null&&band!==null,count:this.count};
    this.recent.push(p);if(this.recent.length>Math.max(s.expansionWindow,s.exitLookback)+1)this.recent.shift();this.previous=c;return p;
  }
}
