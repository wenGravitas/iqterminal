import json,subprocess,urllib.request,hashlib,os,time
from pathlib import Path
protected=[{'id': '8b087d255b7262ff5b1543475c8c26610758ca8b37f0f99af8b54f3e0848336d', 'name': 'iqterminal-history-api', 'running': True, 'startedAt': '2026-11-09T10:14:21.244270641Z'}, {'id': '65471260a0cf64311ed57f9b17f1e1daf6de26f073192e292cd07bfb1e193ece', 'name': 'iqterminal-server', 'running': True, 'startedAt': '2026-10-25T10:58:27.590796454Z'}, {'id': 'a4be8d3c68a52de305fd9e2eaa101f50b592b8b108aaf850ddfbc1b2f53428bb', 'name': 'iqterminal-spot-server', 'running': True, 'startedAt': '2026-10-25T10:58:53.322433531Z'}, {'id': 'd7f786d6c833ee776fc620b8f02209a1e1b1ed5fc3235968272631f3c4cc6a34', 'name': 'iqterminal-history-materializer', 'running': True, 'startedAt': '2026-11-06T16:53:52.644213859Z'}, {'id': '12489deea96a7d5918661f792e91bd819238696bc62b912308becbaa1bcb1763', 'name': 'iqterminal-spot-history-materializer', 'running': True, 'startedAt': '2026-11-06T16:53:52.682114009Z'}, {'id': '1df92fdc2ce05c4113df9ecd8cb99fbabcf101b3fa04447561116ba929d93698', 'name': 'iqterminal-footprint-materializer', 'running': True, 'startedAt': '2026-11-06T16:53:52.623715016Z'}, {'id': '8257c2c80dbcae7add967cb4571983e7639c8f96695e3d5d6302ec9b87ef6447', 'name': 'iqterminal-spot-footprint-materializer', 'running': True, 'startedAt': '2026-11-06T16:53:52.693763579Z'}, {'id': '625825aa977bcf8e18264ed69e3ed4ca1a9290c5c14416db797a8bf11999032b', 'name': 'iqterminal-sql-admission', 'running': True, 'startedAt': '2026-11-06T16:53:48.880958761Z'}]
worker='246c527d7ce8aa1827445b229cab03ca97329989f295c5e9fcf15fb0d144dca6'
gateway='0f5250279212a08a3867eeed0b571d59c4722c624db174d8ebbcfa444ef655c1'
ids=[p['id'] for p in protected]+[worker,gateway]
raw=json.loads(subprocess.check_output(['docker','inspect',*ids],text=True));states={r['Id']:{'id':r['Id'],'name':r['Name'],'running':r['State']['Running'],'startedAt':r['State']['StartedAt'],'image':r['Image']} for r in raw}
for p in protected:
 actual=states[p['id']];assert actual['running'] and actual['startedAt']==p['startedAt']
def get(url):
 with urllib.request.urlopen(url,timeout=15) as r:return json.load(r)
control=get('http://127.0.0.1:18791/health')
assert control['build']=='33c7e3a25105fdb15e28ab029765418aac08b2e8'
assert control['consumers']==control['readers']==control['pins']==0,control
health=get('http://127.0.0.1:18880/v2/history/health');assert health['build']=='112bf11cadd4f521b4b65363baf52756ecd47457'
original=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1');clone=Path('/home/daz/iqterminal-wall-serving-v3-33c7e3a-r1')
receipt=json.loads(Path('/home/daz/iq-wall-stage-33c7e3a-clone-receipt-r1.json').read_text())
files={str(p.relative_to(original)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in original.rglob('*') if p.is_file()}
assert files==receipt['files'],'Original root changed after clone installation'
roots=[original,clone,Path('/home/daz/iqterminal-wall-serving-pre-v3-snapshot-r1'),Path('/home/daz/iqterminal-wall-serving-pre-v3-restored-r1')]
usage={str(p):int(subprocess.check_output(['du','-sb',str(p)],text=True).split()[0]) for p in roots}
assert sum(usage.values())+160*1024**2<=2*1024**3
assert sum(v for k,v in usage.items() if k!=str(clone))<=629145600
assert os.statvfs(clone).f_bavail*os.statvfs(clone).f_frsize>=20*1024**3
queue=json.loads((clone/'queue/queue.json').read_text());assert queue['version']==3
out={'atUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'protectedUnchanged':True,'states':list(states.values()),'workerHealth':control,'gatewayBuild':health['build'],'gatewayAdmission':health['metrics'],'originalRootChecksumUnchanged':True,'originalFileCount':len(files),'wallRootBytes':usage,'wallRootTotalBytes':sum(usage.values()),'reservedRollbackBytes':629145600,'queueVersion':queue['version'],'readyDefaults':[{k:j.get(k) for k in ['id','request','sourceKey','projectionKey']} for j in queue['jobs'] if j['phase']=='ready' and j.get('rollingDefault')],'protectedHistoryHealth':get('http://127.0.0.1:18780/v2/history/health'),'protectedCurrentHealth':get('http://127.0.0.1:18780/v1/health'),'resources':{'loadavg':Path('/proc/loadavg').read_text(),'meminfo':Path('/proc/meminfo').read_text(),'diskFreeBytes':os.statvfs(clone).f_bavail*os.statvfs(clone).f_frsize}}
print(json.dumps(out,indent=2))
