from pathlib import Path
import os,subprocess,shlex,hashlib
bundle=Path('/home/daz/iq-wall-prefix-verify-r1.mjs')
assert hashlib.sha256(bundle.read_bytes()).hexdigest()=='dbeed03605c7b0f000fb10e309503ae0d61a5f51dd9ab5505b853663aa1a0cf9'
values={}
for line in Path('/opt/iqterminal/.env').read_text().splitlines():
 if line.startswith('CH_APP_PASSWORD='):
  value=line.split('=',1)[1];values['CH_APP_PASSWORD']=shlex.split(value,comments=True)[0] if value.startswith(('"',"'")) else value
assert values.get('CH_APP_PASSWORD')
env={**os.environ,**values,'CH_URL':'http://127.0.0.1:18790','CH_USER':'iqterminal','IQ_WALL_PREFIX_VERIFY':'1','IQ_BUILD_COMMIT':'b0f0209795e22e64961b27d0a6e38ef13d21fa49'}
args=['nice','-n','10','/home/daz/.nvm/versions/node/v22.23.4/bin/node','--max-old-space-size=256',str(bundle),'/home/daz/iqterminal-wall-rolling-defaults-r1','/home/daz/iqterminal-wall-prefix-verify-r1','b306e8ba5060dc20b1051f855f15ff900cba57f317fc8892ba6785747b81f599,5693eea94728f5e64c472d2d1cd5e8970a0cbc40f5f643bd12ecc21bc9fb14b8']
p=subprocess.run(args,env=env);raise SystemExit(p.returncode)
