from pathlib import Path
import subprocess,json
name='iqterminal-wall-serving-71f62d2-r1';root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1')
i=json.loads(subprocess.check_output(['docker','inspect',name]))[0];assert i['Id']=='fd8809dcf9b4915a8eeac704de509b1bcbd71dce57f9f0bff95ab36c0a4e4098';assert i['State']['Status']=='exited' and i['State']['ExitCode']==1
log=subprocess.check_output(['docker','logs',name],stderr=subprocess.STDOUT,text=True);assert 'Existing non-coordinator roots cannot be adopted' in log
assert sorted(p.name for p in root.iterdir())==['launch-receipt.json']
destination=Path('/home/daz/iq-wall-serving-71f62d2-r1-launch.json');assert not destination.exists();(root/'launch-receipt.json').rename(destination)
print(json.dumps({'before':i['State'],'failure':log,'action':'Move owned receipt outside empty derived root; start only confirmed stopped new worker','container':i['Id']}))
subprocess.run(['docker','start',name],check=True)
