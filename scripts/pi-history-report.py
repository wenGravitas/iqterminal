#!/usr/bin/env python3
"""Summarize every comparable loading sample; never infer p95 from five runs."""
import json,statistics,sys,collections,math
HOUR=3600000
SCENARIOS={'footprint-spot-4h-5m':(4*HOUR,300000),'footprint-4h-5m':(4*HOUR,300000),'footprint-24h-1h':(24*HOUR,HOUR),'walls-30h-spot-5m':(30*HOUR,300000),'walls-30h-perp-15m':(30*HOUR,900000),'current-footprint-5m':(4*HOUR,300000),'current-walls-15m':(HOUR,900000),'footprint-future-space-1h':(8*HOUR,HOUR)}
def requested_span(row):
    r=row.get('requested') or {};config=SCENARIOS.get(row['case'])
    return bool(config and isinstance(r.get('from'),int) and isinstance(r.get('to'),int) and r['to']-r['from']==config[0])
def footprint_coverage(row):
    last=row.get('last') or {};foot=last.get('footprint') or {};history=(foot.get('status') or {}).get('history') or {};paint=foot.get('paint') or {};r=row.get('requested') or {};closed=(last.get('nativeCandles') or {}).get('closedBoundary');config=SCENARIOS.get(row['case'])
    if not config or not requested_span(row) or not isinstance(closed,int):return {'valid':False,'reason':'Missing or changed requested/eligible interval'}
    step=config[1];end=min(r['to'],closed);expected=list(range(r['from'],end,step))
    if not expected or len(expected)>5000:return {'valid':False,'reason':'Eligible slot capacity or empty interval'}
    painted={round(t*1000) for t in paint.get('times',[]) if isinstance(t,(int,float)) and math.isfinite(t)}
    empty={slot['from'] for part in history.get('ranges',[]) for slot in (part.get('progress') or {}).get('slots',[]) if slot.get('validated') is True and slot.get('state')=='empty' and isinstance(slot.get('from'),int) and slot.get('to')==slot['from']+step}
    missing=[t for t in expected if t not in painted and t not in empty]
    return {'valid':history.get('validated') is True and not history.get('capacityLimited') and not missing and paint.get('cells',0)>0,'from':r['from'],'to':end,'requestedSlots':len(expected),'paintedSlots':sum(t in painted for t in expected),'knownEmptySlots':sum(t in empty for t in expected),'missing':missing}
path=sys.argv[1];rows=[json.loads(line) for line in open(path) if line.strip()]
groups=collections.defaultdict(list)
for row in rows:groups[row['case']].append(row)
report=[]
for name,samples in groups.items():
 field='firstCurrentAt' if name.startswith('current-') else 'completeAt'
 values=[(r.get('paintMarks')or{}).get(field) for r in samples]
 environments=[(r.get('diagnostics')or{}).get('staging',{}).get('config',{}) for r in samples]
 environmentVerified=all(c.get('dataMode')=='staging' and c.get('historyTiles') is True and c.get('build')==r.get('build') and (r.get('diagnostics')or{}).get('fixture') is False for c,r in zip(environments,samples))
 supplemental=any(r.get('wallTransportExperiment') or r.get('workerCpuProfile') or r.get('cpuProfile') or r.get('fitWalls') or r.get('extendedCoverageObservation') or r.get('keepCurrent') for r in samples)
 good=not supplemental and all(v is not None for v in values) and len(values)>=5 and environmentVerified and all(requested_span(r) for r in samples)
 if name.startswith('footprint-'):good=good and all(footprint_coverage(r)['valid'] for r in samples)
 if name.startswith('walls-'):good=good and all((r.get('wallCoverageVerification')or{}).get('valid') is True for r in samples)
 numeric=all(v is not None for v in values)
 median=statistics.median(values) if numeric else None
 maximum=max(values) if numeric else None
 medLimit,maxLimit=(2000,3000) if name.startswith('current-') else (5000,10000)
 first=[(r.get('paintMarks')or{}).get('firstHistoryAt') for r in samples]
 result={'case':name,'samplesMs':values,'medianMs':median,'maximumMs':maximum,'sampleCount':len(samples),'requestedSpanVerified':all(requested_span(r) for r in samples),'footprintCoverage':[footprint_coverage(r) for r in samples] if name.startswith('footprint-') else None,'environmentVerified':environmentVerified,'wallReferenceVerified':[bool((r.get('wallCoverageVerification')or{}).get('valid')) for r in samples] if name.startswith('walls-') else None,'environments':environments,'gate':'SUPPLEMENTAL' if supplemental else 'PASS' if good and median<=medLimit and maximum<=maxLimit else 'FAIL','limitsMs':{'median':medLimit,'maximum':maxLimit},'firstHistoricalPaintMs':first,
 'firstHistory3sGate':('SUPPLEMENTAL' if supplemental else 'PASS' if len(first)>=5 and environmentVerified and all(requested_span(r) for r in samples) and all(v is not None and v<=3000 for v in first) else 'FAIL') if name.startswith('walls-') else None,
 'builds':sorted(set(r.get('build','unknown') for r in samples)),
 'coverage':[{'run':r['run'],'requested':r['requested'],'viewport':(r.get('last')or{}).get('viewport'),'paintedClosedBars':len([t for t in ((r.get('last')or{}).get('footprint',{}).get('paint')or{}).get('times',[]) if r['requested']['from']/1000<=t<min(r['requested']['to'],((r.get('last')or{}).get('nativeCandles')or{}).get('closedBoundary',r['requested']['to']))/1000]),'formingPainted':((r.get('last')or{}).get('nativeCandles')or{}).get('closedBoundary',-1)/1000 in ((r.get('last')or{}).get('footprint',{}).get('paint')or{}).get('times',[]),
 'archive':{k:v for k,v in ((r.get('last')or{}).get('wall',{}).get('status',{}).get('archive',{})or{}).items() if k in ('from','to','loadedThrough','requestComplete','state','exact','rangeComplete')},'exception':r.get('exception')} for r in samples]}
 report.append(result)
print(json.dumps({'source':path,'method':'Pi client observations; navigation-relative main-thread painted content; null is not complete; every sample retained; no p95 from five runs. Recorded rendering labels require their browser-environment receipts; this report does not independently certify foreground execution.','renderingModes':sorted(set(r.get('rendering','unrecorded') for r in rows)),'scenarios':report},indent=2))

if '--assert-gates' in sys.argv[2:] and any(s['gate']!='PASS' or s['firstHistory3sGate']=='FAIL' for s in report):sys.exit(2)
