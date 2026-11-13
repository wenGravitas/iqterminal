"""Task-local read-only 1Hz sampler. Remote mode accepts bounded phases on stdin.
No environments, process arguments, credentials or request bodies are collected.
"""
import concurrent.futures,json,os,re,select,subprocess,sys,time,urllib.request,urllib.error
from pathlib import Path

def command(args,timeout=1.5):
 try:
  r=subprocess.run(args,capture_output=True,text=True,timeout=timeout);return {'code':r.returncode,'text':r.stdout[:131072],'error':r.stderr[:250] if r.returncode else None}
 except Exception as e:return {'error':str(e)}
def read(path):
 try:return Path(path).read_text()
 except Exception as e:return 'unavailable:'+str(e)
def process(pid):
 try:
  raw=read('/proc/'+str(pid)+'/stat');a=raw.rsplit(')',1)[1].split();return {'pid':pid,'comm':raw.split('(',1)[1].rsplit(')',1)[0],'state':a[0],'ppid':int(a[1]),'minorFaults':int(a[7]),'majorFaults':int(a[9]),'userTicks':int(a[11]),'systemTicks':int(a[12]),'startTicks':int(a[19]),'rssPages':int(a[21]),'schedstat':read('/proc/'+str(pid)+'/schedstat').strip()}
 except Exception as e:return {'pid':pid,'error':str(e)}
def pids(comm):
 r=command(['pgrep','-x',comm]);return [int(x) for x in r.get('text','').split() if x.isdecimal()]
def sample(role,peer,extra,include_path):
 start=time.monotonic();ids=set(extra+pids('ssh')+pids('tailscaled'))
 data={'kind':'sample','role':role,'mono':start,'utc':time.time(),'processes':[process(p) for p in sorted(ids)],'mem':{l.split(':')[0]:l.split(':')[1].strip() for l in read('/proc/meminfo').splitlines() if l.split(':')[0] in ['MemTotal','MemAvailable','SwapTotal','SwapFree','Dirty','Writeback']},'vmstat':{l.split()[0]:int(l.split()[1]) for l in read('/proc/vmstat').splitlines() if l.split()[0] in ['pswpin','pswpout','pgmajfault']},'cpu':read('/proc/stat').splitlines()[0],'pressure':{k:read('/proc/pressure/'+k).strip() for k in ['cpu','memory','io']},'interfaces':read('/proc/net/dev'),'sockets':command(['ss','-tinp','dst',peer]),'observerPid':os.getpid(),'clockTicks':os.sysconf('SC_CLK_TCK'),'pageBytes':os.sysconf('SC_PAGE_SIZE')}
 if include_path:
  r=command(['tailscale','status','--json']);
  try:
   j=json.loads(r['text']);data['tailscale']=[{k:p.get(k) for k in ['HostName','TailscaleIPs','CurAddr','Relay','Active','Online','RxBytes','TxBytes','LastHandshake']} for p in j.get('Peer',{}).values() if peer in p.get('TailscaleIPs',[])]
  except Exception as e:data['tailscaleError']=str(e)
 data['sampleCostMs']=(time.monotonic()-start)*1000;return data
PATHS=['/v2/history/footprint-current?interval=5m&rowPrice=25','/v2/history/health','/v2/history/_pi-route-r2-liveness']
def probe(base,rid,path):
 start=time.monotonic();row={'kind':'probe','id':rid,'path':path,'base':base,'startMono':start,'timeoutMs':12000}
 try:
  try:r=urllib.request.urlopen(urllib.request.Request(base+path,headers={'X-IQ-Request-Id':rid}),timeout=12)
  except urllib.error.HTTPError as e:r=e
  with r:
   row.update(status=r.status,headers={k:v for k,v in r.headers.items() if k.lower() in ['x-iq-request-id','x-iq-proxy-queue-ms','x-iq-proxy-header-ms','server-timing','content-length']},headerMs=(time.monotonic()-start)*1000)
   # Discard bounded response bytes; retain only size, never a request/response body.
   row['bytes']=len(r.read(262145))
 except Exception as e:row['error']=str(e)
 row['elapsedMs']=(time.monotonic()-start)*1000;row['late4s']=row['elapsedMs']>4000;row['deadlineMet']=row.get('status') in [200,404] and row['elapsedMs']<12000;return row

def remote():
 cfg=json.loads(sys.argv[2]);root=Path(cfg['out']);root.mkdir(exist_ok=False);cutoff=cfg['cutoff'];print(json.dumps({'ready':True,'pid':os.getpid(),'path':str(root),'sshTermination':'TailscaleSSH userspace, RunSSH=true; kernel server TCP22 sockets unavailable'}),flush=True)
 pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
 for line in sys.stdin:
  msg=json.loads(line)
  if msg['action']=='stop':break
  assert msg['action']=='phase' and msg['name'] in ['baseline','verification'] and 0<msg['seconds']<=300 and time.time()+msg['seconds']+15<cutoff
  phase=msg['name'];end=min(time.monotonic()+msg['seconds'],time.monotonic()+cutoff-time.time());future=None;seq=0;due=time.monotonic();nextsample=due;ticks=0
  with (root/(phase+'.jsonl')).open('x') as f:
   f.write(json.dumps({'kind':'phase','phase':phase,'startUtc':time.time(),'mono':time.monotonic(),'seconds':msg['seconds']})+'\n');print(json.dumps({'phaseStarted':phase}),flush=True)
   while time.monotonic()<end:
    now=time.monotonic()
    if future is not None and future.done():f.write(json.dumps(future.result())+'\n');future=None
    if now>=due and future is None:
     path=PATHS[seq%len(PATHS)];future=pool.submit(probe,'http://127.0.0.1:18880',f'pi-route-r2-{phase}-{seq}-loopback',path);seq+=1;due=now+15
    if now>=nextsample:
     data=sample('server',cfg['peer'],cfg['pids'],ticks%10==0);ticks+=1;data['phase']=phase;f.write(json.dumps(data)+'\n');f.flush();nextsample+=1
    time.sleep(max(.01,min(.1,nextsample-time.monotonic())))
   if future is not None:f.write(json.dumps(future.result())+'\n')
  print(json.dumps({'phaseDone':phase,'probes':seq}),flush=True)
 pool.shutdown();print(json.dumps({'stopped':True}),flush=True)
if __name__=='__main__' and sys.argv[1]=='remote':remote()
