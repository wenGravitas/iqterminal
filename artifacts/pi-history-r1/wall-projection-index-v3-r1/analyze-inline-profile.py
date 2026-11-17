from pathlib import Path
import json,collections
root=Path(__file__).parent
p=json.loads((root/'inline-spot.cpuprofile').read_text());nodes={n['id']:n for n in p['nodes']};weights=collections.Counter()
for sample,delta in zip(p['samples'],p['timeDeltas']):weights[sample]+=delta
bundle=(root/'inline-index-executed.mjs').read_text().splitlines();positions=[]
for node in p['nodes']:
 if node['callFrame']['url'].endswith('/profile.mjs'):
  for item in node.get('positionTicks',[]):positions.append({'function':node['callFrame']['functionName'],'line':item['line'],'ticks':item['ticks'],'source':bundle[item['line']-1]})
result={'scope':'Single CPU-profiled Spot run; V8 elapsed attribution includes throttling/idle/GC, not exclusive durations or comparison timing','selfSamples':[{'sampledMs':v/1000,'frame':nodes[k]['callFrame']} for k,v in weights.most_common(20)],'positions':sorted(positions,key=lambda x:-x['ticks'])[:25]}
print(json.dumps(result,indent=2))
