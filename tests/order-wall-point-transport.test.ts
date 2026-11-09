import {test} from 'vitest';import assert from 'node:assert/strict';
import {encodeWallPointTransport,decodeWallPointTransport} from '../src/shared/order-wall-point-transport.ts';
const point=(at:number,q='9007199254740993.000000001',n='12345678901234567890.000000001')=>({at,usd:Number(n),percentile:null,rank:8,quantity:Number(q),quantityExact:q,notionalExact:n});
const records=()=>[{order:7,segment:{id:'stable:entry:profile',start:1793804400000,end:1793804401000,censoredReason:'गैप',valueRuns:[point(1793804399999),point(1793804400000,'0.00000000000000000000001','0'),point(1793804401000,'0','1000000000000000000000')]},valueRunOrder:[3,7,8],offset:0,totalRuns:3}];
test('point tuples restore byte-identical JSON, decimal spelling, ordering, tiny values and negative offsets',async()=>{
 const source=records(),before=JSON.stringify(source),encoded=await encodeWallPointTransport(source);assert.equal(JSON.stringify(source),before);assert.equal(encoded.changed,true);
 const wire=JSON.stringify(encoded.value),budget={bytes:Buffer.byteLength(wire),max:Buffer.byteLength(before)};const decoded=await decodeWallPointTransport(JSON.parse(wire),undefined,budget);
 assert.equal(decoded.changed,true);assert.equal(JSON.stringify(decoded.value),before);assert.equal(budget.bytes,budget.max);assert.ok(wire.length<before.length);
});
test('unknown fields, scalar mismatches and fractional timestamps remain unchanged native objects',async()=>{
 for(const edit of [(p:any)=>p.extension='future',(p:any)=>p.usd=42,(p:any)=>p.at+=.5]){const source=records();source[0].segment.valueRuns.forEach(edit);const before=JSON.stringify(source),encoded=await encodeWallPointTransport(source);assert.equal(encoded.changed,false);assert.equal(JSON.stringify(encoded.value),before);assert.equal(JSON.stringify((await decodeWallPointTransport(encoded.value)).value),before);}
});
test('malformed tuples and decoded expansion past the canonical byte budget fail explicitly',async()=>{
 for(const tuple of [[0,'1','2'],[.1,'1','2',1],[0,'01','2',1],[0,'1','2',11],[Number.MAX_SAFE_INTEGER,'1','2',1]]){const source:any=records();source[0].segment.valueRuns=[tuple];await assert.rejects(decodeWallPointTransport(source),/tuple/);}
 const encoded=await encodeWallPointTransport(records()),wire=JSON.stringify(encoded.value);await assert.rejects(decodeWallPointTransport(JSON.parse(wire),undefined,{bytes:Buffer.byteLength(wire),max:Buffer.byteLength(wire)}),/canonical byte capacity/);
});
test('bounded work checkpoints can cancel encoding and decoding without publishing a fragment',async()=>{
 const source=records();source[0].segment.valueRuns=Array.from({length:512},(_,i)=>point(1793804400000+i));let checks=0;
 const packed=await encodeWallPointTransport(source,()=>{checks++;});assert.equal(checks,2);
 await assert.rejects(decodeWallPointTransport(packed.value,()=>{throw Error('cancelled checkpoint');}),/cancelled checkpoint/);
 await assert.rejects(encodeWallPointTransport(source,()=>{throw Error('cancelled checkpoint');}),/cancelled checkpoint/);
});
test('negotiated products preserve exact JSON and expansion budgets; v1 never emits or accepts them',async()=>{
 const source:any=records();source[0].segment.priceExact='78000';source[0].segment.valueRuns=[point(1793804400000,'26.68924','2081760.72'),point(1793804400001,'0.00000000000000000000001','0.00000000000000000078')];
 const before=JSON.stringify(source),packed=await encodeWallPointTransport(source,undefined,2),wire=JSON.stringify(packed.value);
 assert.ok(packed.value[0].segment.valueRuns.every((p:any)=>p.length===3));
 const budget={bytes:Buffer.byteLength(wire),max:Buffer.byteLength(before)};
 assert.equal(JSON.stringify((await decodeWallPointTransport(JSON.parse(wire),undefined,budget,2)).value),before);assert.equal(budget.bytes,budget.max);
 await assert.rejects(decodeWallPointTransport(JSON.parse(wire)),/tuple/);
 assert.ok((await encodeWallPointTransport(source)).value[0].segment.valueRuns.every((p:any)=>p.length===4));
 await assert.rejects(decodeWallPointTransport(JSON.parse(wire),undefined,{bytes:Buffer.byteLength(wire),max:Buffer.byteLength(before)-1},2),/canonical byte capacity/);
});
test('product encoding falls back for spelling, source mismatch, missing price, extended point shape and arithmetic bounds',async()=>{
 for(const edit of [(s:any)=>s.segment.valueRuns[0].notionalExact='6.00',(s:any)=>s.segment.priceExact='4',(s:any)=>delete s.segment.priceExact,(s:any)=>s.segment.priceExact='1'.repeat(129),(s:any)=>s.segment.valueRuns[0].extension='future']){
  const source:any=records();source[0].segment.priceExact='2';source[0].segment.valueRuns=[point(1793804400000,'3','6')];edit(source[0]);const before=JSON.stringify(source);
  const packed=await encodeWallPointTransport(source,undefined,2);assert.notEqual(packed.value[0].segment.valueRuns[0].length,3);
  assert.equal(JSON.stringify((await decodeWallPointTransport(JSON.parse(JSON.stringify(packed.value)),undefined,undefined,2)).value),before);
 }
});
test('malformed products fail before expansion and cancellation remains bounded',async()=>{
 for(const [price,tuple] of [['2',[0,'01',1]],['2',[0,'3',11]],['invalid',[0,'3',1]],['1'.repeat(129),[0,'3',1]],['2',[0,'1'.repeat(129),1]],['2',[.5,'3',1]]]){
  const source:any=records();source[0].segment.priceExact=price;source[0].segment.valueRuns=[tuple];await assert.rejects(decodeWallPointTransport(source,undefined,undefined,2),/tuple/);
 }
 const source:any=records();source[0].segment.priceExact='2';source[0].segment.valueRuns=Array.from({length:512},(_,i)=>point(1793804400000+i,'3','6'));const packed=await encodeWallPointTransport(source,undefined,2);let checkpoints=0;
 await decodeWallPointTransport(packed.value,()=>{checkpoints++;},undefined,2);assert.equal(checkpoints,2);
 await assert.rejects(encodeWallPointTransport(source,()=>{throw Error('cancelled');},2),/cancelled/);
});
