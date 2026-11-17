import pathlib,json,statistics,collections,hashlib
root=pathlib.Path(__file__).resolve().parents[1];here=pathlib.Path(__file__).resolve().parent
result={'scope':'Five alternating pairs, headless actual Pi route; other applications left running. No foreground/current-concurrency acceptance. Individual child run=1 is preserved; numbered aggregates use independent paired round1..5. Raw children remain unchanged.','decision':'Reject and revert eight-part grouping: lower completion median but longer maximum chart draws in every pair; all loading gates fail. Retain source-validation overlap.'}
for side in ['control','grouped']:
 rows=[json.loads(x) for x in (here/(side+'-samples.jsonl')).read_text().splitlines()]
 numbered=[];values=[]
 for s in rows:
  n=dict(s,individualRun=s['run'],run=s['pairedRun']);numbered.append(n)
  r=s['last']['wall']['render'];values.append({'round':s['pairedRun'],'firstHistoryMs':s['firstHistoryMs'],'completeMs':s['completeMs'],'draws':r['draws'],'renderMs':r['renderMs'],'maxRenderMs':r['maxRenderMs'],'beforeLoad':s['before']['load'],'afterLoad':s['after']['load']})
 (here/(side+'-numbered-samples.jsonl')).write_text(''.join(json.dumps(s)+'\n' for s in numbered))
 result[side]={'samples':values,'completionMedianMs':statistics.median(s['completeMs'] for s in values),'completionMaximumMs':max(s['completeMs'] for s in values),'medianOfMaximumChartDrawsMs':statistics.median(s['maxRenderMs'] for s in values)}
result['groupingDrawRegressionEveryPair']=all(g['maxRenderMs']>c['maxRenderMs'] for c,g in zip(result['control']['samples'],result['grouped']['samples']))
assert result['groupingDrawRegressionEveryPair']
for side in ['control','grouped']:
 gate=json.loads((here/(side+'-summary.json')).read_text());assert all(s['coverageValid'] for s in gate['samples']);assert not gate['complete']['pass'];assert not gate['firstUseful']['pass']
(here/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
p=root/'wall13d-f82-perp-profile-r1-walls-30h-perp-15m-1.cpuprofile';f=json.loads(p.read_text());nodes={n['id']:n for n in f['nodes']};times=collections.Counter()
for nid,dt in zip(f['samples'],f['timeDeltas']):times[nid]+=dt/1000
profile={'scope':'Single diagnostic CPU-profiled browser; sampled stack self time includes profiler/OS scheduling effects, not exclusive network phases or an acceptance cohort.','source':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'topSelfTime':[{'sampledMs':ms,'frame':nodes[nid]['callFrame']} for nid,ms in times.most_common(25)]}
(root/'wall-overlap-13d30ec'/'profile-summary.json').write_text(json.dumps(profile,indent=2)+'\n')
for directory in ['wall-overlap-13d30ec','wall-coalesce-0ee81eb','wall-pair-13d-0ee-r1']:
 entries=[json.loads(line) for line in (root/directory/'server-resources.jsonl').read_text().splitlines()]
 assert entries[0]['kind']=='start' and entries[-1]['kind']=='end'
 samples=[e for e in entries if e['kind']=='sample'];errors=[e for e in entries if e['kind']=='sample-error']
 builds=sorted(set(e['health']['build'] for e in samples));assert builds==['f82abdfae06c61f8bccff9fea0778bbaac491b5e']
 (root/directory/'server-summary.json').write_text(json.dumps({'scope':'Read-only server resource window; not browser freshness/concurrency/heap proof','samples':len(samples),'errors':errors,'builds':builds,'start':entries[0],'end':entries[-1]},indent=2)+'\n')
print(json.dumps({'controlMedianMs':result['control']['completionMedianMs'],'groupedMedianMs':result['grouped']['completionMedianMs'],'decision':result['decision']}))
