#!/usr/bin/env python3
"""Summarize every comparable loading sample; never infer p95 from five runs."""
import json,statistics,sys,collections
path=sys.argv[1];rows=[json.loads(line) for line in open(path) if line.strip()]
groups=collections.defaultdict(list)
for row in rows:groups[row['case']].append(row)
report=[]
for name,samples in groups.items():
 field='firstCurrentAt' if name.startswith('current-') else 'completeAt'
 values=[(r.get('paintMarks')or{}).get(field) for r in samples]
 environments=[(r.get('diagnostics')or{}).get('staging',{}).get('config',{}) for r in samples]
 environmentVerified=all(c.get('dataMode')=='staging' and c.get('historyTiles') is True and c.get('build')==r.get('build') and (r.get('diagnostics')or{}).get('fixture') is False for c,r in zip(environments,samples))
 good=all(v is not None for v in values) and len(values)>=5 and environmentVerified
 median=statistics.median(values) if good else None
 maximum=max(values) if good else None
 medLimit,maxLimit=(2000,3000) if name.startswith('current-') else (5000,10000)
 first=[(r.get('paintMarks')or{}).get('firstHistoryAt') for r in samples]
 result={'case':name,'samplesMs':values,'medianMs':median,'maximumMs':maximum,'sampleCount':len(samples),'environmentVerified':environmentVerified,'environments':environments,'gate':'PASS' if good and median<=medLimit and maximum<=maxLimit else 'FAIL','limitsMs':{'median':medLimit,'maximum':maxLimit},'firstHistoricalPaintMs':first,
 'firstHistory3sGate':('PASS' if len(first)>=5 and all(v is not None and v<=3000 for v in first) else 'FAIL') if name.startswith('walls-') else None,
 'builds':sorted(set(r.get('build','unknown') for r in samples)),
 'coverage':[{'run':r['run'],'requested':r['requested'],'viewport':(r.get('last')or{}).get('viewport'),'paintedClosedBars':len([t for t in ((r.get('last')or{}).get('footprint',{}).get('paint')or{}).get('times',[]) if r['requested']['from']/1000<=t<r['requested']['to']/1000]),
 'archive':{k:v for k,v in ((r.get('last')or{}).get('wall',{}).get('status',{}).get('archive',{})or{}).items() if k in ('from','to','loadedThrough','requestComplete','state','exact','rangeComplete')},'exception':r.get('exception')} for r in samples]}
 report.append(result)
print(json.dumps({'source':path,'method':'normal Chromium on Pi; navigation-relative main-thread painted content; null is not complete; every sample retained; no p95 from five runs','scenarios':report},indent=2))
