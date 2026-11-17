/** Offline Pi CPU comparison. Real captured financial rows in a constructed,
 * valid checkpoint envelope; no browser, network, cold build or live-tail gate. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {OrderWallsArchiveProjector} from '../src/shared/order-walls-projection.ts';
const [inputPath,manifestPath,output]=process.argv.slice(2);assert.ok(output);assert.ok(global.gc,'Use --expose-gc for comparable isolated samples');
const input=await readFile(inputPath),data=JSON.parse(gunzipSync(input)),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
assert.equal(data.segments.length,23850);assert.equal(manifest.core,'c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c');
const digest=segments=>{const h=createHash('sha256');for(const segment of segments)h.update(JSON.stringify(segment));return h.digest('hex');};
assert.equal(digest(data.segments),'de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6');
// Captured financial values and active candidates are exact. Global queue
// sequences are constructed monotonically for this CPU fixture; it is not a
// canonical replay/reconnect or historical eviction reference.
let sequence=0;const state={...manifest.active,segments:data.segments,valueRunOrder:data.segments.map(s=>s.valueRuns.map(()=>++sequence)),nextValueRunSequence:sequence};
const {settings,from,to}=state,target={cursor:state.cursor+1,epoch:state.epoch+1},samples=[];
const reference=OrderWallsArchiveProjector.restoreCheckpoint({...state,...target},settings,from,to).selectedState();
function measure(method){
 global.gc();const before=process.memoryUsage(),cpu=process.cpuUsage(),start=performance.now();let projector;
 if(method==='double'){
  const first=OrderWallsArchiveProjector.restoreCheckpoint(state,settings,from,to),copy=first.checkpoint();Object.assign(copy,target);
  projector=OrderWallsArchiveProjector.restoreCheckpoint(copy,settings,from,to);
 }else projector=OrderWallsArchiveProjector.restoreCheckpoint({...state,...target},settings,from,to);
 const ms=performance.now()-start,after=process.memoryUsage(),cpuUsed=process.cpuUsage(cpu);
 assert.equal(digest(projector.snapshot()),digest(data.segments));assert.deepEqual(projector.selectedState(),reference);
 return {method,ms,cpu:cpuUsed,heapBefore:before.heapUsed,heapAfter:after.heapUsed,heapGrowth:after.heapUsed-before.heapUsed,retained:projector.diagnostics()};
}
for(let run=1;run<=5;run++)samples.push({run,methods:(run%2?['double','single']:['single','double']).map(measure)});

await writeFile(output,JSON.stringify({scope:'Offline Pi Node CPU; real financial rows in a constructed queue-order envelope; not browser timing, whole loading, source revision or live-tail acceptance',arch:process.arch,node:process.version,inputGzipSha256:createHash('sha256').update(input).digest('hex'),financialHash:digest(data.segments),segments:data.segments.length,valueRuns:sequence,load:(await readFile('/proc/loadavg','utf8')).trim(),memory:await readFile('/proc/meminfo','utf8'),samples},null,2)+'\n');
console.log(JSON.stringify(samples));
