import {describe,it,expect} from 'vitest';
import {CvdContributionLedger} from '../src/feed/cvd-contribution-ledger';
import {recordedMinuteWire} from './helpers/recorded-minute-wire';
const D=86400000,H=3600000,M=60000,day=Date.UTC(2026,10,1),source='binance:perpetual' as const,id='12345678-1234-4abc-8abc-123456789abc';
const rows=[{timeMs:day,base:'9007199254740993.00000001',quote:'100',firstId:'1',lastId:'1',records:'1'},{timeMs:day+23*H,base:'-2',quote:'-20',firstId:'2',lastId:'2',records:'1'}];
function archive(from:number,to:number,values=rows){
 const request={dataset:'cvd',venue:'binance',market:'perpetual',from,to} as const,p=recordedMinuteWire(request),sample=p.bars[0],s=p.publicationSnapshot;
 p.bars=values.filter(r=>r.timeMs>=from&&r.timeMs<to).map(r=>({...sample,...r,baseVolume:r.base.replace('-',''),quoteVolume:r.quote.replace('-','')}));
 p.observationLease={kind:'iq-recorded-minute-observation-lease-v1',id,checkpoint:s.checkpoint,generation:s.generation,catalogueHead:s.catalogueHead,witness:'f'.repeat(64),source:s.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope:request,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};return p;
}
function setup(){
 const l=new CvdContributionLedger(source,'restore-basis'),from=day+D,to=from+M;
 l.applyNative({version:2,semantics:'native-recorded-execution-minute-observations',source:source+':BTCUSDT',incarnation:id,revision:1,revisionScope:'incarnation',replacement:'requested-range',fullProjectionAt:to+1,snapshot:true,stepMs:M,from,to,retainedFrom:from,watermark:'100',watermarkKind:'aggregate-execution-id',baseUnit:'BTC',quoteUnit:'USDT',buckets:[],coverage:{from,to,gaps:[]},status:'live',asOf:to+1,sparse:true,cumulative:false,financialAccepted:false,currentReconciled:false,retirementAuthorized:false});
 l.applyArchive(archive(day,day+D));l.evict(day);return l;
}
describe('bounded sealed CVD day reconstruction',()=>{
 it('restores multiple independently validated pages atomically and retains exact totals/version',()=>{
  const l=setup(),before=l.sum(day,day+D),version=l.diagnostics().version,stage=l.beginArchiveRestore(day);expect(stage.next()).toEqual({from:day+23*H,to:day+D});
  stage.append(archive(day+23*H,day+D));expect(stage.diagnostics()).toMatchObject({pages:1,missingRecords:1});expect(l.sum(day,day+D)).toEqual(before);expect(()=>l.sum(day,day+M)).toThrowError(expect.objectContaining({reason:'restore'}));
  stage.append(archive(day,day+H));expect(stage.next()).toBeUndefined();expect(stage.finish()).toEqual({changed:false,version});expect(l.sum(day,day+M).base).toBe('9007199254740993.00000001');expect(l.sum(day,day+D)).toEqual(before);expect(l.diagnostics().version).toBe(version);expect(()=>stage.finish()).toThrow();
 });
 it('does not require downloading hours with no previously accepted executions',()=>{
  const l=setup(),stage=l.beginArchiveRestore(day);stage.append(archive(day,day+H));expect(stage.next()).toEqual({from:day+23*H,to:day+D});expect(()=>stage.finish()).toThrowError(expect.objectContaining({reason:'restore'}));expect(l.diagnostics().residentCells).toBe(1);
 });
 it('duplicate pages do not double count and a conflicting page leaves the staged candidate unchanged',()=>{
  const l=setup(),stage=l.beginArchiveRestore(day),page=archive(day,day+H);stage.append(page);stage.append(page);const before=stage.diagnostics(),bad=structuredClone(page);bad.bars[0].base='2';expect(()=>stage.append(bad)).toThrowError(expect.objectContaining({reason:'conflict'}));expect(stage.diagnostics()).toEqual(before);stage.append(archive(day+23*H,day+D));stage.finish();expect(l.sum(day,day+D).base).toBe('9007199254740991.00000001');
 });
 it('a fully staged but wrong quantity fails checksum verification without altering accepted history',()=>{
  const l=setup(),before=l.diagnostics(),stage=l.beginArchiveRestore(day),bad=archive(day,day+D);bad.bars[0].base='2';stage.append(bad);expect(()=>stage.finish()).toThrowError(expect.objectContaining({reason:'conflict'}));expect(l.diagnostics()).toEqual(before);expect(l.sum(day,day+D).base).toBe('9007199254740991.00000001');
 });
 it('a changed publication may supply equal bytes without granting new provenance or authority',()=>{
  const l=setup(),stage=l.beginArchiveRestore(day),before=l.diagnostics(),page=archive(day+23*H,day+D);stage.append(archive(day,day+H));page.publicationSnapshot.generation=2;page.observationLease.generation=2;page.publicationSnapshot.checkpoint='4'.repeat(64);page.observationLease.checkpoint='4'.repeat(64);stage.append(page);stage.finish();expect(l.diagnostics().provenanceBytes).toBe(before.provenanceBytes);expect(l.sum(day,day+D).financialAccepted).toBe(false);
 });
 it('reconstruction cannot overwrite a concurrently replaced block, even with the same seal hash',()=>{
  const l=setup(),stage=l.beginArchiveRestore(day);stage.append(archive(day,day+D));l.restoreArchive(archive(day,day+D));l.evict(day);expect(()=>stage.finish()).toThrowError(expect.objectContaining({reason:'basis'}));
 });
 it('refuses foreign day/source input and bounds page attempts',()=>{
  const l=setup(),stage=l.beginArchiveRestore(day);expect(()=>stage.append(archive(day-M,day+M))).toThrowError(expect.objectContaining({reason:'basis'}));const foreign=archive(day,day+H);foreign.request.venue='bybit';expect(()=>stage.append(foreign)).toThrow();expect(stage.diagnostics().pages).toBe(0);
  for(let n=0;n<32;n++)stage.append(archive(day,day+H));expect(()=>stage.append(archive(day+23*H,day+D))).toThrowError(expect.objectContaining({reason:'capacity'}));expect(l.diagnostics().sealedDays).toBe(1);
 });
});
