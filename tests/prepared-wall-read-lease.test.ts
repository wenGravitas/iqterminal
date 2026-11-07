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
