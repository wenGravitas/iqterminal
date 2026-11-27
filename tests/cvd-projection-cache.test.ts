import {describe,it,expect,vi} from 'vitest';
import {CvdContributionLedger} from '../src/feed/cvd-contribution-ledger';
import {CvdProjectionCache,type CvdProjectionRequest} from '../src/feed/cvd-projection-cache';
import {recordedMinuteWire} from './helpers/recorded-minute-wire';
const M=60000,D=86400000,day=Date.UTC(2026,10,1),source='binance:perpetual' as const,id='12345678-1234-4abc-8abc-123456789abc';
function native(from=day,to=day+6*M,base='1',revision=1){return {version:2,semantics:'native-recorded-execution-minute-observations',source:source+':BTCUSDT',incarnation:id,revision,revisionScope:'incarnation',replacement:'requested-range',fullProjectionAt:to+1000,snapshot:true,stepMs:M,from,to,retainedFrom:from,watermark:String(1000+revision),watermarkKind:'aggregate-execution-id',baseUnit:'BTC',quoteUnit:'USDT',buckets:[{time:from,base,quote:base,firstId:'100',lastId:'100',records:'1'}],coverage:{from,to,gaps:[]},status:'live',asOf:to+1000,sparse:true,cumulative:false,financialAccepted:false,currentReconciled:false,retirementAuthorized:false};}
function archive(from:number,to:number,base='1'){
 const request={dataset:'cvd',venue:'binance',market:'perpetual',from,to} as const,p=recordedMinuteWire(request),snapshot=p.publicationSnapshot;
 p.bars=[{...p.bars[0],base,quote:base,baseVolume:base.replace('-',''),quoteVolume:base.replace('-','')}];
 p.observationLease={kind:'iq-recorded-minute-observation-lease-v1',id,checkpoint:snapshot.checkpoint,generation:snapshot.generation,catalogueHead:snapshot.catalogueHead,witness:'f'.repeat(64),source:snapshot.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope:request,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};return p;
}
const view=(from=day,to=day+6*M,anchor=day,stepMs=M):CvdProjectionRequest=>({source,anchor,from,to,stepMs});
function setup(){const ledger=new CvdContributionLedger(source,'cache-basis');ledger.applyNative(native());const cache=new CvdProjectionCache(s=>s===source?ledger:undefined);return {ledger,cache};}
describe('exact resident CVD projection cache',()=>{
 it('returns isolated cached points without rereading minute cells',()=>{
  const {ledger,cache}=setup(),r=view(),first=cache.project(r);expect(first.points).toEqual(ledger.series(day,day,r.to));
  const read=vi.spyOn(ledger,'sum').mockImplementation(()=>{throw Error('must not rebuild');});first.points[0]!.base='poison';expect(cache.project(r).points[0]!.base).toBe('1');expect(read).not.toHaveBeenCalled();expect(cache.diagnostics().hits).toBe(1);
 });
 it('pans and zooms out using cached interval contributions after old cells are gone',()=>{
  const ledger=new CvdContributionLedger(source,'navigation');ledger.applyNative(native(day,day+D));const cache=new CvdProjectionCache(()=>ledger),r=view(day,day+6*M);const original=cache.project(r);ledger.evict(day);
  const read=vi.spyOn(ledger,'sum').mockImplementation(()=>{throw Error('unnecessary replay');});
  const pan=cache.project(view(day+2*M,day+6*M));expect(pan.points).toEqual(original.points.slice(2));
  const zoom=cache.project(view(day,day+6*M,day,3*M));expect(zoom.points).toEqual([{...original.points[2],observed:true},original.points[5]]);expect(read).not.toHaveBeenCalled();
 });
 it('cannot invent finer detail from a coarse cached projection',()=>{
  const ledger=new CvdContributionLedger(source,'resolution');const p=native(day,day+D);p.buckets.push({...p.buckets[0]!,time:day+M,base:'2',quote:'2'});ledger.applyNative(p);const cache=new CvdProjectionCache(()=>ledger);cache.project(view(day,day+6*M,day,3*M));ledger.evict(day);
  expect(()=>cache.project(view(day,day+6*M))).toThrowError(expect.objectContaining({reason:'restore'}));expect(cache.diagnostics().entries).toBe(1);
 });
 it('adjusts exact prefix and suffix values on a correction without rebasing the anchor',()=>{
  const {ledger,cache}=setup(),r=view(day+2*M,day+6*M);cache.project(r);const before=cache.capture(source,day,day+M),p=native(day,day+M,'9007199254740993.00000001',2);ledger.applyNative(p);cache.commit(before);
  const result=cache.project(r);expect(result.points).toEqual(ledger.series(day,r.from,r.to));expect(result.points[0]!.base).toBe('9007199254740993.00000001');expect(result).toMatchObject({stale:false,ledgerVersion:2,financialAccepted:false,currentReconciled:false});
 });
 it('recomputes the affected suffix rather than earlier cached points on a live-tail change',()=>{
  const {ledger,cache}=setup(),r=view(),before=cache.project(r),capture=cache.capture(source,day+5*M,day+6*M),p=native(day+5*M,day+6*M,'2',2);p.retainedFrom=day;ledger.applyNative(p);cache.commit(capture);const after=cache.project(r);
  expect(after.points.slice(0,5)).toEqual(before.points.slice(0,5));expect(after.points[5]!.base).toBe('3');expect(cache.diagnostics().pointsUpdated).toBe(1);expect(after.points).toEqual(ledger.series(day,day,r.to));
 });
 it('updates partial interval deltas, zero coverage and cumulative quality independently',()=>{
  const {ledger,cache}=setup(),r=view(day,day+6*M,day,3*M);cache.project(r);const capture=cache.capture(source,day+M,day+2*M),p=native(day+M,day+2*M,'-2',2);p.retainedFrom=day;ledger.applyNative(p);cache.commit(capture);expect(cache.project(r).points).toEqual(ledger.series(day,day,r.to,3*M));
  const gap=native(day+M,day+2*M,'-2',3);gap.retainedFrom=day;gap.coverage.gaps=[{from:day+M,to:day+2*M,reason:'Known gap'}] as any;
  const c=cache.capture(source,gap.from,gap.to);ledger.applyNative(gap);cache.commit(c);const changed=cache.project(r);expect(changed.points[0]!.base).toBe('-1');expect(changed.points.every(p=>p.partial)).toBe(true);expect(changed.points).toEqual(ledger.series(day,day,r.to,3*M));
 });
 it('fills an unknown archive prefix once, clearing partial flags without duplicate accumulation',()=>{
  const ledger=new CvdContributionLedger(source,'warm-cache');ledger.applyNative(native(day+D,day+D+M));const cache=new CvdProjectionCache(()=>ledger),r=view(day,day+3*M);expect(cache.project(r).points.every(p=>p.partial&&!p.available)).toBe(true);
  const page=archive(day,day+3*M,'-2'),capture=cache.capture(source,day,day+3*M);ledger.applyArchive(page);cache.commit(capture);const accepted=cache.project(r);expect(accepted.points).toEqual(ledger.series(day,day,r.to));expect(accepted.points.every(p=>!p.partial&&p.available)).toBe(true);
  const repeat=cache.capture(source,day,day+3*M);ledger.applyArchive(page);cache.commit(repeat);expect(cache.project(r)).toEqual(accepted);
 });
 it('keeps a year of daily projections after minute eviction and admits a later native change',()=>{
  const end=day+365*D,ledger=new CvdContributionLedger(source,'year-cache');ledger.applyNative(native(end,end+M));const cache=new CvdProjectionCache(()=>ledger),r=view(day,end,day,D);cache.project(r);
  for(let n=0;n<365;n++){const from=day+n*D,c=cache.capture(source,from,from+D);ledger.applyArchive(archive(from,from+D));cache.commit(c);ledger.evict(from);}
  const result=cache.project(r);expect(result.points).toHaveLength(365);expect(result.points.at(-1)).toMatchObject({base:'365',partial:false,available:true});expect(ledger.diagnostics()).toMatchObject({residentCells:1,sealedDays:365});
  const c=cache.capture(source,end,end+M);ledger.applyNative(native(end,end+M,'2',2));cache.commit(c);expect(cache.project(r)).toEqual(result);
 },20000);
 it('uses cached interval observations to repair a whole sealed native day',()=>{
  const ledger=new CvdContributionLedger(source,'sealed-native');ledger.applyNative(native(day,day+D));const cache=new CvdProjectionCache(()=>ledger),r=view(day,day+D,day,3600000);cache.project(r);ledger.evict(day);
  const capture=cache.capture(source,day,day+D);ledger.applyNative(native(day,day+D,'2',2));cache.commit(capture);ledger.evict(day);const actual=cache.project(r);expect(actual.stale).toBe(false);expect(actual.points.every(p=>p.base==='2'&&!p.partial)).toBe(true);
 });
 it('does not discard the prior projection when capture limits require unavailable detail',()=>{
  const ledger=new CvdContributionLedger(source,'retain-stale');const p=native(day,day+D);p.buckets.push({...p.buckets[0]!,time:day+2*M,base:'2',quote:'2'});ledger.applyNative(p);
  const cache=new CvdProjectionCache(()=>ledger,{captureBytes:1}),r=view(day+M,day+3*M);const before=cache.project(r),capture=cache.capture(source,day,day+D);p.revision=2;p.watermark='1002';p.buckets[0]!.base='3';ledger.applyNative(p);cache.commit(capture);ledger.evict(day);
  const retained=cache.project(r);expect(retained.points).toEqual(before.points);expect(retained).toMatchObject({stale:true,failure:'restore',requiresRestore:day});expect(retained.ledgerVersion).toBe(before.ledgerVersion);
 });
 it('a failed ledger transaction leaves cached values untouched',()=>{
  const {ledger,cache}=setup(),r=view(),before=cache.project(r),capture=cache.capture(source,day,day+M),p=native(day,day+M,'2');expect(()=>ledger.applyNative(p)).toThrow();cache.commit(capture);expect(cache.project(r)).toEqual(before);
 });
 it('refuses stale multi-mutation capture instead of missing an intervening correction',()=>{
  const {ledger,cache}=setup(),r=view();cache.project(r);const capture=cache.capture(source,day,day+M);ledger.applyNative(native(day,day+M,'2',2));ledger.applyNative(native(day,day+M,'3',3));cache.commit(capture);expect(cache.diagnostics().stale).toBe(1);expect(cache.project(r).points).toEqual(ledger.series(day,day,r.to));
 });
 it('enforces entry, point, encoded-byte and response budgets without destroying an existing view',()=>{
  const {ledger}=setup(),cache=new CvdProjectionCache(()=>ledger,{entries:1,points:3}),r=view(day,day+3*M);const before=cache.project(r);
  expect(()=>cache.project(view())).toThrowError(expect.objectContaining({reason:'capacity'}));expect(cache.project(r)).toEqual(before);
  cache.project(view(day+M,day+4*M));expect(cache.diagnostics()).toMatchObject({entries:1,points:3,evictions:1});
  for(const limits of [{bytes:1},{responseBytes:1}]){const tiny=new CvdProjectionCache(()=>ledger,limits);expect(()=>tiny.project(r)).toThrowError(expect.objectContaining({reason:'capacity'}));expect(tiny.diagnostics().entries).toBe(0);}
  expect(()=>new CvdProjectionCache(()=>ledger,{entries:25})).toThrow();
 });
 it('validates scopes and preserves source isolation',()=>{
  const {cache}=setup();for(const patch of [{source:'other'},{stepMs:1},{anchor:day+M},{from:day+1},{to:day+10083*M}])expect(()=>cache.project({...view(),...patch} as any)).toThrow();expect(()=>cache.project({...view(),source:'binance:spot'})).toThrowError(expect.objectContaining({reason:'basis'}));
 });
});
