// Explicit synthetic depth-state CPU stress; no production fixture path or venue claim.
import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'iqterminal-heatmap-bench-'));
try {
  await build({ configFile: false, logLevel: 'silent', build: { lib: { entry: 'src/feed/heatmap-model.ts', formats: ['es'], fileName: () => 'collector.mjs' }, outDir: directory, emptyOutDir: false, minify: false } });
  const { LiquidityCollector, HEATMAP_LIMITS } = await import(pathToFileURL(join(directory, 'collector.mjs')).href);
  const base = 1800000000000, results = [], quantile = (v, q) => [...v].sort((a,b)=>a-b)[Math.floor((v.length-1)*q)];
  const bids = Array.from({length:1000},(_,i)=>[83000-i*.1, .1+(i%31)/10]), asks = Array.from({length:1000},(_,i)=>[83000.1+i*.1,.1+(i%29)/10]);
  const book = { snapshotBidBoundary: bids.at(-1)[0], snapshotAskBoundary: asks.at(-1)[0], visitLevels(cb) { for(const [p,q] of bids)cb('bid',p,q);for(const [p,q] of asks)cb('ask',p,q); } };
  for (const configurations of [1,2,4]) {
    const groups = Array.from({length:configurations},(_,i)=>new LiquidityCollector({rowPrice:[10,5,1,.5][i],bucketMs:500},.1));
    // Max retention and eviction are already active when bursts start.
    for(let i=0;i<500;i++) for(const group of groups){group.transition(book,base+i*500,1);group.advance(base+i*500+500);group.changes();}
    global.gc?.(); const heapBefore = process.memoryUsage().heapUsed, arrayBefore = process.memoryUsage().arrayBuffers, samples=[]; let snapshots=0;
    const start = performance.now();
    for(let i=0;i<2000;i++) {
      bids[i%1000][1]=.1+(i%31)/10; asks[(i*17)%1000][1]=.1+(i%29)/10;
      const t=performance.now();
      for(const group of groups) { group.transition(book,base+250000+i*100,1); if(i%5===4) snapshots+=group.changes().length; }
      samples.push(performance.now()-t);
    }
    const cpuMs=performance.now()-start; global.gc?.();
    for(const g of groups){assert.ok(g.bytes<=HEATMAP_LIMITS.bytes);assert.ok(g.cellCount<=HEATMAP_LIMITS.cells);assert.ok(g.snapshot().length<=HEATMAP_LIMITS.buckets);}
    results.push({configurations,updates:2000,levels:2000,cadenceMs:100,publicationMs:500,cpuMs,updateP50Ms:quantile(samples,.5),updateP95Ms:quantile(samples,.95),updateMaxMs:Math.max(...samples),snapshots,groups:groups.map(g=>g.diagnostics()),postGcHeapDelta:process.memoryUsage().heapUsed-heapBefore,arrayBufferDelta:process.memoryUsage().arrayBuffers-arrayBefore});
  }
  const report={scope:'Synthetic CPU collector stress on pre-populated maximum retained session; excludes IPC/drawing and total browser process memory',machine:{platform:process.platform,arch:process.arch,node:process.version},results};
  await writeFile('artifacts/performance-heatmap-collector.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally { await rm(directory,{recursive:true,force:true}); }
