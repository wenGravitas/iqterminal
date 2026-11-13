from pathlib import Path
import tarfile,sys
root=Path('/home/daz/iq-wall-index-v3-cohort-r2')
paths=sorted(root.glob('*.jsonl'))
assert len(paths)==30,len(paths)
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz') as archive:
 for path in paths:archive.add(path,arcname=path.name,recursive=False)
