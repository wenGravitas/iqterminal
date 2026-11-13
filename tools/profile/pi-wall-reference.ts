/** Read-only transport equivalence on retained source; run on staging loopback. */
import assert from 'node:assert/strict';
import {writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OrderWallsArchiveProjector,orderWallsArchiveProfileId,type OrderWallsArchivePage} from '../../src/feed/order-walls-archive';
import {DEFAULT_ORDER_WALLS_SETTINGS,orderWallsSettings} from '../../src/feed/order-walls';
const from=Number(process.argv[2]),to=Number(process.argv[3]),base=process.env.IQ_REFERENCE_URL??'http://127.0.0.1:18780',out=process.env.IQ_REFERENCE_OUT??'/tmp/iq-pi-wall-reference.json';
assert.ok(Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&to>from&&to-from<=3600000);
const results=[];writeFileSync(out+'.requests.jsonl','');
for(const market of ['binance-spot','binance-perp'] as const){
 const settings=orderWallsSettings({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels',topLevels:8,minDurationMs:0,aggregation:'native'}),profile=orderWallsArchiveProfileId(market,settings)!;let watermark:number|undefined;
 const load=async(display:boolean)=>{
  const projector=new OrderWallsArchiveProjector(settings,from,to),patches:unknown[]=[],requests=[];let after=0;
  for(let i=0;i<64;i++){
   const params=new URLSearchParams({market:market==='binance-spot'?'spot':'perpetual',profile,from:String(from),to:String(to),after:String(after),limit:'1000',...(watermark===undefined?{}:{watermark:String(watermark)}),...(display?{display:'1'}:{})});
   const started=performance.now(),response=await fetch(`${base}/v1/order-walls/archive?${params}`,{signal:AbortSignal.timeout(20000)});assert.ok(response.ok,`HTTP ${response.status}`);
   const body=await response.json() as OrderWallsArchivePage;watermark??=body.watermark;assert.equal(body.watermark,watermark);assert.notEqual(body.coverage.status,'unavailable');
   projector.applyPage(body);patches.push(...body.patches);after=body.page.nextAfter;
   const timing={market,display,after:body.page.after,nextAfter:after,hasMore:body.page.hasMore,patches:body.patches.length,ms:performance.now()-started,headers:Object.fromEntries(response.headers)};
   requests.push(timing);appendFileSync(out+'.requests.jsonl',JSON.stringify(timing)+'\n');
   if(!body.page.hasMore)return {segments:JSON.parse(JSON.stringify(projector.snapshot())),patches,requests};
  }
  throw Error('Reference sample exceeded 64 bounded pages');
 };
 const display=await load(true),legacy=await load(false);assert.deepEqual(display.patches,legacy.patches);assert.deepEqual(display.segments,legacy.segments);
 results.push({market,profile,from,to,watermark,patches:display.patches.length,segments:display.segments.length,valueRuns:display.segments.reduce((n:number,s:any)=>n+s.valueRuns.length,0),hash:createHash('sha256').update(JSON.stringify(display.segments)).digest('hex'),displayRequests:display.requests.length,legacyRequests:legacy.requests.length,result:'exact-match'});
 writeFileSync(out,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results.at(-1)));
}
