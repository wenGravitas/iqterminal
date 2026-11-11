#!/usr/bin/env python3
"""Open/close evidence. Every cycle is retained; forced-GC studies cannot pass warm latency."""
import json, re, statistics, sys

def summarize(rows):
    closed={r['cycle']:r for r in rows if r['phase']=='closed'}
    samples=[]
    for r in (r for r in rows if r['phase']=='open'):
        d=r['diagnostic'];c=d.get('staging',{}).get('config',{});ref=r['reference'];p=r['paint'];previous=closed.get(r['cycle']-1,{})
        forced=r['heap']['forcedCollection'] or previous.get('heap',{}).get('forcedCollection',False)
        eligible=r['cycle']>0 and previous.get('diagnostic',{}).get('orderWallsArchive',{}).get('warmEntries',0)>0 and not forced
        source=[q for q in r.get('requests',[]) if '/walls/source?' in q['url'] and q.get('status')==200]
        native=bool(isinstance(r.get('nativeClosedBoundary'),int) and r['nativeClosedBoundary']>=ref['to'] and all(t in set(r.get('nativeClosedTimes',[])) for t in range(ref['from'],ref['to'],900000)))
        full=bool(native and r.get('nativeCoverage',{}).get('valid') and r.get('settledReadVerified') and r['marks']['complete'] is not None
                  and p.get('mounted') and p.get('archiveSegments')==ref['segments'] and p.get('segments')==ref['segments']
                  and p.get('archiveValueRuns')==ref['valueRuns'] and p.get('inputRevision')==p.get('paintedRevision')
                  and p.get('pendingProjectionSegments')==0 and p.get('pendingReferenceSegments')==0
                  and not p.get('valueHistoryLimited') and not p.get('episodeHistoryLimited'))
        environment=bool(re.fullmatch('[a-f0-9]{40}',r['build']) and c.get('build')==r['build'] and c.get('dataMode')=='staging' and c.get('historyTiles') is True and d.get('fixture') is False)
        span=ref['to']-ref['from']==30*3600000 and ref['sourceFrom']==ref['from']-900000 and ref['sourceTo']==ref['to']+900000
        reused=any(j.get('preparedRevisionReused') for j in d['orderWallsArchive'].get('historyJobStates',[]))
        first=r['marks']['first']
        samples.append({'cycle':r['cycle'],'naturalWarmEligible':eligible,'forcedCollection':forced,'firstMs':first,'completeMs':r['marks']['complete'],
                        'environmentVerified':environment,'full30hSpanVerified':span,'completePaintAndNativeCoverage':full,'sourceValidationResponses':len(source),'reusedValidatedManifest':reused,
                        'projectionBatchRequests':sum('/projection-batch?' in q['url'] for q in r.get('requests',[])),
                        'workerHeapBytes':[w['heap']['usedSize'] for w in r['heap']['workers']],
                        'closedWorkerHeapBytes':[w['heap']['usedSize'] for w in closed.get(r['cycle'],{}).get('heap',{}).get('workers',[])],
                        'warmPass':bool(eligible and environment and span and full and source and reused and first is not None and 0<=first<=1000)})
    warm=[r for r in samples if r['naturalWarmEligible']]
    first=[r['firstMs'] for r in warm]
    valid=bool(first) and all(v is not None for v in first)
    return {'scope':'Headless Pi open/close study over a fixed full30h reference. Warm eligibility derives from the preceding closed cache, never from successful timings. Initial and unseeded cycles remain in samples. No foreground, pan/switch/concurrent-live or retained-heap plateau acceptance is inferred.',
            'samples':samples,'warmSampleCount':len(warm),'warmFirstSamplesMs':first,'warmFirstMedianMs':statistics.median(first) if valid else None,'warmFirstMaximumMs':max(first) if valid else None,
            'warmUseful1sGate':'PASS' if len(warm)>=5 and all(r['warmPass'] for r in warm) else 'FAIL' if len(warm)>=5 else 'INCOMPLETE',
            'retainedHeapPlateauGate':'INCOMPLETE','otherReleaseGates':'Not certified by this lifecycle study'}

if __name__=='__main__':
    rows=[json.loads(line) for line in open(sys.argv[1]) if line.strip()]
    report=summarize(rows);print(json.dumps(report,indent=2))
    if '--assert-warm' in sys.argv[2:] and report['warmUseful1sGate']!='PASS':sys.exit(2)
