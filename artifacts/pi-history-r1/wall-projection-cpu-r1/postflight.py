import json,subprocess,urllib.request,time
from pathlib import Path
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
protected=json.loads(Path('/home/daz/iq-wall-retention-protected-baseline.json').read_text())['expected']
for expected in protected:
 value=inspect(expected['name']);assert value['Id']==expected['id'] and value['State']['StartedAt']==expected['startedAt'] and value['State']['Running']
worker=inspect('iqterminal-wall-serving-13730f7-r1');assert worker['Id']=='dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c' and worker['State']['Running']
gateway=inspect('iqterminal-wall-gateway-71f62d2-r2');assert gateway['Id']=='569422becf7c417d91b2ca6eb90a6a8264a0c10ae49421f352e94ccd225e60ae' and gateway['State']['Running']
containers=[]
for variant in ['baseline-fixed','candidate']:
 for run in range(1,6):
  value=inspect('iq-wall-projection-'+variant+'-'+str(run));state=value['State'];host=value['HostConfig']
  assert not state['Running'] and state['ExitCode']==0 and not state['OOMKilled']
  assert host['Memory']==384*1024**2 and host['MemorySwap']==384*1024**2 and host['NanoCpus']==500000000 and host['NetworkMode']=='none' and host['ReadonlyRootfs']
  assert all(not mount['RW'] for mount in value['Mounts'] if mount['Destination']!='/bench')
  containers.append({'name':value['Name'],'id':value['Id'],'image':value['Image'],'state':state,'budget':{k:host[k] for k in ['NanoCpus','Memory','MemorySwap','NetworkMode','ReadonlyRootfs','RestartPolicy']}})
with urllib.request.urlopen('http://127.0.0.1:18791/health',timeout=10) as r:health=json.loads(r.read())
print(json.dumps({'kind':'component-cohort-postflight','at':time.time(),'protected':protected,'workerId':worker['Id'],'gatewayId':gateway['Id'],'health':health,'containers':containers,'scope':'Identity, terminal process/resource bounds and control health only; not client ACK continuity, current latency or memory plateau'}))
