from pathlib import Path
import os,json,subprocess,hashlib,shlex,urllib.request
name='iqterminal-wall-serving-71f62d2-r1';root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1');bundle=Path('/home/daz/iq-wall-serving-71f62d2-r1.mjs')
assert hashlib.sha256(bundle.read_bytes()).hexdigest()=='b05691524a2eac8ccbb50dddbe729cf015c1adb9e889696f4539d6395d115673'
assert not root.exists(),'Refusing to adopt an existing derived root'
assert subprocess.run(['docker','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0,'Container already exists'
assert '18791' not in subprocess.check_output(['ss','-ltn','sport = :18791'],text=True).split('\n',1)[-1]
protected=['iqterminal-server','iqterminal-spot-server','iqterminal-history-materializer','iqterminal-spot-history-materializer','iqterminal-footprint-materializer','iqterminal-spot-footprint-materializer','iqterminal-sql-admission']
info=json.loads(subprocess.check_output(['docker','inspect',*protected]));before=[{'name':x['Name'],'id':x['Id'],'startedAt':x['State']['StartedAt'],'running':x['State']['Running']} for x in info];assert all(x['running'] for x in before)
health=json.loads(urllib.request.urlopen('http://127.0.0.1:18780/v2/history/health',timeout=15).read());assert health['build']=='dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51'
image=subprocess.check_output(['docker','inspect','--format','{{.Image}}','iqterminal-history-api'],text=True).strip()
root.mkdir();inputFile=Path('/home/daz/iq-wall-serving-71f62d2-r1-input.json');assert not inputFile.exists();inputFile.write_text('[]\n')
password=None
for line in Path('/opt/iqterminal/.env').read_text().splitlines():
 if line.startswith('CH_APP_PASSWORD='):
  value=line.split('=',1)[1];password=shlex.split(value,comments=True)[0] if value.startswith(('"',"'")) else value
assert password
env={**os.environ,'CH_PASSWORD':password}
args=['docker','run','-d','--name',name,'--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','0.5','--memory','384m','--user','1000:1000','--restart','no','--stop-timeout','45','-v',str(root)+':/wall-preparation','-v',str(bundle)+':/app/wall-preparations-perf.mjs:ro','-v',str(inputFile)+':/app/perf-requests.json:ro','-e','CH_PASSWORD','-e','CH_URL=http://127.0.0.1:18790','-e','IQ_WALL_PREPARATION_COORDINATOR=1','-e','IQ_WALL_PREPARATION_CONTROL=1','-e','IQ_WALL_QUEUE_FOLLOW=1','-e','IQ_WALL_ROLLING_DEFAULTS=1','-e','WALL_DERIVED_GC=1','-e','IQ_BUILD_COMMIT='+'71f62d2efceb8a4ac0fadb9c8a1495bcf1eb4efa',image,'node','--max-old-space-size=256','/app/wall-preparations-perf.mjs','/wall-preparation','/app/perf-requests.json']
container=subprocess.check_output(args,env=env,text=True).strip()
receipt={'name':name,'container':container,'runtimeImage':image,'bundleSha256':'b05691524a2eac8ccbb50dddbe729cf015c1adb9e889696f4539d6395d115673','build':'71f62d2efceb8a4ac0fadb9c8a1495bcf1eb4efa','root':str(root),'beforeProtected':before,'args':args,'scope':'New isolated worker only. Existing runtime image plus verified mounted bundle; not an image claiming to contain this commit. Serving API/collectors unchanged.'}
Path('/home/daz/iq-wall-serving-71f62d2-r1-launch.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
