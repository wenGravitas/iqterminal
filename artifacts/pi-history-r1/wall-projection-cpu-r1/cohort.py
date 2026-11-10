"""One guarded offline CPU profile; no source/active-cache writes."""
from pathlib import Path
import json,urllib.request,urllib.parse,subprocess,time,threading,hashlib
root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1')
bundles={name:Path('/home/daz/iq-wall-projection-'+name+'.mjs') for name in ['baseline-fixed','candidate']}
expected={'baseline-fixed':'980e7ba3650dedd8a91e40488942b4655601eb19e08edf29ae75e5dd77ba64fc','candidate':'5cc5e29c6002bcba0f6b6eea6b67e90f322ae7f8ffac4be6be9ae17ea4e484d7'}
for name,path in bundles.items():assert hashlib.sha256(path.read_bytes()).hexdigest()==expected[name]
output=Path('/home/daz/iq-wall-projection-cohort-r1')
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
lease={'consumer':'projection-cohort-r1','canonicalKey':job['sourceKey'],'projectionKey':job['projectionKey']}
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
 output.mkdir()
 import shutil
 assert shutil.disk_usage(output).free>=20*1024**3+10*256*1024**2
 print(json.dumps({'kind':'cohort-selected','job':job,'bundles':expected,'image':image,'workerId':worker['Id'],'protected':protected,'scope':'Ten unprofiled offline projection component builds; alternating order, pinned canonical source, fresh output each run, warm host filesystem. Not raw rebuild or Pi chart loading acceptance.'}),flush=True)
 for run in range(1,6):
  for name in (['baseline-fixed','candidate'] if run%2 else ['candidate','baseline-fixed']):
   bundle=bundles[name];destination=output/(name+'-'+str(run));destination.mkdir();container='iq-wall-projection-'+name+'-'+str(run)
   args=['docker','run','--name',container,'--network','none','--cpus','0.5','--memory','384m','--memory-swap','384m','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--stop-timeout','45','--log-opt','max-size=10m','--log-opt','max-file=3','-e','IQ_WALL_PROJECTION_PROFILE=1','-v',str(root/'canonical')+':/source:ro','-v',str(root/'projections')+':/prepared:ro','-v',str(destination)+':/bench:rw','-v',str(bundle)+':/app/profile.mjs:ro',image,'node','--max-old-space-size=256','/app/profile.mjs',job['sourceKey'],job['projectionKey']]
   started=time.perf_counter()
   with (output/(name+'-'+str(run)+'.jsonl')).open('x') as log:
    result=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT)
   lines=[json.loads(line) for line in (output/(name+'-'+str(run)+'.jsonl')).read_text().splitlines() if line.startswith('{')]
   completions=[line for line in lines if line.get('kind')=='projection-profile-complete']
   print(json.dumps({'kind':'component-run','variant':name,'run':run,'processElapsedMs':(time.perf_counter()-started)*1000,'exitCode':result.returncode,'completion':completions,'container':container}),flush=True)
   assert result.returncode==0 and len(completions)==1
   source(name+'-'+str(run)+'-after')
 source('after');protected_check();assert not failures,failures
 print(json.dumps({'kind':'profile-validated','leaseFailures':failures,'output':str(output)}),flush=True)
finally:
 stop.set()
 if thread:thread.join(8)
 control('/release',{'consumer':lease['consumer']})
