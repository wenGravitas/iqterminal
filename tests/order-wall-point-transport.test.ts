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
