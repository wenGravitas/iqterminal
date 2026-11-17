/** Advisory server input capacity never enlarges browser body/cache budgets. */
export function wallInputCapacity(raw:any){
 if(raw?.version!==1||!Number.isSafeInteger(raw.canonicalParts)||raw.canonicalParts<1||!Number.isSafeInteger(raw.metadataBytes)||raw.metadataBytes<1||raw.canonicalParts>raw.metadataBytes/64)throw Error('Unsupported wall input capacity metadata');
 return raw as{version:1;canonicalParts:number;metadataBytes:number};
}
