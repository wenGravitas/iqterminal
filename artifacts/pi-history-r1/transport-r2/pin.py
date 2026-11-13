import json,os,signal,threading,time,urllib.request
from pathlib import Path
root=Path('/home/daz/iqterminal-wall-serving-v3-33c7e3a-r1');q=json.loads((root/'queue/queue.json').read_text());keys=['7be996f3061134b2beaf9cc8257aa69ae43a0aff9b8ecb38abf9bb6f049feffa'];jobs=[next(j for j in q['jobs'] if j.get('sourceKey')==key and j['phase']=='ready') for key in keys]
leases=[{'consumer':'stage691-point-'+j['request']['market'],'canonicalKey':j['sourceKey'],'projectionKey':j['projectionKey']} for j in jobs];stop=threading.Event();signal.signal(signal.SIGTERM,lambda *_:stop.set());began=time.monotonic()
receipt=Path('/home/daz/iq-stage691-point-pins-r1.json')
with receipt.open('x') as f:json.dump({'pid':os.getpid(),'startTicks':Path('/proc/self/stat').read_text().split()[21],'consumers':[l['consumer'] for l in leases]},f)
def control(path,body):
 req=urllib.request.Request('http://127.0.0.1:18791'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=5) as response:return json.loads(response.read(4096))
try:
 turns=0
 while not stop.is_set() and time.monotonic()-began<180:
  for lease in leases:assert control('/retain',lease)['leaseMs']==15000
  turns+=1
  if turns%8==1:print(json.dumps({'phase':'renewed','turn':turns,'elapsedMs':(time.monotonic()-began)*1000,'consumers':[l['consumer'] for l in leases]}),flush=True)
  stop.wait(4)
finally:
 for lease in leases:control('/release',{'consumer':lease['consumer']})
 print(json.dumps({'phase':'released','elapsedMs':(time.monotonic()-began)*1000,'consumers':[l['consumer'] for l in leases]}),flush=True)
