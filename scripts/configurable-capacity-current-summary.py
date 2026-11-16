import json,pathlib,sys
root=pathlib.Path('artifacts/configurable-history-capacity');out=[]
for label in sys.argv[1:]:
 rows=[json.loads(l) for l in open(root/label/'browser-samples.jsonl')];events=[e for r in rows for e in (r.get('trace')or{}).get('events',[])];pending={};confirmed={};accept=[];closes=[]
 for e in events:
  sid=e.get('id')
  if e.get('event')=='send' and e.get('command',{}).get('type')=='ack':pending[sid]=e['command']['cursor']
  if e.get('event')=='message' and e.get('type')=='executions' and e.get('after')==pending.get(sid) and e['after']>confirmed.get(sid,-1):confirmed[sid]=e['after'];accept.append({'socket':sid,'mono':e['mono'],'cursor':e['after']})
  if e.get('event')=='close':closes.append(e)
 gaps=[b['mono']-a['mono'] for a,b in zip(accept,accept[1:]) if a['socket']==b['socket']]
 walls=[r.get('currentWalls') for r in rows if r.get('currentWalls')];health=[r['health'] for r in rows if r.get('health')]
 out.append({'label':label,'observedMs':rows[-1]['elapsedMs'],'advancingExactACKAcceptances':len(accept),'first':accept[0] if accept else None,'last':accept[-1] if accept else None,'longestConfirmedGapMs':max(gaps,default=None),'executionResetEvents':[e for e in events if e.get('type') in ['reset','error']],'closes':closes,'currentWallsFirst':walls[0] if walls else None,'currentWallsLast':walls[-1] if walls else None,'health':health})
(root/'current-summary.json').write_text(json.dumps(out,indent=2)+'\n')
