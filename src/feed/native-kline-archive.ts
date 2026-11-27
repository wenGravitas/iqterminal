/** Native observations retain exact strings; Number conversion is display-only. */
import {sha256} from '@noble/hashes/sha2.js';
import {compareDecimalText} from './decimal';
import {historyRecord as record,historyHash as hash,historyInteger as integer,historyCatalogueHead,type HistoryCatalogueHead} from './history-archive-metadata';
import {readHistoryJson} from './history-json';
import {duration,marketOf,type Candle,type Series,type Market,type Interval} from './protocol';
import {historyScheduler,type HistoryScheduler} from './history-scheduler';
export const NATIVE_ARCHIVE_LIMITS=Object.freeze({rows:1000,rangeMs:31*86400000,responseBytes:4*1024**2,timeoutMs:8000,publications:128});
export interface NativeArchiveRequest {scope:{venue:'binance';market:Market;nativeSymbol:'BTCUSDT';interval:Interval};from:number;to:number}
export interface NativeArchiveBar {timeMs:number;closeTimeMs:number;open:string;high:string;low:string;close:string;baseVolume:string;quoteVolume:string;trades:string;takerBuyBaseVolume:string;takerBuyQuoteVolume:string}
export interface NativeArchivePayload {version:1;kind:'archived-native-kline-observations-v1';scope:NativeArchiveRequest['scope'];from:number;to:number;stepMs:number;bars:NativeArchiveBar[];coverage:{state:'complete'|'partial'|'unavailable';missing:Array<{from:number;to:number}>};publications:Array<{id:string;observedAtMs:number;revision:string}>;publicationSnapshot:{kind:'iq-archive-publication-asof-v1';checkpoint:string;generation:number;catalogueHead:HistoryCatalogueHead;frontier:{source:string;state:'unavailable';reason:'no-independent-frontier-v1'};assurance:{sourceAuthorityVerified:false;currentReconciled:false;retirementAuthorized:false;nativeActivationAuthorized:false}};nativeExchangeCandles:true;sourceAuthorityVerified:false;currentReconciled:false;financialAccepted:false;retirementAuthorized:false;partial:boolean}
function fail():never{throw Error('Native candle archive contract mismatch');}
export function nativeArchiveRequest(series:Series,from:number,to:number):NativeArchiveRequest {
 const step=duration[series.interval];if(series.venue!=='binance'||!['spot','perpetual'].includes(marketOf(series))||!['1m','5m','15m','1h','4h'].includes(series.interval)||!step||![from,to].every(v=>integer(v)&&v%step===0)||from>=to||to-from>NATIVE_ARCHIVE_LIMITS.rangeMs||(to-from)/step>NATIVE_ARCHIVE_LIMITS.rows)fail();
 return {scope:{venue:'binance',market:marketOf(series),nativeSymbol:'BTCUSDT',interval:series.interval},from,to};
}
export function nativeArchiveIdentity(r:NativeArchiveRequest){return [...sha256(new TextEncoder().encode(JSON.stringify(['native-binance-kline-observations-v1',r.scope])))].map(v=>v.toString(16).padStart(2,'0')).join('');}
const decimal=(v:unknown):v is string=>typeof v==='string'&&v.length<=160&&/^(0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/.test(v);
const uint=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
const barFields=['timeMs','closeTimeMs','open','high','low','close','baseVolume','quoteVolume','trades','takerBuyBaseVolume','takerBuyQuoteVolume'];
export function validateNativeArchive(value:unknown,request:NativeArchiveRequest):NativeArchivePayload {
 const r=nativeArchiveRequest({venue:request.scope.venue,market:request.scope.market,interval:request.scope.interval},request.from,request.to),step=duration[r.scope.interval];
 if(request.scope.nativeSymbol!=='BTCUSDT'||!record(value)||value.version!==1||value.kind!=='archived-native-kline-observations-v1'||!record(value.scope)||Object.keys(value.scope).length!==4||Object.entries(r.scope).some(([k,v])=>value.scope[k]!==v)||value.from!==r.from||value.to!==r.to||value.stepMs!==step||value.nativeExchangeCandles!==true||!['sourceAuthorityVerified','currentReconciled','financialAccepted','retirementAuthorized'].every(k=>value[k]===false)||!Array.isArray(value.bars)||value.bars.length>NATIVE_ARCHIVE_LIMITS.rows)fail();
 const bars:NativeArchiveBar[]=value.bars.map((b:unknown)=>{
  if(!record(b)||Object.keys(b).sort().join(',')!==[...barFields].sort().join(',')||!integer(b.timeMs)||b.timeMs<r.from||b.timeMs>=r.to||b.timeMs%step||b.closeTimeMs!==b.timeMs+step-1||!uint(b.trades)||barFields.slice(2).filter(k=>k!=='trades').some(k=>!decimal(b[k])))fail();
  if(compareDecimalText(b.low,'0')<=0||compareDecimalText(b.low,b.high)>0||['open','close'].some(k=>compareDecimalText(b[k],b.low)<0||compareDecimalText(b[k],b.high)>0)||compareDecimalText(b.takerBuyBaseVolume,b.baseVolume)>0||compareDecimalText(b.takerBuyQuoteVolume,b.quoteVolume)>0||b.trades==='0'&&(b.baseVolume!=='0'||b.quoteVolume!=='0'))fail();
  return Object.fromEntries(barFields.map(k=>[k,b[k]])) as unknown as NativeArchiveBar;
 });
 const missing:Array<{from:number;to:number}>=[];let at=r.from;
 for(const b of bars){if(b.timeMs<at)fail();if(b.timeMs>at)missing.push({from:at,to:b.timeMs});at=b.timeMs+step;}if(at<r.to)missing.push({from:at,to:r.to});
 const state=!bars.length?'unavailable':missing.length?'partial':'complete';
 if(!record(value.coverage)||value.coverage.state!==state||JSON.stringify(value.coverage.missing)!==JSON.stringify(missing)||value.partial!==(state!=='complete')||!Array.isArray(value.publications)||value.publications.length>NATIVE_ARCHIVE_LIMITS.publications||bars.length&&!value.publications.length)fail();
 const ids=new Set<string>(),publications=value.publications.map((p:unknown)=>{if(!record(p)||!hash(p.id)||ids.has(p.id)||!hash(p.revision)||!integer(p.observedAtMs))fail();ids.add(p.id);return {id:p.id,observedAtMs:p.observedAtMs,revision:p.revision};});
 const s=value.publicationSnapshot;
 if(!record(s)||s.kind!=='iq-archive-publication-asof-v1'||!hash(s.checkpoint)||!integer(s.generation,1)||!record(s.frontier)||s.frontier.source!==nativeArchiveIdentity(r)||s.frontier.state!=='unavailable'||s.frontier.reason!=='no-independent-frontier-v1'||!record(s.assurance)||Object.keys(s.assurance).sort().join(',')!=='currentReconciled,nativeActivationAuthorized,retirementAuthorized,sourceAuthorityVerified'||!Object.values(s.assurance).every(v=>v===false))fail();
 return {version:1,kind:value.kind,scope:r.scope,from:r.from,to:r.to,stepMs:step,bars,coverage:{state,missing},publications,publicationSnapshot:{kind:s.kind,checkpoint:s.checkpoint,generation:s.generation,catalogueHead:historyCatalogueHead(s.catalogueHead),frontier:{source:s.frontier.source,state:'unavailable',reason:'no-independent-frontier-v1'},assurance:{sourceAuthorityVerified:false,currentReconciled:false,retirementAuthorized:false,nativeActivationAuthorized:false}},nativeExchangeCandles:true,sourceAuthorityVerified:false,currentReconciled:false,financialAccepted:false,retirementAuthorized:false,partial:state!=='complete'};
}
/** Keep full exact payload beside the optional chart projection. */
export function nativeArchiveCandles(payload:NativeArchivePayload):Candle[]{return payload.bars.map(b=>{const c={t:b.timeMs,o:Number(b.open),h:Number(b.high),l:Number(b.low),c:Number(b.close),v:Number(b.baseVolume),revision:0,closed:true};if(![c.o,c.h,c.l,c.c,c.v].every(Number.isFinite)||c.l<=0)fail();return c;});}
export function readNativeArchive(request:NativeArchiveRequest,signal:AbortSignal,fetcher:typeof fetch=fetch,scheduler:HistoryScheduler=historyScheduler){
 const r=nativeArchiveRequest({venue:request.scope.venue,market:request.scope.market,interval:request.scope.interval},request.from,request.to);if(request.scope.nativeSymbol!=='BTCUSDT')fail();
 const url='/market-data/v2/history/native-candles?'+new URLSearchParams({venue:r.scope.venue,market:r.scope.market,symbol:r.scope.nativeSymbol,interval:r.scope.interval,from:String(r.from),to:String(r.to)});
 return scheduler.read(url,'candles',signal,async shared=>{const bounded=AbortSignal.any([shared,AbortSignal.timeout(NATIVE_ARCHIVE_LIMITS.timeoutMs)]);bounded.throwIfAborted();const response=await fetcher(url,{signal:bounded});return (await readHistoryJson(response,bounded,NATIVE_ARCHIVE_LIMITS.responseBytes,v=>validateNativeArchive(v,r))).payload;},1);
}
