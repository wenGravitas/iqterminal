import json,os,signal,threading,time,urllib.request
from pathlib import Path
leases=[{'consumer': 'ro474-extension-perpetual', 'canonicalKey': 'bca3a4e347ead730e8fc2f28acc36bb5b1c4ccdae87fed7a8fec8aa93c59a5b7', 'projectionKey': '528949148e6b4a0196134c626aab5c96dcd712d1b765d9fa890fd7d7ea288224'}];stop=threading.Event();signal.signal(signal.SIGTERM,lambda *_:stop.set());began=time.monotonic()
receipt=Path('/home/daz/iq-ro474-extension-pins-r1.json')
with receipt.open('x') as f:json.dump({'pid':os.getpid(),'startTicks':Path('/proc/self/stat').read_text().split()[21],'consumers':[l['consumer'] for l in leases]},f)
def control(path,body):
 req=urllib.request.Request('http://127.0.0.1:18791'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=5) as response:return json.loads(response.read(4096))
try:
 turns=0
 while not stop.is_set() and time.monotonic()-began<240:
  for lease in leases:assert control('/retain',lease)['leaseMs']==15000
  turns+=1
  if turns%8==1:print(json.dumps({'phase':'renewed','turn':turns,'elapsedMs':(time.monotonic()-began)*1000,'consumers':[l['consumer'] for l in leases]}),flush=True)
  stop.wait(4)
finally:
 for lease in leases:control('/release',{'consumer':lease['consumer']})
 print(json.dumps({'phase':'released','elapsedMs':(time.monotonic()-began)*1000,'consumers':[l['consumer'] for l in leases]}),flush=True)
