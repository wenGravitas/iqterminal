import{build}from'../node_modules/.pnpm/rolldown@1.2.13/node_modules/rolldown/dist/index.mjs';import{execFileSync}from'node:child_process';import{relative}from'node:path';
const dir='artifacts/fresh-current-walls-and-incremental-client-delivery';
await build({input:'src/feed/prepared-wall-projection.ts',platform:'node',output:{file:dir+'/baseline-importer.mjs',format:'esm'},plugins:[{name:'unchanged-client-reference',load(id){if(/\/src\/.*\.ts$/.test(id))return{code:execFileSync('git',['show','5a09b80039af79051c21310a48d9fe4715f4674e:'+relative(process.cwd(),id)],{encoding:'utf8'}),moduleType:'ts'};}}]});
await build({input:'scripts/delivery-client-equality.ts',platform:'node',output:{file:dir+'/client-equality.mjs',format:'esm'}});
