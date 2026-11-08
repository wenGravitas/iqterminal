#!/usr/bin/env python3
"""Exact immutable batch transport diagnostic; never a chart loading gate."""
import argparse, hashlib, json, os, shlex, subprocess, tempfile, time
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',required=True)
parser.add_argument('--samples',type=int,default=1,choices=range(1,6))
parser.add_argument('--key',required=True)
parser.add_argument('--market',choices=['spot','perpetual'],required=True)
parser.add_argument('--start',type=int,default=0)
args=parser.parse_args()
assert len(args.key)==64 and all(c in '0123456789abcdef' for c in args.key)
assert args.start>=0
out=Path(args.output);out.mkdir(exist_ok=False,parents=True)
path='/v2/history/walls/projection-batch?market='+args.market+'&key='+args.key+'&start='+str(args.start)+'&version=1'
# Same curl options, decoding and checksum on each host. Durations stay local.
probe='''import subprocess,tempfile,hashlib,json,time,os
url=URL
with tempfile.TemporaryDirectory(prefix='iq-pinned-wall-') as d:
 b=d+'/body';h=d+'/headers';at=time.monotonic()
 p=subprocess.run(['curl','--silent','--show-error','--fail','--compressed','--header','Accept-Encoding: gzip','--connect-timeout','10','--max-time','60','--output',b,'--dump-header',h,'--write-out','%{json}',url],capture_output=True,text=True)
 r={'url':url,'exitCode':p.returncode,'stderr':p.stderr,'clientElapsedMs':(time.monotonic()-at)*1000,'headers':open(h).read() if os.path.exists(h) else None}
 try:r['curl']=json.loads(p.stdout)
 except ValueError:r['curlRaw']=p.stdout
 if os.path.exists(b):
  body=open(b,'rb').read();r['decodedBytes']=len(body);r['sha256']=hashlib.sha256(body).hexdigest()
 print(json.dumps(r))
'''
results=[]
for sample in range(1,args.samples+1):
 routes=['loopback','ssh','vite'] if sample%2 else ['vite','ssh','loopback']
 for route in routes:
  url=('http://127.0.0.1:4185/market-data' if route=='vite' else 'http://127.0.0.1:18780')+path
  code=probe.replace('URL',repr(url));cmd=['python3','-c',code]
  if route=='loopback':cmd=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','staging',shlex.join(cmd)]
  start=time.monotonic();p=subprocess.run(cmd,capture_output=True,text=True)
  try:r=json.loads(p.stdout)
  except ValueError:r={'error':'probe output invalid','stdout':p.stdout,'stderr':p.stderr,'exitCode':p.returncode}
  r.update(sample=sample,route=route,orchestratorElapsedMs=(time.monotonic()-start)*1000)
  results.append(r);(out/'results.json').write_text(json.dumps({'scope':'Exact pinned prepared gzip batch; loopback curl vs existing SSH vs Vite; no paint or load acceptance. Host-local timings only; loopback orchestrator time includes SSH setup.','path':path,'samples':results},indent=2)+'\n')
  print(json.dumps({k:r.get(k) for k in ['sample','route','exitCode','clientElapsedMs','decodedBytes','sha256','error']}),flush=True)
valid=[r for r in results if r.get('exitCode')==0]
assert len(valid)==len(results),'Transport failure retained in results'
assert len({(r['sha256'],r['decodedBytes']) for r in valid})==1,'Pinned bodies differ'
