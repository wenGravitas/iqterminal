from pathlib import Path
import os,json,subprocess,urllib.request,hashlib
root=Path('artifacts/pi-history-r1/native-restore-pairs-r1')
assert json.loads((root/'server-resources.jsonl').read_text().splitlines()[0])['kind']=='start'
variants={'control':{'url':'http://127.0.0.1:4188','build':'5039ea853ee5253131145accf7969d4334361d8a','dist':'/tmp/iqterminal-wall-native-tasks-dist'},'early':{'url':'http://127.0.0.1:4189','build':'e2fa254b818f7129b9b63ade93325d1ad0ea1cdd','dist':'/tmp/iqterminal-native-restore-dist'}}
for v in variants.values():
 entry=next((Path(v['dist'])/'assets').glob('main-*.js'));served=urllib.request.urlopen(v['url']+'/assets/'+entry.name).read();assert served==entry.read_bytes();v['servedMainSha256']=hashlib.sha256(served).hexdigest()
 health=json.loads(urllib.request.urlopen(v['url']+'/market-data/v2/history/health',timeout=20).read());assert health['build']=='dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51'
(root/'variants.json').write_text(json.dumps(variants,indent=2)+'\n')
results=[]
for pair in range(1,6):
 for variant in (['control','early'] if pair%2 else ['early','control']):
  v=variants[variant];label=f'native-pair-{pair}-{variant}-r1'
  assert not Path('artifacts/pi-history-r1/'+label+'-samples.jsonl').exists()
  env={**os.environ,'IQ_BENCH_URL':v['url'],'IQ_BENCH_BUILD':v['build'],'IQ_BENCH_LABEL':label,'IQ_BENCH_CASE':'walls-30h-perp','IQ_BENCH_SAMPLES':'1','IQ_BENCH_HEADLESS':'1','IQ_BENCH_YIELD_MODE':'user-visible-post-task'}
  with (root/f'{label}-console.txt').open('w') as out:r=subprocess.run(['node','scripts/pi-history-bench.mjs'],env=env,stdout=out,stderr=subprocess.STDOUT)
  entry={'pair':pair,'variant':variant,'label':label,'exitCode':r.returncode,'rawSample':'../'+label+'-samples.jsonl'};results.append(entry);(root/'sequence.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(entry),flush=True)
  assert r.returncode==0
print('Five alternating pairs terminal; each raw sample retains its original run=1. Pair identity is the sequence mapping, never edited source records.',flush=True)
