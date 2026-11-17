import {expect,test,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {acquireWallBatch} from '../src/feed/prepared-wall-batch';
import {historyScheduler} from '../src/feed/history-scheduler';
const text='[{"exact":"123.0000000000001"}]',key='k',revision='r';
const part={index:0,bytes:Buffer.byteLength(text),hash:createHash('sha256').update(text).digest('hex')};
function ready(){return new Response(text+'\n',{headers:{'x-iq-wall-start':'0','x-iq-wall-next':'1','x-iq-wall-parts':'1','x-iq-chunk-key':key,'x-iq-source-revision':revision}});}
let sequence=0;
function acquire(fetcher:typeof fetch,signal=new AbortController().signal,url='/retry-test/'+sequence++){return acquireWallBatch({url,key,revision,parts:[part],fetcher,signal});}
test('temporary empty responses requeue bounded retries without changing exact content',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:408})).mockResolvedValueOnce(new Response(null,{status:503})).mockImplementation(async()=>ready());
 const a=acquire(fetcher);try{const value=await a.read(0);expect(value.body).toEqual([{exact:'123.0000000000001'}]);expect(value.attempts).toBe(3);expect(fetcher).toHaveBeenCalledTimes(3);}finally{a.release();}
});
test('exhausted temporary responses fail after three attempts',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(null,{status:504}));const a=acquire(fetcher);
 try{await expect(a.read(0)).rejects.toThrow('HTTP 504');expect(fetcher).toHaveBeenCalledTimes(3);}finally{a.release();}
});
test('identity and content failures do not retry',async()=>{
 for(const response of [new Response(null,{status:404}),new Response(null,{status:503,headers:{'retry-after':'30'}}),new Response(text+'\n'),new Response('x'.repeat(text.length)+'\n',{headers:ready().headers})]){
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response),a=acquire(fetcher);try{await expect(a.read(0)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);}finally{a.release();}
 }
});
test('backoff releases admission and canceled consumer cannot cancel the other chart',async()=>{
 const one=new AbortController(),two=new AbortController(),url='/retry-shared/'+sequence++;
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:408})).mockImplementation(async()=>ready());
 const a=acquire(fetcher,one.signal,url),b=acquire(fetcher,two.signal,url),first=a.read(0),second=b.read(0);void first.catch(()=>{});
 try{
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
  one.abort();await expect(first).rejects.toThrow(/Aborted/);expect((await second).attempts).toBe(2);expect(fetcher).toHaveBeenCalledTimes(2);
 }finally{a.release();b.release();}
});
test('last consumer cancellation during backoff prevents another upstream request',async()=>{
 const abort=new AbortController(),fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(null,{status:408})),a=acquire(fetcher,abort.signal),pending=a.read(0);void pending.catch(()=>{});
 try{await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));abort.abort();await expect(pending).rejects.toThrow(/Aborted/);await new Promise(r=>setTimeout(r,300));expect(fetcher).toHaveBeenCalledTimes(1);}finally{a.release();}
});

test('server backoff is honored outside admission before a bounded retry',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:503,headers:{'retry-after':'1'}})).mockImplementation(async()=>ready());const a=acquire(fetcher),pending=a.read(0);
 try{
  await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(999);expect(fetcher).toHaveBeenCalledTimes(1);expect(historyScheduler.diagnostics().active).toBe(0);
  await vi.advanceTimersByTimeAsync(1);expect((await pending).attempts).toBe(2);
 }finally{a.release();vi.useRealTimers();}
});
