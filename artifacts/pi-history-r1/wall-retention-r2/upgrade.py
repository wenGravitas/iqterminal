from pathlib import Path
import subprocess,json,hashlib,urllib.request,os,sys,time
commit,expected_sha=sys.argv[1:];assert len(commit)==40 and all(c in '0123456789abcdef' for c in commit)
old_name='iqterminal-wall-serving-0811e74-r2';new_name='iqterminal-wall-serving-'+commit[:7]+'-r1';root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1');bundle=Path('/home/daz/iq-wall-serving-'+commit[:7]+'-r1.mjs')
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name.lstrip('/')]))[0]
expected=json.loads(Path('/home/daz/iq-wall-retention-protected-baseline.json').read_text())['expected']
def protected():
 out=[]
 for item in expected:
  actual=inspect(item['name']);assert actual['Id']==item['id'] and actual['State']['StartedAt']==item['startedAt'] and actual['State']['Running'];out.append(item)
 return out
assert hashlib.sha256(bundle.read_bytes()).hexdigest()==expected_sha
assert json.loads(Path('/home/daz/iq-wall-serving-71f62d2-r1-input.json').read_text())==[]
old=inspect(old_name);assert old['Id']=='26bf7a8d9d8a281c74ae8544d18c220edb61a85dec3a6bd20dd305a303307510' and old['State']['Running']
assert subprocess.run(['docker','inspect',new_name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
control=json.load(urllib.request.urlopen('http://127.0.0.1:18791/health',timeout=10));assert control['readers']==0 and control['pins']==0 and control['consumers']==0
before_protected=protected();before=json.loads((root/'health.json').read_text());queue=json.loads((root/'queue/queue.json').read_text());inode=root.stat().st_ino
identities=[{k:j.get(k) for k in ['id','sourceKey','projectionKey','phase','pages','projectionPages']}|{'proofToken':j.get('proof',{}).get('token')} for j in queue['jobs']]
def cache_hashes():
 selected=[]
 for market in ['spot','perpetual']:
  ready=[j for j in queue['jobs'] if j['phase']=='ready' and j['request']['market']==market and j.get('rollingDefault')]
  if ready:selected.append(max(ready,key=lambda j:j['request']['to']))
 result={}
 for j in selected:
  for kind,key in [('canonical',j['sourceKey']),('projections',j['projectionKey'])]:
   assert len(key)==64 and all(c in '0123456789abcdef' for c in key)
   paths=[root/kind/key/'manifest.json']
   if kind=='projections':paths+=[root/kind/key/'progress.json']+list((root/kind/key).glob('*.prefix.json'))
   for path in paths:
    assert path.is_file() and not path.is_symlink() and path.stat().st_size<=32*1024**2
    with path.open('rb') as handle:result[str(path.relative_to(root))]=hashlib.file_digest(handle,'sha256').hexdigest()
 return result
cache_before=cache_hashes()
baseline=Path('/home/daz/iq-wall-retention-'+commit[:7]+'-baseline.json')
with baseline.open('x') as handle:json.dump({'identities':identities,'cacheHashes':cache_before,'protected':before_protected,'queueVersion':queue['version']},handle)
print(json.dumps({'kind':'before-upgrade','at':time.time(),'oldId':old['Id'],'oldBuild':control['build'],'control':control,'health':before,'queueVersion':queue['version'],'identities':identities,'cacheHashes':cache_before,'protected':before_protected}),flush=True)
subprocess.run(['docker','stop','--time','45',old_name],check=True,stdout=subprocess.DEVNULL)
ended=inspect(old_name);assert not ended['State']['Running'] and ended['State']['ExitCode']==0
assert not (root/'running.lock').exists(),'Do not remove an unreleased owner lock'
assert root.stat().st_ino==inode
stopped=json.loads((root/'queue/queue.json').read_text());by_id={j['id']:j for j in stopped['jobs']}
for item in identities:
 j=by_id[item['id']]
 for k in ['sourceKey','projectionKey']:
  if item[k]:assert j.get(k)==item[k],(item['id'],k)
 if item['proofToken']:assert j['proof']['token']==item['proofToken']
 assert j['pages']>=item['pages'] and j['projectionPages']>=item['projectionPages']
old_env=dict(v.split('=',1) for v in old['Config']['Env']);env={**os.environ,'CH_PASSWORD':old_env['CH_PASSWORD']}
args=['docker','run','-d','--name',new_name,'--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','0.5','--memory','384m','--user','1000:1000','--restart','no','--stop-timeout','45','--log-driver','json-file','--log-opt','max-size=10m','--log-opt','max-file=3','-v',str(root)+':/wall-preparation','-v',str(bundle)+':/app/wall-preparations-perf.mjs:ro','-v','/home/daz/iq-wall-serving-71f62d2-r1-input.json:/app/perf-requests.json:ro','-e','CH_PASSWORD','-e','CH_URL=http://127.0.0.1:18790','-e','IQ_WALL_PREPARATION_COORDINATOR=1','-e','IQ_WALL_PREPARATION_CONTROL=1','-e','IQ_WALL_QUEUE_FOLLOW=1','-e','IQ_WALL_ROLLING_DEFAULTS=1','-e','WALL_DERIVED_GC=1','-e','IQ_BUILD_COMMIT='+commit,old['Image'],'node','--max-old-space-size=256','/app/wall-preparations-perf.mjs','/wall-preparation','/app/perf-requests.json']
id=subprocess.check_output(args,env=env,text=True).strip();assert cache_hashes()==cache_before;print(json.dumps({'kind':'launched','id':id,'name':new_name,'commit':commit,'bundleSha256':expected_sha,'runtimeImage':old['Image'],'oldExit':ended['State']['ExitCode'],'rootPreserved':str(root),'identitiesPreserved':len(identities),'cacheHashCountPreserved':len(cache_before),'queueVersion':stopped['version'],'args':args}),flush=True)
for attempt in range(20):
 try:
  health=json.load(urllib.request.urlopen('http://127.0.0.1:18791/health',timeout=2));assert health['build']==commit;break
 except Exception:
  if attempt==19:raise
  time.sleep(.25)
new=inspect(new_name);assert new['Id']==id and new['State']['Running'];assert new['HostConfig']['LogConfig']['Config']=={'max-file':'3','max-size':'10m'}
assert protected()==before_protected
print(json.dumps({'kind':'active','id':id,'name':new_name,'at':time.time(),'control':health,'startedAt':new['State']['StartedAt'],'logConfig':new['HostConfig']['LogConfig'],'protectedUnchanged':True,'scope':'Only owned isolated worker replaced; exact pinned queue/canonical/projection identities retained before GC starts; original API, side API, collectors, source storage and seven protected services untouched'}),flush=True)
