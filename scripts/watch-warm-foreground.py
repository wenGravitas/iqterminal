"""One manual acceptance session:20min local active window plus bounded cleanup.
No browser/build/cohort. Remote state can remain unconfirmed on access failure;
the session label/fence permits safe repeat reconciliation, not a remote TTL.
"""
import datetime,hashlib,json,os,pathlib,shlex,shutil,signal,socket,subprocess,sys,time,urllib.request,uuid

def validate_helper(be):
 helper=be/'ops/watch-warm-candidate.py'
 if not helper.is_file() or 'SESSION_LIFECYCLE_VERSION=1' not in helper.read_text() or not (be/'ops/watch-warm-remote.py').is_file():raise ValueError('Update both tooling branches: session-owned cleanup helper required before startup')

def run_helper(be,bout,mode,timeout):
 p=subprocess.Popen([sys.executable,'ops/watch-warm-candidate.py',mode],cwd=be,env={**os.environ,'IQ_WATCH_WARM_RUN_DIR':str(bout)},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 try:stdout,stderr=p.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  # The helper and its SSH child have a private process group owned here.
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:p.communicate(timeout=3)
  except subprocess.TimeoutExpired:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   p.communicate(timeout=3)
  raise
 return subprocess.CompletedProcess(p.args,p.returncode,stdout,stderr)

def recovery_command(be,bout):
 return 'cd '+shlex.quote(str(be))+' && IQ_WATCH_WARM_RUN_DIR='+shlex.quote(str(bout))+' '+shlex.quote(sys.executable)+' ops/watch-warm-candidate.py stop'

def cleanup_local(children):
 results=[]
 for p in reversed(children):
  r={'pid':p.pid,'confirmedStopped':False,'errors':[]}
  try:
   if p.poll() is None:
    try:p.terminate();p.wait(timeout=5)
    except subprocess.TimeoutExpired:p.kill();p.wait(timeout=3)
   r['confirmedStopped']=p.poll() is not None
  except Exception as e:r['errors'].append(str(e)[:600])
  results.append(r)
 return results

def reconcile_remote(attempted,be,bout,session_id,build,runner=None):
 if not attempted:return {'confirmed':True,'status':'not-attempted'}
 try:
  r=(runner or run_helper)(be,bout,'stop',190)
  capture_error=None
  try:(bout/'stop.log').write_text(r.stdout+r.stderr)
  except OSError as e:capture_error='Cannot save local stop log: '+str(e)
  data=json.loads(r.stdout);report=data.get('cleanup',{})
  if report.get('sessionId')!=session_id or report.get('build')!=build or report.get('root')!='/home/daz/iqterminal-wall-tail-r5-candidate-proof':raise ValueError('Missing/mismatched cleanup confirmation')
  # A zero exit alone is insufficient, and a failed capture is not a failed stop.
  if r.returncode and report.get('confirmed'):raise ValueError('Inconsistent cleanup result')
  if capture_error:report.setdefault('captureErrors',[]).append(capture_error)
  return report
 except Exception as e:return {'sessionId':session_id,'build':build,'confirmed':False,'status':'unconfirmed','error':str(e)[:1000],'recoveryCommand':recovery_command(be,bout)}

def client_source(fe):
 # Explicit alternate receipts let a new candidate reuse the guarded lifecycle
 # without replacing the old frozen bundle or pretending it tests current main.
 value=os.environ.get('IQ_FOREGROUND_CLIENT_SOURCE')
 source=pathlib.Path(value).expanduser().resolve() if value else fe/'artifacts/watch-ack-warm-acceptance'
 if not (source/'client-build.json').is_file():raise ValueError('Client build receipt required: '+str(source))
 return source

def main():
 fe=pathlib.Path(__file__).resolve().parents[1];be=fe.parent/'iqterminal-server-integration-startup-r1'
 source=client_source(fe);backend=be/'artifacts/watch-ack-warm-acceptance'
 validate_helper(be)
 startup_check=sys.argv[1:]==['--startup-check']
 if sys.argv[1:] and not startup_check:raise SystemExit('Run without arguments; Ctrl-C stops only this owned session.')
 if startup_check:
  parent=json.loads((source/'manifest.json').read_text());assert time.time()+120<datetime.datetime.fromisoformat(parent['experimentCutoffUtc'].replace('Z','+00:00')).timestamp(),'Original task cutoff; no new experiment'
 for port in [4204,4205,18990,18991]:
  with socket.socket() as probe:
   if probe.connect_ex(('127.0.0.1',port))==0:raise SystemExit('Port already occupied; preserve existing owner: '+str(port))
 session_id=str(uuid.uuid4());now=datetime.datetime.now(datetime.timezone.utc);label=('startup-check-' if startup_check else 'manual-')+now.strftime('%Y%m%dT%H%M%SZ')+'-'+session_id[:8];out=source/label;bout=backend/label;out.mkdir();bout.mkdir();deadline=time.monotonic()+1200
 receipt=json.loads((source/'client-build.json').read_text());app=json.loads((backend/'build-receipt.json').read_text())
 for p in [out,bout]:(p/'manifest.json').write_text(json.dumps({'sessionId':session_id,'kind':'Bounded launcher startup check under original task' if startup_check else 'user-invoked manual foreground acceptance, not a renewal of completed agent budget','startUtc':now.isoformat(),'experimentCutoffUtc':(now+datetime.timedelta(minutes=20)).isoformat(),'deadlineUtc':(now+datetime.timedelta(minutes=20)).isoformat(),'frontendApplication':receipt['commit'],'backendApplication':app['commit']},indent=2))
 (out/'client-build.json').write_text(json.dumps(receipt));(bout/'build-receipt.json').write_text(json.dumps(app))
 for name in ['worker.mjs','gateway.mjs']:shutil.copyfile(backend/name,bout/name)
 node=receipt.get('nodeExecutable') or shutil.which('node');assert node and pathlib.Path(node).is_file(),'Tested Node executable required';
 if receipt.get('nodeVersion'):assert subprocess.check_output([node,'--version'],text=True).strip()==receipt['nodeVersion'],'Tested Node version changed'
 children=[];handles=[];startup_attempted=False;stop_requested=False;run_error=None
 def request_stop(*_args):
  nonlocal stop_requested
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
  startup_attempted=True
  attempt={'sessionId':session_id,'backendApplication':app['commit'],'remoteStartupAttempted':True}
  for directory in [out,bout]:(directory/'startup-attempt.json').write_text(json.dumps(attempt,indent=2))
  result=run_helper(be,bout,'start',175)
  (bout/'start.log').write_text(result.stdout+result.stderr)
  if result.returncode:raise RuntimeError('Remote startup failed; reconciling this session even without a receipt. See '+str(bout/'start.log'))
  start_result=json.loads(result.stdout)
  if not start_result.get('success') or start_result.get('sessionId')!=session_id or start_result.get('receipt',{}).get('commit')!=app['commit']:raise ValueError('Missing/mismatched startup confirmation; reconciling session')
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
  print('No automated browser/build is running. Close the candidate tab before Ctrl-C. 20-minute local active window plus bounded cleanup; remote lifetime is not guaranteed if access fails.',flush=True)
  print('Evidence: '+str(out),flush=True)
  if startup_check:
   with urllib.request.urlopen('http://127.0.0.1:4204/market-data/v1/level-watches',timeout=5) as response:assert json.load(response)['source']=='isolated-watch-protocol-harness'
   with urllib.request.urlopen('http://127.0.0.1:4204/',timeout=5) as response:assert response.status==200
  while not startup_check and not stop_requested and time.monotonic()<deadline:
   if any(p.poll() is not None for p in children):raise RuntimeError('Owned child exited during acceptance')
   time.sleep(1)
 except KeyboardInterrupt:print('Stopping owned acceptance session.',flush=True)
 except Exception as e:
  run_error=str(e)[:1000];raise
 finally:
  local=cleanup_local(children)
  remote=reconcile_remote(startup_attempted,be,bout,session_id,app['commit'])
  report={'sessionId':session_id,'remoteStartupAttempted':startup_attempted,'runError':run_error,'local':local,'remote':remote}
  report['confirmed']=all(x['confirmedStopped'] for x in local) and remote.get('confirmed',False)
  try:(out/'cleanup.json').write_text(json.dumps(report,indent=2))
  except OSError as e:print('Cannot save cleanup report: '+str(e)+'; result='+json.dumps(report),file=sys.stderr)
  for h in handles:
   try:h.close()
   except OSError:pass
  if report['confirmed']:print('Cleanup confirmed: local children stopped; this session remote roles removed/absent. Prepared state retained.',flush=True)
  else:
   print('CLEANUP NOT FULLY CONFIRMED. Inspect '+str(out/'cleanup.json'),file=sys.stderr,flush=True)
   print('Recovery (only this session): '+recovery_command(be,bout),file=sys.stderr,flush=True)
  if not report['confirmed']:raise SystemExit(1)

if __name__=='__main__':main()
