from pathlib import Path
import subprocess,json,os,shlex,hashlib
name='iqterminal-wall-gateway-71f62d2-r1';bundle=Path('/home/daz/iq-wall-gateway-71f62d2-r1.mjs')
assert hashlib.sha256(bundle.read_bytes()).hexdigest()=='f27bcba7d7d66aa05e113ee62bd069c060cfc45d8bd79cfc8c5748e2676eb968'
assert subprocess.run(['docker','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
assert '18880' not in subprocess.check_output(['ss','-ltn','sport = :18880'],text=True).split('\n',1)[-1]
original=json.loads(subprocess.check_output(['docker','inspect','iqterminal-history-api']))[0]
mounts=[m for m in original['Mounts'] if m['Destination']=='/state'];assert len(mounts)==1 and mounts[0]['Type']=='bind' and not mounts[0]['RW']
mount=mounts[0];assert Path(mount['Source']).is_dir()
password=None
for line in Path('/opt/iqterminal/.env').read_text().splitlines():
 if line.startswith('CH_APP_PASSWORD='):
  v=line.split('=',1)[1];password=shlex.split(v,comments=True)[0] if v.startswith(('"',"'")) else v
assert password
args=['docker','run','-d','--name',name,'--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','1','--memory','512m','--user','1000:1000','--restart','no','--stop-timeout','45','-v',mount['Source']+':/state:ro','-v','/home/daz/iqterminal-wall-serving-71f62d2-r1:/wall-preparation:ro','-v',str(bundle)+':/app/history-gateway-perf.mjs:ro','-e','CH_PASSWORD','-e','CH_URL=http://127.0.0.1:18790','-e','API_PORT=18880','-e','COLLECTOR_PORT=18784','-e','SPOT_COLLECTOR_PORT=18785','-e','HISTORY_PORT=18782','-e','HISTORY_INTERNAL_SPOT=http://127.0.0.1:18783','-e','HISTORY_TILES_ENABLED=1','-e','WALL_PREPARATION_ENABLED=1','-e','WALL_PREPARATION_STATE=/wall-preparation','-e','WALL_DERIVED_GC=1','-e','IQ_BUILD_COMMIT='+'71f62d2efceb8a4ac0fadb9c8a1495bcf1eb4efa',original['Image'],'node','/app/history-gateway-perf.mjs']
id=subprocess.check_output(args,env={**os.environ,'CH_PASSWORD':password},text=True).strip();print(json.dumps({'container':id,'name':name,'build':'71f62d2efceb8a4ac0fadb9c8a1495bcf1eb4efa','runtimeImage':original['Image'],'bundleSha256':'f27bcba7d7d66aa05e113ee62bd069c060cfc45d8bd79cfc8c5748e2676eb968','inheritedReadOnlyMount':mount,'args':args,'scope':'Isolated staging side gateway on loopback18880; original18780API unchanged.'}))
