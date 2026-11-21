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
