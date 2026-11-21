/** Explicit real-backend acceptance; never part of fixture or ordinary unit runs. */
import {test,expect,vi} from 'vitest';
import {writeFile} from 'node:fs/promises';
import {LiquidationMapService} from '../src/feed/liquidation-map-service';
import {mapSettings} from '../src/liquidation-map/model';
import {packMap,unpackMap} from '../src/liquidation-map/wire';
test.runIf(process.env.IQ_MAP_LIVE_SMOKE==='1')('real staging four-hour acquisition retains bounded retirement history and warm cache',async()=>{
 const originalFetch=globalThis.fetch,service=new LiquidationMapService(()=>{}),base=process.env.IQ_MAP_LIVE_BASE??'http://127.0.0.1:5173';
 vi.stubEnv('VITE_DATA_MODE','staging');vi.stubEnv('VITE_DIAGNOSTICS','1');vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{const url=new URL(input,base);console.log('LIVE MAP REQUEST',url.searchParams.get('priceWidth'),url.searchParams.get('after'));const response=await originalFetch(url,init);console.log('LIVE MAP RESPONSE',response.status);return response;});
 try{
  const now=Date.now(),request={from:now-4*3600000,to:now+60000,settings:mapSettings(undefined),pending:false,dirty:true};
  const started=performance.now(),cold=await(service as any).read(request),totalElapsedMs=performance.now()-started,wire=packMap(cold),decoded=unpackMap({...cold,columns:[],profile:undefined},wire),warm=await(service as any).read({...request,settings:{...request.settings,opacity:.4}});
  expect(cold.historyVersion).toBe(2);expect(cold.columns.length).toBeGreaterThan(0);expect(decoded.columns.length).toBe(cold.columns.length);expect(wire.values.byteLength).toBeLessThanOrEqual(4800000);expect(warm.acquisition.cache).toBe('warm');expect(warm.acquisition.requests).toBe(0);expect((service as any).cacheBytes).toBeLessThanOrEqual(32*1024*1024);
  const result={kind:'real-staging-acquisition/not-fixture',totalElapsedMs,at:new Date().toISOString(),modelVersion:cold.modelVersion,historyVersion:cold.historyVersion,lookbackMs:4*3600000,requestedPriceWidth:100,effectivePriceWidth:cold.priceWidth,resolution:cold.resolution,columns:cold.columns.length,cells:cold.columns.reduce((n:number,c:any)=>n+c.cells.length,0),ipcBytes:wire.values.byteLength,estimatedCacheBytes:(service as any).cacheBytes,profileCells:cold.profile?.cells.length??0,cold:cold.acquisition,warm:warm.acquisition,sources:cold.sources.map((s:any)=>({venue:s.venue,state:s.state,mark:s.mark,quarantinedQuantity:s.quarantinedQuantity,locatedQuantity:s.locatedQuantity}))};
  await writeFile('/tmp/iq-map-live-acquisition.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{service.dispose();vi.unstubAllGlobals();vi.unstubAllEnvs();}
},300000);
