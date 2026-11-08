import type {Candle} from './protocol';
export const NATIVE_CHART_BAR_BUDGET=5000;
export const NATIVE_VISIBLE_BAR_BUDGET=NATIVE_CHART_BAR_BUDGET-2;
export interface NativeCandleVersion {stream:number;request?:number}
/** Preserve the visible past and two latest native bars within the incumbent
 * chart budget. This only runs when a historical merge actually exceeds it. */
export function retainNativeViewport<T extends Candle>(candles:T[],from:number,to:number,budget=NATIVE_CHART_BAR_BUDGET){
 if(candles.length<=budget)return candles;
 const keep=new Set(candles.slice(-2).map(c=>c.t));
 for(let i=candles.length-1;i>=0&&keep.size<budget;i--)if(candles[i]!.t>=from&&candles[i]!.t<to)keep.add(candles[i]!.t);
 for(let i=candles.length-1;i>=0&&keep.size<budget;i--)keep.add(candles[i]!.t);
 return candles.filter(c=>keep.has(c.t));
}

/** Per displayed candle: keep REST read order distinct from exchange stream
 * sequence. The ledger is pruned with the existing chart cache, never a journal. */
export class NativeCandleVersions {
 private values=new Map<number,{stream:number;request:number}>();
 accept(candle:Candle,version:NativeCandleVersion,existing?:Candle){
  const old=this.values.get(candle.t)??{stream:0,request:0};
  if(existing?.closed&&!candle.closed)return false;
  if(version.request!==undefined){
   if(old.stream>version.stream||old.request>version.request)return false;
   this.values.set(candle.t,{stream:old.stream,request:version.request});
  }else{
   if(old.stream>version.stream)return false;
   this.values.set(candle.t,{stream:version.stream,request:old.request});
  }
  return true;
 }
 retain(candles:readonly Candle[]){const keep=new Set(candles.map(c=>c.t));for(const t of this.values.keys())if(!keep.has(t))this.values.delete(t);}
 clear(){this.values.clear();}
 size(){return this.values.size;}
}
