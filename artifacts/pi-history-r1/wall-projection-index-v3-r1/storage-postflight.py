from pathlib import Path
import json,subprocess,shutil,time
roots=['/home/daz/iqterminal-wall-serving-71f62d2-r1']+['/home/daz/iq-wall-index-v3-cohort-'+r for r in ['r1','r2','r3','r4']]+['/home/daz/iq-wall-index-v3-inline-spot-profile-r1']
sizes={p:int(subprocess.check_output(['du','-sb',p],text=True).split()[0]) for p in roots}
disk=shutil.disk_usage(roots[0]);root=sizes[roots[0]]
print(json.dumps({'kind':'read-only-storage-postflight','wall':time.time(),'bytes':sizes,'disk':{'total':disk.total,'used':disk.used,'free':disk.free},'managedRootWithin2GiB':root<=2*1024**3,'freeFloor20GiB':disk.free>=20*1024**3,'quiescentSnapshotPlusRestoreBudgetWouldFit2GiB':3*root+160*1024**2<=2*1024**3,'scope':'Read-only byte accounting after timing cohort; no snapshot, restore, serving upgrade, deletion or collector/source mutation performed.'}),flush=True)
assert root<=2*1024**3 and disk.free>=20*1024**3
