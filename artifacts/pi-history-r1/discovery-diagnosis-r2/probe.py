import json,sys,time,urllib.request,urllib.error,urllib.parse,zlib
for request in json.load(open(sys.argv[1])):
 for run in range(1,6):
  start=time.perf_counter();url=sys.argv[2].rstrip('/')+'/v2/history/walls/discover?'+urllib.parse.urlencode(request)
  try:
   try:r=urllib.request.urlopen(urllib.request.Request(url,headers={'Accept-Encoding':'gzip','X-IQ-Wall-Projection':'c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c'}),timeout=25)
   except urllib.error.HTTPError as error:r=error
   headersMs=(time.perf_counter()-start)*1000;raw=r.read(2*1024*1024+1)
   if len(raw)>2*1024*1024:raise ValueError('Diagnostic wire byte cap 2MiB')
   if r.headers.get('Content-Encoding')=='gzip':
    d=zlib.decompressobj(16+zlib.MAX_WBITS);body=d.decompress(raw,8*1024*1024+1)
    if len(body)>8*1024*1024 or not d.eof:raise ValueError('Diagnostic decoded byte cap 8MiB or incomplete gzip')
   else:body=raw
   data=json.loads(body)
   print(json.dumps({'kind':'bounded-discovery-diagnostic','request':request,'run':run,'status':r.status,'headersMs':headersMs,'totalMs':(time.perf_counter()-start)*1000,'encodedBytes':len(raw),'decodedBytes':len(body),'headers':dict(r.headers),'error':data if r.status>=400 else None,'state':data.get('state'),'sourceToken':data.get('source',{}).get('token'),'scope':'Read-only discovery diagnosis, not chart loading acceptance'}),flush=True)
  except Exception as error:print(json.dumps({'request':request,'run':run,'totalMs':(time.perf_counter()-start)*1000,'exceptionType':type(error).__name__,'error':str(error)}),flush=True)
