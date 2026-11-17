from pathlib import Path
import json,subprocess
root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1');q=json.loads((root/'queue/queue.json').read_text());selected=[]
for market in ['spot','perpetual']:
 jobs=[j for j in q['jobs'] if j['request']['market']==market and j['phase']=='ready' and not j.get('failed')];selected.append(max(jobs,key=lambda j:j['request']['to']))
print(json.dumps({'selected':[{k:j.get(k) for k in ['id','request','sourceKey','projectionKey']} for j in selected]}),flush=True)
r=subprocess.run(['/home/daz/.nvm/versions/node/v22.23.4/bin/node','--max-old-space-size=256','/home/daz/iq-side-reference-r1.mjs',str(root),','.join(j['id'] for j in selected)],env={**__import__('os').environ,'IQ_WALL_DEFAULT_RESUME_REFERENCE':'1'});raise SystemExit(r.returncode)
