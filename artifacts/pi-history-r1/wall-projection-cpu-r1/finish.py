from pathlib import Path
import json,hashlib,subprocess,urllib.request,urllib.parse
root=Path('/home/daz/iqterminal-wall-serving-71f62d2-r1');out=Path('/home/daz/iq-wall-projection-cpu-r1/projection')
job={'id': '54b3cd7d6074c9c28c9580c04bd090c3089f72fae69a33e6dcb8c7ac12cb8cbf', 'request': {'market': 'perpetual', 'profile': 'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1', 'from': 1794210300000, 'to': 1794320100000}, 'lane': 'default', 'requestedAt': 1794320108167, 'updatedAt': 1794320310894, 'defaultOwned': True, 'rollingDefault': True, 'lastTurn': 10754, 'phase': 'ready', 'pages': 79, 'projectionPages': 79, 'parts': 79, 'projectionDecodedBytes': 45783780, 'projectionCompressedBytes': 3470529, 'after': 24768964, 'decodedBytes': 153664642, 'compressedBytes': 6721203, 'leased': True, 'paused': False, 'canonicalManifestReused': False, 'proof': {'market': 'perpetual', 'profile': 'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1', 'from': 1794210300000, 'to': 1794320100000, 'version': 1, 'kind': 'wall-source-sha256-xor-v1', 'watermark': 24768964, 'head': {'cursor': 24768964, 'epoch': 1794309145901, 'at': 1794320105210}, 'availableFrom': 1793506604584, 'anchor': {'cursor': 23684968, 'epoch': 1794186477126, 'at': 1794209881353, 'hash': '201782c838d14f390819896fc860152edc03648dac49903b3b126ed648402a5b'}, 'records': 95365, 'maxCursor': 24768906, 'hash': '35279183978654414703707566552061865247232632660407742344977509571585128793869', 'token': 'd9685c246b411fd5ffde761d1f6732a9cebfbcc3b2fbfe726fbf161c96aeabc6', 'eligible': True}, 'sourceKey': '0b605de942bfbffccf5664c69d8fcb85ef4375e8af3772d267d3f61940fb509f', 'coverage': {'status': 'partial', 'partial': True, 'availableFrom': 1793506604584, 'confirmedTo': 1794320100000, 'gapCount': 4, 'gapsTruncated': False, 'reason': 'Depth continuity gaps are present in the requested range'}, 'projectionManifestReused': False, 'projectionKey': '48a1e13b45500d12c1e1d2dad9cff4fe75802d133c050574dbfe01eb91f1e26a', 'doneAt': 1794320312142}
lease={'consumer':'projection-cpu-r1-finish','canonicalKey':job['sourceKey'],'projectionKey':job['projectionKey']}
def control(path,body):
 req=urllib.request.Request('http://127.0.0.1:18791'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 return json.loads(urllib.request.urlopen(req,timeout=5).read())
try:
 assert control('/retain',lease)['leaseMs']==15000
 original=root/'projections'/job['projectionKey'];actual=out/job['projectionKey']
 a=(actual/'progress.json').read_bytes();b=(original/'progress.json').read_bytes();assert a==b
 # Both are serialized JSON; optional undefined properties do not exist on wire.
 assert (actual/'manifest.json').read_bytes()==(original/'manifest.json').read_bytes()
 state=json.loads(a)
 for part in state['parts']:
  body=(actual/(part['hash']+'.json.gz')).read_bytes()
  assert len(body)==part['compressedBytes'] and hashlib.sha256(body).hexdigest()==part['compressedHash']
 with urllib.request.urlopen('http://127.0.0.1:18880/v2/history/walls/source?'+urllib.parse.urlencode(job['request']),timeout=20) as r:proof=json.loads(r.read());headers=dict(r.headers)
 assert proof['eligible'] and proof['token']==job['proof']['token']
 container=json.loads(subprocess.check_output(['docker','inspect','iqterminal-wall-projection-cpu-r1']))[0]
 assert not container['State']['Running'] and container['State']['ExitCode']==1
 print(json.dumps({'kind':'recovered-profile-validation','result':'serialized-checkpoint-manifest-parts-exact','source':proof,'headers':headers,'checkpointSha256':hashlib.sha256(a).hexdigest(),'checkpointBytes':len(a),'parts':len(state['parts']),'containerId':container['Id'],'profileBytes':Path('/home/daz/iq-wall-projection-cpu-r1/baseline.cpuprofile').stat().st_size,'harnessFailure':'In-memory undefined optional properties versus deserialized public manifest; complete private checkpoint byte comparison passed before the assertion. Corrected to serialized comparison; this read-only recovery verifies both files byte-for-byte.'}),flush=True)
finally:control('/release',{'consumer':lease['consumer']})
