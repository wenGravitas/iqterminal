import json,pathlib,sys,urllib.parse
root=pathlib.Path('artifacts/configurable-history-capacity');summaries=[]
for label in sys.argv[1:]:
 d=root/label;rows=[json.loads(l) for l in (d/'browser-samples.jsonl').read_text().splitlines()];phases={};last=0
 for phase in ['parent','extension-1','extension-2','reopen','reopen-validation']:
  r=[r for r in rows if r['phase']==phase]
  if not r:continue
  done=r[-1];start=r[0]['elapsedMs'];before=[x for x in rows if x['phase']=='before-'+phase];start=before[-1]['elapsedMs'] if before else (0 if phase=='parent' else start)
  jobs=done.get('orderWalls',{}).get('historyJobStates',[]);j=next((j for x in rows for j in x.get('orderWalls',{}).get('historyJobStates',[]) if j['request']['from']==done['status']['archive']['from'] and j['request']['to']==done['status']['archive']['to'] and j.get('preparedFinalization')), {})
  useful=next((x for x in r if x.get('render',{}).get('visibleHistorical',0)>0),None)
  phases[phase]={'firstUsefulSampleMs':useful['elapsedMs']-start if useful else None,'completePaintMs':done['elapsedMs']-start,'archive':done['status']['archive'],'finalization':j.get('preparedFinalization'),'delta':j.get('preparedDelta'),'partCache':done.get('orderWalls',{}).get('preparedPartCache'),'mainApply':done.get('apply'),'chartPreparation':done.get('render',{}).get('preparation')}
  if phase=='parent':last=done['elapsedMs']
 events=[e for r in rows for e in (r.get('trace')or{}).get('events',[])];acks=[e for e in events if 'ack' in str(e.get('kind','')).lower() or 'ack' in str(e.get('type','')).lower()];summaries.append({'label':label,'phases':phases,'traceEventCount':len(events),'ackEventExamples':acks[:3],'eventKinds':sorted(set(str(e.get('event',e.get('type'))) for e in events))})
(root/'delivery-summary.json').write_text(json.dumps(summaries,indent=2)+'\n')
