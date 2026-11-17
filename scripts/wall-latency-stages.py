import json,pathlib,urllib.parse,sys
root=pathlib.Path('artifacts/wall-history-latency-route');out={}
for label in (sys.argv[1:] or ['clean-baseline','clean-candidate']):
 p=root/label;result=json.load(open(p/'browser-result.json'));w=json.load(open(p/'paint-witness.json'));origin=w['timeOrigin'];network={}
 for row in map(json.loads,open(p/'http.jsonl')):
  t=row.get('timing');
  if not t:continue
  key=(row['url'],t['startTime']);old=network.setdefault(key,{});old.update(row);old['timing']=t if t.get('responseEnd',-1)>old.get('timing',{}).get('responseEnd',-1) else old.get('timing',t)
 phases=[]
 for e in w['events']:
  if e['kind']!='complete':continue
  start=origin+e['actionMono'];end=origin+e['paintedMono'];rows=[r for r in network.values() if start<=r['timing']['startTime']<=end];receipts=[]
  for r in sorted(rows,key=lambda x:x['timing']['startTime']):
   t=r['timing'];receipts.append({'path':urllib.parse.urlsplit(r['url']).path.rsplit('/',1)[-1],'startFromActionMs':t['startTime']-start,'headersMs':t.get('responseStart'),'endMs':t.get('responseEnd'),'endFromActionMs':t['startTime']+t.get('responseEnd',0)-start,'status':r.get('status'),'terminalEvent':r['event'],'requestId':r.get('headers',{}).get('x-iq-request-id'),'serverTiming':r.get('headers',{}).get('server-timing')})
  phases.append({'phase':e['phase'],'actionToPaintMs':e['paintedMono']-e['actionMono'],'navigationToPaintMs':e['paintedMono'] if e['phase']=='parent' else None,'witnessLagMs':e['witnessMono']-e['paintedMono'],'requests':receipts})
 out[label]=phases
(root/('stage-comparison-final.json' if sys.argv[1:] else 'stage-comparison.json')).write_text(json.dumps(out,indent=2))
for label,phases in out.items():
 print(label)
 for p in phases:print(p['phase'],round(p['actionToPaintMs']),[(r['path'],round(r['startFromActionMs']),round(r['headersMs'] or 0),round(r['endMs'] or 0)) for r in p['requests']])
