import {gunzipSync,gzipSync} from 'node:zlib';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {packWallDisplay,unpackWallDisplay} from './wall-display-codec-v2.ts';
const pages=JSON.parse(gunzipSync(readFileSync(new URL('./iq-wall-hour-reference.json.gz',import.meta.url)))),raw=pages.map(p=>JSON.stringify(p));
const packed=pages.map(p=>JSON.stringify(packWallDisplay(p)));
console.log(JSON.stringify({kind:'bytes',arch:process.arch,platform:process.platform,raw:raw.reduce((s,x)=>s+Buffer.byteLength(x),0),packed:packed.reduce((s,x)=>s+Buffer.byteLength(x),0),rawGzip:raw.reduce((s,x)=>s+gzipSync(x).length,0),packedGzip:packed.reduce((s,x)=>s+gzipSync(x).length,0)}));
for(let run=1;run<=5;run++){let t=performance.now();const plain=raw.map(x=>JSON.parse(x)),plainMs=performance.now()-t;t=performance.now();const decoded=packed.map(x=>unpackWallDisplay(JSON.parse(x),8*1024*1024)),packedMs=performance.now()-t;assert.deepEqual(decoded,plain);console.log(JSON.stringify({kind:'same-real-hour-decode',run,plainMs,packedMs}));}
