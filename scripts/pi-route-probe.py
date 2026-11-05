"""Five identical, watermark-pinned compressed wall batches per serving route.

Run independently of browser benchmarks. Raw wire bodies/headers are retained;
curl timings are local to each route, SSH process overhead is separate.
"""
import base64,gzip,hashlib,json,os,subprocess,time,urllib.parse
from pathlib import Path
root=Path('artifacts/pi-history-r1'); label=os.environ.get('IQ_ROUTE_LABEL','pinned-route')
backend=os.environ.get('IQ_BACKEND_BUILD','unknown'); output=root/f'{label}.jsonl'; raw=root/label;raw.mkdir(parents=True,exist_ok=True)
# The helper executes the exact same curl on the remote or local host. No keys,
# SQL credentials, remote clock arithmetic, or transport phase subtraction.
helper=r'''
import base64,json,subprocess,sys,tempfile
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='iq-route-') as tmp:
 p=Path(tmp); r=subprocess.run(['curl','--max-time','30','--silent','--show-error','-H','Accept-Encoding: gzip','-H','X-IQ-View-Id: '+sys.argv[2],'-D',str(p/'headers'),'-o',str(p/'body'),'--write-out','%{json}',sys.argv[1]],capture_output=True,text=True)
 print(json.dumps(dict(exit=r.returncode,stderr=r.stderr,metrics=json.loads(r.stdout) if r.stdout else None,headers=(p/'headers').read_text() if (p/'headers').exists() else '',body=base64.b64encode((p/'body').read_bytes()).decode() if (p/'body').exists() else '')))
'''
def read(route,base,path,name):
 url=base+path;args=['python3','-c',helper,url,name]
 if route=='staging-loopback':
  import shlex
  args=['ssh','-o','ConnectTimeout=15','staging',shlex.join(args)]
 at=time.monotonic(); p=subprocess.run(args,capture_output=True,text=True,timeout=50)
 if p.returncode: raise RuntimeError(p.stderr[:500])
 d=json.loads(p.stdout);d['processMs']=(time.monotonic()-at)*1000;wire=base64.b64decode(d.pop('body')); (raw/f'{name}.body').write_bytes(wire);(raw/f'{name}.headers').write_text(d['headers'])
 decoded=gzip.decompress(wire) if wire.startswith(b'\x1f\x8b') else wire
 d.update(url=url,wireBytes=len(wire),decodedBytes=len(decoded),backend=backend)
 if d['exit'] or d['metrics']['http_code']!=200: raise RuntimeError(json.dumps(d))
 body=json.loads(decoded);canonical={k:v for k,v in body.items() if k!='profileStatus'}
 d['financialBodyHash']=hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',',':')).encode()).hexdigest();return d,body
end=json.loads((root/'windows.json').read_text())['end'];params=dict(profile='binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1',market='spot',**{'from':end-30*3600000,'to':end,'after':0,'limit':512,'display':1})
path='/v1/order-walls/archive?'+urllib.parse.urlencode(params)
manifest,body=read('pi-ssh','http://127.0.0.1:18780',path,'manifest');(raw/'manifest.json').write_text(json.dumps(dict(request=manifest,body=body),indent=2)+'\n')
assert body.get('displayVersion')==1 and body.get('snapshot'),body.keys()
params.update(watermark=body['watermark'],after=body['page']['nextAfter'],limit=4096)
path='/v1/order-walls/archive?'+urllib.parse.urlencode(params);expected=None
with output.open('w') as f:
 for route,base in [('staging-loopback','http://127.0.0.1:18780'),('pi-ssh','http://127.0.0.1:18780'),('vite','http://127.0.0.1:4181/market-data')]:
  for run in range(1,6):
   d,b=read(route,base,path,f'{route}-{run}');d.update(route=route,run=run,watermark=b['watermark'],after=b['page']['after'],nextAfter=b['page']['nextAfter'],patches=len(b['patches']))
   expected=expected or d['financialBodyHash'];d['identicalPinnedBody']=d['financialBodyHash']==expected
   f.write(json.dumps(d)+'\n');f.flush();print(route,run,d['metrics']['time_total'],d['identicalPinnedBody'],flush=True)
   assert d['identicalPinnedBody'] and b['watermark']==params['watermark'] and b['page']['after']==params['after']
