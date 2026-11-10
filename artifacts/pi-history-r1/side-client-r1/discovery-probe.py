import json,sys,time,urllib.request,urllib.error,urllib.parse
for request in json.load(open(sys.argv[1])):
 start=time.perf_counter();url=sys.argv[2].rstrip('/')+'/v2/history/walls/discover?'+urllib.parse.urlencode(request)
 try:
  try:r=urllib.request.urlopen(urllib.request.Request(url,headers={'X-IQ-Wall-Projection':'c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c'}),timeout=25)
  except urllib.error.HTTPError as error:r=error
  headersMs=(time.perf_counter()-start)*1000;raw=r.read(512*1024+1);assert len(raw)<=512*1024
  body=json.loads(raw)
  print(json.dumps({'kind':'bounded-discovery-diagnostic','request':request,'status':r.status,'headersMs':headersMs,'totalMs':(time.perf_counter()-start)*1000,'headers':dict(r.headers),'error':body if r.status>=400 else None,'state':body.get('state'),'sourceToken':body.get('source',{}).get('token'),'scope':'Single diagnostic after loading cohort; not a loading acceptance sample'}),flush=True)
 except Exception as error:print(json.dumps({'request':request,'totalMs':(time.perf_counter()-start)*1000,'error':str(error)}),flush=True)
