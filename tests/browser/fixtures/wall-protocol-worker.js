// Explicit diagnostic entry only. Real production worker/message routing with
// controlled HTTP source responses; never an application connectivity fallback.
let config,hold=false,held=[];
self.addEventListener('message',async({data})=>{
 if(data.type==='fixture-wall-hold'){hold=data.value;if(!hold)for(const resolve of held.splice(0))resolve();return;}
 if(data.type!=='fixture-wall-config'||config)return;
 config=data;
 const profile={id:'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1',market:'perpetual',instrument:'binance:perpetual:BTCUSDT',feed:'binance:perpetual:BTCUSDT:usd-m-standard-diff-depth-rpi-excluded',version:1,venue:'binance',aggregation:'native',bandPercent:10,midpointBasis:'best-observed-bid-ask',topN:10,algorithmVersion:1,schemaVersion:1,confirmationMs:0,selectionTopN:10,minimumNotionalUsd:null,exactDerivations:{bandPercent:[10],topNMax:10,minimumNotional:true,confirmation:true,confirmationCrossings:false}};
 const wall=(at,cursor)=>({entryId:'worker-wall',side:'bid',price:'100.00000001',quantity:String(cursor),notional:String(cursor*100.00000001),rank:1,startedAt:at,startCursor:0,startEpoch:1,startKnown:true});
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input),self.location.href),after=Number(url.searchParams.get('after')),from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to'));
  self.postMessage({type:'fixture-wall-request',path:url.pathname,from,to,after});
  if(url.pathname.endsWith('/current')){
   const cursor=after?after+1:100,at=Date.now(),candidate=wall(config.to,cursor);
   return Response.json({version:1,profile,market:profile.market,instrument:profile.instrument,feed:profile.feed,watermark:cursor,head:{cursor,at,epoch:1,valid:true,midpoint:'100'},...(after?{}:{state:{bids:[candidate],asks:[]}}),page:{after,nextAfter:cursor,hasMore:false,lastAt:at,limit:256,sameMillisecondClosed:true},patches:after?[{kind:'patch',cursor,at,epoch:1,midpoint:'100',bids:{upserts:[candidate],removals:[]},asks:{upserts:[],removals:[]}}]:[],coverage:{availableFrom:config.from-86400000,confirmedTo:at,status:'complete',gaps:[]},profileStatus:'ready'});
  }
  if(!url.pathname.endsWith('/archive'))throw Error('Unexpected controlled worker route '+url.pathname);
  if(hold)await new Promise((resolve,reject)=>{held.push(resolve);init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
  return Response.json({version:1,profile,market:profile.market,instrument:profile.instrument,feed:profile.feed,from,to,watermark:20,head:{cursor:20,at:to-1,epoch:1},seed:{at:from,cursor:0,epoch:1,midpoint:'100',bids:[wall(Math.min(config.from,from)-1000,2)],asks:[],bookScope:{bidComplete:true,askComplete:true}},page:{after:0,nextAfter:20,hasMore:false,lastAt:to-1,limit:256,sameMillisecondClosed:true},patches:[],coverage:{availableFrom:Math.min(config.from,from)-86400000,requestedFrom:from,requestedTo:to,confirmedTo:to-1,gaps:[],partial:false,status:'complete',bookScope:{bidComplete:true,askComplete:true}},profileStatus:'ready'});
 };
 if(import.meta.env.VITE_DATA_MODE!=='staging'||import.meta.env.VITE_HISTORY_TILES==='1')throw Error('Protocol fixture requires explicit staging build with history tiles disabled');
 await import('../../../src/feed/worker.ts');
 self.postMessage({type:'fixture-wall-ready'});
});
