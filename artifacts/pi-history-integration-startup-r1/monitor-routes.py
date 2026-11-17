import concurrent.futures,json,subprocess,time,urllib.error,urllib.request,sys
from pathlib import Path
out=Path(__file__).parent;phase=sys.argv[1];assert phase in ['diagnostic','verification'];end=time.monotonic()+650;cutoff=1794469165
paths=['/v2/history/health','/v2/history/footprint-current?interval=5m&rowPrice=25','/v1/health','/v2/history/_startup-probe']
def probe(url,id):
    start=time.monotonic();status=None
    try:
        try:r=urllib.request.urlopen(urllib.request.Request(url,headers={'X-IQ-Request-Id':id}),timeout=4)
        except urllib.error.HTTPError as e:r=e
        with r:body=r.read(2*1024*1024+1);status=r.status;headers=dict(r.headers)
        return {'id':id,'url':url,'ms':(time.monotonic()-start)*1000,'status':status,'headers':headers,'bytes':len(body)}
    except Exception as e:return {'id':id,'url':url,'ms':(time.monotonic()-start)*1000,'status':status,'error':str(e)}
with (out/f'{phase}-route-probes.jsonl').open('x') as f:
    for turn in range(130):
        if time.monotonic()>=end or time.time()>=cutoff or (out/f'{phase}-cohort-done.json').exists():break
        path=paths[turn%len(paths)];prefix=f'startup-r1-{phase}-mon-{turn}'
        def remote():
            code="import urllib.request,urllib.error,json,time\nresults=[]\n"
            for label,url in [('gateway','http://127.0.0.1:18880'+path),('footprint-handler','http://127.0.0.1:18788/current?interval=5m&rowPrice=25')]:
                id=prefix+'-'+label;code+=f"t=time.monotonic();u={url!r};rid={id!r}\ntry:\n try:r=urllib.request.urlopen(urllib.request.Request(u,headers={{'X-IQ-Request-Id':rid}}),timeout=3)\n except urllib.error.HTTPError as e:r=e\n with r:body=r.read(2097153);v={{'id':rid,'url':u,'ms':(time.monotonic()-t)*1000,'status':r.status,'headers':dict(r.headers),'bytes':len(body)}}\nexcept Exception as e:v={{'id':rid,'url':u,'ms':(time.monotonic()-t)*1000,'error':str(e)}}\nresults.append(v)\n"
            code+="print(json.dumps(results))\n"
            try:
                r=subprocess.run(['ssh','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=5','daz@100.124.223.41','python3','-'],input=code,text=True,capture_output=True,timeout=9)
                return {'lane':'server-local','observations':json.loads(r.stdout)} if r.returncode==0 else {'lane':'server-local','error':r.stderr[-500:]}
            except Exception as e:return {'lane':'server-local','error':str(e)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures=[pool.submit(probe,'http://127.0.0.1:18881'+path,prefix+'-forward'),pool.submit(probe,'http://127.0.0.1:4202/market-data'+path,prefix+'-preview'),pool.submit(remote)]
            record={'turn':turn,'phase':phase,'operation':path,'observations':[future.result() for future in futures],'scope':'Equivalent operations overlapping in time; durations monotonic within each originating process; existing404 route is liveness-only'}
        f.write(json.dumps(record)+'\n');f.flush();time.sleep(5)
