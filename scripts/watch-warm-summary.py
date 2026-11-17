import json,pathlib,urllib.parse,statistics
root=pathlib.Path('artifacts/watch-ack-warm-acceptance');labels=['final-current'];out={}
for label in labels:
 p=root/label;r=json.load(open(p/'browser-result.json'));w=json.load(open(p/'paint-witness.json'));samples=[json.loads(l) for l in open(p/'browser-samples.jsonl')];events=[e for row in samples for e in (row.get('trace')or{}).get('events',[])];pending={};confirmed={};ack=[]
 for e in events:
  sid=e.get('id')
  if e.get('event')=='send' and e.get('command',{}).get('type')=='ack':pending[sid]=e['command']['cursor']
  if e.get('event')=='message' and e.get('type')=='executions' and e.get('after')==pending.get(sid) and e['after']>confirmed.get(sid,-1):confirmed[sid]=e['after'];ack.append({'socket':sid,'mono':e['mono'],'cursor':e['after']})
 by={}
 for e in ack:by.setdefault(e['socket'],[]).append(e)
 gaps=[b['mono']-a['mono'] for rows in by.values() for a,b in zip(rows,rows[1:])]
 health=[json.loads(l) for l in open(p/'health.jsonl')];phase=[]
 for e in w['events']:
  if e['kind']=='complete':phase.append({'phase':e['phase'],'actionToPaintMs':e['paintedMono']-e['actionMono'],'navigationToPaintMs':e['paintedMono'] if e['phase']=='parent' else None,'witnessLagMs':e['witnessMono']-e['paintedMono'],'paintedRevision':e['paintedRevision'],'inputRevision':e['inputRevision'],'from':e['from'],'to':e['to'],'loadedThrough':e['loadedThrough']})
 totals=[]
 for c in r['captures']:
  a=c['status']['archive'];d=c['orderWalls'];jobs=d.get('historyJobStates',[]);totals.append({'phase':c['phase'],'from':a['from'],'requestedTo':a['to'],'eligibleTo':a.get('eligibleTo'),'horizonAt':a.get('horizonAt'),'loadedThrough':a.get('loadedThrough'),'gaps':len(a.get('gaps',[])),'gapsTruncated':a.get('gapsTruncated'),'requestComplete':a.get('requestComplete'),'rangeComplete':a.get('rangeComplete'),'pendingPaintWork':c['render'].get('pendingPaintWork'),'queuedPreparation':c['render'].get('queuedPreparation'),'pendingProjectionSegments':c['render'].get('pendingProjectionSegments'),'paintedRevision':c['render'].get('paintedRevision'),'inputRevision':c['render'].get('inputRevision'),'apply':c['apply'],'preparedDeltaPublications':d.get('preparedDeltaPublications'),'warmPrefixHits':d.get('warmPrefixHits'),'warmValidatedReuses':d.get('warmValidatedReuses'),'warmTimings':d.get('warmTimings'),'cache':d.get('preparedPartCache'),'jobs':jobs,'heap':c.get('heap'),'chartPreparation':c['render'].get('preparation')})
 out[label]={'completion':phase,'firstUsefulPaintWitnesses':[e for e in w['events'] if e['kind']!='complete'],'phaseEvidence':totals,'ack':{'advancingExactConfirmations':len(ack),'longestConfirmedGapMs':max(gaps,default=None),'first':ack[:1],'last':ack[-1:],'resets':[e for e in events if e.get('type') in ['reset','error']],'closes':[e for e in events if e.get('event')=='close']},'health':{'samples':len(health),'failures':[e for e in health if (e.get('error') or e.get('status')!=200) and not e.get('cleanup')],'cleanupCancellations':[e for e in health if e.get('cleanup')],'maxBodyMs':max((e.get('bodyMs',0) for e in health),default=0),'maxObserverLoopMs':max((e.get('eventLoopMaxMs',0) for e in health),default=0)},'errors':r.get('errors',[])}
(root/'validation-summary.json').write_text(json.dumps(out,indent=2))
for label,d in out.items():print(label,{'timings':[(e['phase'],round(e['actionToPaintMs'])) for e in d['completion']],'ACKs':d['ack']['advancingExactConfirmations'],'ACKmaxGapMs':d['ack']['longestConfirmedGapMs'],'health':d['health']})
