from pathlib import Path
import json,time,urllib.request,subprocess,sys,collections
commit=sys.argv[1];assert len(commit)==40 and all(c in '0123456789abcdef' for c in commit)
root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1');baseline=json.loads(Path('/home/daz/iq-wall-retention-'+commit[:7]+'-baseline.json').read_text());known={j['id']:j for j in baseline['identities']};name='iqterminal-wall-serving-'+commit[:7]+'-r1'
start=time.perf_counter();initial_spot=None;initial_perp=None;seen=set();success=False;last_stats=-30
print(json.dumps({'kind':'start','commit':commit,'at':time.time(),'durationSeconds':360,'scope':'Read-only same-server retirement/default rollover/resource observation; no client paint, ACK continuity or loading acceptance'}),flush=True)
while time.perf_counter()-start<360:
 began=time.perf_counter()
 try:
  h=json.loads((root/'health.json').read_text());assert h['build']==commit
  q=json.loads((root/'queue/queue.json').read_text());ready={};checks=[]
  for market in ['spot','perpetual']:
   selected=sorted([j for j in q['jobs'] if j['request']['market']==market and j.get('rollingDefault') and j['phase']=='ready'],key=lambda j:j['request']['to'],reverse=True)[:2]
   ready[market]=[{'id':j['id'],'to':j['request']['to'],'sourceKey':j['sourceKey'],'projectionKey':j['projectionKey'],'manifestsPresent':(root/'canonical'/j['sourceKey']/'manifest.json').is_file() and (root/'projections'/j['projectionKey']/'manifest.json').is_file()} for j in selected]
  if initial_spot is None and ready['spot']:initial_spot=ready['spot'][0]['to']
  if initial_perp is None and ready['perpetual']:initial_perp=ready['perpetual'][0]['to']
  retired=h['retention']['lastRetired']
  if retired and retired not in seen:
   seen.add(retired);old=known.get(retired)
   if old:
    checks.append({'id':retired,'canonicalPresent':bool(old.get('sourceKey')) and (root/'canonical'/old['sourceKey']).exists(),'projectionPresent':bool(old.get('projectionKey')) and (root/'projections'/old['projectionKey']).exists(),'jobPresent':(root/'canonical/jobs'/retired).exists(),'journalPresent':(root/'retiring'/(retired+'.json')).exists()})
  current=None;containers=None
  if time.perf_counter()-start-last_stats>=20:
   last_stats=time.perf_counter()-start
   r=subprocess.run(['docker','stats','--no-stream','--format','{{json .}}',name,'iqterminal-wall-gateway-71f62d2-r2','iqterminal-history-api','iqterminal-server','iqterminal-spot-server'],capture_output=True,text=True,timeout=6);containers={'exit':r.returncode,'rows':[json.loads(s) for s in r.stdout.splitlines()]}
   with urllib.request.urlopen('http://127.0.0.1:18780/v1/health',timeout=4) as response:
    raw=response.read(256*1024+1);assert len(raw)<=256*1024;value=json.loads(raw);current={'state':value.get('collector',{}).get('state'),'lastUpdate':value.get('collector',{}).get('lastUpdate'),'depthState':value.get('depth',{}).get('status',{}).get('state')}
  success=len(seen)>=3 and initial_spot is not None and ready['spot'] and ready['spot'][0]['to']>initial_spot and initial_perp is not None and ready['perpetual'] and ready['perpetual'][0]['to']>initial_perp and all(x['manifestsPresent'] for r in ready.values() for x in r) and not h['retention']['lastError']
  print(json.dumps({'kind':'sample','at':time.time(),'elapsedMs':(time.perf_counter()-start)*1000,'sampleMs':(time.perf_counter()-began)*1000,'retention':h['retention'],'trackedJobs':len(q['jobs']),'queueVersion':q['version'],'states':dict(collections.Counter('failed' if j.get('failed') else j['phase'] for j in q['jobs'])),'readyDefaults':ready,'initialSpotReadyTo':initial_spot,'initialPerpetualReadyTo':initial_perp,'newRetirementChecks':checks,'current':current,'containers':containers,'load':Path('/proc/loadavg').read_text().strip(),'memory':Path('/proc/meminfo').read_text(),'cpu':Path('/proc/stat').read_text().splitlines()[0],'vmstat':[s for s in Path('/proc/vmstat').read_text().splitlines() if s.startswith(('pswpin ','pswpout ','pgmajfault '))],'componentConditionsObserved':bool(success)}),flush=True)
  if success:break
 except Exception as error:print(json.dumps({'kind':'sample-error','elapsedMs':(time.perf_counter()-start)*1000,'error':repr(error)}),flush=True)
 time.sleep(max(.1,min(5,360-(time.perf_counter()-start))))
print(json.dumps({'kind':'end','at':time.time(),'elapsedMs':(time.perf_counter()-start)*1000,'distinctRetirementsObserved':len(seen),'initialSpotReadyTo':initial_spot,'initialPerpetualReadyTo':initial_perp,'componentConditionsObserved':bool(success),'scope':'Three actual retirements, latest two ready manifests and Spot and USD-M default rollovers only; not whole release acceptance'}),flush=True)
