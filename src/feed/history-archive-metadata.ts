/** Publication metadata is observation provenance, never current authority. */
export interface HistoryCatalogueHead {version:1;origin:string;authority:string;sequence:number;hash:string;partitions:number;rawBytes:number;proofs:number;proofBytes:number}
export interface HistoryGap {from:number;to:number;reason?:string}
export const historyRecord=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const historyHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const historyInteger=(value:unknown,min=0):value is number=>Number.isSafeInteger(value)&&(value as number)>=min;
export function historyMetadataFailure():never{throw Error('Historical archive metadata mismatch');}
export function historyCatalogueHead(value:unknown):HistoryCatalogueHead {
 if(!historyRecord(value)||value.version!==1||!historyHash(value.origin)||!historyHash(value.authority)||!historyHash(value.hash)||!['sequence','partitions','rawBytes','proofs','proofBytes'].every(k=>historyInteger(value[k])))historyMetadataFailure();
 return {version:1,origin:value.origin,authority:value.authority,sequence:value.sequence,hash:value.hash,partitions:value.partitions,rawBytes:value.rawBytes,proofs:value.proofs,proofBytes:value.proofBytes};
}
export function historyGaps(value:unknown,from:number,to:number,reason:boolean,budget:{gaps:number},minimum=1):HistoryGap[]{
 if(!Array.isArray(value)||value.length>4096||budget.gaps+value.length>4096)historyMetadataFailure();budget.gaps+=value.length;
 return value.map(g=>{if(!historyRecord(g)||!historyInteger(g.from,minimum)||!historyInteger(g.to,minimum)||g.from<from||g.to>to||g.from>=g.to||reason&&(typeof g.reason!=='string'||g.reason.length>500))historyMetadataFailure();return {from:g.from,to:g.to,...(reason?{reason:g.reason}:{})};});
}
