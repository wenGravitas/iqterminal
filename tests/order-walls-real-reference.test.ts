import {test,expect} from 'vitest';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OrderWallsArchiveProjector,orderWallsArchiveProfileId,type OrderWallsArchivePage} from '../src/feed/order-walls-archive';
import {DEFAULT_ORDER_WALLS_SETTINGS,orderWallsSettings} from '../src/feed/order-walls';
const enabled=process.env.IQ_PI_REAL_REFERENCE==='1';
test.skipIf(!enabled)('exact display batches match legacy canonical walls on bounded real Spot and USD-M history',async()=>{
 const {end}=JSON.parse(readFileSync('artifacts/pi-history-r1/windows.json','utf8')),from=end-3600000,to=end;
 const results=[];
 for(const market of ['binance-spot','binance-perp'] as const){
  const settings=orderWallsSettings({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels',topLevels:8,minDurationMs:0,aggregation:'native'});
  const profile=orderWallsArchiveProfileId(market,settings)!;let watermark:number|undefined;
  const load=async(display:boolean)=>{
   const projector=new OrderWallsArchiveProjector(settings,from,to),patches:unknown[]=[],requests=[];let after=0;
   for(let i=0;i<64;i++){
    const params=new URLSearchParams({market:market==='binance-spot'?'spot':'perpetual',profile,from:String(from),to:String(to),after:String(after),limit:'256',...(watermark===undefined?{}:{watermark:String(watermark)}),...(display?{display:'1'}:{})});
    const started=performance.now(),response=await fetch(`http://127.0.0.1:18780/v1/order-walls/archive?${params}`,{signal:AbortSignal.timeout(20000)});expect(response.ok).toBe(true);
    const body=await response.json() as OrderWallsArchivePage;watermark??=body.watermark;expect(body.watermark).toBe(watermark);
    expect(body.coverage.status).not.toBe('unavailable');projector.applyPage(body);patches.push(...body.patches);after=body.page.nextAfter;
    requests.push({after:body.page.after,nextAfter:after,hasMore:body.page.hasMore,patches:body.patches.length,ms:performance.now()-started,headers:Object.fromEntries(response.headers)});
    if(!body.page.hasMore)return {segments:JSON.parse(JSON.stringify(projector.snapshot())),patches,requests};
   }
   throw Error('Bounded real reference exceeded 64 pages');
  };
  const display=await load(true),legacy=await load(false);expect(display.patches).toEqual(legacy.patches);expect(display.segments).toEqual(legacy.segments);
  results.push({market,profile,from,to,watermark,patches:display.patches.length,segments:display.segments.length,hash:createHash('sha256').update(JSON.stringify(display.segments)).digest('hex'),displayRequests:display.requests,legacyRequests:legacy.requests,result:'exact-match'});
 }
 writeFileSync('artifacts/pi-history-r1/real-wall-canonical-reference.json',JSON.stringify(results,null,2)+'\n');
},120000);
