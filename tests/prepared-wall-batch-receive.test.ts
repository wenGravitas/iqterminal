import {test,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {acquireWallBatch} from '../src/feed/prepared-wall-batch';
import {receiveWallBatch} from '../src/feed/prepared-wall-batch-reader';
import {historyScheduler} from '../src/feed/history-scheduler';
const encoder=new TextEncoder();let sequence=0;
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function fixture(){
 const texts=['[{"exact":"123.0000000000001"}]','[{"exact":"456.0000000000002"}]'];
 const frames=texts.map(text=>encoder.encode(text+'\n'));
 const parts=texts.map((text,index)=>({index,bytes:encoder.encode(text).length,hash:createHash('sha256').update(text).digest('hex')}));
 const headers={'x-iq-wall-start':'0','x-iq-wall-next':'2','x-iq-wall-parts':'2','x-iq-chunk-key':'k','x-iq-source-revision':'r'};
 return {frames,parts,headers,texts};
}
test('bounded receiver drains remaining network bytes while first member hash is blocked, retaining admission',async()=>{
 const f=fixture(),hashEntered=deferred(),allowHash=deferred(),allReceived=deferred();let pulls=0;
 const digest=crypto.subtle.digest.bind(crypto.subtle);
 const spy=vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(async(...args)=>{hashEntered.resolve();await allowHash.promise;return digest(...args);});
 const stream=new ReadableStream<Uint8Array>({pull(controller){if(pulls<f.frames.length)controller.enqueue(f.frames[pulls++]);else{controller.close();allReceived.resolve();}}},{highWaterMark:0});
 const batch=acquireWallBatch({url:'/receive-ahead/'+sequence++,key:'k',revision:'r',parts:f.parts,signal:new AbortController().signal,fetcher:async()=>new Response(stream,{headers:f.headers})});
 try{
  await hashEntered.promise;
  // A serial read/decode loop never asks for the next chunk while hash is held.
  await vi.waitFor(()=>expect(pulls).toBe(2));await allReceived.promise;
  expect(historyScheduler.diagnostics().active).toBeGreaterThan(0);
  allowHash.resolve();expect((await batch.read(0)).body).toEqual(JSON.parse(f.texts[0]));expect((await batch.read(1)).body).toEqual(JSON.parse(f.texts[1]));
 }finally{allowHash.resolve();batch.release();spy.mockRestore();}
});
test('first validated member publishes before terminal bytes, whose EOF fence remains mandatory',async()=>{
 const f=fixture();let controller!:ReadableStreamDefaultController<Uint8Array>;
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;c.enqueue(f.frames[0]);}});
 const batch=acquireWallBatch({url:'/receive-progress/'+sequence++,key:'k',revision:'r',parts:f.parts,signal:new AbortController().signal,fetcher:async()=>new Response(stream,{headers:f.headers})});
 try{
  expect((await batch.read(0)).body).toEqual(JSON.parse(f.texts[0]));let published=false;const last=batch.read(1).then(v=>{published=true;return v;});
  controller.enqueue(f.frames[1]);await new Promise(r=>setTimeout(r,10));expect(published).toBe(false);
  controller.close();expect((await last).body).toEqual(JSON.parse(f.texts[1]));
 }finally{batch.release();}
});
test.each(['truncated','extra','network-error'] as const)('received %s tail preserves a validated prefix and rejects terminal completion',async mode=>{
 const f=fixture();let controller!:ReadableStreamDefaultController<Uint8Array>;
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;c.enqueue(f.frames[0]);}});
 const batch=acquireWallBatch({url:'/receive-tail/'+sequence++,key:'k',revision:'r',parts:f.parts,signal:new AbortController().signal,fetcher:async()=>new Response(stream,{headers:f.headers})});
 try{
  expect((await batch.read(0)).body).toEqual(JSON.parse(f.texts[0]));
  if(mode==='network-error')controller.error(Error('network failure'));
  else {controller.enqueue(mode==='truncated'?f.frames[1].subarray(0,-1):encoder.encode(new TextDecoder().decode(f.frames[1])+'x'));controller.close();}
  await expect(batch.read(1)).rejects.toThrow(mode==='network-error'?/network failure/:/byte identity/);
 }finally{batch.release();}
});
test('abort interrupts pending receive and releases the reader lock',async()=>{
 const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({cancel}),abort=new AbortController(),receiver=receiveWallBatch(stream,16,abort.signal),pending=receiver.exact(8);
 abort.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});await receiver.close();expect(cancel).toHaveBeenCalledTimes(1);expect(stream.locked).toBe(false);
});
test('one consumer cancellation retains receive-ahead for a peer; last cancellation closes upstream',async()=>{
 const f=fixture(),cancel=vi.fn(),one=new AbortController(),two=new AbortController();let controller!:ReadableStreamDefaultController<Uint8Array>;
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;},cancel}),url='/receive-cancel/'+sequence++;
 const options={url,key:'k',revision:'r',parts:f.parts,fetcher:vi.fn(async()=>new Response(stream,{headers:f.headers}))};
 const a=acquireWallBatch({...options,signal:one.signal}),b=acquireWallBatch({...options,signal:two.signal});
 try{
  await vi.waitFor(()=>expect(stream.locked).toBe(true));const first=a.read(0);one.abort();await expect(first).rejects.toMatchObject({name:'AbortError'});expect(cancel).not.toHaveBeenCalled();
  controller.enqueue(f.frames[0]);expect((await b.read(0)).body).toEqual(JSON.parse(f.texts[0]));
  const last=b.read(1);two.abort();await expect(last).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(stream.locked).toBe(false));expect(cancel).toHaveBeenCalledTimes(1);expect(options.fetcher).toHaveBeenCalledTimes(1);
 }finally{a.release();b.release();}
});
test('receive buffer rejects unsafe or over-capacity declarations before acquiring a reader',()=>{
 for(const bytes of [0,-1,NaN,Infinity,1.5,8*1024*1024+1]){const stream=new ReadableStream<Uint8Array>();expect(()=>receiveWallBatch(stream,bytes,new AbortController().signal)).toThrow(/capacity/);expect(stream.locked).toBe(false);}
});
