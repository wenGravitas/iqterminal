#!/usr/bin/env python3
"""Quiescent, checksummed copy/restore drill for an owned staging wall root.
Never replaces/clears a root, deletes a lock, or changes protected services.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time
import urllib.request

PROTECTED = ['iqterminal-history-api', 'iqterminal-server', 'iqterminal-spot-server',
 'iqterminal-history-materializer', 'iqterminal-spot-history-materializer',
 'iqterminal-footprint-materializer', 'iqterminal-spot-footprint-materializer', 'iqterminal-sql-admission']
MAX_BYTES = 2 * 1024**3
MIN_FREE = 20 * 1024**3
MAX_FILES = 65536
MAX_FILE = 64 * 1024**2

def inventory(root):
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        if len(Path(directory).relative_to(root).parts) > 16:
            raise ValueError('Derived path depth capacity')
        for name in dirs + files:
            p = Path(directory) / name
            mode = p.lstat().st_mode
            if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise ValueError('Nonregular derived path: ' + str(p.relative_to(root)))
        for name in files:
            p = Path(directory) / name
            size = p.stat().st_size
            if size > MAX_FILE or len(result) >= MAX_FILES:
                raise ValueError('Derived file capacity')
            h = hashlib.sha256()
            with p.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(block)
            result[str(p.relative_to(root))] = {'bytes': size, 'sha256': h.hexdigest()}
    if sum(row['bytes'] for row in result.values()) > MAX_BYTES:
        raise ValueError('Derived root capacity')
    return result

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=60).strip()

def identity(name):
    return json.loads(docker('inspect', '--format', '{{json .}}', name))

def protected_identity():
    # Print/store only the explicit operational identity fields, never Env.
    result = []
    for name in PROTECTED:
        item = identity(name)
        result.append({'name': name, 'id': item['Id'], 'startedAt': item['State']['StartedAt'], 'running': item['State']['Running']})
    if not all(item['running'] for item in result):
        raise ValueError('Protected service is not running')
    return result

def health(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ValueError('Health byte capacity')
    return json.loads(data)

def quiet(url):
    state = health(url)
    if state.get('busy') or any(state.get(key, -1) != 0 for key in ['consumers', 'readers', 'pins']) or state.get('counts', {}).get('building', -1) != 0:
        raise ValueError('Owned wall worker is not quiescent')
    return state

def paths(root, snapshot, restored):
    paths = [Path(p).absolute() for p in [root, snapshot, restored]]
    if any(p.is_symlink() or p.resolve() != p for p in paths):
        raise ValueError('Paths must be canonical without symlinks')
    root, snapshot, restored = paths
    if not root.is_dir() or snapshot.exists() or restored.exists():
        raise ValueError('Root required and copy targets must be absent')
    if any(a == b or a in b.parents or b in a.parents for i, a in enumerate(paths) for b in paths[i + 1:]):
        raise ValueError('Snapshot paths must be disjoint')
    if not snapshot.parent.is_dir() or not restored.parent.is_dir() or len({p.stat().st_dev for p in [root, snapshot.parent, restored.parent]}) != 1:
        raise ValueError('Snapshot paths must share the existing filesystem')
    return root, snapshot, restored

def drill(args):
    root, snapshot, restored = paths(args.root, args.snapshot, args.restored)
    protected = protected_identity()
    ids = [args.gateway, args.worker]
    if len(set(ids)) != 2 or any(not isinstance(i, str) or len(i) != 64 or any(c not in '0123456789abcdef' for c in i) for i in ids):
        raise ValueError('Exact full owned container IDs required')
    owned = [identity(i) for i in ids]
    if any(item['Id'] != expected or not item['State']['Running'] or item['Id'] in {p['id'] for p in protected} or not item['Name'].startswith('/iqterminal-wall-') for item, expected in zip(owned, ids)):
        raise ValueError('Owned container identity mismatch')
    worker_mounts = {m['Source']: m['Destination'] for m in owned[1]['Mounts']}
    if worker_mounts.get(str(root)) != '/wall-preparation':
        raise ValueError('Worker root mount mismatch')
    receipt_path = Path(args.receipt).absolute()
    if receipt_path.exists() or receipt_path.resolve() != receipt_path or not receipt_path.parent.is_dir() or any(p == receipt_path or p in receipt_path.parents for p in [root, snapshot, restored]):
        raise ValueError('Receipt must be a new canonical path outside derived copies')
    before = quiet(args.health)
    # This preflight is conservative; final inventory is taken only after stop.
    size = sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
    if size * 3 + 160 * 1024**2 > MAX_BYTES or shutil.disk_usage(root).free < MIN_FREE + size * 2:
        raise ValueError('Snapshot/restore storage headroom capacity')
    print(json.dumps({'phase': 'preflight', 'root': str(root), 'bytes': size, 'worker': args.worker, 'gateway': args.gateway, 'health': before, 'protected': protected}), flush=True)
    stopped = []
    try:
        # Stop admission before the owner. Do not remove a lock or force kill.
        for index, i in enumerate(ids):
            if index == 1:
                quiet(args.health)
            stopped.append(i)
            docker('kill', '--signal=SIGTERM', i)
            deadline = time.monotonic() + 45
            while identity(i)['State']['Running']:
                if time.monotonic() >= deadline:
                    raise ValueError('Graceful stop timed out; no lock removal or force kill')
                time.sleep(0.2)
            state = identity(i)['State']
            if state['Running'] or state['OOMKilled'] or state['ExitCode'] != 0:
                raise ValueError('Owned service did not stop cleanly')
        if any(root.rglob('running.lock')):
            raise ValueError('Owner lock remains after graceful stop')
        original = inventory(root)
        shutil.copytree(root, snapshot, copy_function=shutil.copy2)
        if inventory(snapshot) != original:
            raise ValueError('Snapshot checksum mismatch')
        shutil.copytree(snapshot, restored, copy_function=shutil.copy2)
        if inventory(restored) != original or inventory(root) != original:
            raise ValueError('Restored/root checksum mismatch')
        # Exact queue JSON must survive, as must every referenced derived file.
        queues = list(restored.glob('queue/*.json'))
        if not queues:
            raise ValueError('Restored queue metadata absent')
        for queue in queues:
            json.loads(queue.read_text())
        receipt = {'version': 1, 'root': str(root), 'snapshot': str(snapshot), 'restored': str(restored), 'files': original,
                   'worker': args.worker, 'gateway': args.gateway, 'protected': protected}
        Path(args.receipt).write_text(json.dumps(receipt, sort_keys=True) + '\n')
        print(json.dumps({'phase': 'restored', 'files': len(original), 'bytes': sum(x['bytes'] for x in original.values()), 'receipt': args.receipt}), flush=True)
    finally:
        # Restart only IDs stopped by this invocation, worker before admission.
        for i in reversed(stopped):
            if not identity(i)['State']['Running']:
                docker('start', i)
        if protected_identity() != protected:
            raise ValueError('Protected service identity/continuity changed')
    if not all(identity(i)['State']['Running'] for i in ids):
        raise ValueError('Owned service did not resume')
    deadline = time.monotonic() + 15
    while True:
        try:
            after = health(args.health)
            break
        except (OSError, ValueError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.2)
    if after.get('build') != before.get('build'):
        raise ValueError('Worker build changed during snapshot drill')
    print(json.dumps({'phase': 'resumed', 'worker': args.worker, 'gateway': args.gateway, 'health': after, 'protectedUnchanged': True}), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ['root', 'snapshot', 'restored', 'worker', 'gateway', 'health', 'receipt']:
        parser.add_argument('--' + field, required=True)
    drill(parser.parse_args())
