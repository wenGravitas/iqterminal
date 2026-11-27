/** Worker-owned exact observations. Transport and renderer lifetimes stay outside. */
import {sha256} from '@noble/hashes/sha2.js';
import type {CvdSource} from './cvd';
import {validateNativeExactCvd,type NativeExactCvd} from './cvd-exact-native';
import {validateMinuteLease,validateLeasedMinutePayload} from './recorded-minute-lease';
import {historyRecord} from './history-archive-metadata';
import {cvdAdd,cvdDecimal} from './cvd-exact-decimal';
const M=60000,DAY=86400000,SLOTS=1440;
export const CVD_LEDGER_LIMITS=Object.freeze({days:3660,residentCells:32768,rootsPerDay:8,provenanceBytes:8*1024**2,points:10082});
export class CvdLedgerFailure extends Error {constructor(readonly reason:'basis'|'conflict'|'capacity'|'restore'|'mutable',readonly day?:number){super('Exact CVD contribution admission unavailable');}}
interface Cell {base:string;quote:string;record?:[string,string,string];complete:boolean;revision:number;watermark:string}
interface Seal {hash:string;present:Uint8Array;recorded:Uint8Array;complete:Uint8Array}
interface Block {day:number;cells?:Map<number,Cell>;seal?:Seal;base:string;quote:string;known:number;covered:number;observed:number;pins:Set<string>;revision:number;watermark:string}
type Candidate=Map<number,Map<number,Cell>>;
const bit=(bits:Uint8Array,n:number)=>!!(bits[n>>3]!&(1<<(n&7)));
const setBit=(bits:Uint8Array,n:number)=>{bits[n>>3]!|=1<<(n&7);};
const contents=(c:Cell)=>[c.base,c.quote,c.record??null,c.complete];
const equal=(a:Cell,b:Cell)=>JSON.stringify(contents(a))===JSON.stringify(contents(b));
function regressedClock(revision:number,watermark:string,oldRevision:number,oldWatermark:string){const value=BigInt(watermark),old=BigInt(oldWatermark);return revision>oldRevision&&value<old||revision<oldRevision&&value>old||revision===oldRevision&&value!==old;}
function range(from:number,to:number){if(![from,to].every(n=>Number.isSafeInteger(n)&&n>=0&&n%M===0)||from>to||to-from>CVD_LEDGER_LIMITS.days*DAY)throw new CvdLedgerFailure('capacity');}
const dayAt=(t:number)=>Math.floor(t/DAY)*DAY;
function put(out:Candidate,time:number,cell:Cell){const day=dayAt(time);let rows=out.get(day);if(!rows)out.set(day,rows=new Map());rows.set(time,cell);}
const rootBytes=(b:Block)=>[...b.pins].reduce((n,s)=>n+new TextEncoder().encode(s).length,0);
export class CvdContributionLedger {
 private blocks=new Map<number,Block>();private cutover?:number;private incarnation?:string;private nativeRevision=0;private nativeWatermark='0';private nativeAsOf=0;private resident=0;private provenanceBytes=0;private version=0;
 private readonly limits:{days:number;residentCells:number;rootsPerDay:number;provenanceBytes:number;points:number};
 get dataVersion(){return this.version;}
 get nativeCutover(){return this.cutover;}
 constructor(readonly source:CvdSource,readonly basisId:string,limits:Partial<Record<keyof typeof CVD_LEDGER_LIMITS,number>>={}){
  if(!['binance:spot','binance:perpetual','bybit:perpetual'].includes(source)||typeof basisId!=='string'||!basisId||basisId.length>160)throw new CvdLedgerFailure('basis');
  this.limits={...CVD_LEDGER_LIMITS,...limits};for(const k of Object.keys(CVD_LEDGER_LIMITS) as Array<keyof typeof CVD_LEDGER_LIMITS>)if(!Number.isSafeInteger(this.limits[k])||this.limits[k]<1||this.limits[k]>CVD_LEDGER_LIMITS[k])throw new CvdLedgerFailure('capacity');
 }
 private blank(day:number):Block{return {day,cells:new Map(),base:'0',quote:'0',known:0,covered:0,observed:0,pins:new Set(),revision:0,watermark:'0'};}
 private hash(block:Block,cutover=this.cutover!){const cells=Array.from({length:SLOTS},(_,i)=>{const cell=block.cells!.get(block.day+i*M);return cell?contents(cell):null;});return [...sha256(new TextEncoder().encode(JSON.stringify([1,this.source,cutover,block.day,cells])))].map(v=>v.toString(16).padStart(2,'0')).join('');}
 private summarize(b:Block){b.base='0';b.quote='0';b.known=b.cells!.size;b.covered=0;b.observed=0;b.revision=0;b.watermark='0';for(const c of b.cells!.values()){b.base=cvdAdd(b.base,c.base);b.quote=cvdAdd(b.quote,c.quote);if(c.complete)b.covered++;if(c.record)b.observed++;b.revision=Math.max(b.revision,c.revision);if(BigInt(c.watermark)>BigInt(b.watermark))b.watermark=c.watermark;}}
 private restore(block:Block,candidate:Map<number,Cell>,native?:NativeExactCvd):Block{
  const out={...block,pins:new Set(block.pins),cells:block.cells?new Map(block.cells):new Map<number,Cell>()};if(block.cells)return out;
  const seal=block.seal!;let missing=false;
  for(let i=0;i<SLOTS;i++)if(bit(seal.present,i)){
   const time=block.day+i*M,incoming=candidate.get(time),recorded=bit(seal.recorded,i);
   if(recorded&&!incoming?.record){missing=true;break;}
   const nativeOwned=time>=this.cutover!;
   out.cells.set(time,{base:recorded?incoming!.base:'0',quote:recorded?incoming!.quote:'0',...(recorded?{record:[...incoming!.record!] as [string,string,string]}:{}),complete:bit(seal.complete,i),revision:nativeOwned?block.revision:0,watermark:nativeOwned?block.watermark:'0'});
  }
  if(!missing&&this.hash(out)===seal.hash){delete out.seal;return out;}
  // A full, complete and newer native-owned day can replace its retained total
  // without needing old minute bytes. Archive generation is never such authority.
  if(native&&block.day>=this.cutover!&&native.from<=block.day&&native.to>=block.day+DAY&&native.revision>block.revision&&candidate.size===SLOTS&&[...candidate.values()].every(c=>c.complete))return {...out,cells:new Map(candidate),seal:undefined};
  throw new CvdLedgerFailure(missing?'restore':native?'restore':'conflict',block.day);
 }
 private commit(staged:Map<number,Block>,changed:boolean){
  let resident=this.resident,provenance=this.provenanceBytes,newDays=0;
  for(const [day,b]of staged){this.summarize(b);if(b.pins.size>this.limits.rootsPerDay)throw new CvdLedgerFailure('capacity',day);const old=this.blocks.get(day);if(!old)newDays++;resident+=(b.cells?.size??0)-(old?.cells?.size??0);provenance+=rootBytes(b)-(old?rootBytes(old):0);}
  if(this.blocks.size+newDays>this.limits.days||resident>this.limits.residentCells||provenance>this.limits.provenanceBytes)throw new CvdLedgerFailure('capacity');
  for(const [day,b]of staged)this.blocks.set(day,b);this.resident=resident;this.provenanceBytes=provenance;if(changed)this.version++;return {changed,version:this.version};
 }
 applyNative(value:unknown){
  const p=validateNativeExactCvd(value,this.source);if(p.status==='awaiting'||!this.incarnation&&!p.snapshot)throw new CvdLedgerFailure('basis');
  if(this.incarnation&&p.incarnation!==this.incarnation)throw new CvdLedgerFailure('basis');
  if(this.incarnation&&regressedClock(p.revision,p.watermark,this.nativeRevision,this.nativeWatermark))throw new CvdLedgerFailure('conflict');
  if(!p.snapshot){this.nativeAsOf=Math.max(this.nativeAsOf,p.asOf);return {changed:false,version:this.version};}
  const cutover=this.cutover??p.retainedFrom,candidates:Candidate=new Map(),byTime=new Map(p.buckets.map(b=>[b.time,b]));
  for(let t=Math.max(p.from,cutover);t<p.to;t+=M){const row=byTime.get(t),complete=p.coverage.from<=t&&p.coverage.to>=t+M&&!p.coverage.gaps.some(g=>g.from<t+M&&g.to>t);if(row||complete)put(candidates,t,{base:row?cvdDecimal(row.base):'0',quote:row?cvdDecimal(row.quote):'0',...(row?{record:[row.firstId,row.lastId,row.records] as [string,string,string]}:{}),complete,revision:p.revision,watermark:p.watermark});}
  const staged=new Map<number,Block>();let changed=!this.incarnation;
  for(const [day,cells]of candidates){const oldBlock=this.blocks.get(day);if(oldBlock?.revision&&regressedClock(p.revision,p.watermark,oldBlock.revision,oldBlock.watermark))throw new CvdLedgerFailure('conflict',day);const block=oldBlock?this.restore(oldBlock,cells,p):this.blank(day);if(oldBlock?.seal&&block.seal===undefined&&this.hash(block,cutover)!==oldBlock.seal.hash)changed=true;
   for(const [time,c]of cells){const old=block.cells!.get(time);if(old?.revision&&regressedClock(p.revision,p.watermark,old.revision,old.watermark))throw new CvdLedgerFailure('conflict',day);if(old&&old.revision>p.revision)continue;if(old&&old.revision===p.revision&&!equal(old,c))throw new CvdLedgerFailure('conflict',day);
    if(old&&!c.complete&&old.record&&(!c.record||BigInt(c.record[2])<BigInt(old.record[2])||BigInt(c.record[0])>BigInt(old.record[0])||BigInt(c.record[1])<BigInt(old.record[1])))throw new CvdLedgerFailure('conflict',day);
    if(!old||!equal(old,c))changed=true;block.cells!.set(time,c);
   }staged.set(day,block);
  }
  const result=this.commit(staged,changed);this.cutover=cutover;this.incarnation=p.incarnation;this.nativeAsOf=Math.max(this.nativeAsOf,p.asOf);if(p.revision>this.nativeRevision){this.nativeRevision=p.revision;this.nativeWatermark=p.watermark;}return result;
 }
 private archiveCandidates(value:unknown,ownedOnly:boolean){
  if(this.cutover===undefined)throw new CvdLedgerFailure('basis');if(!historyRecord(value)||!historyRecord(value.observationLease))throw new CvdLedgerFailure('basis');
  const certificate=validateMinuteLease(value.observationLease,value.observationLease.scope),p=validateLeasedMinutePayload(value,value.request,certificate),r=p.request;
  if(r.dataset!=='cvd'||r.venue+':'+r.market!==this.source)throw new CvdLedgerFailure('basis');
  const pin=JSON.stringify([certificate.checkpoint,certificate.generation,certificate.catalogueHead,certificate.source]),candidates:Candidate=new Map(),byTime=new Map(p.bars.map(b=>[b.timeMs,b]));
  for(let t=r.from;t<Math.min(r.to,ownedOnly?this.cutover:r.to);t+=M){const row=byTime.get(t);if(row&&BigInt(row.records)>BigInt(row.lastId)-BigInt(row.firstId)+1n)throw new CvdLedgerFailure('conflict',dayAt(t));const complete=p.coverage.partitions.some(part=>part.from<=t&&part.to>=t+M&&(part.coverage.state==='complete'||part.coverage.gaps.length>0&&!part.coverage.gaps.some(g=>g.from<t+M&&g.to>t)));if(row||complete)put(candidates,t,{base:row?cvdDecimal(row.base):'0',quote:row?cvdDecimal(row.quote):'0',...(row?{record:[row.firstId,row.lastId,row.records] as [string,string,string]}:{}),complete,revision:0,watermark:'0'});}
  return {candidates,pin,p};
 }
 applyArchive(value:unknown){
  const {candidates,pin}=this.archiveCandidates(value,true);
  const staged=new Map<number,Block>();let changed=false;
  for(const [day,cells]of candidates){const previous=this.blocks.get(day),block=previous?this.restore(previous,cells):this.blank(day);let added=false;
   for(const [time,c]of cells){const old=block.cells!.get(time);if(old){if(old.base!==c.base||old.quote!==c.quote||JSON.stringify(old.record??null)!==JSON.stringify(c.record??null))throw new CvdLedgerFailure('conflict',day);continue;}block.cells!.set(time,c);changed=added=true;}
   if(added)block.pins.add(pin);staged.set(day,block);
  }return this.commit(staged,changed);
 }
 /** Checksummed rehydration may use an equivalent archive copy for native
  * minutes too. It adds no contribution and never changes source ownership. */
 restoreArchive(value:unknown){
  const {candidates}=this.archiveCandidates(value,false),staged=new Map<number,Block>();
  for(const [day,cells]of candidates){const old=this.blocks.get(day);if(old?.seal)staged.set(day,this.restore(old,cells));}
  return this.commit(staged,false);
 }
 /** Disposable reconstruction of one already accepted day. Original seal masks
  * and hash remain authoritative; pages never add observations or provenance. */
 beginArchiveRestore(day:number){
  if(!Number.isSafeInteger(day)||day<0||day%DAY)throw new CvdLedgerFailure('capacity');
  const original=this.blocks.get(day);if(!original?.seal)throw new CvdLedgerFailure('basis',day);
  const seal=original.seal;let cells=new Map<number,Cell>(),pages=0,bytes=0,done=false;
  const current=()=>{if(done||this.blocks.get(day)!==original)throw new CvdLedgerFailure('basis',day);};
  const missing=()=>{let count=0,last:number|undefined;for(let i=0;i<SLOTS;i++)if(bit(seal.recorded,i)&&!cells.get(day+i*M)?.record){count++;last=day+i*M;}return {count,last};};
  return {
   append:(value:unknown)=>{
    current();if(pages>=32)throw new CvdLedgerFailure('capacity',day);
    const {candidates,p}=this.archiveCandidates(value,false);
    if(p.request.from<day||p.request.to>day+DAY)throw new CvdLedgerFailure('basis',day);
    const received=new TextEncoder().encode(JSON.stringify(p)).byteLength;
    if(received>4*1024**2||bytes+received>32*1024**2)throw new CvdLedgerFailure('capacity',day);
    const next=new Map(cells);
    for(const [time,cell]of candidates.get(day)??[]){const old=next.get(time);if(old&&(old.base!==cell.base||old.quote!==cell.quote||JSON.stringify(old.record??null)!==JSON.stringify(cell.record??null)))throw new CvdLedgerFailure('conflict',day);next.set(time,cell);}
    cells=next;pages++;bytes+=received;return {pages,bytes,missingRecords:missing().count};
   },
   next:()=>{current();const time=missing().last;if(time===undefined)return undefined;const from=Math.floor(time/3600000)*3600000;return {from,to:from+3600000};},
   finish:()=>{current();if(missing().count)throw new CvdLedgerFailure('restore',day);const block=this.restore(original,cells),result=this.commit(new Map([[day,block]]),false);done=true;cells.clear();return result;},
   diagnostics:()=>({day,pages,bytes,missingRecords:missing().count,done}),
  };
 }
 evict(day:number){if(!Number.isSafeInteger(day)||day<0||day%DAY)throw new CvdLedgerFailure('capacity');const old=this.blocks.get(day);if(!old)return undefined;if(old.seal)return old.seal.hash;if(day+DAY>this.cutover!&&day+DAY>this.nativeAsOf)throw new CvdLedgerFailure('mutable',day);
  const seal:Seal={hash:this.hash(old),present:new Uint8Array(180),recorded:new Uint8Array(180),complete:new Uint8Array(180)};
  for(const [time,c]of old.cells!){const i=(time-day)/M;setBit(seal.present,i);if(c.record)setBit(seal.recorded,i);if(c.complete)setBit(seal.complete,i);}this.resident-=old.cells!.size;this.blocks.set(day,{...old,cells:undefined,seal});return seal.hash;
 }
 sum(from:number,to:number){
  range(from,to);let base='0',quote='0',knownMinutes=0,coveredMinutes=0,observedMinutes=0;
  for(let day=dayAt(from);day<to;day+=DAY){const b=this.blocks.get(day);if(!b)continue;const lo=Math.max(from,day),hi=Math.min(to,day+DAY);
   if(lo===day&&hi===day+DAY){base=cvdAdd(base,b.base);quote=cvdAdd(quote,b.quote);knownMinutes+=b.known;coveredMinutes+=b.covered;observedMinutes+=b.observed;continue;}
   if(b.cells){for(let t=lo;t<hi;t+=M){const c=b.cells.get(t);if(c){knownMinutes++;base=cvdAdd(base,c.base);quote=cvdAdd(quote,c.quote);if(c.complete)coveredMinutes++;if(c.record)observedMinutes++;}}}
   else{let observed=0;for(let t=lo;t<hi;t+=M){const i=(t-day)/M;if(bit(b.seal!.present,i))knownMinutes++;if(bit(b.seal!.complete,i))coveredMinutes++;if(bit(b.seal!.recorded,i))observed++;}if(observed&&observed!==b.observed)throw new CvdLedgerFailure('restore',day);if(observed){base=cvdAdd(base,b.base);quote=cvdAdd(quote,b.quote);}observedMinutes+=observed;}
  }
  const requestedMinutes=(to-from)/M;return {base,quote,complete:coveredMinutes===requestedMinutes,knownMinutes,coveredMinutes,observedMinutes,requestedMinutes,financialAccepted:false as const};
 }
 /** Coverage masks do not require restored quantities. This must not be used
  * as a substitute for exact sums when a finer projection needs record detail. */
 coverage(from:number,to:number){
  range(from,to);let knownMinutes=0,coveredMinutes=0,observedMinutes=0;
  for(let day=dayAt(from);day<to;day+=DAY){const b=this.blocks.get(day);if(!b)continue;const lo=Math.max(from,day),hi=Math.min(to,day+DAY);
   if(lo===day&&hi===day+DAY){knownMinutes+=b.known;coveredMinutes+=b.covered;observedMinutes+=b.observed;continue;}
   for(let t=lo;t<hi;t+=M){if(b.cells){const c=b.cells.get(t);if(c){knownMinutes++;if(c.complete)coveredMinutes++;if(c.record)observedMinutes++;}}
    else{const i=(t-day)/M;if(bit(b.seal!.present,i))knownMinutes++;if(bit(b.seal!.complete,i))coveredMinutes++;if(bit(b.seal!.recorded,i))observedMinutes++;}}
  }
  const requestedMinutes=(to-from)/M;return {knownMinutes,coveredMinutes,observedMinutes,requestedMinutes,complete:coveredMinutes===requestedMinutes,financialAccepted:false as const};
 }
 series(anchor:number,from:number,to:number,stepMs=60000){
  range(anchor,to);range(from,to);if(anchor>from||!Number.isSafeInteger(stepMs)||stepMs<M||stepMs%M||from%stepMs||to%stepMs||(to-from)%stepMs||(to-from)/stepMs>this.limits.points)throw new CvdLedgerFailure('capacity');
  let total=this.sum(anchor,from);const points:Array<{time:number;base:string;quote:string;partial:boolean;available:boolean;observed:boolean}>=[];
  for(let t=from;t<to;t+=stepMs){const next=this.sum(t,t+stepMs);total={...total,base:cvdAdd(total.base,next.base),quote:cvdAdd(total.quote,next.quote),complete:total.complete&&next.complete};points.push({time:t+stepMs,base:total.base,quote:total.quote,partial:!total.complete,available:next.knownMinutes>0,observed:next.observedMinutes>0});}return points;
 }
 diagnostics(){return {basisId:this.basisId,source:this.source,cutover:this.cutover,incarnation:this.incarnation,nativeRevision:this.nativeRevision,nativeWatermark:this.nativeWatermark,nativeAsOf:this.nativeAsOf,version:this.version,days:this.blocks.size,residentCells:this.resident,sealedDays:[...this.blocks.values()].filter(b=>b.seal).length,provenanceBytes:this.provenanceBytes};}
}
