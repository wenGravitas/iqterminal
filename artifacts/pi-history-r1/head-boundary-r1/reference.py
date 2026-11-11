from pathlib import Path
import json,subprocess,hashlib,os,time,urllib.request
bundle=Path('/home/daz/iq-wall-head-boundary-reference.mjs');assert hashlib.sha256(bundle.read_bytes()).hexdigest()=='00330c3b60e0a5595a7d3314908a72bdab1020fd5ae528eba90a61d3710b87a6'
root=Path('/home/daz/iq-wall-head-boundary-reference-r1');root.mkdir()
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
protected=json.loads(Path('/home/daz/iq-wall-retention-protected-baseline.json').read_text())['expected']
def check():
 for expected in protected:
  value=inspect(expected['name']);assert value['Id']==expected['id'] and value['State']['StartedAt']==expected['startedAt'] and value['State']['Running']
 worker=inspect('iqterminal-wall-serving-13730f7-r1');assert worker['Id']=='dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c' and worker['State']['Running']
 gateway=inspect('iqterminal-wall-gateway-71f62d2-r2');assert gateway['Id']=='569422becf7c417d91b2ca6eb90a6a8264a0c10ae49421f352e94ccd225e60ae' and gateway['State']['Running']
 return worker
worker=check();oldenv=dict(item.split('=',1) for item in worker['Config']['Env']);env={**os.environ,'CH_PASSWORD':oldenv['CH_PASSWORD']}
assert worker['Image']=='sha256:3a67ff312a4924289717685b2c7aa53328e80f0dfd3af8e896bd347a3b848d43'
print(json.dumps({'kind':'reference-preflight','sourceBuild':'e31db8d776941a25cdc53ad2cefaa9d9ab5c92eb','bundleSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'protected':protected,'workerId':worker['Id'],'image':worker['Image'],'scope':'Separate bounded reference containers, read-only canonical SQL through established admission; serving containers are unchanged'}),flush=True)
for market in ['spot','perpetual']:
 output=root/market;output.mkdir();name='iq-wall-head-boundary-reference-'+market+'-r1'
 args=['docker','run','--name',name,'--network','host','--cpus','0.5','--memory','384m','--memory-swap','384m','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--stop-timeout','45','--log-opt','max-size=10m','--log-opt','max-file=3','-e','IQ_WALL_HEAD_BOUNDARY_REFERENCE=1','-e','CH_PASSWORD','-e','CH_URL=http://127.0.0.1:18790','-v',str(output)+':/proof:rw','-v',str(bundle)+':/app/reference.mjs:ro',worker['Image'],'node','--max-old-space-size=256','/app/reference.mjs',market]
 started=time.perf_counter();result=subprocess.run(args,env=env);container=inspect(name)
 print(json.dumps({'kind':'reference-container-terminal','market':market,'elapsedMs':(time.perf_counter()-started)*1000,'id':container['Id'],'state':container['State'],'exitCode':result.returncode}),flush=True)
 assert result.returncode==0 and not container['State']['OOMKilled']
check()
with urllib.request.urlopen('http://127.0.0.1:18791/health',timeout=10) as response:health=json.loads(response.read())
print(json.dumps({'kind':'reference-postflight','protectedUnchanged':True,'servingWorkerUnchanged':True,'sideApiUnchanged':True,'control':health}),flush=True)
