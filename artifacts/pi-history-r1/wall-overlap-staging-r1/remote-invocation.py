from pathlib import Path
import os,subprocess,shlex,hashlib
bundle=Path('/home/daz/iq-wall-overlap-verify-r1.mjs')
assert hashlib.sha256(bundle.read_bytes()).hexdigest()=='484ad3a6573cf78fd96bb341f1f80b2431435040fca417482924535e8df0afc0'
values={}
for line in Path('/opt/iqterminal/.env').read_text().splitlines():
 if line.startswith('CH_APP_PASSWORD='):
  value=line.split('=',1)[1];values['CH_APP_PASSWORD']=shlex.split(value,comments=True)[0] if value.startswith(('"',"'")) else value
assert values.get('CH_APP_PASSWORD')
env={**os.environ,**values,'CH_URL':'http://127.0.0.1:18790','CH_USER':'iqterminal','IQ_WALL_OVERLAP_VERIFY':'1','IQ_BUILD_COMMIT':'fd3b2d6897f14bb41732239e3ab7f10835be75d2'}
args=['nice','-n','10','/home/daz/.nvm/versions/node/v22.23.4/bin/node','--max-old-space-size=256',str(bundle),'/home/daz/iqterminal-wall-rolling-defaults-r1','/home/daz/iqterminal-wall-overlap-verify-r1','b306e8ba5060dc20b1051f855f15ff900cba57f317fc8892ba6785747b81f599,5693eea94728f5e64c472d2d1cd5e8970a0cbc40f5f643bd12ecc21bc9fb14b8']
p=subprocess.run(args,env=env);raise SystemExit(p.returncode)
