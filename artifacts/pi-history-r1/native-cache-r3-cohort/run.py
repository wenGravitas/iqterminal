import hashlib,json,os,subprocess,time
from pathlib import Path
root=Path.cwd();out=root/'artifacts/pi-history-r1/native-cache-r3-cohort'
build=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert build=='1ef788c439499b815fa2328e88b7712f9da9335d'
script=root/'scripts/pi-warm-wall-route.mjs'
manifest={'clientBuild':build,'scriptSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'samplesPerMarket':5,'markets':['spot5m','perpetual15m'],'route':'http://127.0.0.1:4185','sourceReference':'scripts/pi-wall-reference.json','scope':'Headless actual Pi SSH/Vite route. Empty browser cache over prepared server, then same-worker reopen. Not normal foreground acceptance. Preserve every sample; no substitution. Fixed source and full requested30h.','cache':'two exact native entries/1000rows/1MiB; max128 active key/token leases;60s idle TTL; fresh validation independent','before':'../native-cache-validation-r2/staging-before-corrected-route.txt','order':'Alternating markets per pair; heavy checks completed before cohort. Existing two SSH transports, four aggregate historical sockets, current reserve unchanged.'}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
cases=[]
for sample in range(1,6):
 for market in (['spot','perpetual'] if sample%2 else ['perpetual','spot']):
  label=f'native-cache-r3-{sample}-{market}';env=os.environ.copy();env.update(IQ_WARM_WALL_ROUTE='1',IQ_WARM_URL='http://127.0.0.1:4185',IQ_WARM_LABEL=label,IQ_WARM_BUILD=build,IQ_WARM_MARKET=market,IQ_WARM_SAMPLES='1')
  case={'sample':sample,'market':market,'label':label,'phase':'running','startedAt':time.time()};cases.append(case);(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n');print(json.dumps(case),flush=True)
  with (out/(label+'.log')).open('w') as log:p=subprocess.run(['node',str(script)],env=env,stdout=log,stderr=subprocess.STDOUT)
  case.update(phase='terminal',exitCode=p.returncode,finishedAt=time.time(),result=f'../warm-route-{label}/run-1.json');(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n');print(json.dumps(case),flush=True)
