import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
const out='artifacts/pi-history-r1/readonly-r1';
writeFileSync(out+'/comparison.jsonl','',{flag:'wx'});
const arms={old:{url:'http://127.0.0.1:4198',build:'e25cd431feb18286da74e6a15c61088329e3e367'},new:{url:'http://127.0.0.1:4199',build:'474f0660953b5fe6c7e48955eab264691adcff4c'}};
for(let pair=1;pair<=5;pair++)for(const arm of pair%2?['old','new']:['new','old']){
 const label=`readonly-${arm}-${pair}`,config=arms[arm],start=performance.now();let status=0;
 try{execFileSync(process.execPath,['scripts/pi-history-bench.mjs'],{env:{...process.env,IQ_BENCH_URL:config.url,IQ_BENCH_BUILD:config.build,IQ_BENCH_HEADLESS:'1',IQ_BENCH_LABEL:label,IQ_BENCH_CASE:'walls-30h-perp-15m',IQ_BENCH_SAMPLES:'1',IQ_BENCH_WINDOWS:out+'/windows.json',IQ_BENCH_WALL_REFERENCES:out+'/references.json'},stdio:'inherit'});}catch(error){status=error.status??-1;}
 appendFileSync(out+'/comparison.jsonl',JSON.stringify({pair,arm,label,build:config.build,status,processElapsedMs:performance.now()-start,scope:'Process wall time includes post-observation proofs and cleanup; loading gates use raw browser paint marks only'})+'\n');
}
for(const arm of ['old','new'])writeFileSync(out+`/${arm}-samples.jsonl`,Array.from({length:5},(_,i)=>readFileSync(`artifacts/pi-history-r1/readonly-${arm}-${i+1}-samples.jsonl`,'utf8')).join(''));
