/** Opt-in CPU experiment over captured immutable server frames, never a loading gate. */
import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
import {gunzipSync,brotliCompress,constants} from 'node:zlib';import {promisify} from 'node:util';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
if(process.env.IQ_WALL_PRODUCT_FRAMES!=='1')throw Error('Explicit offline selection required');
const dir=resolve(process.argv[2]),{encodeWallPointTransport,decodeWallPointTransport}=await import(pathToFileURL(join(dir,'codec.mjs'))),compress=promisify(brotliCompress),results=[];
const captures=JSON.parse(await readFile(join(dir,'capture.json'),'utf8'));
function checkpoints(){let at=performance.now(),maxSliceMs=0,yields=0;return {async checkpoint(){const elapsed=performance.now()-at;if(elapsed>=8){maxSliceMs=Math.max(maxSliceMs,elapsed);yields++;await new Promise(setImmediate);at=performance.now();}},finish(){return {yields,maxSliceMs:Math.max(maxSliceMs,performance.now()-at)};}};}
for(const capture of captures){
 const raw=gunzipSync(await readFile(join(dir,capture.market+'-batch.gz')),{maxOutputLength:8*1024*1024}),lines=raw.toString().split('\n');assert.equal(lines.pop(),'');assert.equal(raw.length,Number(capture.headers['x-iq-decoded-bytes']));assert.ok(lines.length<=32);
 assert.ok(lines.every(line=>Buffer.byteLength(line)<=4*1024*1024));const samples=[];
 for(let run=1;run<=5;run++)for(const version of run%2?[1,2]:[2,1]){
  const encodeAt=performance.now(),wire=[],encodeCheckpoint=checkpoints();let omitted=0,points=0;
  for(const line of lines){const packed=await encodeWallPointTransport(JSON.parse(line),encodeCheckpoint.checkpoint,version),text=JSON.stringify(packed.value);assert.ok(Buffer.byteLength(text)<=Buffer.byteLength(line));wire.push(text);for(const row of packed.value)for(const p of row.segment.valueRuns){points++;if(Array.isArray(p)&&p.length===3)omitted++;}}
  const encoded=Buffer.from(wire.join('\n')+'\n'),encodeMs=performance.now()-encodeAt,encodeSlices=encodeCheckpoint.finish();
  const compressionAt=performance.now(),body=await compress(encoded,{params:{[constants.BROTLI_PARAM_QUALITY]:5,[constants.BROTLI_PARAM_MODE]:constants.BROTLI_MODE_TEXT}}),compressionMs=performance.now()-compressionAt;
  const decodeAt=performance.now(),decodeCheckpoint=checkpoints();
  for(const [i,text] of wire.entries()){const budget={bytes:Buffer.byteLength(text),max:Buffer.byteLength(lines[i])},decoded=await decodeWallPointTransport(JSON.parse(text),decodeCheckpoint.checkpoint,budget,version);assert.equal(JSON.stringify(decoded.value),lines[i]);assert.equal(budget.bytes,budget.max);}
  samples.push({run,version,points,omitted,decodedBytes:encoded.length,compressedBytes:body.length,encodeMs,encodeSlices,compressionMs,decodeMs:performance.now()-decodeAt,decodeSlices:decodeCheckpoint.finish(),exact:true});
 }
 results.push({market:capture.market,canonicalBytes:raw.length,canonicalSha256:createHash('sha256').update(raw).digest('hex'),parts:lines.length,samples});
 await writeFile(join(dir,'results.json'),JSON.stringify({scope:'Five alternating Pi Node production-codec CPU comparisons per captured immutable bounded batch. Actual canonical server frames; exact JSON and byte expansion checked per part. Encode includes JSON and counting; decode includes parsing, canonical equality and expansion accounting. Compression quality5 matches server. Checkpoints yield via setImmediate after8ms, every256 points. JSON/native/GC work can exceed soft budget. No browser, route, loading, whole-view or live acceptance.',results},null,2)+'\n');
}
await writeFile(join(dir,'executed.mjs'),await readFile(new URL(import.meta.url)));
