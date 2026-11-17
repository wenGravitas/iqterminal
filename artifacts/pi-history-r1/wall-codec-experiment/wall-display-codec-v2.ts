/** Lossless JSON shape encoding for prepared wall parts. Decimal strings and
 * every transition remain exact; this is structural compaction, not sampling. */
export interface WallDisplayData {encoding:'wall-shapes-v2';shapes:string[][];strings:string[];data:unknown}
const encoder=new TextEncoder();
export function packWallDisplay(value:unknown):WallDisplayData {
 const shapes:string[][]=[],ids=new Map<string,number>(),strings:string[]=[],stringIds=new Map<string,number>(),counts=new Map<string,number>();let nodes=0;
 function count(v:any,depth:number){
  if(++nodes>1_000_000||depth>48)throw Error('Wall display structure budget');
  if(typeof v==='string'&&v.length>=12){if(counts.has(v)||counts.size<65_536)counts.set(v,(counts.get(v)??0)+1);}
  else if(Array.isArray(v))for(const x of v)count(x,depth+1);
  else if(v&&typeof v==='object')for(const x of Object.values(v))count(x,depth+1);
 }
 count(value,0);nodes=0;
 function visit(v:any,depth:number):any {
  if(++nodes>1_000_000||depth>48)throw Error('Wall display structure budget');
  if(typeof v==='string'){
   if((counts.get(v)??0)<2)return v;
   let id=stringIds.get(v);if(id===undefined){id=strings.length;stringIds.set(v,id);strings.push(v);}return [-1,id];
  }
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Non-finite wall display number');return v;}
  if(Array.isArray(v))return [0,...v.map(x=>visit(x===undefined?null:x,depth+1))];
  if(typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype)throw Error('Non-JSON wall display value');
  const keys=Object.keys(v).filter(k=>v[k]!==undefined),key=JSON.stringify(keys);let id=ids.get(key);
  if(id===undefined){id=shapes.length;if(id>=256)throw Error('Wall display schema budget');ids.set(key,id);shapes.push(keys);}
  return [id+1,...keys.map(k=>visit(v[k],depth+1))];
 }
 const data=visit(value,0);return {encoding:'wall-shapes-v2',shapes,strings,data};
}
export function unpackWallDisplay(input:unknown,maxBytes=4*1024*1024):unknown {
 const p=input as any;
 if(!p||!['wall-shapes-v1','wall-shapes-v2'].includes(p.encoding)||!Array.isArray(p.shapes)||p.shapes.length>256)throw Error('Invalid wall display encoding');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid wall display budget');
 const strings=p.encoding==='wall-shapes-v2'?p.strings:[];
 if(!Array.isArray(strings)||strings.length>65_536||strings.some(x=>typeof x!=='string'))throw Error('Invalid wall display string table');
 const stringBytes=strings.map(x=>encoder.encode(JSON.stringify(x)).byteLength);
 const schemas=p.shapes.map((keys:string[])=>{
  if(!Array.isArray(keys)||keys.length>128||keys.some(k=>typeof k!=='string')||new Set(keys).size!==keys.length)throw Error('Invalid wall display schema');
  return {keys,bytes:keys.reduce((n,k)=>n+encoder.encode(JSON.stringify(k)).byteLength+1,0)};
 });
 let nodes=0,bytes=0;
 const add=(n:number)=>{bytes+=n;if(bytes>maxBytes)throw Error('Expanded wall display byte budget');};
 function visit(v:any,depth:number):any {
  if(++nodes>1_000_000||depth>48)throw Error('Wall display structure budget');
  if(v===null){add(4);return null;}
  if(typeof v==='string'){add(encoder.encode(JSON.stringify(v)).byteLength);return v;}
  if(typeof v==='boolean'){add(v?4:5);return v;}
  if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Invalid wall display number');add(String(v).length);return v;}
  if(!Array.isArray(v)||!Number.isInteger(v[0])||v[0]<-1)throw Error('Invalid wall display node');
  if(v[0]===-1){const id=v[1];if(v.length!==2||!Number.isInteger(id)||id<0||id>=strings.length)throw Error('Invalid wall display string reference');add(stringBytes[id]);return strings[id];}
  const [tag,...values]=v;
  if(tag===0){add(2+Math.max(0,values.length-1));return values.map(x=>visit(x,depth+1));}
  const schema=schemas[tag-1];if(!schema||schema.keys.length!==values.length)throw Error('Invalid wall display shape');
  add(2+schema.bytes+Math.max(0,values.length-1));const result:any={};
  for(let i=0;i<values.length;i++)Object.defineProperty(result,schema.keys[i],{value:visit(values[i],depth+1),enumerable:true,writable:true,configurable:true});
  return result;
 }
 return visit(p.data,0);
}
