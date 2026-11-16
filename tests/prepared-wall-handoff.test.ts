import{expect,test,vi}from'vitest';
import{discoverPreparedWallAdmission}from'../src/feed/prepared-wall-admission';
import{preparedWallReader}from'../src/feed/prepared-wall-history';
import{wallReadControlScheduler}from'../src/feed/prepared-wall-read-lease';
import{projectionOnlyFixture,from,to,settings,profile}from'./helpers/prepared-wall-fixture';

test.each(['valid','invalid-source','reader-failure','canceled'] as const)('preparation ownership reaches the reader before cleanup: %s',async mode=>{
 const f=projectionOnlyFixture(),abort=new AbortController(),calls:string[]=[],owned=new Set<string>(),request={market:'spot' as const,profile:profile.id,from,to};
 let readerOwned=false;
 const fetcher=(async(input,init)=>{const u=new URL(String(input),'http://test');calls.push((init?.method??'GET')+' '+u.pathname);
  if(init?.method==='DELETE'){owned.delete(u.searchParams.get('consumer')!);return Response.json({});}
  if(u.pathname.endsWith('/reader')){expect(owned.size).toBe(1);if(mode==='reader-failure')return new Response('{}',{status:503});const body=JSON.parse(String(init?.body));readerOwned=true;return Response.json({version:1,leaseMs:15000,canonicalKey:body.canonicalKey,projectionKey:body.projectionKey});}
  const h=new Headers(init?.headers);owned.add(h.get('X-IQ-Wall-Consumer')!);return Response.json({...f.discovery,...(mode==='invalid-source'?{source:{}}:{}),readerLease:{version:1,leaseMs:15000},preparation:{version:1,leaseMs:15000,pollMs:1000,job:{id:'a'.repeat(64),request,phase:'ready',state:'ready',pages:1,projectionPages:1}}});
 }) as typeof fetch;
 const found=await discoverPreparedWallAdmission({request,url:'/discover',projection:true,fetcher,signal:abort.signal,decode:r=>r.json(),retainForReader:true});
 expect(owned.size).toBe(1);if(mode==='canceled')abort.abort();
 let reader;try{if(mode==='valid'){reader=await preparedWallReader(request,fetcher,abort.signal,undefined,settings,{discovery:found});expect(readerOwned).toBe(true);expect(calls.findIndex(c=>c==='POST /market-data/v2/history/walls/reader')).toBeLessThan(calls.findIndex(c=>c==='DELETE /market-data/v2/history/walls/preparation'));}else await expect(preparedWallReader(request,fetcher,abort.signal,undefined,settings,{discovery:found})).rejects.toThrow();}
 finally{reader?.dispose();abort.abort();}
 await vi.waitFor(()=>expect(wallReadControlScheduler.diagnostics()).toMatchObject({active:0,queued:0}));expect(owned.size).toBe(0);
});
