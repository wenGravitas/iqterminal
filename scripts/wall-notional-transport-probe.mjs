/** Offline hypothesis only: no protocol or canonical source changes. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync,brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
if(process.env.IQ_WALL_NOTIONAL_PROBE!=='1')throw Error('Explicit offline selection required');
const output=process.argv[2];if(!output)throw Error('Unique output directory required');await mkdir(output);
const compress=promisify(brotliCompress),results=[];
function multiply(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length>128||b.length>128||![a,b].every(v=>/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)))return null;
 const scale=(a.split('.')[1]?.length??0)+(b.split('.')[1]?.length??0);
 let digits=String(BigInt(a.replace('.',''))*BigInt(b.replace('.',''))).padStart(scale+1,'0');
 if(scale)digits=digits.slice(0,-scale)+'.'+digits.slice(-scale);
 return digits.includes('.')?digits.replace(/0+$/,'').replace(/\.$/,''):digits;
}
for(const market of ['spot','perpetual']){
 const input=await readFile(`artifacts/pi-history-r1/budget-paint-tasks-r3/${market}-input.json.gz`),raw=gunzipSync(input,{maxOutputLength:64*1024*1024}),{segments}=JSON.parse(raw),canonical=JSON.stringify(segments),samples=[];
 for(let run=1;run<=5;run++)for(const variant of run%2?['incumbent','omit-proven-product']:['omit-proven-product','incumbent']){
  const start=performance.now();let omitted=0,points=0;
  const packed=[];
  for(const s of segments){const valueRuns=[];for(const p of s.valueRuns){
   const product=variant==='omit-proven-product'?multiply(s.priceExact,p.quantityExact):null;
   assert.equal(Object.keys(p).join(','),'at,usd,percentile,rank,quantity,quantityExact,notionalExact');
   assert.equal(p.percentile,null);assert.equal(p.usd,Number(p.notionalExact));assert.equal(p.quantity,Number(p.quantityExact));
   if(product===p.notionalExact){valueRuns.push([p.at-s.start,p.quantityExact,p.rank]);omitted++;}
   else valueRuns.push([p.at-s.start,p.quantityExact,p.notionalExact,p.rank]);
   if(++points%256===0)await new Promise(setImmediate);
  }packed.push({...s,valueRuns});}
  const wire=Buffer.from(JSON.stringify(packed)),encodeMs=performance.now()-start;
  const compressionAt=performance.now(),compressed=await compress(wire,{params:{[constants.BROTLI_PARAM_QUALITY]:5,[constants.BROTLI_PARAM_MODE]:constants.BROTLI_MODE_TEXT}}),compressionMs=performance.now()-compressionAt;
  const decodeAt=performance.now(),decoded=JSON.parse(wire);
  let count=0;for(const s of decoded){s.valueRuns=s.valueRuns.map(p=>{const n=p.length===3?multiply(s.priceExact,p[1]):p[2];assert.notEqual(n,null);return {at:s.start+p[0],usd:Number(n),percentile:null,rank:p.at(-1),quantity:Number(p[1]),quantityExact:p[1],notionalExact:n};});count+=s.valueRuns.length;if(count%256===0)await new Promise(setImmediate);}
  assert.equal(JSON.stringify(decoded),canonical);
  samples.push({run,variant,points,omitted,encodeMs,compressionMs,decodeMs:performance.now()-decodeAt,decodedBytes:wire.length,compressedBytes:compressed.length,exact:true});
 }
 results.push({market,inputSha256:createHash('sha256').update(raw).digest('hex'),samples});
 await writeFile(`${output}/results.json`,JSON.stringify({scope:'Five alternating offline Pi prototype samples over captured exact walls. Entire market payload, not actual bounded delivery frames. Exact decimal product omitted only when its canonical spelling matches; every restored JSON byte matches. Not protocol implementation, browser, route or loading acceptance. Decode timing includes final exact comparison.',results},null,2)+'\n');
}
await writeFile(`${output}/executed.mjs`,await readFile(new URL(import.meta.url)));
