import json,statistics
from pathlib import Path
out=Path(__file__).resolve().parent;root=out.parent
cases=json.loads((out/'cases.json').read_text());assert len(cases)==10 and all(c['phase']=='terminal' for c in cases)
summary={'scope':'Five headless actual-Pi-route samples per full30h market; no normal foreground acceptance; null means not observed, never shortened source or unavailable data.','markets':{}}
for market in ['spot','perpetual']:
 rows=[]
 for c in cases:
  if c['market']!=market:continue
  r=json.loads((out/c['result']).read_text());cold=r.get('cold') or {};warm=r.get('warm') or {};paint=cold.get('paint') or {};native=cold.get('native') or {};a=(cold.get('wall') or {}).get('archive') or {}
  rows.append({'sample':c['sample'],'firstHistoryMs':cold.get('firstHistory'),'completeMs':cold.get('complete'),'renderedSegments':paint.get('segments'),'requestedSegments':r['reference']['segments'],'renderedValueRuns':paint.get('archiveValueRuns'),'requestedValueRuns':r['reference']['valueRuns'],'nativeVisible':native.get('visible'),'nativeRequested':(r['reference']['to']-r['reference']['from'])//(300000 if market=='spot' else 900000),'loadedThrough':a.get('loadedThrough'),'requestedFrom':r['reference']['from'],'requestedTo':r['reference']['to'],'warmFirstMs':None if warm.get('firstHistory') is None else warm['firstHistory']-warm['start'],'warmCompleteMs':None if warm.get('complete') is None else warm['complete']-warm['start'],'warmNotRun':r.get('warmNotRun'),'error':r.get('error'),'pageErrors':r.get('errors'),'exactHash':r.get('coldHash'),'result':c['result']})
 def stats(key):
  values=[r[key] for r in rows if r[key] is not None];return {'samples':len(values),'medianMs':statistics.median(values) if len(values)==5 else None,'maximumMs':max(values) if len(values)==5 else None,'observedSubsetMaximumMs':max(values) if values else None}
 summary['markets'][market]={'samples':rows,'firstHistory':stats('firstHistoryMs'),'complete':stats('completeMs'),'warm':stats('warmFirstMs'),'gates':{'firstUsefulWithin3s':'FAIL' if any(r['firstHistoryMs'] is None or r['firstHistoryMs']>3000 for r in rows) else 'PASS','completeMedian5sMaximum10s':'FAIL' if any(r['completeMs'] is None or r['completeMs']>10000 for r in rows) or statistics.median([r['completeMs'] for r in rows])>5000 else 'PASS','warmUsefulWithin1s':'UNPROVEN - full seed unavailable' if any(r['warmFirstMs'] is None for r in rows) else 'PASS' if all(r['warmFirstMs']<=1000 for r in rows) else 'FAIL','foregroundPrimary':'UNPROVEN - headed paused'}}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
