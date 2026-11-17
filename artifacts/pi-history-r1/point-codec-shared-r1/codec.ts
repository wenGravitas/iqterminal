/** Lossless transport only. Object metadata/ordering and exact decimal spelling
 * survive unchanged; redundant point numbers are reconstructed only when equal.
 * Unknown point shapes stay native JSON. Canonical part hashes remain the fence. */
export const WALL_POINT_TRANSPORT='exact-points-v1';
const pointKeys='at,usd,percentile,rank,quantity,quantityExact,notionalExact';
const record=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v));
const validRank=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=1&&Number(v)<=10;
const pointOverhead=JSON.stringify({at:0,usd:0,percentile:null,rank:1,quantity:0,quantityExact:'0',notionalExact:'0'}).length-JSON.stringify([0,'0','0',1]).length-2;
type Checkpoint=()=>void|Promise<void>;
export async function encodeWallPointTransport(value:unknown,checkpoint?:Checkpoint){
 if(!Array.isArray(value)||value.length>100000)throw Error('Invalid wall point transport records');
 let changed=false,work=0;const rows=[];
 for(const row of value){
  if(!record(row)||!record(row.segment)||!Array.isArray(row.segment.valueRuns))throw Error('Invalid wall point transport segment');
  const base=row.segment.start,points=[];
  if(row.segment.valueRuns.length>100000)throw Error('Wall point transport value capacity');
  for(const p of row.segment.valueRuns){
   if(record(p)&&Object.keys(p).join(',')===pointKeys&&p.percentile===null&&validRank(p.rank)&&decimal(p.quantityExact)&&decimal(p.notionalExact)
    &&p.quantity===Number(p.quantityExact)&&p.usd===Number(p.notionalExact)&&Number.isSafeInteger(base)&&Number.isSafeInteger(p.at)
    &&Number.isSafeInteger(p.at-base)&&base+(p.at-base)===p.at){
    points.push([p.at-base,p.quantityExact,p.notionalExact,p.rank]);changed=true;
   }else points.push(p);
   if(++work>1000000)throw Error('Wall point transport value capacity');if(work%256===0)await checkpoint?.();
  }
  rows.push({...row,segment:{...row.segment,valueRuns:points}});
 }
 return {value:rows,changed};
}
export async function decodeWallPointTransport(value:unknown,checkpoint?:Checkpoint,budget?:{bytes:number;max:number}){
 if(!Array.isArray(value)||value.length>100000)throw Error('Invalid wall point transport records');
 let changed=false,work=0;
 for(const row of value){
  if(!record(row)||!record(row.segment)||!Array.isArray(row.segment.valueRuns))throw Error('Invalid wall point transport segment');
  const base=row.segment.start,points=[];
  if(row.segment.valueRuns.length>100000)throw Error('Wall point transport value capacity');
  for(const p of row.segment.valueRuns){
   if(Array.isArray(p)){
    if(p.length!==4||!Number.isSafeInteger(base)||!Number.isSafeInteger(p[0])||!Number.isSafeInteger(base+p[0])||base+p[0]<0||!decimal(p[1])||!decimal(p[2])||!validRank(p[3]))throw Error('Invalid wall point transport tuple');
    const [delta,quantityExact,notionalExact,rank]=p;
    const at=base+delta,usd=Number(notionalExact),quantity=Number(quantityExact);
    if(budget){budget.bytes+=pointOverhead+String(at).length+String(usd).length+String(quantity).length-String(delta).length;if(budget.bytes>budget.max)throw Error('Wall point transport canonical byte capacity');}
    points.push({at,usd,percentile:null,rank,quantity,quantityExact,notionalExact});changed=true;
   }else points.push(p);
   if(++work>1000000)throw Error('Wall point transport value capacity');if(work%256===0)await checkpoint?.();
  }
  row.segment.valueRuns=points;
 }
 return {value,changed};
}
