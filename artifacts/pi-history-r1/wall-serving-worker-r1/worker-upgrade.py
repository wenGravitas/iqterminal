from pathlib import Path
import subprocess,json,hashlib,urllib.request,os
oldName='iqterminal-wall-serving-71f62d2-r1';newName='iqterminal-wall-serving-0811e74-r1';root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1');bundle=Path('/home/daz/iq-wall-serving-0811e74-r1.mjs')
assert hashlib.sha256(bundle.read_bytes()).hexdigest()=='5232f8b2fecc82e78b1174034514c5bcef3e7c26503a7332e1f4192782f6154e'
old=json.loads(subprocess.check_output(['docker','inspect',oldName]))[0];assert old['Id']=='fd8809dcf9b4915a8eeac704de509b1bcbd71dce57f9f0bff95ab36c0a4e4098' and old['State']['Running']
assert subprocess.run(['docker','inspect',newName],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
control=json.load(urllib.request.urlopen('http://127.0.0.1:18791/health',timeout=10));assert control['readers']==0 and control['pins']==0
before=json.loads((root/'health.json').read_text());assert json.loads((root/'.wall-preparation-root.json').read_text())['version']==1
print(json.dumps({'kind':'before-upgrade','worker':old['Id'],'state':before,'control':control}),flush=True)
subprocess.run(['docker','stop','--time','45',oldName],check=True,stdout=subprocess.DEVNULL)
ended=json.loads(subprocess.check_output(['docker','inspect',oldName]))[0];assert not ended['State']['Running'] and ended['State']['ExitCode']==0;assert not (root/'running.lock').exists(),'Graceful checkpoint owner lock did not release'
oldEnv=dict(v.split('=',1) for v in old['Config']['Env']);env={**os.environ,'CH_PASSWORD':oldEnv['CH_PASSWORD']}
args=['docker','run','-d','--name',newName,'--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','0.5','--memory','384m','--user','1000:1000','--restart','no','--stop-timeout','45','-v',str(root)+':/wall-preparation','-v',str(bundle)+':/app/wall-preparations-perf.mjs:ro','-v','/home/daz/iq-wall-serving-71f62d2-r1-input.json:/app/perf-requests.json:ro','-e','CH_PASSWORD','-e','CH_URL=http://127.0.0.1:18790','-e','IQ_WALL_PREPARATION_COORDINATOR=1','-e','IQ_WALL_PREPARATION_CONTROL=1','-e','IQ_WALL_QUEUE_FOLLOW=1','-e','IQ_WALL_ROLLING_DEFAULTS=1','-e','WALL_DERIVED_GC=1','-e','IQ_BUILD_COMMIT='+'0811e742b74c1898f6c885bdd75fa50cdbba22c5',old['Image'],'node','--max-old-space-size=256','/app/wall-preparations-perf.mjs','/wall-preparation','/app/perf-requests.json']
id=subprocess.check_output(args,env=env,text=True).strip();print(json.dumps({'kind':'launched-upgrade','container':id,'name':newName,'build':'0811e742b74c1898f6c885bdd75fa50cdbba22c5','bundleSha256':'5232f8b2fecc82e78b1174034514c5bcef3e7c26503a7332e1f4192782f6154e','runtimeImage':old['Image'],'oldExitCode':ended['State']['ExitCode'],'args':args,'rootPreserved':str(root)}))
