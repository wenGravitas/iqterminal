/** Install only the two verified derived sample chunks for read-route checks. */
import assert from 'node:assert/strict';import {readdir,readFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {readWallChunkManifest,readWallChunkPart} from '../src/wall-history-chunks.ts';import {atomicWrite} from '../src/history-state.ts';
if(process.env.IQ_STAGE_WALL_SAMPLE_PARTS!=='1')throw Error('Explicit derived sample installation opt-in required');
const expectedBuild=process.argv[2];assert.match(expectedBuild??'',/^[a-f0-9]{40}$/);
const health=await(await fetch('http://127.0.0.1:18780/v2/history/health',{signal:AbortSignal.timeout(10000)})).json();assert.equal(health.build,expectedBuild);
const identities=()=>execFileSync('docker',['inspect','--format','{{.Name}} {{.Id}} {{.State.StartedAt}}','iqterminal-server','iqterminal-spot-server'],{encoding:'utf8'}).trim();
const before=identities(),samples=[];let totalBytes=0;
for(const market of ['spot','perpetual']){
 const source=join(process.cwd(),`artifacts/pi-history-r1/wall-chunk-536f25d-${market}/chunks`),keys=(await readdir(source)).filter(x=>/^[a-f0-9]{64}$/.test(x));assert.equal(keys.length,1);
 const key=keys[0],manifest=await readWallChunkManifest(source,key);assert.equal(manifest.request.market,market);
 const parts=[];for(const part of manifest.parts){const loaded=await readWallChunkPart(source,key,part.hash);parts.push(loaded);totalBytes+=loaded.body.byteLength;}
 assert.ok(totalBytes<=2*1024*1024,'Explicit derived sample byte budget');samples.push({market,key,manifest,parts});
}
for(const sample of samples){
 const root=join(process.cwd(),'state',sample.market==='spot'?'history-spot':'history','wall-chunks'),dir=join(root,sample.key);await mkdir(dir,{recursive:true});
 async function install(file,body){try{assert.deepEqual(await readFile(file),Buffer.from(body),'Existing derived sample differs; refusing replacement');}catch(e){if(e.code!=='ENOENT')throw e;await atomicWrite(file,body);}}
 for(const part of sample.parts)await install(join(dir,part.part.hash+'.json.gz'),part.body);
 await install(join(dir,'manifest.json'),JSON.stringify(sample.manifest));
 for(const part of sample.parts)await readWallChunkPart(root,sample.key,part.part.hash);
 console.log(JSON.stringify({kind:'installed-derived-wall-sample',market:sample.market,key:sample.key,from:sample.manifest.request.from,to:sample.manifest.request.to,sourceRevision:sample.manifest.request.sourceRevision,parts:sample.parts.length,bytes:sample.parts.reduce((s,p)=>s+p.body.byteLength,0),root}));
}
assert.equal(identities(),before);console.log(JSON.stringify({kind:'collector-identities-unchanged',identities:before,build:expectedBuild,totalSampleBytes:totalBytes}));
