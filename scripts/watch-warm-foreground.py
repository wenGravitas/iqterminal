"""User-invoked, maximum 20min isolated acceptance session. Never opens a browser.
No build, headless suite, reference job, real watch mutation or incumbent restart.
Its separate manual receipt never changes an archived agent-goal manifest.
"""
import datetime,hashlib,json,os,pathlib,shutil,signal,socket,subprocess,sys,time,urllib.request
fe=pathlib.Path(__file__).resolve().parents[1];be=fe.parent/'iqterminal-server-integration-startup-r1'
source=fe/'artifacts/watch-ack-warm-acceptance';backend=be/'artifacts/watch-ack-warm-acceptance'
startup_check=sys.argv[1:]==['--startup-check']
if sys.argv[1:] and not startup_check:raise SystemExit('Run without arguments; Ctrl-C stops only this owned session.')
if startup_check:
 parent=json.load(open(source/'manifest.json'));assert time.time()+120<datetime.datetime.fromisoformat(parent['experimentCutoffUtc'].replace('Z','+00:00')).timestamp(),'Original task cutoff; no new experiment'
for port in [4204,4205,18990,18991]:
 with socket.socket() as probe:
  if probe.connect_ex(('127.0.0.1',port))==0:raise SystemExit('Port already occupied; preserve existing owner: '+str(port))
now=datetime.datetime.now(datetime.timezone.utc);label=('startup-check-' if startup_check else 'manual-')+now.strftime('%Y%m%dT%H%M%SZ');out=source/label;bout=backend/label;out.mkdir();bout.mkdir();deadline=time.monotonic()+1200
receipt=json.load(open(source/'client-build.json'));app=json.load(open(backend/'build-receipt.json'))
for p in [out,bout]:(p/'manifest.json').write_text(json.dumps({'kind':'Bounded launcher startup check under original task' if startup_check else 'user-invoked manual foreground acceptance, not a renewal of completed agent budget','startUtc':now.isoformat(),'experimentCutoffUtc':(now+datetime.timedelta(minutes=20)).isoformat(),'deadlineUtc':(now+datetime.timedelta(minutes=20)).isoformat(),'frontendApplication':receipt['commit'],'backendApplication':app['commit']},indent=2))
(out/'client-build.json').write_text(json.dumps(receipt));(bout/'build-receipt.json').write_text(json.dumps(app))
for name in ['worker.mjs','gateway.mjs']:shutil.copyfile(backend/name,bout/name)
node=receipt.get('nodeExecutable') or shutil.which('node');assert node and pathlib.Path(node).is_file(),'Tested Node executable required';
if receipt.get('nodeVersion'):assert subprocess.check_output([node,'--version'],text=True).strip()==receipt['nodeVersion'],'Tested Node version changed'
env={**os.environ,'IQ_WATCH_WARM_RUN_DIR':str(bout)};children=[];handles=[];started=False;stop_requested=False
def request_stop(*_args):
 global stop_requested
 stop_requested=True
for sig in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP]:signal.signal(sig,request_stop)
# Require the exact previously built assets; never silently rebuild during acceptance.
assert receipt['exitCode']==0 and pathlib.Path(receipt['outDir']).is_dir()
assert (backend/'watch-protocol.mjs').is_file()
for relative,digest in receipt['assets'].items():assert hashlib.sha256((pathlib.Path(receipt['outDir'])/relative).read_bytes()).hexdigest()==digest,'Client artifact changed: '+relative
for name,digest in app['bundles'].items():assert hashlib.sha256((backend/(name+'.mjs')).read_bytes()).hexdigest()==digest,'Backend artifact changed: '+name
def launch(args,cwd,log,extra=None):
 h=open(log,'w');handles.append(h);p=subprocess.Popen(args,cwd=cwd,env={**os.environ,**(extra or {})},stdout=h,stderr=subprocess.STDOUT,start_new_session=True);children.append(p);return p
try:
 with open(bout/'start.log','w') as h:subprocess.run([sys.executable,'ops/watch-warm-candidate.py','start'],cwd=be,env=env,stdout=h,stderr=subprocess.STDOUT,check=True,timeout=150,start_new_session=True)
 started=True
 if stop_requested:raise KeyboardInterrupt
 for port in [18990,18991]:launch(['ssh','-N','-o','ExitOnForwardFailure=yes','-o','ControlMaster=no','-o','ControlPath=none','-o','Compression=no','-o','IPQoS=none','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-L',f'127.0.0.1:{port}:127.0.0.1:18890','daz@100.124.223.41'],fe,out/('tunnel-'+str(port)+'.log'))
 launch([node,str(backend/'watch-protocol.mjs')],be,out/'watch.log',{'WATCH_PORT':'4205','WATCH_STATE':str(out/'watch-state-not-opened'),'IQ_BUILD_COMMIT':app['commit']})
 launch([node,'scripts/watch-warm-preview.mjs'],fe,out/'preview.log',{'IQ_WATCH_WARM_RUN_DIR':str(out),'VITE_DATA_MODE':'staging','VITE_CURRENT_API_URL':'http://127.0.0.1:18991','VITE_HISTORY_API_URL':'http://127.0.0.1:18990','VITE_WATCH_API_URL':'http://127.0.0.1:4205','IQ_STARTUP_TRACE':'1'})
 ready=False;until=min(deadline,time.monotonic()+40)
 while time.monotonic()<until:
  if stop_requested:raise KeyboardInterrupt
  if any(p.poll() is not None for p in children):raise RuntimeError('Owned child exited; inspect '+str(out))
  try:
   with urllib.request.urlopen('http://127.0.0.1:4204/market-data/v2/history/health',timeout=12) as response:health=json.load(response)
   assert health['build']==app['commit'];ready=True;break
  except (OSError,AssertionError):time.sleep(.5)
 if not ready:raise RuntimeError('Candidate readiness deadline; no foreground check started')
 print('READY: http://127.0.0.1:4204 — open manually on i3 workspace 9.',flush=True)
 print('Client '+receipt['commit']+' / backend '+app['commit']+'. Watch uses isolated read-only protocol harness.',flush=True)
 print('No automated browser/build is running. Close the candidate tab before Ctrl-C. Automatic shutdown after 20 minutes.',flush=True)
 print('Evidence: '+str(out),flush=True)
 if startup_check:
  with urllib.request.urlopen('http://127.0.0.1:4204/market-data/v1/level-watches',timeout=5) as response:assert json.load(response)['source']=='isolated-watch-protocol-harness'
  with urllib.request.urlopen('http://127.0.0.1:4204/',timeout=5) as response:assert response.status==200
 while not startup_check and not stop_requested and time.monotonic()<deadline:
  if any(p.poll() is not None for p in children):raise RuntimeError('Owned child exited during acceptance')
  time.sleep(1)
except KeyboardInterrupt:print('Stopping owned acceptance session.',flush=True)
finally:
 for p in reversed(children):
  if p.poll() is None:
   p.terminate()
   try:p.wait(timeout=5)
   except subprocess.TimeoutExpired:p.kill();p.wait()
 if started:
  with open(bout/'stop.log','w') as h:r=subprocess.run([sys.executable,'ops/watch-warm-candidate.py','stop'],cwd=be,env=env,stdout=h,stderr=subprocess.STDOUT,timeout=150,start_new_session=True)
  if r.returncode:print('Owned remote stop needs inspection: '+str(bout/'stop.log'),file=sys.stderr)
 for h in handles:h.close()
 print('Owned local processes stopped. Prepared state preserved; incumbent untouched.',flush=True)
