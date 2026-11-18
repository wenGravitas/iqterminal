import {depthMatrixSourceDefinition,matrixBucketIndex,type DepthMatrixColumn,type MatrixCoverage,type MatrixCumulativeValue,type MatrixReferenceAnchor} from '../feed/depth-matrix';
export type AmountCoverage='exact'|'lower-bound'|'unknown';
export interface BookAmount {quantity:number;notional:number;coverage:AmountCoverage}
export interface BookContribution {source:string;quantity:number;notional:number;coverage:MatrixCoverage;live:boolean;cursor:number;epoch:number|string|null;at:number;ageMs:number|null;cumulative:MatrixCumulativeValue|null}
export interface BookSide extends BookAmount {contributions:BookContribution[];cumulative:BookAmount|null}
export interface BookRow {index:string;low:string;high:string;bid:BookSide;ask:BookSide}
export interface OrderBookProjection {width:string;anchor?:MatrixReferenceAnchor;sources:string[];liveSources:string[];rows:BookRow[];at:number}
export const knownCoverage=(coverage:MatrixCoverage)=>coverage==='observed'||coverage==='known-empty';
const admissible=(coverage:MatrixCoverage)=>knownCoverage(coverage)||coverage==='partial';
/** No implicit atomic cross-source head: every contribution carries its own fence.
 * Only live, fresh, covered source amounts enter a combined number. */
export function projectOrderBook(columns:readonly DepthMatrixColumn[],selected:readonly string[],width:string,anchor:MatrixReferenceAnchor|undefined,now:number):OrderBookProjection {
 const sources=[...new Set(selected)].slice(0,8),bySource=new Map(columns.map(c=>[c.source,c]));
 const live=(c:DepthMatrixColumn|undefined)=>!!c&&!!depthMatrixSourceDefinition(c.source)?.supported&&c.state==='live'&&c.lastAt>0&&now-c.lastAt<=5000&&now-c.lastAt>=-1000;
 const grids=new Map(sources.map(id=>[id,new Map((bySource.get(id)?.rows??[]).map(r=>[r.index,r]))]));
 const cumulative=new Map(sources.map(id=>{
  const c=bySource.get(id),p=c?.cumulative;
  const valid=!!p&&p.version===1&&!!anchor&&p.reference===anchor.price&&p.referenceIndex===matrixBucketIndex(anchor.price,width)&&p.cursor===c?.cursor&&p.epoch===c.epoch&&p.at===c.lastAt;
  return [id,new Map(valid?p.rows.map(r=>[r.index,r]):[])];
 }));
 const rows=(sources.map(s=>bySource.get(s)).find(c=>c?.rows.length)?.rows??[]).slice(0,2000);
 const origin=anchor?matrixBucketIndex(anchor.price,width):null;
 const projected=rows.map(row=>{
  const side=(side:'bid'|'ask'):BookSide=>{
   const contributions=sources.map(source=>{
    const c=bySource.get(source),r=grids.get(source)?.get(row.index),p=cumulative.get(source)?.get(row.index);
    return {source,quantity:r?.[side==='bid'?'bidQuantity':'askQuantity']??0,notional:r?.[side==='bid'?'bidNotional':'askNotional']??0,
     coverage:r?.[side==='bid'?'bidCoverage':'askCoverage']??'unknown',live:live(c),cursor:c?.cursor??0,epoch:c?.epoch??null,at:c?.lastAt??0,
     ageMs:c?.lastAt?Math.max(0,now-c.lastAt):null,cumulative:p?.[side]??null};
   });
   const active=contributions.filter(c=>c.live&&admissible(c.coverage));
   const amount:BookAmount={quantity:active.reduce((s,c)=>s+c.quantity,0),notional:active.reduce((s,c)=>s+c.notional,0),
    coverage:sources.length>0&&contributions.every(c=>c.live&&knownCoverage(c.coverage))?'exact':active.length?'lower-bound':'unknown'};
   const hasOrigin=origin!==null&&(side==='bid'?BigInt(row.index)<=BigInt(origin):BigInt(row.index)>=BigInt(origin));
   const valid=contributions.filter(c=>c.live&&c.cumulative&&(c.cumulative.coverage==='exact'||c.cumulative.coverage==='lower-bound'));
   const cum:BookAmount|null=hasOrigin?{quantity:valid.reduce((s,c)=>s+c.cumulative!.quantity,0),notional:valid.reduce((s,c)=>s+c.cumulative!.notional,0),
    coverage:sources.length>0&&contributions.every(c=>c.live&&c.cumulative?.coverage==='exact')?'exact':valid.length?'lower-bound':'unknown'}:null;
   return {...amount,contributions,cumulative:cum};
  };
  return {index:row.index,low:row.low,high:row.high,bid:side('bid'),ask:side('ask')};
 });
 return {width,...(anchor?{anchor}:{}),sources,liveSources:sources.filter(s=>live(bySource.get(s))),rows:projected,at:now};
}
/** The denominator is selected live books within these displayed rows, both sides
 * independently even when source midpoints diverge. Unknown is never zero %. */
export function displayedBalance(rows:readonly BookRow[]){
 const bid=rows.reduce((s,r)=>s+r.bid.notional,0),ask=rows.reduce((s,r)=>s+r.ask.notional,0);
 const complete=rows.length>0&&rows.every(r=>r.bid.coverage==='exact'&&r.ask.coverage==='exact');
 const available=rows.some(r=>r.bid.coverage!=='unknown')&&rows.some(r=>r.ask.coverage!=='unknown');
 return {bid,ask,complete,available,bidShare:available&&bid+ask>0?bid/(bid+ask):null};
}
