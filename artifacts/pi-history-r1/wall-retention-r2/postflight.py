from pathlib import Path
import json,subprocess,urllib.request,time
name='iqterminal-wall-serving-13730f7-r1';expected='dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c'
def inspect(n):return json.loads(subprocess.check_output(['docker','inspect',n.lstrip('/')]))[0]
worker=inspect(name);assert worker['Id']==expected and worker['State']['Running']
base=json.loads(Path('/home/daz/iq-wall-retention-protected-baseline.json').read_text())['expected']
for r in base:
 v=inspect(r['name']);assert v['Id']==r['id'] and v['State']['StartedAt']==r['startedAt'] and v['State']['Running']
print(json.dumps({'kind':'protected-postflight','at':time.time(),'preserved':base,'worker':{'id':worker['Id'],'startedAt':worker['State']['StartedAt']}}),flush=True)
script="""import{execFile}from'node:child_process';import{promisify}from'node:util';import{performance}from'node:perf_hooks';const run=promisify(execFile);for(let n=1;n<=5;n++){const at=performance.now();try{const r=await run('du',['-sb','--','/wall-preparation'],{maxBuffer:1024,timeout:10000});console.log(JSON.stringify({kind:'isolated-du-profile',run:n,elapsedMs:performance.now()-at,bytes:Number(r.stdout.split(/\\s+/)[0]),scope:'Exact production disk scan inside the unchanged0.5CPU384MiB worker budget; concurrent background work, not a loading gate or exclusive CPU phase'}));}catch(error){console.log(JSON.stringify({kind:'isolated-du-profile',run:n,elapsedMs:performance.now()-at,error:String(error),code:error.code}));}}"""
result=subprocess.run(['docker','exec',name,'node','--input-type=module','-e',script]);assert result.returncode==0
root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1');h=json.loads((root/'health.json').read_text())
with urllib.request.urlopen('http://127.0.0.1:18791/health',timeout=10) as r:c=json.loads(r.read())
print(json.dumps({'kind':'health-postflight','at':time.time(),'build':h['build'],'counts':c['counts'],'readers':c['readers'],'pins':c['pins'],'consumers':c['consumers'],'retention':h['retention'],'defaults':h['defaults'],'scope':'Live isolated worker state after reference readers released; health is not client ACK continuity'}),flush=True)
