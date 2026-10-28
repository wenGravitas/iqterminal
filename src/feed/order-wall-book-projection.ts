import type {BinanceDepthBook} from './depth-book';
import {OrderWallRankIndex} from './order-wall-rank';

/** One bounded nearest-price projection shared by direct-mode consumers.
 * The incumbent source exposes full book visits, so visits remain linear.
 * Only changed prices update the index; selection never sorts the whole book. */
export class DirectWallBookProjection {
 private bids=new Map<number,number>();private asks=new Map<number,number>();
 private bidIndex=new OrderWallRankIndex();private askIndex=new OrderWallRankIndex();
 private cached?:{book:BinanceDepthBook;epoch:number;sequence:number;value:ReturnType<DirectWallBookProjection['build']>};
 readonly metrics={projections:0,cacheHits:0,changedPrices:0};
 clear(){this.bids.clear();this.asks.clear();this.bidIndex.clear();this.askIndex.clear();this.cached=undefined;}
 project(book:BinanceDepthBook,epoch:number){
  const sequence=book.lastUpdateId;
  if(Number.isSafeInteger(sequence)&&this.cached?.book===book&&this.cached.epoch===epoch&&this.cached.sequence===sequence){this.metrics.cacheHits++;return this.cached.value;}
  if(this.cached&&(this.cached.book!==book||this.cached.epoch!==epoch))this.clear();
  const value=this.build(book);this.cached={book,epoch,sequence,value};return value;
 }
 private build(book:BinanceDepthBook){
  const bids=new Map<number,number>(),asks=new Map<number,number>();
  book.visitLevels((side,price,size)=>(side==='bid'?bids:asks).set(price,size));
  for(const[before,next,index]of[[this.bids,bids,this.bidIndex],[this.asks,asks,this.askIndex]] as const){
   for(const[p,q]of next)if(before.get(p)!==q){index.set(p,p*q,q);this.metrics.changedPrices++;}
   for(const p of before.keys())if(!next.has(p)){index.set(p,0);this.metrics.changedPrices++;}
  }
  this.bids=bids;this.asks=asks;this.metrics.projections++;
  const bidRows=this.bidIndex.levels(5000,true),askRows=this.askIndex.levels(5000);
  const bidFloor=bids.size>5000?Math.max(book.snapshotBidBoundary??-Infinity,bidRows.at(-1)?.[0]??-Infinity):book.snapshotBidBoundary;
  const askCeiling=asks.size>5000?Math.min(book.snapshotAskBoundary??Infinity,askRows.at(-1)?.[0]??Infinity):book.snapshotAskBoundary;
  return {bidMap:new Map(bidRows),askMap:new Map(askRows),bids:bidRows,asks:askRows,
   scope:{maxLevelsPerSide:5000,bidComplete:false,askComplete:false,
    ...(bidFloor!==null&&Number.isFinite(bidFloor)?{bidFloor}:{}),...(askCeiling!==null&&Number.isFinite(askCeiling)?{askCeiling}:{})}};
 }
 diagnostics(){return {...this.metrics,trackedLevels:this.bids.size+this.asks.size};}
}
