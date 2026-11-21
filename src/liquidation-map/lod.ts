import type {MapCell} from './model';
/** Nested absolute-grid aggregation only. Never mixes scenarios, sides, native
 * quotes, source kind, freshness or other provenance; never sums through time. */
export function coarsenMapCells(cells:MapCell[],width:number):MapCell[]{
 if(!Number.isFinite(width)||width<=0)throw Error('Invalid absolute price grid');
 const bins=new Map<string,MapCell>();
 for(const cell of cells){const {low,high,quantity,nativePrice,...identity}=cell,next=Math.floor(low/width)*width,key=JSON.stringify([next,identity]);
  const old=bins.get(key);if(old){const total=old.quantity+quantity;old.nativePrice=total?(old.nativePrice*old.quantity+nativePrice*quantity)/total:old.nativePrice;old.quantity=total;}
  else bins.set(key,{...identity,low:next,high:next+width,quantity,nativePrice});
 }return [...bins.values()];
}

import type {MapColumn} from './model';
/** Preserve stock changes and first removals. Within one time bucket, repeated
 * identical price-bin stock needs only its first and last as-of metadata.
 * Native-price valuation metadata is never copied back to an earlier snapshot. */
export function compactMapColumns(columns:MapColumn[],resolution:number):MapColumn[]{
 const output:MapColumn[]=[];let last:MapColumn|undefined,signature='',run=0,first=0;
 for(const column of [...columns].sort((a,b)=>a.availableAt-b.availableAt)){
  const next=JSON.stringify([column.scenarioCatalog,column.cells.map(({nativePrice,...stock})=>JSON.stringify(stock)).sort()]);
  const continuous=last&&column.availableAt<=Math.min(last.validUntil??Infinity,last.availableAt+Math.max(last.resolution??resolution,120000));
  if(continuous&&next===signature&&Math.floor(last!.availableAt/resolution)===Math.floor(column.availableAt/resolution)){
   if(run>=2){output.pop();output[first]={...output[first],validUntil:column.availableAt};}
   output.push(column);run++;
  }else{first=output.length;output.push(column);run=1;}
  signature=next;last=column;
 }return output;
}
