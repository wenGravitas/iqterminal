import type {OiHistoryRange} from '../../src/feed/raw-open-interest-history';
const hash=(s:string)=>s.repeat(64);
export function oiHistoryWire(r:OiHistoryRange,asOfMs:number):any{
 const head={version:1,origin:hash('1'),authority:hash('2'),sequence:3,hash:hash('3'),partitions:3,rawBytes:500,proofs:0,proofBytes:0};
 return {version:1,market:'perpetual',nativeSymbol:'BTC',units:'BTC',timeBasis:'sourceTimeMs',semantics:'observed-open-interest-publication-asof',...r,
  observations:r.venues.map(venue=>({venue,market:'perpetual',nativeSymbol:venue==='hyperliquid'?'BTC':'BTCUSDT',sourceTimeMs:r.from+1000,observedAtMs:Math.min(asOfMs,r.to+24*3600000),epoch:0,value:123.00000001,valueDecimal:'123.00000001',units:'BTC',source:'explicit-test',sourceTimeQuality:'exchange-event',quality:'valid',gapBefore:true})),conflicts:[],partial:false,truncated:false,
  hot:{state:'read',asOfMs,invalidRows:0,truncated:false},warm:{state:'publication-asof',catalogueHead:head,truncated:false,venues:r.venues.map((venue,index)=>({venue,truncated:false,failures:[],coverage:{version:1,tier:'warm',state:'archived',requested:{from:r.from,to:r.to},missing:[],partitions:[{id:hash(String(index+4)),sourceRevision:hash('8'),from:r.from,to:r.to,format:'iq-clickhouse-rows-v1',coverage:{state:'complete',gaps:[]}}]},publicationSnapshot:{kind:'iq-archive-publication-asof-v1',checkpoint:hash('9'),generation:1,catalogueHead:head,frontier:{source:hash(String(index+4)),state:'unavailable',reason:'no-independent-frontier-v1'},assurance:{sourceAuthorityVerified:false,currentReconciled:false,retirementAuthorized:false,nativeActivationAuthorized:false}}}))},
  sourceAuthorityVerified:false,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};
}
