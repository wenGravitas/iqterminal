#!/usr/bin/env python3
"""Exact immutable batch transport diagnostic; never a chart loading gate."""
import argparse, hashlib, json, os, shlex, subprocess, tempfile, time
from urllib.parse import urlsplit
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',required=True)
parser.add_argument('--samples',type=int,default=1,choices=range(1,6))
parser.add_argument('--key',required=True)
parser.add_argument('--market',choices=['spot','perpetual'],required=True)
parser.add_argument('--start',type=int,default=0)
parser.add_argument('--version',type=int,choices=[1,2],default=1)
parser.add_argument('--encoding',choices=['gzip','br'],default='gzip')
parser.add_argument('--vite-base',default='http://127.0.0.1:4185')
parser.add_argument('--source-token')
args=parser.parse_args()
base=urlsplit(args.vite_base)
assert base.scheme=='http' and base.hostname in ['127.0.0.1','localhost'] and not base.username and not base.password and base.path in ['', '/'] and not base.query and not base.fragment
if args.source_token:assert len(args.source_token)==64 and all(c in '0123456789abcdef' for c in args.source_token)
assert len(args.key)==64 and all(c in '0123456789abcdef' for c in args.key)
assert args.start>=0
out=Path(args.output);out.mkdir(exist_ok=False,parents=True)
path='/v2/history/walls/projection-batch?market='+args.market+'&key='+args.key+'&start='+str(args.start)+'&version='+str(args.version)
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
  body=open(b,'rb').read(8*1024*1024+1);r['decodedBytes']=len(body);r['sha256']=hashlib.sha256(body).hexdigest()
  if len(body)>8*1024*1024:r['bodyCapacityError']=True;r['exitCode']=98
 print(json.dumps(r))
'''
results=[]
for sample in range(1,args.samples+1):
 routes=['loopback','ssh','vite'] if sample%2 else ['vite','ssh','loopback']
 for route in routes:
  url=(args.vite_base.rstrip('/')+'/market-data' if route=='vite' else 'http://127.0.0.1:18780')+path
  code=probe.replace('URL',repr(url)).replace('Accept-Encoding: gzip','Accept-Encoding: '+args.encoding);cmd=['python3','-c',code]
  if route=='loopback':cmd=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','staging',shlex.join(cmd)]
  start=time.monotonic();p=subprocess.run(cmd,capture_output=True,text=True)
  try:r=json.loads(p.stdout)
  except ValueError:r={'error':'probe output invalid','stdout':p.stdout,'stderr':p.stderr,'exitCode':p.returncode}
  r.update(sample=sample,route=route,orchestratorElapsedMs=(time.monotonic()-start)*1000)
  headers={line.split(':',1)[0].lower():line.split(':',1)[1].strip() for line in (r.get('headers') or '').splitlines() if ':' in line}
  r['identityValid']=headers.get('x-iq-chunk-key')==args.key and headers.get('x-iq-wall-start')==str(args.start) and headers.get('content-encoding')==args.encoding
  if args.source_token:r['identityValid']=r['identityValid'] and headers.get('x-iq-source-revision')==args.source_token
  if args.version==2:r['identityValid']=r['identityValid'] and headers.get('x-iq-wall-transport')=='exact-points-v1' and headers.get('x-iq-decoded-bytes')==str(r.get('decodedBytes'))
  results.append(r);(out/'results.json').write_text(json.dumps({'scope':'Exact pinned prepared encoded batch; loopback curl vs existing SSH vs Vite; no paint or load acceptance. Host-local timings only; loopback orchestrator time includes SSH setup.','path':path,'encoding':args.encoding,'version':args.version,'sourceToken':args.source_token,'samples':results},indent=2)+'\n')
  print(json.dumps({k:r.get(k) for k in ['sample','route','exitCode','clientElapsedMs','decodedBytes','sha256','error']}),flush=True)
valid=[r for r in results if r.get('exitCode')==0 and r.get('identityValid')]
assert len(valid)==len(results),'Transport failure retained in results'
assert len({(r['sha256'],r['decodedBytes']) for r in valid})==1,'Pinned bodies differ'
