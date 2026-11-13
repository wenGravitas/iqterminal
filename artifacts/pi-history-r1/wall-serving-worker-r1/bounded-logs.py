from pathlib import Path
import json,subprocess,urllib.request,time,os
items=[{'oldName': 'iqterminal-wall-serving-0811e74-r1', 'newName': 'iqterminal-wall-serving-0811e74-r2', 'oldId': '9287d66d0e75a71571f1e5c9826b82fa96fc693c8379c4defdfc347b5e3626bd', 'args': ['docker', 'run', '-d', '--name', 'iqterminal-wall-serving-0811e74-r1', '--network', 'host', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '0.5', '--memory', '384m', '--user', '1000:1000', '--restart', 'no', '--stop-timeout', '45', '-v', '/home/daz/iqterminal-wall-serving-71f62d2-r1:/wall-preparation', '-v', '/home/daz/iq-wall-serving-0811e74-r1.mjs:/app/wall-preparations-perf.mjs:ro', '-v', '/home/daz/iq-wall-serving-71f62d2-r1-input.json:/app/perf-requests.json:ro', '-e', 'CH_PASSWORD', '-e', 'CH_URL=http://127.0.0.1:18790', '-e', 'IQ_WALL_PREPARATION_COORDINATOR=1', '-e', 'IQ_WALL_PREPARATION_CONTROL=1', '-e', 'IQ_WALL_QUEUE_FOLLOW=1', '-e', 'IQ_WALL_ROLLING_DEFAULTS=1', '-e', 'WALL_DERIVED_GC=1', '-e', 'IQ_BUILD_COMMIT=0811e742b74c1898f6c885bdd75fa50cdbba22c5', 'sha256:3a67ff312a4924289717685b2c7aa53328e80f0dfd3af8e896bd347a3b848d43', 'node', '--max-old-space-size=256', '/app/wall-preparations-perf.mjs', '/wall-preparation', '/app/perf-requests.json']}, {'oldName': 'iqterminal-wall-gateway-71f62d2-r1', 'newName': 'iqterminal-wall-gateway-71f62d2-r2', 'oldId': 'fca1269083b4504944dccf1d3a6e387844700cf7545b958002ecc4eb29777dd5', 'args': ['docker', 'run', '-d', '--name', 'iqterminal-wall-gateway-71f62d2-r1', '--network', 'host', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '1', '--memory', '512m', '--user', '1000:1000', '--restart', 'no', '--stop-timeout', '45', '-v', '/home/daz/iqterminal-wall-product-proof/state:/state:ro', '-v', '/home/daz/iqterminal-wall-serving-71f62d2-r1:/wall-preparation:ro', '-v', '/home/daz/iq-wall-gateway-71f62d2-r1.mjs:/app/history-gateway-perf.mjs:ro', '-e', 'CH_PASSWORD', '-e', 'CH_URL=http://127.0.0.1:18790', '-e', 'API_PORT=18880', '-e', 'COLLECTOR_PORT=18784', '-e', 'SPOT_COLLECTOR_PORT=18785', '-e', 'HISTORY_PORT=18782', '-e', 'HISTORY_INTERNAL_SPOT=http://127.0.0.1:18783', '-e', 'HISTORY_TILES_ENABLED=1', '-e', 'WALL_PREPARATION_ENABLED=1', '-e', 'WALL_PREPARATION_STATE=/wall-preparation', '-e', 'WALL_DERIVED_GC=1', '-e', 'IQ_BUILD_COMMIT=71f62d2efceb8a4ac0fadb9c8a1495bcf1eb4efa', 'sha256:3a67ff312a4924289717685b2c7aa53328e80f0dfd3af8e896bd347a3b848d43', 'node', '/app/history-gateway-perf.mjs']}]
root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1')
c=json.load(urllib.request.urlopen('http://127.0.0.1:18791/health',timeout=10));assert c['readers']==0 and c['pins']==0
protected=['iqterminal-history-api','iqterminal-server','iqterminal-spot-server','iqterminal-history-materializer','iqterminal-spot-history-materializer','iqterminal-footprint-materializer','iqterminal-spot-footprint-materializer','iqterminal-sql-admission']
def identities():return [{'name':v['Name'],'id':v['Id'],'startedAt':v['State']['StartedAt']} for v in json.loads(subprocess.check_output(['docker','inspect',*protected]))]
before=identities();old=[]
for item in items:
 v=json.loads(subprocess.check_output(['docker','inspect',item['oldName']]))[0];assert v['Id']==item['oldId'] and v['State']['Running'];assert subprocess.run(['docker','inspect',item['newName']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
 old.append(v)
# Side gateway first; no client leases remain. Only our two test containers.
for index in [1,0]:
 subprocess.run(['docker','stop','--time','45',items[index]['oldName']],stdout=subprocess.DEVNULL,check=True)
 v=json.loads(subprocess.check_output(['docker','inspect',items[index]['oldName']]))[0];assert not v['State']['Running'] and v['State']['ExitCode']==0
assert not (root/'running.lock').exists()
launched=[]
for index in [0,1]:
 item=items[index];args=item['args'];args[args.index('--name')+1]=item['newName'];args[2:2]=['--log-driver','json-file','--log-opt','max-size=10m','--log-opt','max-file=3']
 envs=dict(v.split('=',1) for v in old[index]['Config']['Env']);id=subprocess.check_output(args,env={**os.environ,'CH_PASSWORD':envs['CH_PASSWORD']},text=True).strip();launched.append({'id':id,'name':item['newName'],'args':args})
 port=18791 if index==0 else 18880
 for attempt in range(20):
  try:health=json.load(urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health' if index==0 else 'http://127.0.0.1:18880/v2/history/health',timeout=2));break
  except Exception:
   if attempt==19:raise
   time.sleep(.25)
 v=json.loads(subprocess.check_output(['docker','inspect',item['newName']]))[0];assert v['HostConfig']['LogConfig']['Config']=={'max-file':'3','max-size':'10m'};launched[-1]['logConfig']=v['HostConfig']['LogConfig'];launched[-1]['health']=health
assert identities()==before
print(json.dumps({'protectedIdentitiesPreserved':before,'active':launched,'rootPreserved':str(root),'scope':'Owned isolated services recreated with bounded logs; original API/collectors never stopped.'}))
