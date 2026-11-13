import {createHash} from 'node:crypto';
import {OrderWallsArchiveProjector} from '../../src/feed/order-walls-archive';
import {orderWallsSettings} from '../../src/feed/order-walls';
import {WALL_PROJECTION_CORE_SHA256} from '../../src/shared/order-walls-projection-version';
export const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const from=1800000000000,to=from+30*3600000,settings=orderWallsSettings({enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10});
export const normalized={topLevels:8,minimumNotionalEnabled:false,minimumNotionalUsd:0,minDurationMs:0};
export const profile:any={id:'binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1',version:1,market:'spot',venue:'binance',instrument:'binance:spot:BTCUSDT',feed:'binance:spot:BTCUSDT:spot-diff-depth',aggregation:'native',bandPercent:10,midpointBasis:'best-observed-bid-ask',topN:10,algorithmVersion:1,schemaVersion:1,confirmationMs:0,selectionTopN:10,minimumNotionalUsd:null,exactDerivations:{bandPercent:[10],topNMax:10,minimumNotional:true,confirmation:true}};
export const oldHead={cursor:30,epoch:2,at:to+1000},head={cursor:40,epoch:3,at:to+2000};
export function fixture(split=false,end=to,start=from){
 const from=start,to=end,oldHead={cursor:30,epoch:2,at:to+1000},head={cursor:40,epoch:3,at:to+2000};
 const coverage:any={availableFrom:from-1000,requestedFrom:from,requestedTo:to,confirmedTo:to,gaps:[{at:from+3000,reason:'Observed disconnect'}],partial:true,status:'partial'};
 const candidate=(id:string)=>({entryId:id,side:'bid',price:'100.00000001',quantity:'2.000000000001',notional:'200.0000000001',rank:1,startedAt:from-1000,startCursor:1,startEpoch:1,startKnown:true});
 const page:any={version:1,profile,market:'spot',instrument:profile.instrument,feed:profile.feed,from,to,watermark:30,head:oldHead,
  page:{after:1,nextAfter:30,hasMore:false,lastAt:to,limit:4096,sameMillisecondClosed:true},seed:{at:from-1,cursor:1,epoch:1,midpoint:'100',bids:[candidate('A')],asks:[]},
  patches:[{kind:'patch',cursor:2,epoch:1,at:from+1000,midpoint:'100',bids:{upserts:[{...candidate('A'),quantity:'3.000000000003',notional:'300.0000000003'}],removals:[]},asks:{upserts:[],removals:[]}},
   {kind:'gap',cursor:3,epoch:2,at:from+3000,midpoint:'100',reason:'Observed disconnect',bids:{upserts:[],removals:[]},asks:{upserts:[],removals:[]}},
   {kind:'patch',cursor:4,epoch:2,at:from+4000,midpoint:'100',bids:{upserts:[{...candidate('B'),startCursor:4,startEpoch:2,startedAt:from+4000}],removals:[]},asks:{upserts:[],removals:[]}}],coverage};
 const original=new OrderWallsArchiveProjector(settings,from,to);original.applyPage(page);
 const full=original.checkpoint(),closed=original.takeClosedSegments(),active=original.checkpoint();
 const groups=closed.map(item=>{
  const base={order:full.segments.findIndex(s=>s.id===item.segment.id),totalRuns:item.segment.valueRuns.length};
  if(!split||item.segment.valueRuns.length<2)return [{...item,...base,offset:0}];
  return [0,1].map((offset,i)=>({...base,offset,segment:{...item.segment,valueRuns:i===0?item.segment.valueRuns.slice(0,1):item.segment.valueRuns.slice(1)},valueRunOrder:i===0?item.valueRunOrder.slice(0,1):item.valueRunOrder.slice(1)}));
 });
 const texts=groups.flatMap(group=>group.map(row=>JSON.stringify([row]))),parts=texts.map(text=>({hash:hash(text),bytes:Buffer.byteLength(text),records:1}));let index=0;
 const coordinates=groups.map(group=>group.map(()=>[index++,0]));
 const sourceKey='b'.repeat(64),sourceToken='a'.repeat(64),key=hash(JSON.stringify({version:2,sourceKey,core:WALL_PROJECTION_CORE_SHA256,settings:normalized}));
 const manifest:any={version:2,key,sourceKey,sourceToken,core:WALL_PROJECTION_CORE_SHA256,complete:true,settings:normalized,parts,closed:coordinates,active,activeOrder:active.segments.map(s=>full.segments.findIndex(v=>v.id===s.id)),coverage,profile};
 const source:any={version:1,kind:'wall-source-sha256-xor-v1',market:'spot',profile:profile.id,from,to,token:sourceToken,eligible:true,watermark:40,head};
 const canonicalText=JSON.stringify(page),canonicalPart={index:0,hash:hash(canonicalText),canonicalHash:hash(canonicalText),bytes:Buffer.byteLength(canonicalText),after:1,nextAfter:30};
 const canonical:any={version:5,key:sourceKey,complete:true,watermark:30,head:oldHead,after:30,request:{market:'spot',profile:profile.id,from,to,watermark:30,sourceRevision:hash(JSON.stringify([canonicalPart.canonicalHash]))},parts:[canonicalPart],sourceProof:{...source,watermark:30,head:oldHead}};
 const advertised={manifest,delivery:{version:1,maxParts:32,maxDecodedBytes:8*1024*1024}};
 return {manifest,texts,source,canonical,advertised,full,page,context:{restoreProjector:true,sourceKey,sourceToken,watermark:30,epoch:2,from,to,profile:profile.id,market:'spot' as const,settings}};
}

/** Real pinned-source identity used by the negotiated projection response. */
export function projectionOnlyFixture(split=true,end=to,start=from){
 const f=fixture(split,end,start),proof=f.canonical.sourceProof;
 const key=hash(JSON.stringify({version:5,market:proof.market,profile:proof.profile,from:proof.from,to:proof.to,watermark:proof.watermark,sourceToken:proof.token}));
 f.canonical.key=key;f.context.sourceKey=key;f.manifest.sourceKey=key;
 f.manifest.key=hash(JSON.stringify({version:2,sourceKey:key,core:WALL_PROJECTION_CORE_SHA256,settings:normalized}));
 const discovery={state:'ready',representation:'projection-v1',source:f.source,
  sourceSnapshot:{version:1,kind:'wall-projection-source-v1',key,request:{market:proof.market,profile:proof.profile,from:proof.from,to:proof.to},sourceProof:proof,watermark:proof.watermark,head:proof.head},projection:f.advertised};
 return {...f,discovery};
}
