import {test,expect,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadOrderWallsArchive} from '../src/feed/order-walls-archive';
import {orderWallsSettings} from '../src/feed/order-walls';

// Explicit real-route check. Never run network/source preparation in unit tests.
test.skipIf(process.env.IQ_WALL_NEWEST_FIRST_LIVE!=='1')('newest-first prepared walls equal chronological raw replay on bounded real histories',async()=>{
 const origin=process.env.IQ_WALL_REFERENCE_ORIGIN??'http://127.0.0.1:18780',results:unknown[]=[];
 const health=await fetch(origin+'/v2/history/health',{signal:AbortSignal.timeout(20000)}).then(r=>r.json());
 const to=Math.floor((health.materializer.head.at-60000)/60000)*60000,from=to-300000;
 const settings=orderWallsSettings({enabled:true,mode:'top-levels',topLevels:8,aggregation:'native',searchRangePercent:10});
 try{
  for(const market of ['binance-spot','binance-perp'] as const){
   const paths:string[]=[],fetcher:typeof fetch=(input,init)=>{
    const url=new URL(String(input),'http://local');paths.push(url.pathname);return fetch(origin+url.pathname.replace(/^\/market-data/,'')+url.search,init);
   };
   vi.stubEnv('VITE_HISTORY_TILES','0');vi.stubEnv('VITE_WALL_NEWEST_FIRST','0');
   const raw=await loadOrderWallsArchive({request:{market,from,to,settings},fetcher,signal:AbortSignal.timeout(60000)});
   expect(raw.status.archive?.requestComplete).toBe(true);expect(raw.status.archive?.exact).toBe(true);expect(raw.segments.length).toBeGreaterThan(0);
   vi.stubEnv('VITE_WALL_NEWEST_FIRST','1');const parts:number[]=[],coldStart=performance.now();
   const prepared=await loadOrderWallsArchive({request:{market,from,to,settings,watermark:raw.watermark,head:raw.head},fetcher,signal:AbortSignal.timeout(90000),onPageMetrics:m=>{if(m.delivery==='projection')parts.push(m.partIndex!);}});
   expect(parts.length).toBeGreaterThan(0);expect(parts).toEqual([...parts].sort((a,b)=>b-a));
   expect(prepared.status.archive?.requestComplete).toBe(true);expect(prepared.segments).toEqual(raw.segments);
   expect(prepared.status.archive?.gaps).toEqual(raw.status.archive?.gaps);expect(prepared.status.archive?.rangeComplete).toBe(raw.status.archive?.rangeComplete);
   const firstPreparedMs=performance.now()-coldStart,warmStart=performance.now(),warmParts:number[]=[];
   const reopened=await loadOrderWallsArchive({request:{market,from,to,settings,watermark:raw.watermark,head:raw.head},fetcher,signal:AbortSignal.timeout(60000),onPageMetrics:m=>{if(m.delivery==='projection')warmParts.push(m.partIndex!);}});
   expect(reopened.segments).toEqual(raw.segments);expect(reopened.status.archive?.requestComplete).toBe(true);expect(warmParts.length).toBeGreaterThan(0);
   results.push({market,origin,from,to,watermark:raw.watermark,segments:prepared.segments.length,parts,warmParts,firstPreparedMs,reopenedMs:performance.now()-warmStart,paths,coverage:prepared.status.archive,sha256:createHash('sha256').update(JSON.stringify(prepared.segments)).digest('hex'),result:'exact-match'});
  }
  mkdirSync('artifacts/order-walls-newest-first',{recursive:true});writeFileSync('artifacts/order-walls-newest-first/real-reference.json',JSON.stringify(results,null,2)+'\n');
 }finally{vi.unstubAllEnvs();}
},320000);
