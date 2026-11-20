import {afterEach,expect,test,vi} from 'vitest';
import {acquirePreparedWallReadLease,wallReadControlScheduler} from '../src/feed/prepared-wall-read-lease';
import {historyScheduler} from '../src/feed/history-scheduler';
afterEach(()=>vi.useRealTimers());
const identity={canonicalKey:'a'.repeat(64),projectionKey:'b'.repeat(64)};
function source(failAfter=Infinity){const calls:Array<{method?:string;body?:any;consumer?:string}>=[];let reads=0;
 const fetcher=(async(input,init)=>{if(init?.method==='DELETE'){calls.push({method:'DELETE',consumer:new URL(String(input),'http://test').searchParams.get('consumer')!});return new Response('{}');}
  const body=JSON.parse(init!.body as string);calls.push({method:init?.method,body});if(++reads>failAfter)return new Response('{}',{status:503});return new Response(JSON.stringify({version:1,leaseMs:15000,...identity}));}) as typeof fetch;
 return {fetcher,calls};
}
test('lease survives closed-history completion, renews with unchanged keys and releases once',async()=>{
 vi.useFakeTimers();const s=source(),lease=await acquirePreparedWallReadLease(identity,s.fetcher,new AbortController().signal);lease.assertActive();
 expect(s.calls).toHaveLength(1);await vi.advanceTimersByTimeAsync(16000);lease.assertActive();expect(s.calls.filter(c=>c.method==='POST')).toHaveLength(4);
 expect(new Set(s.calls.map(c=>c.body?.consumer)).size).toBe(1);expect(s.calls.every(c=>c.body.canonicalKey===identity.canonicalKey&&c.body.projectionKey===identity.projectionKey)).toBe(true);
 expect(wallReadControlScheduler.diagnostics().active).toBe(0);lease.release();lease.release();await vi.advanceTimersByTimeAsync(0);expect(s.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);expect(lease.signal.aborted).toBe(true);
});
test('two occupied history slots cannot starve renewal; canceling one reader preserves its peer',async()=>{
 vi.useFakeTimers();const historyAbort=new AbortController(),pending=[0,1].map(i=>historyScheduler.read('occupied-'+i,'order-walls',historyAbort.signal,upstream=>new Promise((_resolve,reject)=>upstream.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))).catch(()=>{}));
 const s=source(),a=new AbortController(),b=new AbortController();const first=await acquirePreparedWallReadLease(identity,s.fetcher,a.signal),second=await acquirePreparedWallReadLease(identity,s.fetcher,b.signal);
 await vi.advanceTimersByTimeAsync(5000);expect(s.calls.filter(c=>c.method==='POST')).toHaveLength(4);expect(historyScheduler.diagnostics().active).toBe(2);
 a.abort();await vi.advanceTimersByTimeAsync(0);expect(first.signal.aborted).toBe(true);second.assertActive();expect(s.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
 second.release();historyAbort.abort();await Promise.all(pending);await vi.advanceTimersByTimeAsync(0);
});
test('renewal failure aborts the reader and prevents further validated publication',async()=>{
 vi.useFakeTimers();const s=source(1),lease=await acquirePreparedWallReadLease(identity,s.fetcher,new AbortController().signal);
 await vi.advanceTimersByTimeAsync(5000);expect(lease.signal.aborted).toBe(true);expect(()=>lease.assertActive()).toThrow(/lease lost.*Retry/);expect(s.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
});
test('malformed identity or oversized lease response fails explicitly with bounded cleanup',async()=>{
 const s=source();await expect(acquirePreparedWallReadLease({...identity,projectionKey:'wrong'},s.fetcher,new AbortController().signal)).rejects.toThrow(/identity/);expect(s.calls).toHaveLength(0);
 const fetcher=(async(_input,init)=>init?.method==='DELETE'?new Response('{}'):new Response('x'.repeat(4097))) as typeof fetch;
 await expect(acquirePreparedWallReadLease(identity,fetcher,new AbortController().signal)).rejects.toThrow(/size/);
 await vi.waitFor(()=>expect(wallReadControlScheduler.diagnostics().active).toBe(0));
});
test('one transient renewal timeout retries only inside the original acknowledged lease and keeps identity',async()=>{vi.useFakeTimers();let n=0;const consumers:string[]=[];const fetcher=(async(_url,init)=>{if(init?.method==='DELETE')return new Response('{}');const b=JSON.parse(String(init?.body));consumers.push(b.consumer);if(++n===2)throw new DOMException('Aborted','AbortError');return new Response(JSON.stringify({version:1,leaseMs:15000,...identity}));}) as typeof fetch;const lease=await acquirePreparedWallReadLease(identity,fetcher,new AbortController().signal);await vi.advanceTimersByTimeAsync(5000);lease.assertActive();expect(n).toBe(3);expect(new Set(consumers).size).toBe(1);lease.release();});
test('two transient failures terminate; a timed-out initial acquisition has no unconfirmed lease to reuse',async()=>{vi.useFakeTimers();let n=0;const f=(async(_u,init)=>{if(init?.method==='DELETE')return new Response('{}');if(++n>1)throw new DOMException('Aborted','AbortError');return new Response(JSON.stringify({version:1,leaseMs:15000,...identity}));}) as typeof fetch;const lease=await acquirePreparedWallReadLease(identity,f,new AbortController().signal);await vi.advanceTimersByTimeAsync(5000);expect(n).toBe(3);expect(lease.signal.aborted).toBe(true);let first=0;await expect(acquirePreparedWallReadLease(identity,(async(_u,init)=>{if(init?.method==='DELETE')return new Response('{}');first++;throw new TypeError('Network');}) as typeof fetch,new AbortController().signal)).rejects.toThrow();expect(first).toBe(1);});
test('adopts an independently validated discovery lease without another acquisition request and renews from the discovery send clock',async()=>{
 vi.useFakeTimers();const s=source(),sentAt=performance.now();await vi.advanceTimersByTimeAsync(2000);
 const lease=await acquirePreparedWallReadLease(identity,s.fetcher,new AbortController().signal,{consumer:'discovered-reader',sentAt,response:{version:1,leaseMs:15000,...identity}});
 expect(s.calls).toHaveLength(0);lease.assertActive();await vi.advanceTimersByTimeAsync(3000);expect(s.calls).toHaveLength(1);expect(s.calls[0].body.consumer).toBe('discovered-reader');lease.release();
});
test('discovery adoption rejects wrong keys and already expired acknowledgments',async()=>{
 vi.useFakeTimers();const s=source(),sentAt=performance.now();
 await expect(acquirePreparedWallReadLease(identity,s.fetcher,new AbortController().signal,{consumer:'reader',sentAt,response:{version:1,leaseMs:15000,...identity,canonicalKey:'c'.repeat(64)}})).rejects.toThrow(/identity/);
 await vi.advanceTimersByTimeAsync(15001);
 await expect(acquirePreparedWallReadLease(identity,s.fetcher,new AbortController().signal,{consumer:'expired-reader',sentAt,response:{version:1,leaseMs:15000,...identity}})).rejects.toThrow(/expired/);
 expect(s.calls.every(c=>c.method==='DELETE')).toBe(true);
});
