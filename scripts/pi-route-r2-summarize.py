"""Summaries of immutable task observations; no cross-host clock subtraction."""
import json,re,statistics
from pathlib import Path
root=Path('artifacts/pi-forwarded-route-r2')
def load(file):return [json.loads(l) for l in file.open() if l.strip()]
def proc(rows,pid):
 v=[r for x in rows for r in x.get('processes',[]) if r['pid']==pid and 'error' not in r]
 if not v:return None
 b,e=v[0],v[-1];ticks=rows[0]['clockTicks'];wait=[(int(y['schedstat'].split()[1])-int(x['schedstat'].split()[1]))/1e6 for x,y in zip(v,v[1:])]
 return {'pid':pid,'comm':b['comm'],'majorFaultDelta':e['majorFaults']-b['majorFaults'],'cpuSeconds':(e['userTicks']+e['systemTicks']-b['userTicks']-b['systemTicks'])/ticks,'schedWaitTotalMs':(int(e['schedstat'].split()[1])-int(b['schedstat'].split()[1]))/1e6,'largestSchedCounterIncrementMs':max(wait or [0]),'maxRssBytes':max(r['rssPages'] for r in v)*rows[0]['pageBytes'],'scope':'Process main-thread schedstat; deferred counter increments are not exclusive1s intervals. Tailscaled is shared, not per SSH flow.'}
def socket(rows,pid):
 out=[]
 for x in rows:
  raw=x['sockets'].get('text','');m=re.search(r'[^\n]*pid='+str(pid)+r'[^\n]*\n([^\n]+)',raw)
  if not m:continue
  metrics=m.group(1);item={k:float(v) for k,v in re.findall(r'\b(rto|rtt|bytes_sent|bytes_received|bytes_retrans|rcv_ooopack):([0-9.]+)',metrics)};r=re.search(r'\bretrans:\d+/(\d+)',metrics)
  if r:item['totalRetrans']=int(r.group(1))
  header=m.group(0).splitlines()[0].split();item['recvQ']=int(header[1]);item['sendQ']=int(header[2]);out.append(item)
 if not out:return None
 return {'samples':len(out),'maxRtoMs':max(x.get('rto',0) for x in out),'maxRttMs':max(x.get('rtt',0) for x in out),'totalRetransDelta':out[-1].get('totalRetrans',0)-out[0].get('totalRetrans',0),'retransBytesDelta':out[-1].get('bytes_retrans',0)-out[0].get('bytes_retrans',0),'receivedBytesDelta':out[-1].get('bytes_received',0)-out[0].get('bytes_received',0),'outOfOrderDelta':out[-1].get('rcv_ooopack',0)-out[0].get('rcv_ooopack',0),'maxRecvQ':max(x['recvQ'] for x in out),'maxSendQ':max(x['sendQ'] for x in out)}
def interfaces(text):
 d={}
 for l in text.splitlines():
  if ':' not in l:continue
  name,values=l.split(':',1);v=list(map(int,values.split()));d[name.strip()]={'rxErrors':v[2],'rxDrops':v[3],'txErrors':v[10],'txDrops':v[11]}
 return d
def resources(rows):
 a,b=rows[0],rows[-1];ia,ib=interfaces(a['interfaces']),interfaces(b['interfaces']);paths=[]
 for r in rows:
  for x in r.get('tailscale',[]):
   v={'CurAddr':x.get('CurAddr'),'RelayFallback':x.get('Relay'),'Online':x.get('Online')}
   if v not in paths:paths.append(v)
 return {'swapPageDeltas':{k:b['vmstat'][k]-a['vmstat'][k] for k in a['vmstat']},'interfaceErrorDeltas':{n:{k:ib[n][k]-ia[n][k] for k in ia[n]} for n in ia if n in ib},'paths':paths,'sampleCostMaxMs':max(r['sampleCostMs'] for r in rows),'pressureAvg10Max':{k:max([float(m.group(1)) for r in rows if (m:=re.search(r'some avg10=([0-9.]+)',r['pressure'][k]))] or [None]) for k in ['cpu','memory','io']}}
def probes(rows):
 q=[r for r in rows if r['kind']=='probe'];lanes={}
 for lane in ['forward','preview','loopback']:
  v=[r for r in q if r['id'].endswith('-'+lane)]
  if not v:continue
  ordered=sorted(v,key=lambda r:r['startMono']);assert all(a['startMono']+a['elapsedMs']/1000<=b['startMono']+.01 for a,b in zip(ordered,ordered[1:])),lane+' observer overlap'
  lanes[lane]={'count':len(v),'late4s':sum(r['late4s'] for r in v),'deadlineFailures':sum(not r['deadlineMet'] for r in v),'medianMs':statistics.median(r['elapsedMs'] for r in v),'maxMs':max(r['elapsedMs'] for r in v),'samples':v}
 return lanes
choice=json.load(open(root/'comparison-choice.json'));summary={'scope':'Each phase300s; one1Hz sampler per host; one persistent remote sampler/control session. Kernel serverTCP22 unavailable because TailscaleSSH uses userspace netstack. No host-clock subtraction.','phases':{}}
for phase,pid in [('baseline',choice['oldCurrentPid']),('verification',choice['newCurrentPid'])]:
 local=load(root/(phase+'-client.jsonl'));remote=load(root/(phase+'-server.jsonl'));cs=[r for r in local if r['kind']=='sample'];ss=[r for r in remote if r['kind']=='sample'];summary['phases'][phase]={'clientSamples':len(cs),'serverSamples':len(ss),'probes':probes(local+remote),'clientCurrentSsh':proc(cs,pid),'currentTcp':socket(cs,pid),'clientHistorySsh':proc(cs,choice['historyPidUnchanged']),'historyTcp':socket(cs,choice['historyPidUnchanged']),'serverTailscaled':proc(ss,1843359),'gateway':proc(ss,1363596),'worker':proc(ss,2801215),'clientResources':resources(cs),'serverResources':resources(ss)}
work=load(root/'workload.jsonl');end=work[-1];stalls=[]
for s in end['diagnostics']['staging']['streams']:
 if not s.get('executionProof'):continue
 cursor=s['executionProof'].get('lastConfirmedAckCursor');same=[r for r in work if any(x['key']==s['key'] and x.get('executionProof',{}).get('lastConfirmedAckCursor')==cursor for x in r['diagnostics']['staging']['streams'])];stalls.append({'key':s['key'],'confirmedCursor':cursor,'minimumUnchangedObservationSeconds':(same[-1]['mono']-same[0]['mono'])/1000,'finalProof':s['executionProof']})
summary['persistentWorkload']={'stalls':stalls,'injectedCurrentTransportRecovery':choice['recoveryResult'],'historyPidPreserved':choice['historyPidUnchanged'],'lastHeartbeatCaveat':'streamAt updates on socket creation; connected means a socket object exists, not necessarily OPEN. Neither field is live-progress proof.'}
starts=load(root/'startups-five/samples.jsonl');summary['startupAttempts']=[{'run':x['run'],'bootstrapMs':(x.get('measurement') or {}).get('bootstrapMs'),'navigationLiveMs':(x.get('measurement') or {}).get('firstAt'),'error':x.get('error'),'confirmedProof':x.get('currentExecutionProof'),'baselineProof':x.get('baselineExecutionProof'),'healthErrors':[{'stage':k,**x[k]} for k in ['derivedBefore','sourceBefore','derivedAfter','sourceAfter'] if x[k].get('error')]} for x in starts]
(root/'paired-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:{lane:{n:v[n] for n in ['count','late4s','deadlineFailures','maxMs']} for lane,v in d['probes'].items()} for k,d in summary['phases'].items()},indent=2));print('stalls',[(s['key'],s['minimumUnchangedObservationSeconds']) for s in stalls])
