from pathlib import Path
import json,urllib.request,urllib.parse,gzip,hashlib,time
base='http://127.0.0.1:18880';health=json.loads(Path('/home/daz/iqterminal-wall-serving-71f62d2-r1/health.json').read_text());results=[]
def read(path,headers={},body=None,method=None):
 at=time.perf_counter();r=urllib.request.urlopen(urllib.request.Request(base+path,headers=headers,data=body,method=method),timeout=20);data=r.read(9*1024**2+1);assert len(data)<=9*1024**2;return r,data,(time.perf_counter()-at)*1000
for market in ['spot','perpetual']:
 job=next(j for j in health['jobs'] if j['request']['market']==market and j['state']=='ready');consumer='isolated-serving-read-'+market
 response,body,discoveryMs=read('/v2/history/walls/discover?'+urllib.parse.urlencode(job['request']),{'X-IQ-Wall-Projection':'c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c'})
 found=json.loads(body);assert found['state']=='ready';p=found['projection']['manifest'];assert p['key']==job['projectionKey'];assert p['sourceToken']==found['source']['token']
 lease=json.dumps({'consumer':consumer,'canonicalKey':found['manifest']['key'],'projectionKey':p['key']}).encode()
 r,b,leaseMs=read('/v2/history/walls/reader',{'Content-Type':'application/json'},lease,'POST');assert json.loads(b)['leaseMs']==15000
 try:
  r,body,batchMs=read('/v2/history/walls/projection-batch?'+urllib.parse.urlencode({'market':market,'key':p['key'],'start':0,'version':1}),{'X-IQ-Wall-Reader':consumer,'Accept-Encoding':'gzip'})
  raw=gzip.decompress(body);lines=raw.decode().splitlines();start=int(r.headers['X-IQ-Wall-Start']);end=int(r.headers['X-IQ-Wall-Next']);assert len(lines)==end-start and end>start
  for index,line in enumerate(lines,start):assert hashlib.sha256(line.encode()).hexdigest()==p['parts'][index]['hash']
  assert r.headers['X-IQ-Source-Revision']==found['source']['token'];assert r.headers['X-IQ-Db-Queries']=='0'
  results.append({'market':market,'request':job['request'],'sourceToken':found['source']['token'],'sourceKey':found['manifest']['key'],'projectionKey':p['key'],'partsVerified':len(lines),'start':start,'next':end,'compressedBytes':len(body),'decodedBytes':len(raw),'discoveryMs':discoveryMs,'leaseMs':leaseMs,'batchMs':batchMs,'headers':dict(r.headers),'scope':'One bounded immutable batch through isolated staging side API with source discovery, reader lease, membership hashes and zero-DB delivery. Not full visible coverage, browser paint or latency acceptance.'})
 finally:read('/v2/history/walls/preparation?'+urllib.parse.urlencode({'consumer':consumer}),method='DELETE')
print(json.dumps(results))
