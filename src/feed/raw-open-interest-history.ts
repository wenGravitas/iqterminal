/** Read-only publication-as-of wire contract. No unit/financial authority is inferred. */
import {RAW_OPEN_INTEREST_MAX_RANGE_MS,RAW_OPEN_INTEREST_MAX_OBSERVATIONS,RAW_OPEN_INTEREST_VENUES,compatibleRawOpenInterestVenues,validateRawOpenInterestObservations,validateRawOpenInterestConflicts,observationKey,type RawOpenInterestObservation,type RawOpenInterestConflict,type RawOpenInterestVenue} from './raw-open-interest';
export interface OiHistoryRange {from:number;to:number;venues:RawOpenInterestVenue[]}
export interface OiCatalogueHead {version:1;origin:string;authority:string;sequence:number;hash:string;partitions:number;rawBytes:number;proofs:number;proofBytes:number}
export interface OiHistoryGap {from:number;to:number;reason?:string}
export interface OiHistoryVenueCoverage {
 venue:RawOpenInterestVenue;state:'archived'|'partial'|'unavailable';truncated:boolean;
 missing:OiHistoryGap[];failures:Array<{id:string;state:string;reason:'integrity'|'capacity'|'origin'}>;
 partitions:Array<{id:string;from:number;to:number;format:string;sourceRevision:string;state:'complete'|'partial';gaps:OiHistoryGap[]}>;
 publication:{checkpoint:string;generation:number;catalogueHead:OiCatalogueHead;source:string;frontier:'unavailable';reason:'no-independent-frontier-v1'|'source-not-in-snapshot'};
}
export interface OiHistoryPayload extends OiHistoryRange {
 version:1;market:'perpetual';nativeSymbol:'BTC';units:'BTC';timeBasis:'sourceTimeMs';semantics:'observed-open-interest-publication-asof';
 observations:RawOpenInterestObservation[];conflicts:RawOpenInterestConflict[];partial:boolean;truncated:boolean;
 hot:{state:'read';asOfMs:number;truncated:boolean;invalidRows:number}|{state:'unavailable'};
 warm:{state:'publication-asof';catalogueHead:OiCatalogueHead;venues:OiHistoryVenueCoverage[];truncated:boolean}|{state:'unavailable'|'disabled'};
 sourceAuthorityVerified:false;currentReconciled:false;financialAccepted:false;recoveryQualified:false;retirementAuthorized:false;
}
export const OI_HISTORY_CLIENT_LIMITS=Object.freeze({windows:15,cacheWindows:16,cacheBytes:8*1024**2,responseBytes:4*1024**2,subscribers:32,timeoutMs:12000,attempts:3,retryMs:30000});
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown,min=0):v is number=>Number.isSafeInteger(v)&&(v as number)>=min;
const bool=(v:unknown):v is boolean=>typeof v==='boolean';
function fail():never{throw Error('Historical OI response contract mismatch');}
export function oiHistoryRange(value:OiHistoryRange,maxRange=RAW_OPEN_INTEREST_MAX_RANGE_MS):OiHistoryRange {
 if(!value||!integer(value.from,1)||!integer(value.to,1)||value.from>=value.to||value.to-value.from>maxRange||!Array.isArray(value.venues)||!value.venues.length||value.venues.length>3||value.venues.some(v=>!RAW_OPEN_INTEREST_VENUES.includes(v))||new Set(value.venues).size!==value.venues.length)throw Error('Invalid historical OI range');
 return {from:value.from,to:value.to,venues:compatibleRawOpenInterestVenues(value.venues)};
}
export function oiHistoryKey(range:OiHistoryRange){return `${range.from}:${range.to}:${compatibleRawOpenInterestVenues(range.venues).join(',')}`;}
function head(value:unknown):OiCatalogueHead {
 if(!record(value)||value.version!==1||!hash(value.origin)||!hash(value.authority)||!hash(value.hash)||!['sequence','partitions','rawBytes','proofs','proofBytes'].every(k=>integer(value[k])))fail();
 return {version:1,origin:value.origin,authority:value.authority,sequence:value.sequence,hash:value.hash,partitions:value.partitions,rawBytes:value.rawBytes,proofs:value.proofs,proofBytes:value.proofBytes};
}
function gaps(value:unknown,from:number,to:number,reason:boolean,budget:{gaps:number}):OiHistoryGap[]{
 if(!Array.isArray(value)||value.length>4096||budget.gaps+value.length>4096)fail();budget.gaps+=value.length;
 return value.map(g=>{if(!record(g)||!integer(g.from,1)||!integer(g.to,1)||g.from<from||g.to>to||g.from>=g.to||reason&&(typeof g.reason!=='string'||g.reason.length>500))fail();return {from:g.from,to:g.to,...(reason?{reason:g.reason}:{})};});
}
export function validateOiHistoryPayload(value:unknown,range:OiHistoryRange):OiHistoryPayload {
 const request=oiHistoryRange(range);if(!record(value)||value.version!==1||value.market!=='perpetual'||value.nativeSymbol!=='BTC'||value.units!=='BTC'||value.timeBasis!=='sourceTimeMs'||value.semantics!=='observed-open-interest-publication-asof'||value.from!==request.from||value.to!==request.to||!bool(value.partial)||!bool(value.truncated)||!Array.isArray(value.venues)||value.venues.length!==request.venues.length||new Set(value.venues).size!==request.venues.length||value.venues.some(v=>!request.venues.includes(v))||!['sourceAuthorityVerified','currentReconciled','financialAccepted','recoveryQualified','retirementAuthorized'].every(k=>value[k]===false)||!Array.isArray(value.observations)||value.observations.length>RAW_OPEN_INTEREST_MAX_OBSERVATIONS)fail();
 const observations=validateRawOpenInterestObservations(value.observations,request.venues,request.from,request.to);
 if(!Array.isArray(value.conflicts)||value.conflicts.length>RAW_OPEN_INTEREST_MAX_OBSERVATIONS)fail();
 const conflicts=validateRawOpenInterestConflicts(value.conflicts.map(c=>{if(!record(c)||c.market!==undefined&&c.market!=='perpetual')fail();return {...c,market:'perpetual'};}),request.venues,request.from,request.to);
 const keys=new Set(observations.map(observationKey));if(conflicts.some(c=>keys.has(observationKey(c))))fail();
 let hot:OiHistoryPayload['hot'];
 if(!record(value.hot))fail();
 if(value.hot.state==='unavailable')hot={state:'unavailable'};
 else if(value.hot.state==='read'&&integer(value.hot.asOfMs,1)&&bool(value.hot.truncated)&&integer(value.hot.invalidRows)&&value.hot.invalidRows<=2000)hot={state:'read',asOfMs:value.hot.asOfMs,truncated:value.hot.truncated,invalidRows:value.hot.invalidRows};else fail();
 let warm:OiHistoryPayload['warm'];const budget={gaps:0},partitionIds=new Set<string>();
 if(!record(value.warm))fail();
 if(value.warm.state==='disabled'||value.warm.state==='unavailable')warm={state:value.warm.state};
 else{
  if(value.warm.state!=='publication-asof'||!bool(value.warm.truncated)||!Array.isArray(value.warm.venues)||value.warm.venues.length!==request.venues.length||new Set(value.warm.venues.map(v=>v?.venue)).size!==request.venues.length)fail();
  const catalogueHead=head(value.warm.catalogueHead);let checkpoint='',generation=0,totalFailures=0;
  const venues:OiHistoryVenueCoverage[]=value.warm.venues.map(v=>{
   if(!record(v)||!request.venues.includes(v.venue)||!bool(v.truncated)||!record(v.coverage)||v.coverage.version!==1||v.coverage.tier!=='warm'||!['archived','partial','unavailable'].includes(v.coverage.state)||v.coverage.requested?.from!==request.from||v.coverage.requested?.to!==request.to||!Array.isArray(v.coverage.partitions)||v.coverage.partitions.length>64||!Array.isArray(v.failures)||v.failures.length>64||totalFailures+v.failures.length>64)fail();
   totalFailures+=v.failures.length;const s=v.publicationSnapshot;
   if(!record(s)||s.kind!=='iq-archive-publication-asof-v1'||!hash(s.checkpoint)||!integer(s.generation,1)||JSON.stringify(head(s.catalogueHead))!==JSON.stringify(catalogueHead)||!record(s.assurance)||!['sourceAuthorityVerified','currentReconciled','retirementAuthorized','nativeActivationAuthorized'].every(k=>s.assurance[k]===false)||!record(s.frontier)||!hash(s.frontier.source)||s.frontier.state!=='unavailable'||!['no-independent-frontier-v1','source-not-in-snapshot'].includes(s.frontier.reason))fail();
   if(checkpoint&&(checkpoint!==s.checkpoint||generation!==s.generation))fail();checkpoint=s.checkpoint;generation=s.generation;
   const partitions:OiHistoryVenueCoverage['partitions']=v.coverage.partitions.map(p=>{
    if(!record(p)||!hash(p.id)||partitionIds.has(p.id)||partitionIds.size>=64||!hash(p.sourceRevision)||!integer(p.from,1)||!integer(p.to,1)||p.from>=p.to||p.from>=request.to||p.to<=request.from||typeof p.format!=='string'||!p.format||p.format.length>80||!record(p.coverage)||!['complete','partial'].includes(p.coverage.state))fail();partitionIds.add(p.id);
    const parsed=gaps(p.coverage.gaps,p.from,p.to,true,budget);if(p.coverage.state==='complete'&&parsed.length)fail();return {id:p.id,from:p.from,to:p.to,format:p.format,sourceRevision:p.sourceRevision,state:p.coverage.state,gaps:parsed};
   });
   const missing=gaps(v.coverage.missing,request.from,request.to,false,budget),expectedMissing:OiHistoryGap[]=[];let at=request.from;
   for(const p of [...partitions].sort((a,b)=>a.from-b.from||a.to-b.to)){if(p.from>at)expectedMissing.push({from:at,to:Math.min(p.from,request.to)});at=Math.max(at,p.to);}if(at<request.to)expectedMissing.push({from:at,to:request.to});
   const expectedState=!partitions.length?'unavailable':expectedMissing.length||partitions.some(p=>p.state==='partial')?'partial':'archived';if(JSON.stringify(missing)!==JSON.stringify(expectedMissing)||v.coverage.state!==expectedState)fail();
   return {venue:v.venue,state:v.coverage.state,truncated:v.truncated,missing,partitions,failures:v.failures.map(f=>{if(!record(f)||!hash(f.id)||!['archived','loading','unavailable','partial'].includes(f.state)||!['integrity','capacity','origin'].includes(f.reason))fail();return {id:f.id,state:f.state,reason:f.reason};}),publication:{checkpoint:s.checkpoint,generation:s.generation,catalogueHead,source:s.frontier.source,frontier:'unavailable',reason:s.frontier.reason}};
  });warm={state:'publication-asof',catalogueHead,venues,truncated:value.warm.truncated};
 }
 const derivedTruncated=hot.state==='read'&&hot.truncated||warm.state==='publication-asof'&&(warm.truncated||warm.venues.some(v=>v.truncated));
 const derivedPartial=hot.state!=='read'||warm.state!=='publication-asof'||value.truncated||hot.state==='read'&&hot.invalidRows>0||conflicts.length>0||warm.state==='publication-asof'&&warm.venues.some(v=>v.state!=='archived'||v.failures.length>0);
 if(derivedTruncated&&!value.truncated||derivedPartial&&!value.partial)fail();
 return {version:1,market:'perpetual',nativeSymbol:'BTC',units:'BTC',timeBasis:'sourceTimeMs',semantics:'observed-open-interest-publication-asof',...request,observations,conflicts,partial:value.partial,truncated:value.truncated,hot,warm,sourceAuthorityVerified:false,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};
}

/** Centre-first raw windows. Wide views retain explicit capacity metadata rather
 * than issuing an unbounded replay or pretending to offer a coarse aggregate. */
export function planOiHistory(value:OiHistoryRange,now:number){
 const request=oiHistoryRange(value,Number.MAX_SAFE_INTEGER),to=Math.min(request.to,now-RAW_OPEN_INTEREST_MAX_RANGE_MS);
 if(to<=request.from)return {windows:[] as OiHistoryRange[],capacityLimited:false};
 const first=Math.floor(request.from/RAW_OPEN_INTEREST_MAX_RANGE_MS),last=Math.floor((to-1)/RAW_OPEN_INTEREST_MAX_RANGE_MS),middle=Math.floor((first+last)/2),count=last-first+1,windows:OiHistoryRange[]=[];
 for(let distance=0;windows.length<Math.min(count,OI_HISTORY_CLIENT_LIMITS.windows);distance++)for(const index of distance?[middle+distance,middle-distance]:[middle])if(index>=first&&index<=last&&windows.length<OI_HISTORY_CLIENT_LIMITS.windows)windows.push({from:Math.max(1,index*RAW_OPEN_INTEREST_MAX_RANGE_MS),to:(index+1)*RAW_OPEN_INTEREST_MAX_RANGE_MS,venues:[...request.venues]});
 return {windows,capacityLimited:count>OI_HISTORY_CLIENT_LIMITS.windows};
}
