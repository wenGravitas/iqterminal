import {test,expect} from 'vitest';
import {PreparedFootprints} from '../src/feed/prepared-footprints';
class Cache {values=new Map<string,any>();async getMany(keys:string[]){return new Map(keys.filter(k=>this.values.has(k)).map(k=>[k,this.values.get(k)]));}async putMany(entries:{key:string;value:any}[]){for(const x of entries)this.values.set(x.key,x.value);}}
const feed='binance:perpetual:BTCUSDT:aggregate-trade';
test('closed footprint revisions replace rather than add and a correction can remove an empty bar',async()=>{const cache=new Cache();let revision=1,bar:any={time:900};const request:any=async()=>new Response(JSON.stringify({version:1,feed,state:'ready',tiles:[{from:900000,revision,bar}]}));const client=new PreparedFootprints(request,cache),signal=new AbortController().signal,events:any[]=[];await client.load(900000,1200000,'5m',10,signal,(bars,complete,validated)=>events.push({bars,complete,validated}));expect(events.at(-1)).toEqual({bars:[{time:900,revision:1}],complete:true,validated:true});revision=2;bar=null;events.length=0;await client.load(900000,1200000,'5m',10,signal,(bars,complete,validated)=>events.push({bars,complete,validated}));expect(events[0].validated).toBe(false);expect(events.at(-1)).toEqual({bars:[],complete:true,validated:true});});
test('unavailable materialization produces an explicit error rather than permanent loading',async()=>{const client=new PreparedFootprints((async()=>new Response(JSON.stringify({version:1,feed,state:'unavailable',tiles:[]}))) as any,new Cache());await expect(client.load(900000,1200000,'5m',10,new AbortController().signal,()=>{})).rejects.toThrow('unavailable');});
test('cancelled instrument generations cannot publish a late historical response',async()=>{let resolve!:(r:Response)=>void;const request:any=()=>new Promise<Response>(r=>resolve=r);const client=new PreparedFootprints(request,new Cache()),abort=new AbortController(),published:any[]=[];const work=client.load(900000,1200000,'5m',10,abort.signal,(...x)=>published.push(x));await new Promise(r=>setTimeout(r,0));abort.abort();await expect(work).rejects.toMatchObject({name:'AbortError'});resolve(new Response(JSON.stringify({version:1,feed,state:'ready',tiles:[]})));await new Promise(r=>setTimeout(r,0));expect(published).toEqual([]);});

test('Spot footprint history selects the Spot feed and keeps its tiles in a separate cache namespace',async()=>{
 const calls:string[]=[],cache=new Cache(),spotFeed='binance:spot:BTCUSDT:aggregate-trade';
 const request:any=async(url:string)=>{calls.push(url);return new Response(JSON.stringify({version:1,feed:spotFeed,state:'ready',tiles:[{from:900000,revision:1,bar:{time:900,revision:1,source:'binance-spot-aggtrade'}}]}));};
 const client=new PreparedFootprints(request,cache),signal=new AbortController().signal;
 await client.load(900000,1200000,'5m',10,signal,()=>{},'spot');
 expect(new URL(calls[0]!, 'http://localhost').searchParams.get('market')).toBe('spot');
 expect([...cache.values.keys()].some(key=>key.startsWith('footprint:binance:spot:BTCUSDT:aggregate-trade:'))).toBe(true);
});

test('5m lookback warmup covers more than four hours in lower-priority summary-only chunks',async()=>{
 const step=300_000,epoch=1_800_000_000_000,visibleFrom=epoch+26*3_600_000,visibleTo=epoch+30*3_600_000;
 const candidateFrom=epoch+25*3_600_000,analysisFrom=candidateFrom-51*step;
 const calls:Array<{from:number;to:number;known:string}> = [],cache=new Cache(),published:any[]=[];
 const request:any=async(url:string)=>{
  const query=new URL(url,'http://localhost').searchParams,from=Number(query.get('from')),to=Number(query.get('to'));
  calls.push({from,to,known:query.get('known')??''});
  const tiles=[];
  for(let at=from;at<to;at+=step){
   const time=at/1000;
   tiles.push({from:at,revision:1,bar:{time,revision:1,delta:20,quoteDelta:200,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'observed',gapBefore:false},
     coverage:{from:at,to:at+step,complete:true,gaps:[]}});
  }
  return new Response(JSON.stringify({version:1,feed,state:'ready',tiles}));
 };
 const client=new PreparedFootprints(request,cache);
 await client.load(visibleFrom,visibleTo,'5m',25,new AbortController().signal,
  (bars,complete,validated,analysis)=>published.push({bars,complete,validated,analysis}),'perpetual',analysisFrom);
 expect(calls).toEqual([
  {from:visibleFrom,to:visibleTo,known:''},
  {from:analysisFrom,to:analysisFrom+4*3_600_000,known:''},
  {from:analysisFrom+4*3_600_000,to:visibleFrom,known:''},
 ]);
 expect(calls.every(call=>call.to-call.from<=14_400_000)).toBe(true);
 expect(published.at(-1).analysis.summaries).toHaveLength(111);
 expect(Math.min(...published.at(-1).analysis.summaries.map((summary:any)=>summary.time))).toBe(analysisFrom/1000);
 expect(published.at(-1).analysis.summaries.find((summary:any)=>summary.time===analysisFrom/1000)).toMatchObject({revisionSource:'prepared-content-hash',coverageEvidence:{validated:true}});
 expect(cache.values.size).toBe(48); // Full dense tiles are retained only for the four-hour visible request.
});
