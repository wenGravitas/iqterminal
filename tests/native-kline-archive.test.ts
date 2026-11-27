import {expect,test,vi} from 'vitest';
import {nativeArchiveRequest,nativeArchiveIdentity,validateNativeArchive,nativeArchiveCandles,readNativeArchive} from '../src/feed/native-kline-archive';
import {HistoryScheduler} from '../src/feed/history-scheduler';
const H='a'.repeat(64),step=60000,series={venue:'binance',market:'perpetual',interval:'1m'} as const;
const request=nativeArchiveRequest(series,0,4*step);
function fixture(){return {version:1,kind:'archived-native-kline-observations-v1',scope:{...request.scope},from:0,to:4*step,stepMs:step,bars:[0,step,3*step].map(timeMs=>({timeMs,closeTimeMs:timeMs+step-1,open:'80000.1234567890123456789',high:'80001',low:'79999',close:'80000.2',baseVolume:'2.000000000000000001',quoteVolume:'160000',trades:'18446744073709551615',takerBuyBaseVolume:'1',takerBuyQuoteVolume:'80000'})),coverage:{state:'partial',missing:[{from:2*step,to:3*step}]},publications:[{id:H,revision:H,observedAtMs:4*step}],publicationSnapshot:{kind:'iq-archive-publication-asof-v1',checkpoint:H,generation:1,catalogueHead:{version:1,origin:H,authority:H,sequence:1,hash:H,partitions:1,rawBytes:1,proofs:0,proofBytes:0},frontier:{source:nativeArchiveIdentity(request),state:'unavailable',reason:'no-independent-frontier-v1'},assurance:{sourceAuthorityVerified:false,currentReconciled:false,retirementAuthorized:false,nativeActivationAuthorized:false}},nativeExchangeCandles:true,sourceAuthorityVerified:false,currentReconciled:false,financialAccepted:false,retirementAuthorized:false,partial:true};}
test('exact sparse native observations survive validation and display conversion does not mutate them',()=>{
 const input=fixture(),payload=validateNativeArchive(input,request),before=JSON.stringify(payload),candles=nativeArchiveCandles(payload);
 expect(payload.bars[0]?.open).toBe('80000.1234567890123456789');expect(payload.bars[0]?.trades).toBe('18446744073709551615');expect(candles.map(b=>b.t)).toEqual([0,step,3*step]);expect(candles.every(b=>b.closed&&b.revision===0)).toBe(true);expect(JSON.stringify(payload)).toBe(before);
 input.bars[0]!.open='1';expect(payload.bars[0]?.open).not.toBe('1');
});
test('source identity matches independent backend golden encoding',()=>{
 expect(nativeArchiveIdentity(request)).toBe('18a5dd2ab0375e452c782bf6e6109420251a28e7b07c2574c586114ae3e99352');
});
test.each([
 ['venue',(v:any)=>v.scope.venue='bybit'],['market',(v:any)=>v.scope.market='spot'],['symbol',(v:any)=>v.scope.nativeSymbol='ETHUSDT'],['interval',(v:any)=>v.scope.interval='5m'],['range',(v:any)=>v.to+=step],['precision',(v:any)=>v.bars[0].trades=18446744073709551615],['u64 overflow',(v:any)=>v.bars[0].trades='18446744073709551616'],['duplicate bar',(v:any)=>v.bars[1]=v.bars[0]],['OHLC',(v:any)=>v.bars[0].high='1'],['volume',(v:any)=>v.bars[0].takerBuyBaseVolume='3'],['close time',(v:any)=>v.bars[0].closeTimeMs++],['wrong missing',(v:any)=>v.coverage.missing=[]],['coverage',(v:any)=>v.coverage.state='complete'],['partial flag',(v:any)=>v.partial=false],['authority',(v:any)=>v.financialAccepted=true],['witness assurance',(v:any)=>v.publicationSnapshot.assurance.currentReconciled=true],['foreign stream',(v:any)=>v.publicationSnapshot.frontier.source=H],['missing witness',(v:any)=>delete v.publicationSnapshot],['no publications',(v:any)=>v.publications=[]],['duplicate publications',(v:any)=>v.publications.push(v.publications[0])],['unbounded observation',(v:any)=>v.publications[0].observedAtMs=Infinity],['recorded candles',(v:any)=>v.nativeExchangeCandles=false]
])('rejects %s',(_name,change)=>{const input=fixture();change(input);expect(()=>validateNativeArchive(input,request)).toThrow();});
test('empty archive response requires the entire requested range missing',()=>{
 const input=fixture();input.bars=[];input.publications=[];input.coverage={state:'unavailable',missing:[{from:0,to:4*step}]};expect(validateNativeArchive(input,request).coverage.state).toBe('unavailable');
 input.coverage.missing=[];expect(()=>validateNativeArchive(input,request)).toThrow();
});
test('unsupported and oversized scopes fail before fetch',async()=>{
 for(const s of [{...series,interval:'30m' as const},{...series,interval:'1d' as const},{...series,venue:'hyperliquid' as const}])expect(()=>nativeArchiveRequest(s,0,step)).toThrow();
 expect(()=>nativeArchiveRequest(series,0,1001*step)).toThrow();expect(()=>nativeArchiveRequest({...series,interval:'4h'},0,32*86400000)).toThrow();
 const fetcher=vi.fn();await expect(readNativeArchive(request,AbortSignal.abort(),fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
test('same-window consumers share transport; cancelling one leaves its peer and exact result intact',async()=>{
 const scheduler=new HistoryScheduler(1),a=new AbortController(),b=new AbortController();let finish!:(r:Response)=>void;
 const fetcher=vi.fn((_url:RequestInfo|URL,_init?:RequestInit)=>new Promise<Response>(resolve=>finish=resolve));
 const first=readNativeArchive(request,a.signal,fetcher as typeof fetch,scheduler),second=readNativeArchive(request,b.signal,fetcher as typeof fetch,scheduler);const cancelled=expect(first).rejects.toThrow();
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));a.abort();await cancelled;expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
 finish(new Response(JSON.stringify(fixture())));expect((await second).bars).toHaveLength(3);expect(fetcher.mock.calls[0]?.[0]).toContain('/v2/history/native-candles?venue=binance&market=perpetual&symbol=BTCUSDT');
});
test('disabled or unavailable endpoint never falls back to another candle source',async()=>{
 const fetcher=vi.fn(async()=>new Response('',{status:503}));await expect(readNativeArchive(request,new AbortController().signal,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
});
