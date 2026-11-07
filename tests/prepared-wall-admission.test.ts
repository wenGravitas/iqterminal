import {afterEach,expect,test,vi} from 'vitest';
import {discoverPreparedWallAdmission,PreparedWallPreparationError} from '../src/feed/prepared-wall-admission';
import {historyScheduler} from '../src/feed/history-scheduler';
afterEach(()=>vi.useRealTimers());
const request={market:'spot' as const,profile:'exact-profile',from:1000,to:2000},url='/market-data/v2/history/walls/discover?market=spot';
const job=(phase='canonical',extra:Record<string,unknown>={})=>({id:'a'.repeat(64),request,phase,state:phase==='ready'?'ready':'building',pages:3,projectionPages:0,...extra});
const reply=(j=job())=>({state:'building',preparation:{version:1,leaseMs:15000,pollMs:250,job:j}});
const run=(fetcher:typeof fetch,signal=new AbortController().signal,extra:Record<string,unknown>={})=>discoverPreparedWallAdmission({request,url,projection:false,fetcher,signal,decode:response=>response.json(),...extra});
test('preparation renews the same consumer/job, yields its scheduler slot and releases after ready',async()=>{
 vi.useFakeTimers();const calls:RequestInit[]=[],updates:any[]=[];let reads=0;
 const fetcher=(async(_url,init)=>{calls.push(init!);return new Response(JSON.stringify(init?.method==='DELETE'?{}:++reads===1?reply():reads===2?reply(job('projection')):{...reply(job('ready')),state:'ready'}));}) as typeof fetch;
 const promise=run(fetcher,undefined,{onPreparation:(value:any)=>updates.push(value)});
 await vi.advanceTimersByTimeAsync(0);expect(updates).toHaveLength(1);expect(historyScheduler.diagnostics().active).toBe(0);
 await vi.advanceTimersByTimeAsync(250);expect(updates.at(-1).phase).toBe('projection');expect(historyScheduler.diagnostics().active).toBe(0);
 await vi.advanceTimersByTimeAsync(250);expect((await promise).state).toBe('ready');await vi.advanceTimersByTimeAsync(0);
 const headers=calls.filter(c=>c.method!=='DELETE').map(c=>new Headers(c.headers));
 expect(new Set(headers.map(h=>h.get('X-IQ-Wall-Consumer'))).size).toBe(1);expect(headers[0].get('X-IQ-Wall-Job')).toBeNull();expect(headers[1].get('X-IQ-Wall-Job')).toBe('a'.repeat(64));expect(calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
});
test('aborting one view releases only its interest while another view finishes the same request',async()=>{
 vi.useFakeTimers();const a=new AbortController(),b=new AbortController(),released:string[]=[];let ready=false;
 const fetcher=(async(input,init)=>{const path=new URL(String(input),'http://test');if(init?.method==='DELETE'){released.push(path.searchParams.get('consumer')!);return new Response('{}');}return new Response(JSON.stringify(ready?{...reply(job('ready')),state:'ready'}:reply()));}) as typeof fetch;
 const first=run(fetcher,a.signal),second=run(fetcher,b.signal),rejected=expect(first).rejects.toMatchObject({name:'AbortError'});
 await vi.advanceTimersByTimeAsync(0);a.abort();await rejected;await vi.advanceTimersByTimeAsync(0);expect(released).toHaveLength(1);expect(b.signal.aborted).toBe(false);
 ready=true;await vi.advanceTimersByTimeAsync(250);await second;await vi.advanceTimersByTimeAsync(0);expect(new Set(released).size).toBe(2);expect(historyScheduler.diagnostics().active).toBe(0);
});
test('specific failed jobs stop polling and preserve retryability/category',async()=>{
 const fetcher=vi.fn(async(_input,init)=>new Response(JSON.stringify(init?.method==='DELETE'?{}:reply(job('canonical',{state:'failed',category:'invalid-content',error:'Canonical hash mismatch',retryable:false})))));
 await expect(run(fetcher as typeof fetch)).rejects.toMatchObject({name:'PreparedWallPreparationError',category:'invalid-content',retryable:false,message:'Canonical hash mismatch'});
 await vi.waitFor(()=>expect(fetcher.mock.calls.filter(c=>c[1]?.method==='DELETE')).toHaveLength(1));expect(fetcher.mock.calls.filter(c=>c[1]?.method!=='DELETE')).toHaveLength(1);
});
test('explicit Retry commands remain stable through every renewal',async()=>{
 vi.useFakeTimers();const headers:Headers[]=[];let reads=0;
 const fetcher=(async(_input,init)=>{if(init?.method==='DELETE')return new Response('{}');headers.push(new Headers(init?.headers));return new Response(JSON.stringify(++reads===1?reply():{...reply(job('ready')),state:'ready'}));}) as typeof fetch;
 const promise=run(fetcher,undefined,{retry:{token:'user-retry-1',newRevision:true}});await vi.advanceTimersByTimeAsync(250);await promise;await vi.advanceTimersByTimeAsync(0);
 expect(headers.map(h=>h.get('X-IQ-Wall-Retry'))).toEqual(['user-retry-1','user-retry-1']);expect(headers.map(h=>h.get('X-IQ-Wall-New-Revision'))).toEqual(['1','1']);
});
test('mismatched progress never publishes coverage and a ready-but-invalidated cache requires a new revision',async()=>{
 let published=0;const invalid=(async(_input,init)=>new Response(JSON.stringify(init?.method==='DELETE'?{}:reply(job('canonical',{request:{...request,to:3000}}))))) as typeof fetch;
 await expect(run(invalid,undefined,{onPreparation:()=>published++})).rejects.toThrow(/identity/);expect(published).toBe(0);
 const stale=(async(_input,init)=>new Response(JSON.stringify(init?.method==='DELETE'?{}:reply(job('ready'))))) as typeof fetch;
 await expect(run(stale)).rejects.toBeInstanceOf(PreparedWallPreparationError);await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
});
test('disabled/legacy discovery keeps its existing fallback without creating lease work',async()=>{
 const calls:RequestInit[]=[];const fetcher=(async(_input,init)=>{calls.push(init!);return new Response('{"state":"missing"}');}) as typeof fetch;
 expect(await run(fetcher)).toEqual({state:'missing'});expect(calls).toHaveLength(1);expect(calls[0].method).toBeUndefined();
});
