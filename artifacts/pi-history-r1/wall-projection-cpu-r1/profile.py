"""One guarded offline CPU profile; no source/active-cache writes."""
from pathlib import Path
import json,urllib.request,urllib.parse,subprocess,time,threading,hashlib
root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1')
bundle=Path('/home/daz/iq-wall-projection-profile-baseline.mjs')
output=Path('/home/daz/iq-wall-projection-cpu-r1')
image='sha256:3a67ff312a4924289717685b2c7aa53328e80f0dfd3af8e896bd347a3b848d43'
worker=json.loads(subprocess.check_output(['docker','inspect','iqterminal-wall-serving-13730f7-r1']))[0]
assert worker['Id']=='dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c' and worker['State']['Running'] and worker['Image']==image
protected=json.loads(Path('/home/daz/iq-wall-retention-protected-baseline.json').read_text())['expected']
def protected_check():
 for r in protected:
  value=json.loads(subprocess.check_output(['docker','inspect',r['name']]))[0]
  assert value['Id']==r['id'] and value['State']['StartedAt']==r['startedAt'] and value['State']['Running']
protected_check()
queue=json.loads((root/'queue/queue.json').read_text())
job=max((j for j in queue['jobs'] if j['phase']=='ready' and j['request']['market']=='perpetual' and j.get('rollingDefault')),key=lambda j:j['request']['to'])
lease={'consumer':'projection-cpu-r1','canonicalKey':job['sourceKey'],'projectionKey':job['projectionKey']}
def control(path,body):
 req=urllib.request.Request('http://127.0.0.1:18791'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=3) as r:return json.loads(r.read(4096))
def source(phase):
 at=time.perf_counter()
 with urllib.request.urlopen('http://127.0.0.1:18880/v2/history/walls/source?'+urllib.parse.urlencode(job['request']),timeout=20) as r:
  value=json.loads(r.read(128*1024));headers=dict(r.headers)
 assert value['eligible'] and value['token']==job['proof']['token']
 print(json.dumps({'kind':'source-check','phase':phase,'elapsedMs':(time.perf_counter()-at)*1000,'headers':headers,'source':value}),flush=True)
stop=threading.Event();failures=[]
def renew():
 while not stop.wait(4):
  try:control('/retain',lease)
  except Exception as error:failures.append(repr(error))
thread=None
try:
 assert control('/retain',lease)['leaseMs']==15000
 thread=threading.Thread(target=renew);thread.start()
 source('before')
 output.mkdir() # deliberate exclusive output guard
 print(json.dumps({'kind':'profile-selected','job':job,'bundleSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'image':image,'workerId':worker['Id'],'protected':protected,'output':str(output),'scope':'Offline CPU profile only, not a latency gate'}),flush=True)
 args=['docker','run','--name','iqterminal-wall-projection-cpu-r1','--network','none','--cpus','0.5','--memory','384m','--memory-swap','384m','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--stop-timeout','45','--log-opt','max-size=10m','--log-opt','max-file=3','-e','IQ_WALL_PROJECTION_PROFILE=1','-v',str(root/'canonical')+':/source:ro','-v',str(root/'projections')+':/prepared:ro','-v',str(output)+':/bench:rw','-v',str(bundle)+':/app/profile.mjs:ro',image,'node','--cpu-prof','--cpu-prof-dir=/bench','--cpu-prof-name=baseline.cpuprofile','--max-old-space-size=256','/app/profile.mjs',job['sourceKey'],job['projectionKey']]
 result=subprocess.run(args)
 assert result.returncode==0,result.returncode
 source('after');protected_check();assert not failures,failures
 print(json.dumps({'kind':'profile-validated','leaseFailures':failures,'files':[{'name':p.name,'bytes':p.stat().st_size} for p in output.iterdir()]}),flush=True)
finally:
 stop.set()
 if thread:thread.join(8)
 control('/release',{'consumer':lease['consumer']})
