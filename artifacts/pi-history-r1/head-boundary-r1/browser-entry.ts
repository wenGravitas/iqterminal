import {loadOrderWallsArchive,OrderWallsArchiveProjector} from '../../../src/feed/order-walls-archive';
import {preparedWallReader} from '../../../src/feed/prepared-wall-history';
import {orderWallsSettings} from '../../../src/feed/order-walls';
export async function run(){
 const h=1800000060000,from=h-60000,to=h+1,head={cursor:3,epoch:1,at:h};
 const profile={id:'binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1',version:1,market:'spot',venue:'binance',instrument:'binance:spot:BTCUSDT',feed:'binance:spot:BTCUSDT:spot-diff-depth',aggregation:'native',bandPercent:10,midpointBasis:'best-observed-bid-ask',topN:10,algorithmVersion:1,schemaVersion:1,confirmationMs:0,selectionTopN:10,minimumNotionalUsd:null,exactDerivations:{bandPercent:[10],topNMax:10,minimumNotional:true,confirmation:true,confirmationCrossings:false}};
 const request={market:'spot' as const,profile:profile.id,from,to},settings=orderWallsSettings({enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10});
 const candidate={entryId:'exact-head-wall',side:'bid',price:'100',quantity:'1',notional:'100',rank:1,startedAt:h-5000,startCursor:1,startEpoch:1,startKnown:true};
 const page={version:1,profile,market:'spot',instrument:profile.instrument,feed:profile.feed,from,to,watermark:3,head,page:{after:0,nextAfter:3,hasMore:false,lastAt:h,limit:4096,sameMillisecondClosed:true,observations:3},
  seed:{at:from-1,cursor:0,epoch:1,midpoint:'100',bids:[],asks:[]},
  patches:[1,2,3].map(cursor=>({cursor,epoch:1,at:cursor===1?h-5000:h,kind:'patch',midpoint:'100',bids:{upserts:[{...candidate,quantity:String(cursor),notional:String(cursor*100)}],removals:[]},asks:{upserts:[],removals:[]}})),
  coverage:{availableFrom:from-1000,requestedFrom:from,requestedTo:to,confirmedTo:h,status:'partial',partial:true,gaps:[{at:from+1000,reason:'Explicit fixture gap'}]}};
 const hash=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const text=JSON.stringify(page),digest=await hash(text),source={...request,version:1,kind:'wall-source-sha256-xor-v1',token:'a'.repeat(64),eligible:true,watermark:3,head};
 const manifest={version:5,key:'b'.repeat(64),complete:true,request:{...request,watermark:3,sourceRevision:await hash(JSON.stringify([digest]))},watermark:3,head,after:3,sourceProof:source,parts:[{index:0,hash:digest,canonicalHash:digest,bytes:new TextEncoder().encode(text).length,after:0,nextAfter:3,encoding:'json-gzip-v1'}]};
 const calls:string[]=[],updates:any[]=[];
 const fetcher:typeof fetch=async(input)=>{const path=new URL(String(input),location.href).pathname;calls.push(path);if(path.endsWith('/discover'))return new Response(JSON.stringify({state:'ready',source,manifest}));if(path.endsWith('/source'))return new Response(JSON.stringify(source));if(path.endsWith('/part'))return new Response(text);throw Error('Unexpected protocol route '+path);};
 const result=await loadOrderWallsArchive({request:{market:'binance-spot',from,to,settings,watermark:3,head},fetcher,onUpdate:update=>updates.push({kind:update.kind,complete:update.status.archive?.requestComplete})});
 const reference=new OrderWallsArchiveProjector(settings,from,to);reference.applyPage(page as any);
 if(JSON.stringify(result.segments)!==JSON.stringify(reference.snapshot()))throw Error('Financial reference mismatch');
 const last=result.segments.find(s=>s.archiveEntryId===candidate.entryId)?.valueRuns.at(-1);
 if(last?.at!==h||last.quantityExact!=='3'||result.status.archive?.confirmedTo!==h||result.status.archive?.requestComplete!==true||result.status.archive?.rangeComplete!==false||!result.status.archive.gaps.length)throw Error('Head, same-time quantity or explicit gap mismatch');
 const rejected=await preparedWallReader({...request,watermark:3,head:{...head,at:h-1}},fetcher,new AbortController().signal);
 if(rejected!==null)throw Error('Accepted a head one millisecond behind');
 return {scope:'Explicit deterministic headless Chromium/WebCrypto prepared-history protocol and shared-kernel reference check; not live venue, chart painting or latency acceptance',head,requested:{from,to},lastValue:last,coverage:result.status.archive,updates,calls,result:'pass'};
}
