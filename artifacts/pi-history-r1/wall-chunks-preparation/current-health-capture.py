import urllib.request,json,time,pathlib
out=pathlib.Path('/home/daz/workarea/iqterminal-perf-history/artifacts/pi-history-r1/wall-current-during-route-072.jsonl')
with out.open('w') as f:
 for run in range(1,6):
  start=time.monotonic();record={'kind':'current-source-health-during-one-hour-route-diagnostic','run':run,'route':'http://127.0.0.1:18781/v1/health','localMonotonicStart':start,'scope':'Five lightweight live-tunnel health observations; no current-only baseline or full concurrent-chart gate claim'}
  try:
   with urllib.request.urlopen(record['route'],timeout=10) as r:d=json.load(r);record.update(http=r.status,collector=d.get('collector'),metrics=d.get('metrics'),watermark=d.get('watermark'))
  except Exception as e:record['error']=str(e)
  record['durationMs']=(time.monotonic()-start)*1000;f.write(json.dumps(record)+'\n');f.flush()
  if run<5:time.sleep(1)
