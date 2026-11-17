from pathlib import Path
import json,subprocess,urllib.request,time
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
protected=json.loads(Path('/home/daz/iq-wall-retention-protected-baseline.json').read_text())['expected']
for expected in protected:
 value=inspect(expected['name']);assert value['Id']==expected['id'] and value['State']['StartedAt']==expected['startedAt'] and value['State']['Running']
worker=inspect('iqterminal-wall-serving-13730f7-r1');gateway=inspect('iqterminal-wall-gateway-71f62d2-r2')
assert worker['Id']=='dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c' and worker['State']['Running']
assert gateway['Id']=='569422becf7c417d91b2ca6eb90a6a8264a0c10ae49421f352e94ccd225e60ae' and gateway['State']['Running']
containers=[]
for market in ['spot','perpetual']:
 for variant in ['baseline','candidate','followup']:
  for run in range(1,6):
   v=inspect('iq-wall-index-v3-r2-'+market+'-'+variant+'-'+str(run));h=v['HostConfig'];s=v['State']
   assert not s['Running'] and s['ExitCode']==0 and not s['OOMKilled']
   assert h['Memory']==384*1024**2 and h['MemorySwap']==384*1024**2 and h['NanoCpus']==500000000 and h['NetworkMode']=='none' and h['ReadonlyRootfs']
   assert all(not m['RW'] for m in v['Mounts'] if m['Destination']!='/bench')
   containers.append({'name':v['Name'],'id':v['Id'],'state':s,'image':v['Image'],'budget':{k:h[k] for k in ['Memory','MemorySwap','NanoCpus','NetworkMode','ReadonlyRootfs','RestartPolicy']}})
with urllib.request.urlopen('http://127.0.0.1:18791/health',timeout=10) as response:health=json.loads(response.read())
print(json.dumps({'kind':'index-v3-postflight','at':time.time(),'workerId':worker['Id'],'gatewayId':gateway['Id'],'protected':protected,'health':health,'containers':containers,'scope':'Terminal process bounds, protected identities and control state only; no client ACK/freshness/latency acceptance.'}))
