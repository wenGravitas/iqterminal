import os, json, subprocess, pathlib, hashlib, time
root=pathlib.Path('/home/daz/workarea/iqterminal-perf-history')
out=root/'artifacts/pi-history-r1/wall-pair-13d-0ee-r1'
builds={'control':('13d30ecb5d510111695d07e24a72f7afa65cbd9c',4188),'grouped':('0ee81ebba15b2d5d4ffb2c6caa7a18c4e6918317',4187)}
for side in builds:(out/(side+'-samples.jsonl')).write_text('')
steps=[]
for run in range(1,6):
 for side in (['control','grouped'] if run%2 else ['grouped','control']):
  build,port=builds[side];label=f'wall-pair-13d-0ee-r1-{run}-{side}'
  env=dict(os.environ,IQ_BENCH_URL=f'http://127.0.0.1:{port}',IQ_BENCH_LABEL=label,IQ_BENCH_BUILD=build,IQ_BENCH_CASE='walls-30h-perp',IQ_BENCH_SAMPLES='1',IQ_BENCH_HEADLESS='1',IQ_BENCH_OBSERVATION_MS='45000')
  before=time.monotonic()
  with (out/(f'{run}-{side}-console.log')).open('w') as log:
   result=subprocess.run(['/home/daz/.nvm/versions/node/v22.19.0/bin/node','scripts/pi-history-bench.mjs'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
  sample_path=root/'artifacts/pi-history-r1'/f'{label}-samples.jsonl'
  rows=[json.loads(line) for line in sample_path.read_text().splitlines()] if sample_path.exists() else []
  if result.returncode or len(rows)!=1:raise RuntimeError(f'{label}: runner exit {result.returncode}, {len(rows)} samples')
  row=rows[0];row['pairedRun']=run;row['pairedSide']=side
  with (out/(side+'-samples.jsonl')).open('a') as file:file.write(json.dumps(row)+'\n')
  steps.append({'run':run,'side':side,'label':label,'build':build,'port':port,'elapsedMs':(time.monotonic()-before)*1000,'sampleSha256':hashlib.sha256(sample_path.read_bytes()).hexdigest(),'firstHistoryMs':row['firstHistoryMs'],'completeMs':row['completeMs']})
  (out/'sequence.json').write_text(json.dumps(steps,indent=2)+'\n')
  print(json.dumps(steps[-1]),flush=True)
