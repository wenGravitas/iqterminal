from pathlib import Path
import os,subprocess,shlex,hashlib
bundle=Path('/home/daz/iq-wall-overlap-tail-verify-r1.mjs')
assert hashlib.sha256(bundle.read_bytes()).hexdigest()=='f03bd46fe2c48460fc5d65b24ee2ff25038fe7871bd30a0bde7d7b883d61b61d'
values={}
for line in Path('/opt/iqterminal/.env').read_text().splitlines():
 if line.startswith('CH_APP_PASSWORD='):
  value=line.split('=',1)[1];values['CH_APP_PASSWORD']=shlex.split(value,comments=True)[0] if value.startswith(('"',"'")) else value
assert values.get('CH_APP_PASSWORD')
env={**os.environ,**values,'CH_URL':'http://127.0.0.1:18790','CH_USER':'iqterminal','IQ_WALL_OVERLAP_VERIFY':'1','IQ_BUILD_COMMIT':'472f8ac83ff2b024583c54024e023a9135970e7c'}
args=['nice','-n','10','/home/daz/.nvm/versions/node/v22.23.4/bin/node','--max-old-space-size=256',str(bundle),'/home/daz/iqterminal-wall-rolling-defaults-r1','/home/daz/iqterminal-wall-overlap-tail-verify-r1','b306e8ba5060dc20b1051f855f15ff900cba57f317fc8892ba6785747b81f599,5693eea94728f5e64c472d2d1cd5e8970a0cbc40f5f643bd12ecc21bc9fb14b8']
p=subprocess.run(args,env=env);raise SystemExit(p.returncode)
