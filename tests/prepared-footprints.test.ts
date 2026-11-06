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

test('24h of hourly tiles remains partial until every chunk validates, nearest history first', async () => {
 const hour=3600000,from=1800000000000,to=from+24*hour,requests:Array<{from:number;to:number}>=[],events:any[]=[];
 let release!:()=>void; const held=new Promise<void>(resolve=>release=resolve);
 const request:any=async(url:string)=>{
  const q=new URL(url,'http://localhost').searchParams,start=Number(q.get('from')),end=Number(q.get('to'));
  requests.push({from:start,to:end}); if(start===from)await held;
  const tiles=[];for(let at=start;at<end;at+=hour)tiles.push({from:at,revision:1,bar:{time:at/1000},coverage:{from:at,to:at+hour,complete:true,gaps:[]}});
  return new Response(JSON.stringify({version:1,feed,state:'ready',tiles}));
 };
 const client=new PreparedFootprints(request,new Cache());
 const work=client.load(from,to,'1h',25,new AbortController().signal,(bars,complete,validated,_analysis,progress)=>events.push({bars,complete,validated,progress}));
 await new Promise(resolve=>setTimeout(resolve,30));
 expect(requests[0]).toEqual({from:to-4*hour,to});expect(requests.every(r=>r.to-r.from<=4*hour)).toBe(true);
 expect(events.some(e=>e.bars.length>0)).toBe(true);expect(events.every(e=>!e.complete)).toBe(true);
 release();await work;
 expect(events.at(-1).bars).toHaveLength(24);expect(events.at(-1).complete).toBe(true);
 expect(events.at(-1).progress).toMatchObject({requestedSlots:24,loadedSlots:24,validatedSlots:24});
});

test('known empty, source gaps and failed sibling chunks retain precise independent coverage',async()=>{
 const hour=3600000,from=1800000000000,to=from+8*hour,events:any[]=[];
 const request:any=async(url:string)=>{
  const q=new URL(url,'http://localhost').searchParams,start=Number(q.get('from'));
  if(start===from)return new Response(JSON.stringify({error:'retryable source read'}),{status:503});
  return new Response(JSON.stringify({version:1,feed,state:'ready',tiles:Array.from({length:4},(_,i)=>({from:start+i*hour,revision:1,bar:i===0?null:{time:(start+i*hour)/1000},coverage:{from:start+i*hour,to:start+(i+1)*hour,complete:i!==1,gaps:i===1?[{from:start+hour,to:start+hour+1000,reason:'not recorded'}]:[]}}))}));
 };
 const client=new PreparedFootprints(request,new Cache());
 await expect(client.load(from,to,'1h',25,new AbortController().signal,(bars,complete,_validated,_analysis,progress)=>events.push({bars,complete,progress}))).rejects.toThrow('retryable source read');
 expect(events.at(-1).bars).toHaveLength(3);expect(events.every(e=>!e.complete)).toBe(true);
 expect(events.at(-1).progress.slots.filter((s:any)=>s.state==='empty')).toHaveLength(1);
 expect(events.at(-1).progress.slots.filter((s:any)=>s.state==='gapped')).toHaveLength(1);
 expect(events.at(-1).progress.validatedSlots).toBe(4);
});


test('warm revision validation preserves a known-empty covered slot without requiring a bar summary',async()=>{
 const cache=new Cache(),events:any[]=[];let warm=false;
 const request:any=async()=>new Response(JSON.stringify({version:1,feed,state:'ready',tiles:[{from:900000,revision:1,...(warm?{}:{bar:null,coverage:{from:900000,to:1200000,complete:true,gaps:[]}})}]}));
 const client=new PreparedFootprints(request,cache),signal=new AbortController().signal;
 await client.load(900000,1200000,'5m',25,signal,()=>{});warm=true;
 await client.load(900000,1200000,'5m',25,signal,(bars,complete,validated,_analysis,progress)=>events.push({bars,complete,validated,progress}));
 expect(events.at(-1)).toMatchObject({bars:[],complete:true,validated:true,progress:{validatedSlots:1,slots:[{state:'empty',validated:true}]}});
});

test('a pending canonical revision retains painted bars but invalidates only affected slots and analysis',async()=>{
 const from=1800000000000,step=3600000,events:any[]=[];let call=0;
 const tiles=(revision:number)=>[0,1].map(i=>({from:from+i*step,revision,bar:{time:(from+i*step)/1000,delta:revision,quoteDelta:revision*80000,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'observed',gapBefore:false},coverage:{from:from+i*step,to:from+(i+1)*step,complete:true,gaps:[]}}));
 const client=new PreparedFootprints((async()=>{call++;return new Response(JSON.stringify({version:1,feed,state:call===1?'building':'ready',revisionState:call===1?'pending':'ready',revisionRanges:call===1?[{from,to:from+step,state:'building'}]:[],tiles:tiles(call)}));}) as any,new Cache());
 await client.load(from,from+2*step,'1h',25,new AbortController().signal,(bars,complete,_validated,analysis,progress)=>events.push({bars,complete,analysis,progress}));
 const pending=events[0];expect(pending.bars).toHaveLength(2);expect(pending.complete).toBe(false);expect(pending.progress.validatedSlots).toBe(1);
 expect(pending.progress.slots).toMatchObject([{state:'building',validated:false},{state:'ready',validated:true}]);
 expect(pending.analysis.summaries.map((s:any)=>s.coverageEvidence.validated)).toEqual([false,true]);
 expect(events.at(-1)).toMatchObject({complete:true,progress:{validatedSlots:2}});expect(events.at(-1).bars.map((b:any)=>b.delta)).toEqual([2,2]);
});

test('failed canonical revision retains cached good bars with unavailable unvalidated coverage',async()=>{
 const from=1800000000000,step=3600000,cache=new Cache();let failed=false;const events:any[]=[];
 const request:any=async()=>new Response(JSON.stringify({version:1,feed,state:failed?'unavailable':'ready',revisionState:failed?'unavailable':'ready',revisionRanges:failed?[{from,to:from+step,state:'unavailable'}]:[],error:failed?'repair source unavailable':undefined,tiles:[{from,revision:1,bar:{time:from/1000},coverage:{from,to:from+step,complete:true,gaps:[]}}]}));
 const client=new PreparedFootprints(request,cache),signal=new AbortController().signal;
 await client.load(from,from+step,'1h',25,signal,()=>{});failed=true;
 await expect(client.load(from,from+step,'1h',25,signal,(bars,complete,_validated,_analysis,progress)=>events.push({bars,complete,progress}))).rejects.toThrow('repair source unavailable');
 expect(events.at(-1)).toMatchObject({bars:[{time:from/1000,revision:1}],complete:false,progress:{loadedSlots:1,validatedSlots:0,slots:[{state:'unavailable',validated:false}]}});
});
