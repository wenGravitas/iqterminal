import {it,expect} from 'vitest';
import type {BinanceDepthBook} from '../src/feed/depth-book';
import {DirectWallBookProjection} from '../src/feed/order-wall-book-projection';
it('shares a bounded direct projection by epoch/sequence, updates only changed prices and never mutates prior outputs',()=>{
 const bids=new Map(Array.from({length:5001},(_,i)=>[80000-i*.1,1])),asks=new Map(Array.from({length:5001},(_,i)=>[80000.1+i*.1,2]));
 let visits=0;const book={lastUpdateId:7,snapshotBidBoundary:79000,snapshotAskBoundary:81000,visitLevels(callback:(side:'bid'|'ask',price:number,size:number)=>void){visits++;for(const[p,q]of bids)callback('bid',p,q);for(const[p,q]of asks)callback('ask',p,q);}} as unknown as BinanceDepthBook;
 const projection=new DirectWallBookProjection(),first=projection.project(book,1);
 expect(first.bidMap.size).toBe(5000);expect(first.askMap.size).toBe(5000);
 expect(first.bidMap.has(79500)).toBe(false);expect(first.askMap.has(80500.1)).toBe(false);
 expect(first.scope).toMatchObject({bidFloor:79500.1,askCeiling:80500,bidComplete:false,askComplete:false});
 expect(projection.project(book,1)).toBe(first);expect(visits).toBe(1);
 const changes=projection.diagnostics().changedPrices;bids.set(80000,5);(book as any).lastUpdateId=8;
 const second=projection.project(book,1);expect(second.bidMap.get(80000)).toBe(5);expect(first.bidMap.get(80000)).toBe(1);
 expect(projection.diagnostics().changedPrices-changes).toBe(1);
 expect(projection.project(book,2)).not.toBe(second);expect(visits).toBe(3);
 projection.clear();expect(projection.diagnostics().trackedLevels).toBe(0);
});
