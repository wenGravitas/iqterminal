/** Decoded immutable members, authenticated again by membership in each fresh
 * manifest. One worker/service budget, never one budget per chart/generation.
 * Charges include parsed-object overhead; warm presentations keep their own
 * existing32MiB budget. Uncommitted imports are charged but never reusable.
 * Content is immutable: LRU/explicit invalidation/disposal bound its lifetime;
 * age never substitutes for fresh source/manifest validation. */
export interface WallPartIdentity {hash:string;bytes:number;records:number}
interface Entry {key:string;value:unknown;bytes:number;refs:number;committed:boolean;valid:boolean}
export class PreparedWallPartCache {
 private entries=new Map<string,Entry>();private bytes=0;private disposed=false;
 readonly stats={hits:0,misses:0,reusedCanonicalBytes:0,admissions:0,evictions:0,capacityMisses:0,abortedAdmissions:0};
 constructor(readonly maxBytes=128*1024*1024,readonly maxEntries=256){if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>128*1024*1024||!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>512)throw Error('Invalid prepared wall part-cache budget');}
 diagnostics(){return {...this.stats,entries:this.entries.size,accountedBytes:this.bytes,pinnedEntries:[...this.entries.values()].filter(e=>e.refs>0).length,stagedEntries:[...this.entries.values()].filter(e=>!e.committed).length,maxBytes:this.maxBytes,maxEntries:this.maxEntries,warmPresentationBudgetBytes:32*1024*1024};}
 private remove(e:Entry){if(this.entries.get(e.key)!==e)return;this.entries.delete(e.key);this.bytes-=e.bytes;}
 clear(){for(const e of this.entries.values()){e.valid=false;if(!e.refs)this.remove(e);}}
 dispose(){this.disposed=true;this.clear();}
 begin(family:string,parts:readonly WallPartIdentity[]){
  const held=new Map<number,Entry>(),staged=new Set<Entry>();let committed=false,released=false;
  // Pin all present members before sequential reads. A scan of cold misses must
  // not evict the later warm members before the importer reaches them.
  for(const [i,p]of parts.entries()){const e=this.entries.get(family+':'+p.hash+':'+p.bytes+':'+p.records);if(e&&e.valid&&e.committed&&!this.disposed){e.refs++;held.set(i,e);}else{this.stats.misses++;if(e&&!e.refs)this.remove(e);}}
  const active=()=>{if(released)throw Error('Released prepared wall cache transaction');};
  return {
   // Invalidation blocks new leases; an existing authenticated immutable lease
   // remains readable until release, avoiding mid-import hole/ownership races.
   get:<T>(index:number):T|undefined=>{active();const e=held.get(index);if(!e||!e.committed){this.stats.misses++;return;}
    this.stats.hits++;this.stats.reusedCanonicalBytes+=parts[index]!.bytes;this.entries.delete(e.key);this.entries.set(e.key,e);return e.value as T;},
   has:(index:number)=>held.has(index),
   stage:(index:number,value:unknown,runCount:number)=>{active();if(this.disposed||held.has(index))return;const p=parts[index]!,key=family+':'+p.hash+':'+p.bytes+':'+p.records;
    if(this.entries.has(key))return;const bytes=Math.max(2*p.bytes,p.records*512+runCount*256)+512;
    if(!Number.isSafeInteger(bytes)||bytes>this.maxBytes){this.stats.capacityMisses++;return;}
    while(this.bytes+bytes>this.maxBytes||this.entries.size>=this.maxEntries){const old=[...this.entries.values()].find(e=>e.refs===0);if(!old){this.stats.capacityMisses++;return;}this.remove(old);this.stats.evictions++;}
    const e:Entry={key,value,bytes,refs:1,committed:false,valid:true};this.entries.set(key,e);this.bytes+=bytes;staged.add(e);held.set(index,e);
   },
   commit:()=>{active();if(this.disposed)return;for(const e of staged)if(e.valid){e.committed=true;this.stats.admissions++;}committed=true;},
   release:()=>{if(released)return;released=true;for(const e of held.values()){if(!committed&&staged.has(e)){e.valid=false;this.stats.abortedAdmissions++;}e.refs--;if(!e.refs&&!e.valid)this.remove(e);}}
  };
 }
}
