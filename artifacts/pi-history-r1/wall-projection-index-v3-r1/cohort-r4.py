"""Five alternating component comparisons per market; never a chart gate."""
from pathlib import Path
import json,urllib.request,urllib.parse,subprocess,time,threading,hashlib,shutil
source_root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1')
output=Path('/home/daz/iq-wall-index-v3-cohort-r4')
bundles={name:Path('/home/daz/iq-wall-index-'+('inline-followup' if name=='candidate' else name)+'.mjs') for name in ['baseline','candidate']}
expected={'baseline':'dd82d2ac5c297ef1b1f5739f8f4fab62fde16b681c983061e0517c3c06706f6c','candidate':'b09d077853c7354024ad8e02e41a464a0590c3646493674a2f40ecd45c89e2bb'}
for name,path in bundles.items():assert hashlib.sha256(path.read_bytes()).hexdigest()==expected[name]
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
protected=json.loads(Path('/home/daz/iq-wall-retention-protected-baseline.json').read_text())['expected']
def check():
 for record in protected:
  v=inspect(record['name']);assert v['Id']==record['id'] and v['State']['StartedAt']==record['startedAt'] and v['State']['Running']
 worker=inspect('iqterminal-wall-serving-13730f7-r1');assert worker['Id']=='dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c' and worker['State']['Running']
 gateway=inspect('iqterminal-wall-gateway-71f62d2-r2');assert gateway['Id']=='569422becf7c417d91b2ca6eb90a6a8264a0c10ae49421f352e94ccd225e60ae' and gateway['State']['Running']
 return worker
worker=check();assert worker['Image']=='sha256:3a67ff312a4924289717685b2c7aa53328e80f0dfd3af8e896bd347a3b848d43'
queue=json.loads((source_root/'queue/queue.json').read_text())
jobs={market:max((j for j in queue['jobs'] if j['phase']=='ready' and j['request']['market']==market and j.get('rollingDefault')),key=lambda j:j['request']['to']) for market in ['spot','perpetual']}
leases=[{'consumer':'index-v3-r4-component-'+market,'canonicalKey':job['sourceKey'],'projectionKey':job['projectionKey']} for market,job in jobs.items()]
def control(path,body):
 request=urllib.request.Request('http://127.0.0.1:18791'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(request,timeout=3) as response:return json.loads(response.read(4096))
def source(market,phase):
 job=jobs[market];started=time.perf_counter()
 with urllib.request.urlopen('http://127.0.0.1:18880/v2/history/walls/source?'+urllib.parse.urlencode(job['request']),timeout=20) as response:proof=json.loads(response.read(128*1024));headers=dict(response.headers)
 print(json.dumps({'kind':'source-check','market':market,'phase':phase,'elapsedMs':(time.perf_counter()-started)*1000,'headers':headers,'source':proof}),flush=True)
 assert proof['eligible'] and proof['token']==job['proof']['token']
stop=threading.Event();failures=[];thread=None
def renew():
 while not stop.wait(4):
  for lease in leases:
   try:assert control('/retain',lease)['leaseMs']==15000
   except Exception as error:failures.append(repr(error))
try:
 for lease in leases:assert control('/retain',lease)['leaseMs']==15000
 thread=threading.Thread(target=renew);thread.start()
 for market in jobs:source(market,'before')
 output.mkdir();assert shutil.disk_usage(output).free>=20*1024**3+20*256*1024**2
 print(json.dumps({'kind':'cohort-selected','jobs':jobs,'baselineSource':'e4fa9b6ffa72e91e6be5f7579588217cfed76a7a','candidateSource':'2a1dace25a1f3557e03a441edd89d5945525b77c','bundles':expected,'image':worker['Image'],'protected':protected,'scope':'Twenty unprofiled offline projection component builds, five per variant per market. Same pinned source per market, fresh output, alternating order, host filesystem cache not cleared. No raw cold build, browser, current ACK, chart paint or loading acceptance.'}),flush=True)
 for run in range(1,6):
  for market in (['perpetual','spot'] if run%2 else ['spot','perpetual']):
   job=jobs[market]
   for variant in (['baseline','candidate'] if run%2 else ['candidate','baseline']):
    label=market+'-'+variant+'-'+str(run);destination=output/label;destination.mkdir();name='iq-wall-index-v3-r4-'+label
    args=['docker','run','--name',name,'--network','none','--cpus','0.5','--memory','384m','--memory-swap','384m','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--stop-timeout','45','--log-opt','max-size=10m','--log-opt','max-file=3','-e','IQ_WALL_PROJECTION_PROFILE=1','-v',str(source_root/'canonical')+':/source:ro','-v',str(source_root/'projections')+':/prepared:ro','-v',str(destination)+':/bench:rw','-v',str(bundles[variant])+':/app/profile.mjs:ro',worker['Image'],'node','--max-old-space-size=256','/app/profile.mjs',job['sourceKey'],job['projectionKey']]
    started=time.perf_counter()
    with (output/(label+'.jsonl')).open('x') as log:result=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT)
    records=[json.loads(line) for line in (output/(label+'.jsonl')).read_text().splitlines() if line.startswith('{')]
    done=[r for r in records if r.get('kind')=='projection-profile-complete'];steps=[r for r in records if r.get('kind')=='projection-profile-step'];v3=sum(r['privateVersion']==3 for r in steps)
    print(json.dumps({'kind':'component-run','market':market,'variant':variant,'run':run,'processElapsedMs':(time.perf_counter()-started)*1000,'exitCode':result.returncode,'completion':done,'v3Pages':v3,'maximumCheckpointBytes':max((r['checkpointBytes'] for r in steps if not r['complete']),default=0),'maximumSampledRssBytes':max((r['memory']['rss'] for r in steps),default=0),'container':name}),flush=True)
    assert result.returncode==0 and len(done)==1 and not done[0]['profiled']
    if variant=='candidate' and market=='perpetual' and max(r['checkpointBytes'] for r in steps)>2*1024**2:assert v3>0
    source(market,label+'-after');assert not failures,failures
 for market in jobs:source(market,'after')
 check();print(json.dumps({'kind':'cohort-validated','leaseFailures':failures,'output':str(output),'servingUnchanged':True}),flush=True)
finally:
 stop.set()
 if thread:thread.join(8)
 for lease in leases:
  try:control('/release',{'consumer':lease['consumer']})
  except Exception as error:print(json.dumps({'kind':'release-error','error':repr(error)}),flush=True)
