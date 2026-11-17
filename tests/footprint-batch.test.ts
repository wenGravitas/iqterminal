import {test,expect,vi} from 'vitest';
import {decodeFootprintBatch,readFootprintBatch,footprintBatchMember,FootprintBatchUnsupported} from '../src/feed/footprint-batch';
import {PreparedFootprints} from '../src/feed/prepared-footprints';
const hour=3600000,from=1800000000000;
const urls=Array.from({length:6},(_,i)=>`/market-data/v2/history/footprints?from=${from+(5-i)*4*hour}&to=${from+(6-i)*4*hour}&interval=1h&rowPrice=25&known=`);
const members=urls.map(footprintBatchMember);
const chunk=(index:number)=>({version:1,kind:'chunk',index,request:members[index],data:{version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:4},(_,i)=>{const start=members[index]!.from+i*hour;return {from:start,revision:1,bar:{time:start/1000,delta:-1,quoteDelta:-123.456},coverage:{from:start,to:start+hour,complete:true,gaps:[]}};})}});
const end={version:1,kind:'end',members:6,failed:0};
const line=(value:any)=>JSON.stringify(value)+'\n';
function response(text:string|ReadableStream<Uint8Array>){return new Response(text,{headers:{'content-type':'application/x-ndjson','x-iq-footprint-batch':'1','x-iq-batch-chunks':'6'}});}
test('progressive 24h history paints every ready member but cannot complete before the verified footer and EOF',async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>,calls=0;const encoder=new TextEncoder();
 const request:any=async()=>{calls++;return response(new ReadableStream({start(c){controller=c;}}));};
 const events:any[]=[],cache={getMany:async()=>new Map(),putMany:async()=>{}};
 const abort=new AbortController();
 const work=new PreparedFootprints(request,cache).load(from,from+24*hour,'1h',25,abort.signal,(bars,complete)=>events.push({bars,complete}));
 try{
 await vi.waitFor(()=>expect(controller).toBeDefined());for(let i=0;i<6;i++)controller.enqueue(encoder.encode(line(chunk(i))));
 await vi.waitFor(()=>expect(events.at(-1)?.bars).toHaveLength(20));expect(calls).toBe(1);expect(events.every(e=>!e.complete)).toBe(true);
 controller.enqueue(encoder.encode(line(end)));await new Promise(resolve=>setTimeout(resolve,10));expect(events.every(e=>!e.complete)).toBe(true);
 controller.close();await work;expect(events.at(-1).complete).toBe(true);expect(events.at(-1).bars).toHaveLength(24);expect(events.at(-1).bars.every((b:any)=>b.quoteDelta===-123.456)).toBe(true);
 }finally{abort.abort();await work.catch(()=>{});}
});
test('missing footer, altered identities, duplicates and trailing frames reject without delivering the final member',async()=>{
 const variants=[Array.from({length:6},(_,i)=>chunk(i)),[...Array.from({length:6},(_,i)=>chunk(i)),{...end,members:5}],[chunk(0),chunk(0)],[{...chunk(0),request:{...members[0],rowPrice:50}}],[...Array.from({length:6},(_,i)=>chunk(i)),end,end]];
 for(const frames of variants){const delivered:number[]=[];await expect(decodeFootprintBatch(response(frames.map(line).join('')),members,new AbortController().signal,async d=>{delivered.push(d.index);})).rejects.toThrow();expect(delivered).not.toContain(5);}
});
test('fragmented UTF8/lines preserve exact financial values and error siblings remain independent',async()=>{
 const frames=Array.from({length:6},(_,i)=>i===2?{version:1,kind:'error',index:i,request:members[i],error:{message:'retained source read failed',category:'query',retryable:true}}:chunk(i));
 const raw=new TextEncoder().encode([...frames,{...end,failed:1}].map(line).join('')),stream=new ReadableStream<Uint8Array>({start(c){for(let i=0;i<raw.length;i+=17)c.enqueue(raw.slice(i,i+17));c.close();}}),deliveries:any[]=[];
 await decodeFootprintBatch(response(stream),members,new AbortController().signal,async d=>{deliveries.push(d);});expect(deliveries).toHaveLength(6);expect(deliveries[2].error).toMatchObject({retryable:true,category:'query'});expect(deliveries[5].data.tiles[0].bar.quoteDelta).toBe(-123.456);
});
test('identical consumers share transport; one cancellation retains the peer and releases upstream only after the last interest',async()=>{
 let calls=0,signal!:AbortSignal,controller!:ReadableStreamDefaultController<Uint8Array>;
 const request:any=async(_url:string,init:RequestInit)=>{calls++;signal=init.signal!;return response(new ReadableStream({start(c){controller=c;}}));};
 const a=new AbortController(),b=new AbortController(),seen:number[]=[];
 const first=readFootprintBatch(request,urls,a.signal,async()=>{},'a'),cancelled=expect(first).rejects.toMatchObject({name:'AbortError'});
 const second=readFootprintBatch(request,urls,b.signal,async index=>{seen.push(index);},'b');
 await new Promise(resolve=>setTimeout(resolve,5));a.abort();await cancelled;expect(calls).toBe(1);expect(signal.aborted).toBe(false);
 controller.enqueue(new TextEncoder().encode([...Array.from({length:6},(_,i)=>chunk(i)),end].map(line).join('')));controller.close();await second;expect(seen).toEqual([0,1,2,3,4,5]);
 const c=new AbortController(),third=readFootprintBatch(request,urls,c.signal,async()=>{},'c'),rejected=expect(third).rejects.toMatchObject({name:'AbortError'});await new Promise(resolve=>setTimeout(resolve,5));c.abort();await rejected;expect(signal.aborted).toBe(true);
});
test('only explicit unsupported status permits legacy fallback; invalid advertised streams remain failures',async()=>{
 let calls=0;const request:any=async()=>{calls++;return new Response(null,{status:405});};
 for(let i=0;i<2;i++)await expect(readFootprintBatch(request,urls,new AbortController().signal,async()=>{},'legacy')).rejects.toBeInstanceOf(FootprintBatchUnsupported);expect(calls).toBe(1);
 const malformed:any=async()=>Response.json({version:1,state:'ready'});await expect(readFootprintBatch(malformed,urls,new AbortController().signal,async()=>{},'bad')).rejects.toThrow('Invalid footprint batch response');
});

test('truncated prepared response retains all earlier good bars and never reports complete',async()=>{
 const request:any=async()=>response(Array.from({length:6},(_,i)=>chunk(i)).map(line).join('')),events:any[]=[];
 await expect(new PreparedFootprints(request,{getMany:async()=>new Map(),putMany:async()=>{}}).load(from,from+24*hour,'1h',25,new AbortController().signal,(bars,complete)=>events.push({bars,complete}))).rejects.toThrow('Truncated');
 expect(events.at(-1).bars).toHaveLength(20);expect(events.every(e=>!e.complete)).toBe(true);
});

test('a building member polls independently after ready siblings and retains their bars',async()=>{
 let batchCalls=0,getCalls=0;const events:any[]=[];
 const request:any=async(url:string)=>{
  if(url.endsWith('footprints-batch')){batchCalls++;return response([...Array.from({length:6},(_,i)=>i===0?{...chunk(i),data:{...chunk(i).data,state:'building',tiles:[]}}:chunk(i)),end].map(line).join(''));}
  getCalls++;expect(new URL(url,'http://localhost').searchParams.get('from')).toBe(String(members[0]!.from));return Response.json(chunk(0).data);
 };
 await new PreparedFootprints(request,{getMany:async()=>new Map(),putMany:async()=>{}}).load(from,from+24*hour,'1h',25,new AbortController().signal,(bars,complete)=>events.push({bars,complete}));
 expect(batchCalls).toBe(1);expect(getCalls).toBe(1);expect(events.some(e=>e.bars.length===20&&!e.complete)).toBe(true);expect(events.at(-1)).toMatchObject({complete:true});expect(events.at(-1).bars).toHaveLength(24);
});

test('a failed batch member exposes only its unavailable slots while every ready sibling stays validated',async()=>{
 const request:any=async()=>response([...Array.from({length:6},(_,i)=>i===2?{version:1,kind:'error',index:i,request:members[i],error:{message:'source read failed',category:'query',retryable:true}}:chunk(i)),{...end,failed:1}].map(line).join('')),events:any[]=[];
 await expect(new PreparedFootprints(request,{getMany:async()=>new Map(),putMany:async()=>{}}).load(from,from+24*hour,'1h',25,new AbortController().signal,(bars,complete,_valid,_analysis,progress)=>events.push({bars,complete,progress}))).rejects.toThrow('source read failed');
 const last=events.at(-1);expect(last.bars).toHaveLength(20);expect(last.progress.validatedSlots).toBe(20);expect(last.progress.slots.filter((s:any)=>s.state==='unavailable')).toHaveLength(4);expect(last.progress.slots.filter((s:any)=>s.state==='ready'&&s.validated)).toHaveLength(20);expect(events.every(e=>!e.complete)).toBe(true);
});
