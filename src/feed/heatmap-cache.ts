import {HEATMAP_STRIDE,type LiquidityBucket} from './heatmap-model';
export interface CachedHeatmap {version:1;savedAt:number;rowPrice:number;timeMs:number;buckets:LiquidityBucket[];}
export interface HeatmapHistoryCache {read(rowPrice:number,timeMs:number):Promise<CachedHeatmap|undefined>;write(value:CachedHeatmap):Promise<void>;dispose?():void;}
const BYTE_LIMIT=2*1024*1024;
/** Only durable closed historical tiles may be restored. Never restore live-book state. */
export function cachedTiles(value:CachedHeatmap|undefined,bounds:{from:number;to:number;low:number;high:number;rowPrice:number;timeMs:number},now:number):LiquidityBucket[]{
 if(!value||value.version!==1||value.rowPrice!==bounds.rowPrice||value.timeMs!==bounds.timeMs||!Number.isSafeInteger(value.savedAt)||value.savedAt>now||now-value.savedAt>300000||!Array.isArray(value.buckets)||value.buckets.length>240)return [];
 let bytes=0;const rows:LiquidityBucket[]=[];for(const b of value.buckets){
  if(!b.preaggregated||b.timeMs!==bounds.timeMs||b.rowSize!==bounds.rowPrice||!Number.isSafeInteger(b.start)||!Number.isSafeInteger(b.end)||b.start%bounds.timeMs||b.end!==b.start+bounds.timeMs||b.end>Math.min(bounds.to,Math.floor(now/bounds.timeMs)*bounds.timeMs)||!(b.cells instanceof Float64Array)||b.cells.length%HEATMAP_STRIDE||b.cells.length>512*HEATMAP_STRIDE||!b.cells.every(Number.isFinite))return [];
  bytes+=b.cells.byteLength;if(bytes>BYTE_LIMIT)return [];if(b.end<=bounds.from)continue;
  const cells:number[]=[];for(let i=0;i<b.cells.length;i+=HEATMAP_STRIDE)if(b.cells[i]>=bounds.low&&b.cells[i]<bounds.high)cells.push(...b.cells.subarray(i,i+HEATMAP_STRIDE));if(cells.length)rows.push({...b,cells:new Float64Array(cells),peaks:new Float64Array()});
 }return rows;
}
/** Four viewport records, each <=2MiB; optional cache failure never replaces server validation. */
export class IndexedHeatmapCache implements HeatmapHistoryCache {
 private database?:Promise<IDBDatabase|undefined>;
 private open(){return this.database??=new Promise<IDBDatabase|undefined>(resolve=>{if(typeof indexedDB==='undefined'){resolve(undefined);return;}const r=indexedDB.open('iqterminal-staging-heatmap-v1',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('viewports',{keyPath:'key'});s.createIndex('savedAt','savedAt');};r.onerror=()=>resolve(undefined);r.onblocked=()=>resolve(undefined);r.onsuccess=()=>resolve(r.result);});}
 dispose(){void this.database?.then(db=>db?.close());}
 async read(rowPrice:number,timeMs:number){const db=await this.open();if(!db)return;return new Promise<CachedHeatmap|undefined>(resolve=>{try{const r=db.transaction('viewports').objectStore('viewports').get(`${rowPrice}:${timeMs}`);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(undefined);}catch{resolve(undefined);}});}
 async write(value:CachedHeatmap){if(value.buckets.reduce((n,b)=>n+b.cells.byteLength,0)>BYTE_LIMIT)return;const db=await this.open();if(!db)return;await new Promise<void>(resolve=>{try{const tx=db.transaction('viewports','readwrite'),s=tx.objectStore('viewports');s.put({...value,key:`${value.rowPrice}:${value.timeMs}`});const count=s.count();count.onsuccess=()=>{let excess=count.result-4;if(excess>0){const r=s.index('savedAt').openCursor();r.onsuccess=()=>{const c=r.result;if(c&&excess-->0){c.delete();c.continue();}};}};tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();}catch{resolve();}});}
}
