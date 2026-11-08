import type {Candle} from './protocol';
interface Entry {bars:Candle[];bytes:number;expires:number}
/** Closed native prices for warm presentation only. Fresh viewport reads still
 * validate every cached slot; this cache owns no stream sequence or live cursor. */
export class NativeCandlePresentationCache {
 private entries=new Map<string,Entry>();private rows=0;private bytes=0;
 readonly metrics={hits:0,admissions:0,capacityMisses:0};
 constructor(private clock=()=>performance.now()){}
 private drop(key:string){const entry=this.entries.get(key);if(entry){this.rows-=entry.bars.length;this.bytes-=entry.bytes;this.entries.delete(key);}}
 expire(){for(const [key,entry]of this.entries)if(entry.expires<=this.clock())this.drop(key);}
 read(key:string){
  this.expire();const entry=this.entries.get(key);if(!entry)return;
  this.entries.delete(key);this.entries.set(key,entry);this.metrics.hits++;
  return entry.bars.map(bar=>({...bar}));
 }
 put(key:string,bars:readonly Candle[]){
  this.expire();this.drop(key);if(!bars.length)return;
  let bytes=256+key.length*2;
  if(bars.length>1000){this.metrics.capacityMisses++;return;}
  for(const bar of bars){
   const values=Object.values(bar);
   // The native contract is flat. Reject exotic cache content rather than
   // dropping fields such as quote volume or retaining unbounded child graphs.
   if(bar.closed!==true||values.length>32||Object.keys(bar).some(key=>key.length>64)||values.some(v=>v!==null&&typeof v!=='boolean'&&!(typeof v==='number'&&Number.isFinite(v))&&!(typeof v==='string'&&v.length<=128))){this.metrics.capacityMisses++;return;}
   bytes+=256+JSON.stringify(bar).length*2;
   if(bytes>1024*1024){this.metrics.capacityMisses++;return;}
  }
  while(this.entries.size>=2||this.rows+bars.length>1000||this.bytes+bytes>1024*1024)this.drop(this.entries.keys().next().value!);
  this.entries.set(key,{bars:bars.map(bar=>Object.freeze({...bar})),bytes,expires:this.clock()+60000});this.rows+=bars.length;this.bytes+=bytes;this.metrics.admissions++;
 }
 /** Merge authoritative native slots, including a bootstrap that wins the
  * history race. Partial updates cannot prolong the other cached slots' TTL. */
 seed(key:string,bars:readonly Candle[]){
  this.expire();if(!bars.length)return;const entry=this.entries.get(key),expires=entry?.expires;
  const merged=new Map((entry?.bars??[]).map(bar=>[bar.t,bar]));for(const bar of bars)merged.set(bar.t,bar);
  this.put(key,[...merged.values()].sort((a,b)=>a.t-b.t));
  const revised=this.entries.get(key);if(revised&&expires!==undefined)revised.expires=expires;
 }

 clear(){this.entries.clear();this.rows=0;this.bytes=0;}
 diagnostics(){this.expire();return {...this.metrics,entries:this.entries.size,rows:this.rows,accountedBytes:this.bytes,limits:{entries:2,rows:1000,accountedBytes:1024*1024,ttlMs:60000}};}
}
