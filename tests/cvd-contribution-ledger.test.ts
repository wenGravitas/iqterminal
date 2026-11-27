import {describe,it,expect} from 'vitest';
import {CvdContributionLedger} from '../src/feed/cvd-contribution-ledger';
import {validateNativeExactCvd} from '../src/feed/cvd-exact-native';
import {cvdDecimal,cvdAdd} from '../src/feed/cvd-exact-decimal';
import {recordedMinuteWire} from './helpers/recorded-minute-wire';
import type {MinuteHistoryRequest} from '../src/feed/recorded-minute-history';
const M=60000,D=86400000,day=Date.UTC(2026,10,1),cut=day+3*M,id='12345678-1234-4abc-8abc-123456789abc';
function native(from=cut,to=cut+3*M,rows:Array<Record<string,any>>=[{time:from,base:'10',quote:'100',firstId:'100',lastId:'100',records:'1'}],revision=1,incarnation=id){return {version:2,semantics:'native-recorded-execution-minute-observations',source:'binance:perpetual:BTCUSDT',incarnation,revision,revisionScope:'incarnation',replacement:'requested-range',fullProjectionAt:to+1000,snapshot:true,stepMs:M,from,to,retainedFrom:from,watermark:'1000',watermarkKind:'aggregate-execution-id',baseUnit:'BTC',quoteUnit:'USDT',buckets:rows,coverage:{from,to,gaps:[] as Array<{from:number;to:number;reason:string}>},status:'live',asOf:to+1000,sparse:true,cumulative:false,financialAccepted:false,currentReconciled:false,retirementAuthorized:false};}
function bar(timeMs:number,base='5',quote='50',execution='1'){return {timeMs,venue:'binance',market:'perpetual',nativeSymbol:'BTCUSDT',open:'10',high:'10',low:'10',close:'10',baseVolume:base.replace(/^-/,''),quoteVolume:quote.replace(/^-/,''),base,quote,firstId:execution,lastId:execution,records:'1'};}
function archive(from=day,to=cut,rows=[bar(from)],generation=1){
 const request:MinuteHistoryRequest={dataset:'cvd',venue:'binance',market:'perpetual',from,to},p=recordedMinuteWire(request);p.bars=rows;p.publicationSnapshot.generation=generation;p.publicationSnapshot.checkpoint=String(generation%10).repeat(64);
 const s=p.publicationSnapshot;p.observationLease={kind:'iq-recorded-minute-observation-lease-v1',id,checkpoint:s.checkpoint,generation:s.generation,catalogueHead:s.catalogueHead,witness:'f'.repeat(64),source:s.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope:request,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};return p;
}
const ledger=(from=cut,to=cut+3*M)=>{const l=new CvdContributionLedger('binance:perpetual','stable-basis');l.applyNative(native(from,to));return l;};
describe('native exact boundary',()=>{
 it('preserves exact values and refuses numeric legacy fields, unsafe IDs and promoted authority',()=>{
  const payload=native();payload.buckets[0]!.base='9007199254740993.00000001';const parsed=validateNativeExactCvd(payload,'binance:perpetual');expect(parsed.buckets[0]!.base).toBe(payload.buckets[0]!.base);payload.buckets[0]!.base='mutated';expect(parsed.buckets[0]!.base).toBe('9007199254740993.00000001');
  for(const change of [(p:any)=>p.version=1,(p:any)=>p.watermark=1000,(p:any)=>p.buckets[0].base=1,(p:any)=>p.buckets[0].records='2',(p:any)=>p.currentReconciled=true,(p:any)=>p.snapshot=false,(p:any)=>p.incarnation='old',(p:any)=>p.watermarkKind='collector-sequence',(p:any)=>p.coverage.gaps=[{from:day,to:cut,reason:'foreign'}]]){const p=native();change(p);expect(()=>validateNativeExactCvd(p,'binance:perpetual')).toThrow();}
 });
 it('adds bounded signed decimals without Number rounding',()=>{expect(cvdAdd('9007199254740993.00000001','-9007199254740993')).toBe('0.00000001');expect(cvdAdd('-0.10','.1'.replace('.','0.'))).toBe('0');expect(cvdDecimal('-0.000')).toBe('0');expect(cvdDecimal('12.34000')).toBe('12.34');expect(()=>cvdAdd('1e10','1')).toThrow();});
});
describe('persistent contribution ownership',()=>{
 it('loads earlier archive contributions once and keeps the same anchor through navigation',()=>{
  const l=ledger();const before=l.sum(day,cut+3*M);expect(before.base).toBe('10');expect(before.complete).toBe(false);const p=archive();l.applyArchive(p);expect(l.sum(day,cut+3*M)).toMatchObject({base:'15',quote:'150',complete:true});const version=l.diagnostics().version,full=l.series(day,cut,cut+3*M),panned=l.series(day,cut+M,cut+3*M);expect(panned).toEqual(full.slice(1));expect(l.applyArchive(p)).toEqual({changed:false,version});expect(l.sum(day,cut+3*M).base).toBe('15');
 });
 it('marks unknown history unavailable instead of emitting an observed zero series',()=>{
  const l=ledger();expect(l.series(day,day,day+M)).toEqual([{time:day+M,base:'0',quote:'0',partial:true,available:false,observed:false}]);expect(l.sum(day,day+M)).toMatchObject({knownMinutes:0,complete:false});
 });
 it('reverse and overlapping page arrival produces identical totals without double counting',()=>{
  const one=archive(day,day+2*M,[bar(day,'2','20'),bar(day+M,'3','30','2')]),two=archive(day+M,cut,[bar(day+M,'3','30','2'),bar(day+2*M,'-1','-10','3')]);const a=ledger(),b=ledger();a.applyArchive(one);a.applyArchive(two);b.applyArchive(two);b.applyArchive(one);expect(a.sum(day,cut+3*M)).toEqual(b.sum(day,cut+3*M));expect(a.sum(day,cut+3*M)).toMatchObject({base:'14',quote:'140',complete:true});
 });
 it('retains native contributions outside newer snapshots and never uses archives to fill native-owned gaps',()=>{
  const l=ledger();l.applyArchive(archive());const next=native(cut+M,cut+4*M,[],2);l.applyNative(next);expect(l.sum(day,cut+4*M).base).toBe('15');expect(l.diagnostics().cutover).toBe(cut);l.applyArchive(archive(cut,cut+M,[bar(cut,'999','9990')]));expect(l.sum(day,cut+4*M).base).toBe('15');
 });
 it('pins ownership to the retained horizon rather than the first requested viewport page',()=>{
  const l=new CvdContributionLedger('binance:perpetual','horizon'),first=native(cut+M,cut+3*M);first.retainedFrom=cut;l.applyNative(first);expect(l.diagnostics().cutover).toBe(cut);l.applyArchive(archive(cut,cut+M,[bar(cut,'999','9990')]));expect(l.sum(cut,cut+3*M).base).toBe('10');
  const earlier=native(cut,cut+M,[{time:cut,base:'3',quote:'30',firstId:'90',lastId:'90',records:'1'}],2);earlier.watermark='1001';l.applyNative(earlier);expect(l.sum(cut,cut+3*M).base).toBe('13');expect(l.diagnostics().cutover).toBe(cut);
 });
 it('native higher revisions replace exact contributions; older replies cannot undo corrections',()=>{
  const l=ledger(),p=native();p.revision=2;p.watermark='1001';p.buckets[0]!.base='12';p.buckets[0]!.quote='120';l.applyNative(p);expect(l.sum(cut,cut+3*M).base).toBe('12');l.applyNative(native());expect(l.sum(cut,cut+3*M).base).toBe('12');const version=l.diagnostics().version;p.revision=3;p.watermark='1002';expect(l.applyNative(p)).toEqual({changed:false,version});
 });
 it('conflicting archive clocks and equal native revisions fail atomically',()=>{
  const l=ledger();l.applyArchive(archive());const before=l.sum(day,cut+3*M),version=l.diagnostics().version;expect(()=>l.applyArchive(archive(day,cut,[bar(day,'6','60')],2))).toThrowError(expect.objectContaining({reason:'conflict'}));const p=native();p.buckets[0]!.base='11';expect(()=>l.applyNative(p)).toThrowError(expect.objectContaining({reason:'conflict'}));expect(l.sum(day,cut+3*M)).toEqual(before);expect(l.diagnostics().version).toBe(version);
 });
 it('new incarnations and inconsistent durable clocks preserve the accepted basis',()=>{
  const l=ledger(),before=l.sum(cut,cut+3*M);expect(()=>l.applyNative(native(cut,cut+3*M,[],1,'12345678-1234-4abc-8abc-123456789abd'))).toThrowError(expect.objectContaining({reason:'basis'}));const p=native();p.revision=2;p.watermark='999';expect(()=>l.applyNative(p)).toThrowError(expect.objectContaining({reason:'conflict'}));expect(l.sum(cut,cut+3*M)).toEqual(before);
 });
 it('a newer global page cannot hide a rollback relative to an older accepted minute',()=>{
  const l=ledger(),other=native(cut+M,cut+2*M,[{time:cut+M,base:'20',quote:'200',firstId:'101',lastId:'101',records:'1'}],3);other.watermark='1002';l.applyNative(other);const before=l.sum(cut,cut+3*M),oldReply=native(cut,cut+M,[{time:cut,base:'11',quote:'110',firstId:'100',lastId:'100',records:'1'}],2);oldReply.watermark='999';expect(()=>l.applyNative(oldReply)).toThrowError(expect.objectContaining({reason:'conflict'}));expect(l.sum(cut,cut+3*M)).toEqual(before);
 });
 it('partial snapshots cannot remove observed native executions or manufacture known gaps as zero',()=>{
  const l=ledger(),p=native();p.revision=2;p.buckets=[];p.coverage.gaps=[{from:cut,to:cut+3*M,reason:'Collection gap'}];l.applyNative(p);expect(l.sum(cut,cut+3*M).base).toBe('10');const partial=archive();partial.partial=true;partial.coverage.state='partial';partial.coverage.partitions[0].coverage={state:'partial',gaps:[{from:day+M,to:cut,reason:'Original gap'}]};l.applyArchive(partial);expect(l.sum(day,cut)).toMatchObject({base:'5',complete:false,coveredMinutes:1});
 });
 it('capacity rejects the complete transaction and preserves existing history',()=>{
  const l=new CvdContributionLedger('binance:perpetual','tiny',{residentCells:4});l.applyNative(native());const before=l.diagnostics();expect(()=>l.applyArchive(archive())).toThrowError(expect.objectContaining({reason:'capacity'}));expect(l.diagnostics()).toEqual(before);expect(l.sum(day,cut).base).toBe('0');
 });
 it('a late overlap conflict does not admit an earlier valid prefix from the same page',()=>{
  const l=ledger();l.applyArchive(archive(day+M,cut,[bar(day+M,'3','30','2')]));const before=l.diagnostics(),sum=l.sum(day,cut);expect(()=>l.applyArchive(archive(day,cut,[bar(day,'2','20'),bar(day+M,'4','40','2')],2))).toThrowError(expect.objectContaining({reason:'conflict'}));expect(l.diagnostics()).toEqual(before);expect(l.sum(day,cut)).toEqual(sum);
 });
 it('rejects impossible archive record cardinality before admitting any contribution',()=>{
  const l=ledger(),p=archive(),before=l.diagnostics();p.bars[0].records='2';expect(()=>l.applyArchive(p)).toThrowError(expect.objectContaining({reason:'conflict'}));expect(l.diagnostics()).toEqual(before);
 });
 it('day and provenance admission limits preserve prior contributions',()=>{
  for(const limits of [{days:1},{provenanceBytes:1}]){const l=new CvdContributionLedger('binance:perpetual','bounded',limits);l.applyNative(native());const before=l.diagnostics();const p=limits.days?archive(day-D,day-D+M,[bar(day-D)]):archive();expect(()=>l.applyArchive(p)).toThrowError(expect.objectContaining({reason:'capacity'}));expect(l.diagnostics()).toEqual(before);}
  const l=new CvdContributionLedger('binance:perpetual','roots',{rootsPerDay:1});l.applyNative(native());l.applyArchive(archive(day,day+M));const before=l.diagnostics();expect(()=>l.applyArchive(archive(day+M,day+2*M,[bar(day+M,'3','30','2')],2))).toThrowError(expect.objectContaining({reason:'capacity'}));expect(l.diagnostics()).toEqual(before);
 });
});
describe('bounded resident blocks',()=>{
 it('does not evict a mutable native day, and rehydrates mixed ownership from an equal archive copy',()=>{
  const l=ledger();l.applyArchive(archive());expect(()=>l.evict(day)).toThrowError(expect.objectContaining({reason:'mutable'}));const later=native();later.revision=2;later.asOf=day+D+M;later.fullProjectionAt=later.asOf;l.applyNative(later);const before=l.sum(day,cut+3*M),version=l.diagnostics().version;l.evict(day);expect(()=>l.sum(day,day+M)).toThrowError(expect.objectContaining({reason:'restore'}));
  const copy=archive(day,cut+3*M,[bar(day),bar(cut,'10','100','100')],2);expect(l.restoreArchive(copy)).toEqual({changed:false,version});expect(l.sum(day,cut+3*M)).toEqual(before);expect(l.sum(day,day+M).base).toBe('5');expect(l.diagnostics().cutover).toBe(cut);
 });
 it('eviction retains exact totals and version, and partial boundaries require verified restoration',()=>{
  const cutoff=day+D,l=ledger(cutoff,cutoff+3*M),p=archive(day,cutoff,[bar(day+M,'5','50'),bar(cutoff-M,'-2','-20','2')]);l.applyArchive(p);const before=l.sum(day,cutoff+3*M),version=l.diagnostics().version,hash=l.evict(day);expect(hash).toMatch(/^[a-f0-9]{64}$/);expect(l.sum(day,cutoff+3*M)).toEqual(before);expect(l.diagnostics().version).toBe(version);expect(()=>l.sum(day+M,cutoff-M)).toThrowError(expect.objectContaining({reason:'restore',day}));
  const reloaded=archive(day,cutoff,p.bars,2);expect(l.applyArchive(reloaded)).toEqual({changed:false,version});expect(l.sum(day+M,cutoff-M).base).toBe('5');expect(l.evict(day)).toBe(hash);
  const tampered=archive(day,cutoff,[bar(day+M,'6','60'),bar(cutoff-M,'-2','-20','2')],3);expect(()=>l.applyArchive(tampered)).toThrowError(expect.objectContaining({reason:'conflict'}));expect(l.sum(day,cutoff+3*M)).toEqual(before);expect(l.diagnostics().version).toBe(version);
 });
 it('a complete newer native day replaces a sealed total without replaying its old minute bytes',()=>{
  const rows=[{time:day,base:'10',quote:'100',firstId:'100',lastId:'100',records:'1'},{time:day+D-M,base:'-4',quote:'-40',firstId:'101',lastId:'101',records:'1'}],l=new CvdContributionLedger('binance:perpetual','native-day');l.applyNative(native(day,day+D,rows));l.evict(day);expect(l.sum(day,day+D).base).toBe('6');const changed=structuredClone(rows);changed[0]!.base='15';changed[0]!.quote='150';l.applyNative(native(day,day+D,changed,2));expect(l.sum(day,day+D)).toMatchObject({base:'11',quote:'110',complete:true});
 });
 it('keeps a year of exact daily totals while only the current native page remains resident',()=>{
  const end=day+365*D,l=ledger(end,end+3*M);
  for(let n=0;n<365;n++){const from=day+n*D;l.applyArchive(archive(from,from+D,[bar(from,'1','10',String(10000+n))]));l.evict(from);}
  expect(l.sum(day,end)).toMatchObject({base:'365',quote:'3650',complete:true,requestedMinutes:365*1440});expect(l.diagnostics().residentCells).toBe(3);expect(l.diagnostics().sealedDays).toBe(365);expect(l.sum(day+M,day+2*M)).toMatchObject({base:'0',complete:true});
 },20000);
});
