"""Summarize raw V8 samples and all ten fixed-source component builds."""
from pathlib import Path
import json,collections,statistics,tarfile
root=Path(__file__).parent
p=json.loads((root/'baseline.cpuprofile').read_text())
nodes={n['id']:n for n in p['nodes']};weights=collections.Counter();positions=collections.Counter()
for sample,delta in zip(p['samples'],p['timeDeltas']):weights[sample]+=delta
for node in p['nodes']:
 if node['callFrame']['functionName']=='advancePreparedWallProjection':
  for item in node.get('positionTicks',[]):positions[item['line']]+=item['ticks']
bundle=(root/'baseline-executed.mjs').read_text().splitlines()
summary={'profile':{'scope':'V8 sampled elapsed attribution under cgroup throttling, including idle/GC and terminal harness failure formatting. Not exclusive CPU durations or Pi chart latency.',
 'largestSelfSamples':[{'sampledMs':ms/1000,'frame':nodes[key]['callFrame']} for key,ms in weights.most_common(12)],
 'builderPositionTicks':[{'ticks':ticks,'bundleLine':line,'source':bundle[line-1]} for line,ticks in positions.most_common(12)]}}
events=[json.loads(line) for line in (root/'cohort.jsonl').read_text().splitlines()]
runs=[event for event in events if event['kind']=='component-run']
assert len(runs)==10 and events[-1]['kind']=='profile-validated'
digests=set()
for variant in ['baseline-fixed','candidate']:
 cohort=[event for event in runs if event['variant']==variant]
 assert len(cohort)==5 and all(event['exitCode']==0 and len(event['completion'])==1 for event in cohort)
 results=[event['completion'][0] for event in cohort]
 assert all(result['result']=='exact-match' for result in results)
 digests.update(result['checkpointSha256'] for result in results)
 values=[result['elapsedMs'] for result in results]
 summary[variant]={'scope':'Unprofiled offline projection component, warm host filesystem, fresh output; same pinned canonical input. Not raw cold materialization or end-to-end Pi route.',
  'samplesMs':values,'medianMs':statistics.median(values),'maximumMs':max(values),
  'cpuMs':[(r['cpu']['user']+r['cpu']['system'])/1000 for r in results],
  'terminalRssBytes':[r['memory']['rss'] for r in results]}
assert len(digests)==1
summary['checkpointSha256']=next(iter(digests))
with tarfile.open(root/'page-logs.tar.gz') as archive:
 assert len(archive.getmembers())==10
 summary['pageLogs']=[]
 for member in archive.getmembers():
  assert member.isfile() and '/' not in member.name
  records=[json.loads(line) for line in archive.extractfile(member).read().decode().splitlines()]
  assert len(records)==80 and records[-1]['result']=='exact-match' and records[-1]['parts']==79
  assert all(row['step']==i+1 and row['nextPage']==i+1 for i,row in enumerate(records[:-1]))
  summary['pageLogs'].append({'name':member.name,'pages':79,'maximumSampledRssBytes':max(row['memory']['rss'] for row in records),'scope':'Page-boundary RSS samples, not peak RSS or retained-heap plateau'})
postflight=json.loads((root/'postflight.jsonl').read_text())
assert postflight['kind']=='component-cohort-postflight' and len(postflight['protected'])==8 and len(postflight['containers'])==10
assert all(c['state']['ExitCode']==0 and not c['state']['OOMKilled'] for c in postflight['containers'])
summary['postflight']={'protectedServices':8,'terminalSuccessfulContainers':10,'workerId':postflight['workerId'],'gatewayId':postflight['gatewayId'],'readers':postflight['health']['readers'],'consumers':postflight['health']['consumers']}
summary['medianReductionPercent']=100*(1-summary['candidate']['medianMs']/summary['baseline-fixed']['medianMs'])
summary['acceptance']='Release loading/current/concurrency/warm/heap/foreground gates unchanged and incomplete.'
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
