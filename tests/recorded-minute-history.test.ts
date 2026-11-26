import {describe,it,expect,vi} from 'vitest';
import {minuteHistoryRequest,minuteSourceIdentity,validateMinuteHistoryPayload,readMinuteHistoryResponse,MINUTE_HISTORY_LIMITS,type MinuteHistorySource} from '../src/feed/recorded-minute-history';
import {readHistoryJson,HistoryResponseFailure} from '../src/feed/history-json';
import {recordedMinuteRequest as request,recordedMinuteWire as wire,recordedMinuteSourceIds} from './helpers/recorded-minute-wire';
const signal=()=>AbortSignal.timeout(3000);
describe('recorded minute observation wire',()=>{
 it('preserves exact signed increments, OHLC and UInt64 identifiers as sparse observations',()=>{
  const input=wire(),value=validateMinuteHistoryPayload(input,request);expect(value).toEqual(input);expect(value.bars).toHaveLength(2);expect(value.bars[0]).toMatchObject({open:'9007199254740993.00000001',quote:'9007199254740993.00000000',firstId:'9007199254740993000'});expect(value.cumulative).toBe(false);expect('revision' in value.bars[0]!).toBe(false);expect('asOf' in value).toBe(false);input.bars[0].base='999';expect(value.bars[0]!.base).toBe('-12.00000001');
 });
 it('binds all six candle/CVD source identities to actual venue and market',()=>{
  for(const dataset of ['candles','cvd'] as const)for(const [venue,market]of [['binance','spot'],['binance','perpetual'],['bybit','perpetual']] as const){const scope={...request,dataset,venue,market},value=validateMinuteHistoryPayload(wire(scope),scope);expect(minuteSourceIdentity(scope)).toBe(recordedMinuteSourceIds[dataset][`${venue}:${market}` as MinuteHistorySource]);expect(value.request).toEqual(scope);}
  const mismatched=wire();mismatched.publicationSnapshot.frontier.source=recordedMinuteSourceIds.cvd['binance:spot'];expect(()=>validateMinuteHistoryPayload(mismatched,request)).toThrow();
 });
 it('requires explicit bounded minute ranges and refuses unsupported sources',()=>{
  expect(minuteHistoryRequest(request)).toEqual(request);expect(minuteHistoryRequest({...request,from:0,to:60000}).from).toBe(0);
  for(const patch of [{from:request.from+1},{to:request.from},{to:request.from+MINUTE_HISTORY_LIMITS.rangeMs+60000},{from:NaN},{from:1e20},{venue:'coinbase'},{venue:'bybit',market:'spot'},{dataset:'depth'},{symbol:'ETHUSDT'}])expect(()=>minuteHistoryRequest({...request,...patch})).toThrow();
 });
 it('rejects decimal loss, invalid magnitudes, inverted prices, unsafe IDs and row scope',()=>{
  for(const patch of [{base:1},{quote:'9007199254740993.00000002'},{base:'-123.00000002'},{baseVolume:'-1'},{open:'0'},{close:'1e20'},{high:'9007199254740993.00000000'},{low:'9007199254740993.00000002'},{base:'1'.repeat(161)},{firstId:9007199254740993},{firstId:'18446744073709551616'},{lastId:'1'},{records:'0'},{timeMs:request.from+1},{timeMs:request.to},{venue:'bybit'},{market:'spot'},{nativeSymbol:'ETHUSDT'}]){const value=wire();Object.assign(value.bars[0],patch);expect(()=>validateMinuteHistoryPayload(value,request)).toThrow();}
  const duplicate=wire();duplicate.bars[1]=duplicate.bars[0];expect(()=>validateMinuteHistoryPayload(duplicate,request)).toThrow();const reversed=wire();reversed.bars.reverse();expect(()=>validateMinuteHistoryPayload(reversed,request)).toThrow();const tooMany=wire();tooMany.bars=Array.from({length:1441},()=>tooMany.bars[0]);expect(()=>validateMinuteHistoryPayload(tooMany,request)).toThrow();
 });
 it('keeps original gaps, unavailable ranges and partition failures without making zero rows',()=>{
  const partial=wire();partial.coverage.state='partial';partial.coverage.partitions[0].coverage={state:'partial',gaps:[{from:request.from+60000,to:request.from+120000,reason:'Original collector gap'}]};partial.partial=true;const parsed=validateMinuteHistoryPayload(partial,request);expect(parsed.coverage.partitions[0]!.coverage.gaps[0]!.reason).toBe('Original collector gap');expect(parsed.bars).toHaveLength(2);
  const empty=wire();empty.bars=[];empty.coverage.state='unavailable';empty.coverage.partitions=[];empty.coverage.missing=[{from:request.from,to:request.to}];empty.partial=true;empty.failures=[{id:'9'.repeat(64),state:'unavailable',reason:'origin'}];expect(validateMinuteHistoryPayload(empty,request).bars).toEqual([]);
 });
 it('refuses internally inconsistent or oversized coverage metadata',()=>{
  for(const change of [(v:any)=>{v.coverage.missing=[{from:request.from,to:request.to}];},(v:any)=>{v.coverage.partitions=[];},(v:any)=>{v.coverage.partitions[0].coverage.gaps=[{from:request.from,to:request.from+1,reason:'gap'}];},(v:any)=>{v.coverage.partitions[0].format='unknown-format';},(v:any)=>{v.coverage.partitions.push(v.coverage.partitions[0]);},(v:any)=>{v.coverage.partitions=Array(65).fill(v.coverage.partitions[0]);},(v:any)=>{v.coverage.partitions[0].coverage={state:'partial',gaps:Array(4097).fill({from:request.from,to:request.from+1,reason:'gap'})};v.partial=true;v.coverage.state='partial';},(v:any)=>{v.truncated=true;},(v:any)=>{v.failures=[{id:v.coverage.partitions[0].id,state:'partial',reason:'capacity'}];v.partial=true;}]){const value=wire();change(value);expect(()=>validateMinuteHistoryPayload(value,request)).toThrow();}
 });
 it('denies promoted authority, unknown provenance and mismatched request namespaces',()=>{
  for(const change of [(v:any)=>{v.sourceAuthorityVerified=true;},(v:any)=>{v.cumulative=true;},(v:any)=>{v.nativeExchangeCandles=true;},(v:any)=>{v.publicationSnapshot.assurance.currentReconciled=true;},(v:any)=>{v.publicationSnapshot.assurance.extra=false;},(v:any)=>{v.publicationSnapshot.frontier.state='ready';},(v:any)=>{v.publicationSnapshot.frontier.reason='source-not-in-snapshot';},(v:any)=>{v.publicationSnapshot.generation=0;},(v:any)=>{v.publicationSnapshot.catalogueHead.sequence=Number.MAX_SAFE_INTEGER+1;},(v:any)=>{v.request.dataset='candles';},(v:any)=>{v.baseUnit='USD';}]){const value=wire();change(value);expect(()=>validateMinuteHistoryPayload(value,request)).toThrow();}
 });
 it('retains distinct publication identities without choosing a correction winner',()=>{
  const one=wire(),two=wire();two.publicationSnapshot.checkpoint='4'.repeat(64);two.publicationSnapshot.generation=2;two.bars[0].base='-11.00000001';expect(validateMinuteHistoryPayload(one,request).publicationSnapshot.checkpoint).not.toBe(validateMinuteHistoryPayload(two,request).publicationSnapshot.checkpoint);expect(validateMinuteHistoryPayload(one,request).bars[0]!.base).toBe('-12.00000001');
 });
});
describe('shared bounded historical JSON transport',()=>{
 it('normalizes minute payloads through a streaming body and preserves decoded size',async()=>{
  const text=JSON.stringify(wire()),result=await readMinuteHistoryResponse(new Response(text),request,signal());expect(result.bytes).toBe(new TextEncoder().encode(text).length);expect(result.payload.bars).toHaveLength(2);
 });
 it('rejects malformed UTF8/JSON, declared and chunked decoded overflow',async()=>{
  for(const response of [new Response(new Uint8Array([0xff])),new Response('{'),new Response('{}',{headers:{'content-length':String(MINUTE_HISTORY_LIMITS.responseBytes+1)}}),new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MINUTE_HISTORY_LIMITS.responseBytes));controller.enqueue(new Uint8Array([1]));controller.close();}}))])await expect(readMinuteHistoryResponse(response,request,signal())).rejects.toMatchObject({reason:'invalid',retryable:false});
 });
 it('separates endpoint disable, retryable provider failure and invalid budgets',async()=>{
  await expect(readMinuteHistoryResponse(new Response('{}',{status:404}),request,signal())).rejects.toMatchObject({reason:'disabled',retryable:false});await expect(readMinuteHistoryResponse(new Response('{}',{status:503}),request,signal())).rejects.toMatchObject({reason:'network',retryable:true});await expect(readHistoryJson(new Response('{}'),signal(),MINUTE_HISTORY_LIMITS.responseBytes+1,v=>v)).rejects.toBeInstanceOf(HistoryResponseFailure);
 });
 it('drains a body that ignores cancellation before releasing the read',async()=>{
  let finish!:()=>void;const cancel=vi.fn(()=>new Promise<void>(r=>finish=r)),response=new Response(new ReadableStream({cancel})),abort=new AbortController();let settled=false;const work=readMinuteHistoryResponse(response,request,abort.signal).finally(()=>settled=true);abort.abort();await Promise.resolve();expect(cancel).toHaveBeenCalledOnce();expect(settled).toBe(false);finish();await expect(work).rejects.toThrow();expect(settled).toBe(true);
 });
 it('waits for HTTP-error response cancellation too',async()=>{
  let finish!:()=>void;const cancel=vi.fn(()=>new Promise<void>(r=>finish=r)),response=new Response(new ReadableStream({cancel}),{status:503});let settled=false;const work=readMinuteHistoryResponse(response,request,signal()).finally(()=>settled=true);await Promise.resolve();expect(cancel).toHaveBeenCalledOnce();expect(settled).toBe(false);finish();await expect(work).rejects.toMatchObject({reason:'network'});
 });
});
