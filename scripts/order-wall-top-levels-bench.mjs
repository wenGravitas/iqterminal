/** Bundle the DOM-free TypeScript harness with the project's installed Vite;
 * measure in a fresh Node child, after compilation has finished. No new dependency. */
import {build} from 'vite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const temporary=await mkdtemp(join(tmpdir(),'iqterminal-top-levels-bench-'));
try{
 const entry=process.argv.includes('--render')?'order-wall-top-levels-render-bench.ts':'order-wall-top-levels-bench.ts';
 await build({configFile:false,publicDir:false,logLevel:'warn',build:{ssr:resolve('scripts',entry),outDir:temporary,emptyOutDir:false,minify:false,target:'node22',rolldownOptions:{output:{entryFileNames:'bench.mjs'}}}});
 const result=spawnSync(process.execPath,['--expose-gc',join(temporary,'bench.mjs'),...process.argv.slice(2)],{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;process.exitCode=result.status??1;
}finally{await rm(temporary,{recursive:true,force:true});}
