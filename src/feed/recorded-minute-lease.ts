/** Historical provenance only. Tokens never enter chart/feed data contracts. */
import {minuteHistoryRequest,minuteSourceIdentity,validateMinuteHistoryPayload,type MinuteHistoryRequest,type MinuteHistoryPayload} from './recorded-minute-history';
import {historyRecord as record,historyHash as hash,historyInteger as integer,historyCatalogueHead,type HistoryCatalogueHead} from './history-archive-metadata';
export const MINUTE_SESSION_LIMITS=Object.freeze({rangeMs:31*86400000,lifetimeMs:60000,pages:32,responseBytes:32*1024**2,controlBytes:32768,requestMs:8000});
export interface MinuteLeaseCertificate {kind:'iq-recorded-minute-observation-lease-v1';id:string;checkpoint:string;generation:number;catalogueHead:HistoryCatalogueHead;witness:string;source:string;acquiredAtMs:number;expiresAtMs:number;scope:MinuteHistoryRequest;witnessedAtAcquisition:true;currentReconciled:false;financialAccepted:false;recoveryQualified:false;retirementAuthorized:false}
export interface LeasedMinutePayload extends MinuteHistoryPayload {observationLease:MinuteLeaseCertificate}
function invalid():never{throw Error('Historical minute lease contract mismatch');}
export function minuteSessionScope(value:unknown):MinuteHistoryRequest{
 if(!record(value)||![value.from,value.to].every(n=>integer(n)&&n%60000===0)||value.from>=value.to||value.to-value.from>MINUTE_SESSION_LIMITS.rangeMs)invalid();
 const narrowed=minuteHistoryRequest({...value,to:Math.min(value.to,value.from+86400000)});return {...narrowed,to:value.to};
}
const sourceFor=(scope:MinuteHistoryRequest)=>minuteSourceIdentity({...scope,to:Math.min(scope.to,scope.from+86400000)});
export function validateMinuteLease(value:unknown,requested:MinuteHistoryRequest):MinuteLeaseCertificate{
 const scope=minuteSessionScope(requested);
 if(!record(value)||Object.keys(value).sort().join(',')!=='acquiredAtMs,catalogueHead,checkpoint,currentReconciled,expiresAtMs,financialAccepted,generation,id,kind,recoveryQualified,retirementAuthorized,scope,source,witness,witnessedAtAcquisition'||value.kind!=='iq-recorded-minute-observation-lease-v1'||typeof value.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.id)||!hash(value.checkpoint)||!integer(value.generation,1)||!hash(value.witness)||value.source!==sourceFor(scope)||!integer(value.acquiredAtMs)||!integer(value.expiresAtMs)||value.expiresAtMs<=value.acquiredAtMs||value.expiresAtMs-value.acquiredAtMs>MINUTE_SESSION_LIMITS.lifetimeMs||JSON.stringify(minuteSessionScope(value.scope))!==JSON.stringify(scope)||value.witnessedAtAcquisition!==true||!['currentReconciled','financialAccepted','recoveryQualified','retirementAuthorized'].every(k=>value[k]===false))invalid();
 return {kind:value.kind,id:value.id,checkpoint:value.checkpoint,generation:value.generation,catalogueHead:historyCatalogueHead(value.catalogueHead),witness:value.witness,source:value.source,acquiredAtMs:value.acquiredAtMs,expiresAtMs:value.expiresAtMs,scope,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};
}
export function validateLeasedMinutePayload(value:unknown,requested:MinuteHistoryRequest,certificate:MinuteLeaseCertificate):LeasedMinutePayload{
 const request=minuteHistoryRequest(requested),scope=certificate.scope;
 if(['dataset','venue','market'].some(k=>request[k as keyof MinuteHistoryRequest]!==scope[k as keyof MinuteHistoryRequest])||request.from<scope.from||request.to>scope.to||!record(value))invalid();
 const lease=validateMinuteLease(value.observationLease,scope),payload=validateMinuteHistoryPayload(value,request),snapshot=payload.publicationSnapshot;
 if(JSON.stringify(lease)!==JSON.stringify(certificate)||snapshot.checkpoint!==lease.checkpoint||snapshot.generation!==lease.generation||JSON.stringify(snapshot.catalogueHead)!==JSON.stringify(lease.catalogueHead)||snapshot.frontier.source!==lease.source)invalid();
 return {...payload,observationLease:lease};
}
