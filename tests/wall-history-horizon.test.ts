import {expect,test,vi} from 'vitest';
import {eligibleWallHistoryRange,readWallHistoryHorizon,type WallHistoryHorizon} from '../src/feed/wall-history-horizon';
import {historyScheduler} from '../src/feed/history-scheduler';
const request={market:'spot' as const,profile:'exact-profile'};
const horizon:WallHistoryHorizon={version:1,kind:'wall-source-horizon-v1',...request,head:{cursor:12,epoch:2,at:1000},availableFrom:400};
const signal=()=>new AbortController().signal;
test('future whitespace does not consume eligible history and retention never shifts the requested start',()=>{
 for(const to of [1001,2000,9000])expect(eligibleWallHistoryRange({from:100,to},horizon)).toMatchObject({from:100,to:1001,requestedTo:to,horizonAt:1000});
 expect(eligibleWallHistoryRange({from:10,to:500},horizon)).toMatchObject({from:10,to:500});
 expect(eligibleWallHistoryRange({from:2000,to:3000},horizon)).toMatchObject({from:2000,to:2000});
 for(const range of [{from:-1,to:1},{from:1,to:1},{from:2,to:1},{from:0.1,to:1}])expect(()=>eligibleWallHistoryRange(range,horizon)).toThrow();
 expect(()=>eligibleWallHistoryRange({from:0,to:2},{...horizon,head:{...horizon.head,at:Number.MAX_SAFE_INTEGER}})).toThrow();
});
test('horizon validates identity, exact counters and bounded decoded bytes',async()=>{
 const read=(body:unknown)=>readWallHistoryHorizon(request,async()=>Response.json(body),signal());
 expect(await read(horizon)).toEqual(horizon);
 for(const patch of [{version:2},{kind:'coverage'},{market:'perpetual'},{profile:'other'},{head:{cursor:1.5,epoch:2,at:3}},{head:{cursor:1,epoch:-1,at:3}},{availableFrom:undefined}])await expect(read({...horizon,...patch})).rejects.toThrow(/Invalid/);
 await expect(read({...horizon,padding:'x'.repeat(8200)})).rejects.toThrow(/byte capacity/);
});
test('only a missing older route falls back; failure is not converted to absent source',async()=>{
 expect(await readWallHistoryHorizon(request,async()=>new Response('',{status:404}),signal())).toBeUndefined();
 await expect(readWallHistoryHorizon(request,async()=>new Response('Unavailable',{status:503}),signal())).rejects.toThrow();
 await expect(readWallHistoryHorizon(request,async()=>new Response('bad json'),signal())).rejects.toThrow();
});
test('shared horizon reads cancel obsolete consumers independently and release scheduler capacity',async()=>{
 const a=new AbortController(),b=new AbortController();let upstream!:AbortSignal,release!:(r:Response)=>void;
 const fetcher=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>{upstream=init!.signal!;return new Promise<Response>(r=>release=r);});
 const one=readWallHistoryHorizon(request,fetcher,a.signal);void one.catch(()=>{});
 const two=readWallHistoryHorizon(request,fetcher,b.signal);
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));a.abort();await expect(one).rejects.toMatchObject({name:'AbortError'});expect(upstream.aborted).toBe(false);
 release(Response.json(horizon));expect(await two).toEqual(horizon);await vi.waitFor(()=>expect(historyScheduler.diagnostics().active).toBe(0));
});
