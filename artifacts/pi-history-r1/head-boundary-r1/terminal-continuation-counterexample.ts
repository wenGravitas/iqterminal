/** Explicit deterministic correctness evidence; not a venue or latency test. */
import assert from 'node:assert/strict';
import {OrderWallsArchiveProjector} from '../../../src/shared/order-walls-projection.ts';
const settings={topLevels:8,minimumNotionalEnabled:false,minimumNotionalUsd:0,minDurationMs:0};
const from=1000,h=1010,to=1020;
const a={entryId:'base',side:'bid',price:'100.1',quantity:'1',notional:'100.1',rank:1,startedAt:1001,startCursor:1,startEpoch:1,startKnown:true};
const b={...a,entryId:'observed-later-time',price:'100.2',notional:'100.2',startedAt:1012,startCursor:2};
const side=(upserts:any[]=[],removals:any[]=[])=>({upserts,removals});
const patch=(cursor:number,at:number,bids=side())=>({cursor,at,epoch:1,kind:'patch',midpoint:'100',bids,asks:side()});
const inputs=[patch(1,1001,side([a])),patch(2,1012,side([b])),patch(3,1013,side([],[{entryId:b.entryId,side:'bid',price:b.price,at:1013,cursor:3,epoch:1,reason:'rank-exit',lastConfirmedAt:1013,lastConfirmedCursor:3}])),patch(4,h)];
const page=(end:number,headCursor:number,headAt:number,patches:any[],after=0,hasMore=false)=>({version:1,profile:{},from,to:end,watermark:headCursor,head:{cursor:headCursor,epoch:1,at:headAt},page:{after,nextAfter:hasMore?4:headCursor,hasMore,lastAt:patches.at(-1)?.at??headAt},patches,coverage:{availableFrom:from,requestedFrom:from,requestedTo:end,confirmedTo:headAt,status:'complete',partial:false,gaps:[]}} as any);
// Model the incumbent canonical SQL at<to predicate. The short presentation
// proves its past interval but terminal nextAfter=4 does not prove that every
// observation with cursor<=4 had an in-range timestamp.
const short=new OrderWallsArchiveProjector(settings,from,h+1);
short.applyPage(page(h+1,4,h,inputs.filter(p=>p.at<h+1)));
const continued=short.cloneForLiveTail(to),tail=page(to,5,1015,[patch(5,1015)],4);
continued.applyPage(tail);
const reference=new OrderWallsArchiveProjector(settings,from,to);
reference.applyPage(page(to,5,1015,inputs,0,true));reference.applyPage(tail);
assert.ok(reference.snapshot().some(s=>s.archiveEntryId===b.entryId));
assert.ok(!continued.snapshot().some(s=>s.archiveEntryId===b.entryId));
const quietShort=new OrderWallsArchiveProjector(settings,from,h+1);
quietShort.applyPage(page(h+1,4,h,[inputs[0]!]));
const quietContinued=quietShort.cloneForLiveTail(to);quietContinued.applyPage(tail);
const quietReference=new OrderWallsArchiveProjector(settings,from,to);
quietReference.applyPage({...page(to,5,1015,[inputs[0]!],0,true),page:{after:0,nextAfter:1,hasMore:true,lastAt:1001}});quietReference.applyPage({...tail,page:{...tail.page,after:1}});
const actual=quietContinued.snapshot()[0]!.meanUsd,expected=quietReference.snapshot()[0]!.meanUsd;
assert.notEqual(actual,expected,'A terminal quiet-tail integration boundary also changes exact floating accumulation');
console.log(JSON.stringify({scope:'Deterministic canonical at<to and incumbent shared-kernel counterexample, not live source or latency acceptance',fixedHead:h,requestedEnd:to,shortEnd:h+1,omittedFutureCursors:[2,3],missingEpisode:b.entryId,continued:continued.snapshot(),reference:reference.snapshot(),quietTailMean:{continued:actual,reference:expected},result:'terminal-continuation-is-not-an-exact-reference'}));
