import {test,expect,vi} from 'vitest';import {createHash} from 'node:crypto';
import {acquireWallBatch} from '../src/feed/prepared-wall-batch';
import {encodeWallPointTransport,WALL_POINT_TRANSPORT,WALL_PRODUCT_POINT_TRANSPORT} from '../src/shared/order-wall-point-transport';
const row=(at=100)=>[{order:0,segment:{id:'stable',start:100,valueRuns:[{at,usd:123.456,percentile:null,rank:1,quantity:2,quantityExact:'2.000',notionalExact:'123.456'}]},valueRunOrder:[1],offset:0,totalRuns:1}];
let sequence=0;
async function fixture(values=[row()],version:1|2=1){const texts=values.map(v=>JSON.stringify(v)),wire=await Promise.all(values.map(async v=>JSON.stringify((await encodeWallPointTransport(v,undefined,version)).value)));const parts=texts.map((text,index)=>({index,bytes:Buffer.byteLength(text),hash:createHash('sha256').update(text).digest('hex')}));
 const headers={'x-iq-wall-start':'0','x-iq-wall-next':String(parts.length),'x-iq-wall-parts':String(parts.length),'x-iq-chunk-key':'key','x-iq-source-revision':'revision','x-iq-wall-transport':version===2?WALL_PRODUCT_POINT_TRANSPORT:WALL_POINT_TRANSPORT,'x-iq-wall-part-bytes':JSON.stringify(wire.map(t=>Buffer.byteLength(t))),'x-iq-canonical-bytes':String(parts.reduce((n,p)=>n+p.bytes+1,0)),'x-iq-decoded-bytes':String(wire.reduce((n,t)=>n+Buffer.byteLength(t)+1,0))};
 return {parts,headers,wire,body:wire.join('\n')+'\n',values};}
function acquire(f:Awaited<ReturnType<typeof fixture>>,fetcher:typeof fetch,signal=new AbortController().signal,url='/point-batch/'+sequence++,version:1|2=1){return acquireWallBatch({url,key:'key',revision:'revision',parts:f.parts,pointTransport:version===2?2:true,maxParts:32,fetcher,signal});}
test('malformed framing/capability metadata fails instead of falling back to native JSON',async()=>{
 for(const change of [{'x-iq-wall-part-bytes':'['},{'x-iq-wall-part-bytes':'null'},{'x-iq-wall-part-bytes':'[-1]'},{'x-iq-wall-transport':'unknown'},{'x-iq-canonical-bytes':'1'},{'x-iq-decoded-bytes':'1'}]){const f=await fixture(),fetcher=vi.fn(async()=>new Response(f.body,{headers:{...f.headers,...change}})),a=acquire(f,fetcher);try{await expect(a.read(0)).rejects.toThrow(/transport/);expect(fetcher).toHaveBeenCalledTimes(1);}finally{a.release();}}
});
test('changed exact decimals fail the original canonical hash without retry',async()=>{
 const f=await fixture(),body=f.body.replace('2.000','3.000'),fetcher=vi.fn(async()=>new Response(body,{headers:f.headers})),a=acquire(f,fetcher);try{await expect(a.read(0)).rejects.toThrow(/hash/);expect(fetcher).toHaveBeenCalledTimes(1);}finally{a.release();}
});
test('validated first member survives a truncated terminal member',async()=>{
 const f=await fixture([row(),row(101)]),a=acquire(f,(async()=>new Response(f.body.slice(0,-1),{headers:f.headers})) as typeof fetch);
 try{expect((await a.read(0)).body).toEqual(f.values[0]);await expect(a.read(1)).rejects.toThrow(/byte identity/);}finally{a.release();}
});
test('one canceled reader cannot cancel a peer awaiting the same compact response',async()=>{
 const f=await fixture(),one=new AbortController();let resolve!:(r:Response)=>void,upstream!:AbortSignal;
 const fetcher=vi.fn(async(_u:unknown,init?:RequestInit)=>{upstream=init!.signal!;return new Promise<Response>(r=>resolve=r);}),url='/point-shared/'+sequence++,a=acquire(f,fetcher,one.signal,url),b=acquire(f,fetcher,undefined,url),first=a.read(0),second=b.read(0);
 try{await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));one.abort();await expect(first).rejects.toMatchObject({name:'AbortError'});expect(upstream.aborted).toBe(false);resolve(new Response(f.body,{headers:f.headers}));expect((await second).body).toEqual(f.values[0]);}finally{a.release();b.release();}
});
test('compact input cannot amplify beyond the advertised canonical byte capacity',async()=>{
 const f=await fixture();f.parts[0].bytes=Buffer.byteLength(f.wire[0]);f.headers['x-iq-canonical-bytes']=String(f.parts[0].bytes+1);const a=acquire(f,(async()=>new Response(f.body,{headers:f.headers})) as typeof fetch);
 try{await expect(a.read(0)).rejects.toThrow(/canonical byte capacity/);}finally{a.release();}
});

test('product capability restores canonical hashes and rejects price changes or a downgrade',async()=>{
 const values:any=row();values[0].segment.priceExact='61.728';
 for(const change of ['none','price','capability']){const f=await fixture([values],2),body=change==='price'?f.body.replace('61.728','62.728'):f.body,headers={...f.headers,...(change==='capability'?{'x-iq-wall-transport':WALL_POINT_TRANSPORT}:{})},a=acquire(f,(async()=>new Response(body,{headers})) as typeof fetch,undefined,undefined,2);
  try{if(change==='none')expect((await a.read(0)).body).toEqual(values);else await expect(a.read(0)).rejects.toThrow(change==='price'?/hash/:/transport/);}finally{a.release();}
 }
});
