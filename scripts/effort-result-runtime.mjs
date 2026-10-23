import { transformWithOxc } from 'vite';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/** Compile the actual DOM-free live engine, with no copied replay formulas. */
export async function effortRuntime(){const dir=await mkdtemp(join(tmpdir(),'iq-effort-'));try{for(const name of ['settings','engine']){const source=await readFile(new URL(`../src/effort-result/${name}.ts`,import.meta.url),'utf8');const code=(await transformWithOxc(source,`${name}.ts`,{target:'es2022'})).code.replace(/(['"])\.\/settings\1/g,'"./settings.mjs"');await writeFile(join(dir,`${name}.mjs`),code);}return {...await import(pathToFileURL(join(dir,'engine.mjs')).href),...await import(pathToFileURL(join(dir,'settings.mjs')).href),dispose:()=>rm(dir,{recursive:true,force:true})};}catch(error){await rm(dir,{recursive:true,force:true});throw error;}}
