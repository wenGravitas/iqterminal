import {describe,it,expect,vi} from 'vitest';
import {validateMinuteLease,validateLeasedMinutePayload,minuteSessionScope,MINUTE_SESSION_LIMITS} from '../src/feed/recorded-minute-lease';
import {RecordedMinuteSessionClient} from '../src/feed/recorded-minute-session';
import {recordedMinuteRequest as request,recordedMinuteWire as wire} from './helpers/recorded-minute-wire';
import type {MinuteHistoryRequest} from '../src/feed/recorded-minute-history';
const token='e'.repeat(64),json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
function certificate(scope:MinuteHistoryRequest=request){const p=wire({...scope,to:Math.min(scope.to,scope.from+86400000)}).publicationSnapshot;return {kind:'iq-recorded-minute-observation-lease-v1',id:'12345678-1234-4abc-8abc-123456789abc',checkpoint:p.checkpoint,generation:p.generation,catalogueHead:p.catalogueHead,witness:'f'.repeat(64),source:p.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope:{...scope},witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};}
function fixture(scope:MinuteHistoryRequest=request){
 let now=1000;const cert=certificate(scope),calls:Array<{url:string;init:RequestInit}>=[];
 const fetch=vi.fn(async(url:RequestInfo|URL,init:RequestInit={})=>{calls.push({url:String(url),init});if(init.method==='POST')return json({version:1,token,lease:cert});if(init.method==='DELETE')return json({version:1,released:true});return json({...wire(request),observationLease:cert});});
 const client=new RecordedMinuteSessionClient(true,fetch,()=>now);return {client,cert,fetch,calls,time:(value:number)=>now=value};
}
describe('publication lease contract',()=>{
 it('accepts the exact backend certificate and a bounded long scope',()=>{
  const long={...request,to:request.from+31*86400000};expect(minuteSessionScope(long)).toEqual(long);expect(validateMinuteLease(certificate(long),long)).toEqual(certificate(long));
  for(const patch of [{to:request.from+32*86400000},{from:request.from+1},{venue:'bybit',market:'spot'},{instrument:'ETHUSDT'}])expect(()=>minuteSessionScope({...long,...patch})).toThrow();
 });
 it('refuses promoted assurances, invalid identities, source, scope and lifetime',()=>{
  for(const patch of [{currentReconciled:true},{financialAccepted:true},{recoveryQualified:true},{retirementAuthorized:true},{witnessedAtAcquisition:false},{id:token},{generation:0},{witness:'bad'},{source:'0'.repeat(64)},{expiresAtMs:1800000060001},{expiresAtMs:1800000000000},{scope:{...request,venue:'bybit'}},{extra:false}])expect(()=>validateMinuteLease({...certificate(),...patch},request)).toThrow();
 });
 it('binds every page to the complete original certificate and publication head',()=>{
  const lease=validateMinuteLease(certificate(),request),input={...wire(),observationLease:certificate()},parsed=validateLeasedMinutePayload(input,request,lease);expect(parsed.bars[0]!.base).toBe('-12.00000001');expect(parsed.observationLease).toEqual(lease);
  for(const mutate of [(v:any)=>delete v.observationLease,(v:any)=>{v.observationLease.id='12345678-1234-4abc-8abc-123456789abd';},(v:any)=>{v.observationLease.expiresAtMs--;},(v:any)=>{v.publicationSnapshot.checkpoint='4'.repeat(64);},(v:any)=>{v.publicationSnapshot.generation++;},(v:any)=>{v.publicationSnapshot.catalogueHead.proofs++;},(v:any)=>{v.observationLease.witness='0'.repeat(64);}]){const value=structuredClone(input);mutate(value);expect(()=>validateLeasedMinutePayload(value,request,lease)).toThrow();}
 });
});
describe('bounded minute session transport',()=>{
 it('keeps the token out of URLs, returned data and diagnostics and releases explicitly',async()=>{
  const f=fixture();const opened=await f.client.open(request),page=await f.client.read(request);expect(opened).toEqual(f.cert);expect(page!.observationLease.id).toBe(f.cert.id);expect(page!.bars[0]!.firstId).toBe('9007199254740993000');expect(JSON.stringify([opened,page,f.client.diagnostics()])).not.toContain(token);
  expect(await f.client.close()).toEqual({released:true});expect(await f.client.close()).toEqual({released:false});expect(f.calls).toHaveLength(3);for(const call of f.calls){expect(call.url).not.toContain(token);expect(call.init.redirect).toBe('error');expect(call.init.cache).toBe('no-store');}expect(new Headers(f.calls[1]!.init.headers).get('X-IQ-Minute-Lease')).toBe(token);
 });
 it('preserves earlier accepted pages after origin failure without automatically replacing publication',async()=>{
  const f=fixture();await f.client.open(request);const accepted=await f.client.read(request);f.fetch.mockImplementationOnce(async()=>json({error:'private failure'},503));await expect(f.client.read(request)).rejects.toMatchObject({reason:'network',retryable:true});expect(accepted!.bars[0]!.base).toBe('-12.00000001');expect(f.calls.filter(c=>c.init.method==='POST')).toHaveLength(1);expect(f.client.diagnostics().session!.certificate).toEqual(f.cert);await f.client.close();
 });
 it('quarantines inconsistent pages without modifying previously accepted data or issuing more reads',async()=>{
  const f=fixture();await f.client.open(request);const accepted=await f.client.read(request);f.fetch.mockImplementationOnce(async()=>json({...wire(),observationLease:{...f.cert,generation:2}}));await expect(f.client.read(request)).rejects.toMatchObject({reason:'invalid'});const calls=f.fetch.mock.calls.length;await expect(f.client.read(request)).rejects.toMatchObject({reason:'invalid'});expect(f.fetch).toHaveBeenCalledTimes(calls);expect(accepted!.publicationSnapshot.generation).toBe(1);await f.client.close();
 });
 it('uses monotonic elapsed time rather than server wall-clock age and refuses late pages',async()=>{
  const f=fixture();await f.client.open(request);f.time(60999);await f.client.read(request);f.time(61000);const calls=f.fetch.mock.calls.length;await expect(f.client.read(request)).rejects.toMatchObject({reason:'expired'});expect(f.fetch).toHaveBeenCalledTimes(calls);await f.client.close();
  const slow=fixture();slow.fetch.mockImplementationOnce(async()=>{slow.time(61000);return json({version:1,token,lease:slow.cert});});await expect(slow.client.open(request)).rejects.toMatchObject({reason:'expired'});expect(slow.client.diagnostics().session).toBeUndefined();expect(slow.fetch).toHaveBeenCalledTimes(2);
 });
 it('limits manual retry attempts and rejects out-of-scope reads before network access',async()=>{
  const f=fixture();await f.client.open(request);for(const patch of [{venue:'bybit'},{dataset:'candles'},{from:request.from-60000},{to:request.to+60000}])await expect(f.client.read({...request,...patch} as any)).rejects.toMatchObject({reason:'invalid'});expect(f.fetch).toHaveBeenCalledTimes(1);
  for(let n=0;n<MINUTE_SESSION_LIMITS.pages;n++)await f.client.read(request);await expect(f.client.read(request)).rejects.toMatchObject({reason:'capacity'});expect(f.fetch).toHaveBeenCalledTimes(33);await f.client.close();
 });
 it('a competing open never cancels the admitted acquisition',async()=>{
  const f=fixture();let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);f.fetch.mockImplementationOnce(async()=>{await gate;return json({version:1,token,lease:f.cert});});const work=f.client.open(request);await Promise.resolve();await expect(f.client.open(request)).rejects.toMatchObject({reason:'capacity'});expect(f.client.diagnostics().active).toBe(true);finish();expect(await work).toEqual(f.cert);await f.client.close();
 });
 it('known tokens from invalid acquisition responses are released before another open',async()=>{
  const f=fixture();f.fetch.mockImplementationOnce(async()=>json({version:1,token,lease:{...f.cert,financialAccepted:true}}));await expect(f.client.open(request)).rejects.toMatchObject({reason:'invalid'});expect(f.client.diagnostics().session).toBeUndefined();expect(f.calls).toHaveLength(1);expect(f.calls[0]!.init.method).toBe('DELETE');expect(new Headers(f.calls[0]!.init.headers).get('X-IQ-Minute-Lease')).toBe(token);expect(await f.client.open(request)).toEqual(f.cert);await f.client.close();
 });
 it('close waits for an abort-ignoring body to drain before releasing and allowing another session',async()=>{
  const f=fixture();await f.client.open(request);let finish!:()=>void;const cancel=vi.fn(()=>new Promise<void>(r=>finish=r));f.fetch.mockImplementationOnce(async()=>new Response(new ReadableStream({cancel})));const caller=new AbortController(),page=f.client.read(request,caller.signal);await vi.waitFor(()=>expect(f.fetch).toHaveBeenCalledTimes(2));await Promise.resolve();caller.abort();await vi.waitFor(()=>expect(cancel).toHaveBeenCalledOnce());let closed=false;const closing=f.client.close().then(v=>{closed=true;return v;});await Promise.resolve();expect(closed).toBe(false);await expect(f.client.open(request)).rejects.toMatchObject({reason:'capacity'});expect(f.fetch).toHaveBeenCalledTimes(2);finish();await expect(page).rejects.toThrow();expect(await closing).toEqual({released:true});expect(await f.client.open(request)).toEqual(f.cert);await f.client.dispose();
 });
 it('disabled and disposed clients never inspect poisoned inputs or start requests',async()=>{
  const poison=new Proxy({},{get(){throw Error('unselected input read');}}),request=vi.fn();const off=new RecordedMinuteSessionClient(false,request);expect(await off.open(poison as any,poison as any)).toBeUndefined();expect(await off.read(poison as any,poison as any)).toBeUndefined();await off.dispose();expect(request).not.toHaveBeenCalled();const on=new RecordedMinuteSessionClient(true,request);await on.dispose();expect(await on.open(poison as any)).toBeUndefined();expect(request).not.toHaveBeenCalled();
 });
});
