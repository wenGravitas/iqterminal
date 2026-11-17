import json,time,platform,signal
from pathlib import Path
running=True
def stop(*args):
 global running
 running=False
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
print(json.dumps({'kind':'resource-scope','machine':platform.machine(),'clock':'monotonic same-host only','scope':'Read-only partial-window host resource samples during projection component cohort; no chart/ACK/latency gate'}),flush=True)
for i in range(180):
 if not running:break
 memory={}
 for line in Path('/proc/meminfo').read_text().splitlines():
  key,value=line.split(':',1)
  if key in ['MemTotal','MemAvailable','SwapTotal','SwapFree','SwapCached','Dirty','Writeback']:memory[key]=value.strip()
 stat=Path('/proc/stat').read_text().splitlines()
 print(json.dumps({'kind':'host-resource','mono':time.monotonic(),'wall':time.time(),'loadavg':Path('/proc/loadavg').read_text().strip(),'memory':memory,'cpu':stat[0],'processes':[line for line in stat if line.startswith(('procs_running ','procs_blocked '))]}),flush=True)
 time.sleep(3)
print(json.dumps({'kind':'resource-terminal','stopped':not running,'mono':time.monotonic()}),flush=True)
