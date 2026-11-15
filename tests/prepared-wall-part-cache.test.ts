import{test,expect}from'vitest';
import{PreparedWallPartCache}from'../src/feed/prepared-wall-part-cache';
import{readPreparedWallProjection}from'../src/feed/prepared-wall-projection';
import{hash,fixture,from,to,profile,normalized}from'./helpers/prepared-wall-fixture';
import{WALL_PROJECTION_CORE_SHA256}from'../src/shared/order-walls-projection-version';
const frozen=()=>Object.freeze([{value:'immutable'}]);
const part=(s:string)=>({hash:s.repeat(64),bytes:500,records:1});
test('transactions charge pending members; abort, leases, invalidation and eviction stay bounded',()=>{
 const cache=new PreparedWallPartCache(4000,2),parts=[part('a'),part('b'),part('c')];
 const seed=cache.begin('family',parts);seed.stage(0,frozen(),0);seed.stage(1,frozen(),0);
 const charged=cache.diagnostics().accountedBytes;expect(charged).toBeLessThanOrEqual(4000);expect(cache.diagnostics().stagedEntries).toBe(2);
 const concurrent=cache.begin('family',parts);expect(concurrent.get(0)).toBeUndefined();concurrent.release();seed.commit();seed.release();
 const lease=cache.begin('family',parts);expect(lease.get(0)).toEqual(frozen());lease.stage(2,frozen(),0);expect(cache.diagnostics().capacityMisses).toBe(1);
 cache.clear();expect(lease.get(0)).toEqual(frozen());expect(cache.diagnostics()).toMatchObject({entries:2,accountedBytes:charged});lease.release();expect(cache.diagnostics().accountedBytes).toBe(0);
 const aborted=cache.begin('family',parts);aborted.stage(0,frozen(),0);aborted.release();expect(cache.diagnostics()).toMatchObject({entries:0,stagedEntries:0,pinnedEntries:0});
 const full=cache.begin('family',parts);full.stage(0,frozen(),0);full.stage(1,frozen(),0);full.commit();full.release();
 const replacement=cache.begin('other',[parts[2]!]);replacement.stage(0,frozen(),0);replacement.commit();replacement.release();expect(cache.diagnostics().evictions).toBe(1);
 const retained=cache.begin('other',[parts[2]!]);expect(retained.get(0)).toEqual(frozen());retained.release();cache.dispose();expect(cache.diagnostics().accountedBytes).toBe(0);
});
function generation(n:number){
 const at=to+1000,B=fixture().page.patches[2].bids.upserts[0],C={...B,entryId:'C',startedAt:at,startCursor:5,startEpoch:2},D={...C,entryId:'D',startedAt:at+60000,startCursor:6};
 const patches=[{kind:'patch',cursor:5,epoch:2,at,midpoint:'100',bids:{removals:[{entryId:'B',side:'bid',price:B.price,at,cursor:5,epoch:2,reason:'rank-exit',lastConfirmedAt:at-1,lastConfirmedCursor:4}],upserts:[C]},asks:{removals:[],upserts:[]}}, {kind:'patch',cursor:6,epoch:2,at:at+60000,midpoint:'100',bids:{removals:[{entryId:'C',side:'bid',price:C.price,at:at+60000,cursor:6,epoch:2,reason:'rank-exit',lastConfirmedAt:at+59999,lastConfirmedCursor:5}],upserts:[D]},asks:{removals:[],upserts:[]}}];
 const f=fixture(true,to+n*60000,from,profile,patches.slice(0,n));
 f.context.sourceKey=hash('source-'+n);f.context.sourceToken=hash('token-'+n);f.manifest.sourceKey=f.context.sourceKey;f.manifest.sourceToken=f.context.sourceToken;
 f.manifest.key=hash(JSON.stringify({version:2,sourceKey:f.context.sourceKey,core:WALL_PROJECTION_CORE_SHA256,settings:normalized}));return f;
}
function io(f:ReturnType<typeof fixture>){const fetched:number[]=[];const fetcher:typeof fetch=async input=>{
 const u=new URL(String(input),'http://test'),start=Number(u.searchParams.get('start')),chosen=f.manifest.parts.slice(start,start+32);fetched.push(start);
 return new Response(f.texts.slice(start,start+chosen.length).join('\n')+'\n',{headers:{'x-iq-wall-start':String(start),'x-iq-wall-next':String(start+chosen.length),'x-iq-wall-parts':String(chosen.length),'x-iq-chunk-key':f.manifest.key,'x-iq-source-revision':f.manifest.sourceToken}});
 };return{fetcher,fetched};}
async function read(f:ReturnType<typeof fixture>,cache:PreparedWallPartCache,completion?:()=>Promise<void>,signal=new AbortController().signal){const t=io(f);const result=await readPreparedWallProjection(f.advertised,{...f.context,restoreProjector:false,partCache:cache,fetcher:t.fetcher,signal,validateCompletion:completion},()=>{});return{result,...t};}
test('two successive manifests reuse exact closed members; replace terminal/active state and retain full equality',async()=>{
 const cache=new PreparedWallPartCache(),a=generation(0),b=generation(1),c=generation(2);
 const first=await read(a,cache);expect(first.result!.finalization.reusedParts).toBe(0);
 for(const f of[b,c]){const warm=await read(f,cache),cold=await read(f,new PreparedWallPartCache(0));expect(warm.result!.segments).toEqual(cold.result!.segments);expect(warm.result!.segments).toEqual(f.full.segments.sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side)||a.price-b.price));expect(warm.result!.coverage).toEqual(f.manifest.coverage);expect(warm.result!.finalization.reusedParts).toBeGreaterThan(0);expect(warm.fetched).toEqual([f===b?2:3]);expect(warm.result!.finalization.importedParts).toBe(f.manifest.parts.length);}
 expect(cache.diagnostics()).toMatchObject({pinnedEntries:0,stagedEntries:0});cache.dispose();expect(cache.diagnostics().accountedBytes).toBe(0);
});
test('failed final source validation/cancellation cannot admit staged members or poison prior immutable data',async()=>{
 const cache=new PreparedWallPartCache();await read(generation(0),cache);const entries=cache.diagnostics().entries;
 await expect(read(generation(1),cache,async()=>{throw Error('source changed');})).rejects.toThrow('source changed');expect(cache.diagnostics()).toMatchObject({entries,pinnedEntries:0,stagedEntries:0});
 const controller=new AbortController();await expect(read(generation(1),cache,async()=>{controller.abort();},controller.signal)).rejects.toThrow();expect(cache.diagnostics()).toMatchObject({entries,pinnedEntries:0,stagedEntries:0});
 const repaired=await read(generation(1),cache);expect(repaired.fetched).toEqual([2]);
});
test('profile identity, evicted members and malformed changed content use cold verification rather than stale values',async()=>{
 const cache=new PreparedWallPartCache();await read(generation(0),cache);cache.clear();const cold=await read(generation(1),cache);expect(cold.result!.finalization.reusedParts).toBe(0);
 const changed=generation(2);changed.manifest.profile={...changed.manifest.profile,schemaVersion:2};const next=await read(changed,cache);expect(next.result!.finalization.reusedParts).toBe(0);
 const bad=generation(2);bad.manifest.parts[0].hash=hash('correction');await expect(read(bad,cache)).rejects.toThrow(/hash mismatch/);expect(cache.diagnostics()).toMatchObject({pinnedEntries:0,stagedEntries:0});
});
test('partial eviction follows the existing bounded batch contract and preserves exact fragments',async()=>{
 const f=generation(0),calibration=new PreparedWallPartCache();await read(f,calibration);const cache=new PreparedWallPartCache(calibration.diagnostics().accountedBytes-1);calibration.dispose();
 await read(f,cache);expect(cache.diagnostics().entries).toBe(1);
 const next=await read(generation(1),cache),cold=await read(generation(1),new PreparedWallPartCache(0));
 expect(next.result!.segments).toEqual(cold.result!.segments);expect(next.result!.finalization.reusedParts).toBe(1);expect(next.fetched).toEqual([1]);
});
test('cached members have no mutable aliases across presentations',async()=>{
 const cache=new PreparedWallPartCache(),f=generation(0),first=await read(f,cache);const closed=first.result!.segments.find(s=>s.end!==null)!;
 expect(()=>{closed.valueRuns[0]!.usd=1;}).toThrow();closed.price=9;
 const second=await read(generation(1),cache),cold=await read(generation(1),new PreparedWallPartCache(0));expect(second.result!.segments).toEqual(cold.result!.segments);
});

test('oversized identity metadata falls back without retaining unaccounted keys',()=>{const cache=new PreparedWallPartCache(),tx=cache.begin('x'.repeat(8193),[part('a')]);tx.stage(0,frozen(),0);tx.commit();tx.release();expect(cache.diagnostics().accountedBytes).toBe(0);});
