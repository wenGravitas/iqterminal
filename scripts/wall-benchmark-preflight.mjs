/** Read-only benchmark admission; never prepares or queues historical work. */
const profiles=Object.freeze({spot:'binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1',perpetual:'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1'});
export const wallBenchmarkProfiles=profiles;
export const wallBenchmarkMaximumSourceMs=48*3600000;
export function wallBenchmarkSourceRequest(market,reference){
 if(!Object.hasOwn(profiles,market)||!reference||![reference.from,reference.to,reference.sourceFrom,reference.sourceTo].every(v=>Number.isSafeInteger(v)&&v>0)||reference.sourceFrom>reference.from||reference.sourceTo<reference.to||reference.from>=reference.to||reference.sourceTo-reference.sourceFrom>wallBenchmarkMaximumSourceMs||typeof reference.sourceToken!=='string'||! /^[a-f0-9]{64}$/.test(reference.sourceToken))throw Error('Invalid bounded benchmark source reference');
 return {market,profile:profiles[market],from:reference.sourceFrom,to:reference.sourceTo};
}
export async function wallBenchmarkPreflight(base,market,reference,{fetcher=fetch,signal}={}){
 const request=wallBenchmarkSourceRequest(market,reference),url=new URL('/market-data/v2/history/walls/source',base);url.search=new URLSearchParams(Object.entries(request).map(([k,v])=>[k,String(v)])).toString();
 const started=performance.now(),deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);let response,reader;
 try{
  response=await fetcher(url,{signal:deadline,headers:{'cache-control':'no-cache'}});if(response.status!==200)throw Error('source-http-'+response.status);
  if(!response.body)throw Error('source-body-unavailable');reader=response.body.getReader();const chunks=[];let size=0;
  for(;;){deadline.throwIfAborted();const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>65536)throw Error('source-body-capacity');chunks.push(Buffer.from(next.value));}deadline.throwIfAborted();const proof=JSON.parse(Buffer.concat(chunks,size).toString());
  if(!proof||proof.version!==1||proof.kind!=='wall-source-sha256-xor-v1'||Object.entries(request).some(([k,v])=>proof[k]!==v)||typeof proof.eligible!=='boolean'||typeof proof.token!=='string'||!/^[a-f0-9]{64}$/.test(proof.token))throw Error('source-proof-context');
  const reason=!proof.eligible?'source-ineligible':proof.token!==reference.sourceToken?'reference-source-changed':undefined;
  return {kind:'wall-benchmark-source-preflight-v1',state:reason?'refused':'eligible',...(reason?{reason}:{}),request,expectedToken:reference.sourceToken,proof,ms:performance.now()-started,jobsRequested:false};
 }catch(error){return {kind:'wall-benchmark-source-preflight-v1',state:'refused',reason:deadline.aborted?'source-cancelled-or-timeout':'source-unavailable',detail:String(error.message??error),request,expectedToken:reference.sourceToken,ms:performance.now()-started,jobsRequested:false};}
 finally{if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}else await response?.body?.cancel().catch(()=>{});}
}
/** The product deliberately strips absolute candle ranges at initial startup.
 * Open the target through normal panel construction after that live bootstrap. */
export async function openColdWallBenchmarkPanel(page,id,params){
 await page.waitForFunction(id=>window.__terminal?.panels.has(id)&&document.documentElement.dataset.appState==='ready',id,{timeout:15000});
 await page.evaluate(id=>{const t=window.__terminal;t.dock.removePanel(t.dock.getPanel(id));},id);
 await page.waitForFunction(id=>!window.__terminal.panels.has(id),id,{timeout:5000});
 return page.evaluate(({id,params})=>{const b=window.__wallRoute;b.phase='cold';b.start=performance.now();b.firstHistory=null;b.settled=null;b.complete=null;b.nativeData=null;b.nativeValidated=null;b.frames=[];b.tasks=[];b.observations=[];window.__terminal.dock.addPanel({id,component:'candle',tabComponent:'compact-chart',title:'Prepared wall history',params,minimumWidth:220,minimumHeight:140});return {start:b.start,historyViewport:params.historyViewport};},{id,params});
}
