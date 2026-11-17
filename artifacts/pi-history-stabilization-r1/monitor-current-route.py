import json,subprocess,time,urllib.request,threading
from pathlib import Path
out=Path(__file__).parent
remote='''import json,time,urllib.request
end=time.monotonic()+100
while time.monotonic()<end:
 for label,url in [('footprint-materializer','http://127.0.0.1:18788/current?interval=5m&rowPrice=25'),('collector','http://127.0.0.1:18780/v1/health')]:
  t=time.monotonic()
  try:
   with urllib.request.urlopen(url,timeout=3) as r:b=json.load(r)
   v={'label':label,'ms':(time.monotonic()-t)*1000,'state':b.get('state') or b.get('collector',{}).get('state'),'status':b.get('status'),'timeUtcMs':int(time.time()*1000)}
  except Exception as e:v={'label':label,'ms':(time.monotonic()-t)*1000,'error':str(e),'timeUtcMs':int(time.time()*1000)}
  print(json.dumps(v),flush=True)
 time.sleep(2)
'''
def ssh():
 with (out/'current-route-recheck-server.jsonl').open('w') as f:r=subprocess.run(['ssh','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=8','daz@100.124.223.41','python3','-'],input=remote,text=True,stdout=f,stderr=subprocess.STDOUT,timeout=120)
 print('Server monitor exit',r.returncode,flush=True)
t=threading.Thread(target=ssh);t.start();end=time.monotonic()+100
with (out/'current-route-recheck-forward.jsonl').open('w') as f:
 while time.monotonic()<end:
  began=time.monotonic()
  try:
   with urllib.request.urlopen('http://127.0.0.1:18881/v1/health',timeout=3) as r:b=json.load(r)
   v={'ms':(time.monotonic()-began)*1000,'state':b.get('collector',{}).get('state'),'timeUtcMs':int(time.time()*1000)}
  except Exception as e:v={'ms':(time.monotonic()-began)*1000,'error':str(e),'timeUtcMs':int(time.time()*1000)}
  f.write(json.dumps(v)+'\n');f.flush();time.sleep(2)
t.join()
