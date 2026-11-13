from pathlib import Path
import json,urllib.request,urllib.parse,urllib.error,subprocess,time,threading,os,hashlib
root=Path('/home/daz/iqterminal-wall-serving-v3-33c7e3a-r1');helper=Path('/home/daz/iq-side-reference-r1.mjs');expected='03de1bce8eb6aff553fa03639cc5807998f9c4b2a997bbd3b4a2631051bb3f5f'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==expected
queue=json.loads((root/'queue/queue.json').read_text());jobs=[max([j for j in queue['jobs'] if j['phase']=='ready' and j['request']['market']==market and j.get('rollingDefault')],key=lambda j:j['request']['to']) for market in ['perpetual']]
def control(path,body):
 req=urllib.request.Request('http://127.0.0.1:18791'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=3) as r:return json.loads(r.read(4096))
def source(j,phase):
 at=time.perf_counter();url='http://127.0.0.1:18880/v2/history/walls/source?'+urllib.parse.urlencode(j['request'])
 try:r=urllib.request.urlopen(url,timeout=15)
 except urllib.error.HTTPError as error:r=error
 raw=r.read(128*1024+1);assert len(raw)<=128*1024;value=json.loads(raw)
 print(json.dumps({'kind':'source-check','phase':phase,'market':j['request']['market'],'request':j['request'],'status':r.status,'elapsedMs':(time.perf_counter()-at)*1000,'headers':dict(r.headers),'source':value}),flush=True)
 assert r.status==200 and value['eligible'] and value['token']==j['proof']['token']
leases=[{'consumer':'stage039-handoff-reference-'+j['request']['market'],'canonicalKey':j['sourceKey'],'projectionKey':j['projectionKey']} for j in jobs];stop=threading.Event();failures=[]
def renew():
 while not stop.wait(4):
  for lease in leases:
   try:control('/retain',lease)
   except Exception as error:failures.append(repr(error))
thread=None
try:
 for lease in leases:assert control('/retain',lease)['leaseMs']==15000
 thread=threading.Thread(target=renew);thread.start()
 print(json.dumps({'kind':'selected','jobs':[{k:j.get(k) for k in ['id','request','sourceKey','projectionKey']} for j in jobs],'scope':'Fresh canonical shared-projector folds versus ready projections after GC, with independently revalidated canonical DB source and reader leases; not raw-book independence or chart latency'}),flush=True)
 for j in jobs:source(j,'before')
 result=subprocess.run(['docker','run','--name','iqterminal-wall-stage039-handoff-reference-r1','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','0.5','--memory','384m','--user','1000:1000','--restart','no','--mount','type=bind,source='+str(root)+',target='+str(root)+',readonly','--mount','type=bind,source='+str(helper)+',target=/reference.mjs,readonly','-e','IQ_WALL_DEFAULT_RESUME_REFERENCE=1','sha256:3a67ff312a4924289717685b2c7aa53328e80f0dfd3af8e896bd347a3b848d43','node','--max-old-space-size=256','/reference.mjs',str(root),','.join(j['id'] for j in jobs)],env={**os.environ,'IQ_WALL_DEFAULT_RESUME_REFERENCE':'1'},timeout=60)
 assert result.returncode==0
 for j in jobs:source(j,'after')
 assert not failures,failures
 print(json.dumps({'kind':'validated-reference-complete','result':'exact-match','jobs':[j['id'] for j in jobs],'leaseFailures':failures}),flush=True)
finally:
 stop.set()
 if thread:thread.join(8);assert not thread.is_alive()
 for lease in leases:
  try:control('/release',{'consumer':lease['consumer']})
  except Exception as error:print(json.dumps({'kind':'release-error','consumer':lease['consumer'],'error':repr(error)}),flush=True)
