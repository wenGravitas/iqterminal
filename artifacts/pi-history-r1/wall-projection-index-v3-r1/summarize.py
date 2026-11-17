from pathlib import Path
import json,statistics,sys
root=Path(__file__).parent
path=root/(sys.argv[1] if len(sys.argv)>1 else 'cohort.jsonl')
rows=[json.loads(line) for line in path.read_text().splitlines()]
assert rows[-1]['kind']=='cohort-validated'
runs=[r for r in rows if r['kind']=='component-run']
selection=next(r for r in rows if r['kind']=='cohort-selected')
result={'scope':selection['scope'],'selection':selection,'groups':[],'validation':rows[-1]}
for market in sorted({r['market'] for r in runs}):
 for variant in sorted({r['variant'] for r in runs}):
  group=sorted((r for r in runs if r['market']==market and r['variant']==variant),key=lambda r:r['run'])
  assert len(group)==5
  for r in group:assert r['exitCode']==0 and len(r['completion'])==1 and r['completion'][0]['result']=='exact-match' and not r['completion'][0]['profiled']
  values=[r['completion'][0]['elapsedMs'] for r in group]
  result['groups'].append({'market':market,'variant':variant,'samplesMs':values,'medianMs':statistics.median(values),'maximumMs':max(values),'processSamplesMs':[r['processElapsedMs'] for r in group],'maximumSampledRssBytes':max(r['maximumSampledRssBytes'] for r in group),'maximumBuildingCheckpointBytes':max(r['maximumCheckpointBytes'] for r in group),'cpuSamplesMs':[(r['completion'][0]['cpu']['user']+r['completion'][0]['cpu']['system'])/1000 for r in group],'checkpointHashes':sorted({r['completion'][0]['checkpointSha256'] for r in group}),'prefixHashes':sorted({r['completion'][0]['prefixSha256'] for r in group})})
print(json.dumps(result,indent=2))
