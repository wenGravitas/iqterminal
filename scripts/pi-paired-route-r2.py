"""One persistent SSH sampler, two explicitly requested bounded phases."""
import concurrent.futures,importlib.util,json,queue,shlex,subprocess,threading,time,sys,base64,gzip
from pathlib import Path
root=Path('artifacts/pi-forwarded-route-r2');manifest=json.load(open(root/'manifest.json'));cutoff=manifest['experimentCutoffEpoch'];assert time.time()<cutoff
spec=importlib.util.spec_from_file_location('sampler',Path(__file__).with_name('pi-paired-route-sampler.py'));sampler=importlib.util.module_from_spec(spec);spec.loader.exec_module(sampler)
remote='/home/daz/iq-pi-forwarded-route-r2';body=base64.b64encode(Path(__file__).with_name('pi-paired-route-sampler.py').read_bytes()).decode();install="from pathlib import Path;import base64;p=Path('/home/daz/iq-pi-forwarded-route-r2-sampler.py');f=p.open('xb');f.write(base64.b64decode("+repr(body)+"));f.close()"
args=['ssh','-o','ControlMaster=no','-o','ControlPath=none','-o','Compression=no','-o','IPQoS=none','-o','ConnectTimeout=8','daz@100.124.223.41']
subprocess.run(args+['python3','-c',shlex.quote(install)],check=True,timeout=30)
r=json.load(open('/home/daz/workarea/iqterminal-server-integration-startup-r1/artifacts/pi-forwarded-route-r2/gateway-trace-reset.json'));cfg={'out':remote,'cutoff':cutoff,'peer':'100.110.77.55','pids':[r['gatewayHostPid'],r['workerHostPid']]}
control=subprocess.Popen(args+['python3','-u','/home/daz/iq-pi-forwarded-route-r2-sampler.py','remote',shlex.quote(json.dumps(cfg))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=(root/'control-stderr.txt').open('x'),text=True,bufsize=1)
events=queue.Queue()
def listen():
 for line in control.stdout:
  with (root/'control-events.jsonl').open('a') as f:f.write(line)
  try:events.put(json.loads(line))
  except:events.put({'unparsed':line})
threading.Thread(target=listen,daemon=True).start()
def wait_event(key,value=None,seconds=35):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:e=events.get(timeout=1)
  except queue.Empty:
   assert control.poll() is None,'Persistent sampler exited';continue
  if key in e and (value is None or e[key]==value):return e
 raise TimeoutError('Sampler acknowledgement '+key)
ready=wait_event('ready');(root/'paired-ready.json').write_text(json.dumps({'controlSshPid':control.pid,'remote':ready,'mode':'One persistent control connection for both phases. Server results written locally, retrieved after measurements.'},indent=2)+'\n')
seen=set();pool=concurrent.futures.ThreadPoolExecutor(max_workers=2)
try:
 while time.time()<cutoff:
  file=root/'phase-request.json'
  if not file.exists():time.sleep(.25);continue
  req=json.load(open(file))
  if req.get('stop'):break
  phase=req['name']
  if phase in seen:time.sleep(.25);continue
  assert phase in ['baseline','verification'] and 0<req['seconds']<=300
  assert time.time()+req['seconds']+30<cutoff,'Insufficient experiment budget for the bounded phase and cleanup'
  seen.add(phase)
  control.stdin.write(json.dumps({'action':'phase',**req})+'\n');control.stdin.flush();wait_event('phaseStarted',phase)
  (root/'workload-control.json').write_text(json.dumps({'phase':phase}));start=time.monotonic();end=min(start+req['seconds'],start+cutoff-time.time());nextsample=start;nextprobe=start;seq=0;ticks=0;pending={}
  with (root/(phase+'-client.jsonl')).open('x') as f:
   f.write(json.dumps({'kind':'phase','phase':phase,'startUtc':time.time(),'mono':start,'seconds':req['seconds'],'observerTraffic':'One request per15s per lane, no overlap within lane; deadline12s,4s lateness marker only'})+'\n')
   while time.monotonic()<end:
    now=time.monotonic()
    for lane,future in list(pending.items()):
     if future.done():f.write(json.dumps(future.result())+'\n');del pending[lane]
    if now>=nextprobe and now<end-24 and not pending:
     path=sampler.PATHS[seq%len(sampler.PATHS)]
     for lane,base in [('forward','http://127.0.0.1:18881'),('preview','http://127.0.0.1:4202/market-data')]:pending[lane]=pool.submit(sampler.probe,base,f'pi-route-r2-{phase}-{seq}-{lane}',path)
     seq+=1;nextprobe=now+15
    if now>=nextsample:
     preview=json.load(open(root/'preview-diagnostic.json'))['pid'];data=sampler.sample('client','100.124.223.41',[preview,control.pid],ticks%10==0);data['phase']=phase;ticks+=1;f.write(json.dumps(data)+'\n');f.flush();nextsample+=1
    time.sleep(max(.01,min(.1,nextsample-time.monotonic())))
   for future in pending.values():f.write(json.dumps(future.result())+'\n')
  wait_event('phaseDone',phase,seconds=30);(root/(phase+'-done.json')).write_text(json.dumps({'endedUtc':time.time(),'localSampleSeconds':time.monotonic()-start,'probesPerLane':seq})+'\n');print('Finished '+phase,flush=True)
finally:
 try:control.stdin.write('{"action":"stop"}\n');control.stdin.flush();control.stdin.close()
 except Exception:pass
 try:control.wait(timeout=20)
 except subprocess.TimeoutExpired:control.terminate();control.wait(timeout=10)
 pool.shutdown()
 # Retrieval is after measurement, never one new SSH per probe. Compress these
 # repetitive local snapshots before crossing the measured private route.
 code="import json,gzip,base64;from pathlib import Path;root=Path("+repr(remote)+");names="+repr(sorted(seen))+";print(json.dumps({n:base64.b64encode(gzip.compress((root/(n+'.jsonl')).read_bytes())).decode() for n in names}))"
 r=subprocess.run(args+['python3','-c',shlex.quote(code)],capture_output=True,text=True,timeout=45)
 assert r.returncode==0,r.stderr
 for phase,encoded in json.loads(r.stdout).items():
  raw=gzip.decompress(base64.b64decode(encoded));path=root/(phase+'-server.jsonl')
  if path.exists():assert path.read_bytes()==raw,'Preserve existing capture; retrieval differs'
  else:
   with path.open('xb') as f:f.write(raw)
 with (root/'paired-done.json').open('x') as f:f.write(json.dumps({'endedUtc':time.time(),'phases':sorted(seen),'controlExit':control.returncode})+'\n')
