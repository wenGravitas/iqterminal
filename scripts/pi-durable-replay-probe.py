"""Read-only finite WS replay probe, stdlib only. Stores metadata, never executions."""
import argparse,base64,hashlib,json,math,os,socket,struct,time,urllib.parse

def replay(url,case,seconds=60,target=3):
 start=time.monotonic();end=start+min(seconds,60);events=[];state='CONNECTING';sock=None;buffer=b'';fragments=bytearray();opcode0=None;after=case['after'];pending=None;received=0;confirmed=0;last_message=start;digest=hashlib.sha256()
 def log(event,**kw):events.append({'event':event,'ms':(time.monotonic()-start)*1000,'readyState':state,**kw})
 def exact(n):
  nonlocal buffer
  threshold=65536
  while len(buffer)<n:
   sock.settimeout(max(.001,min(end-time.monotonic(),last_message+15-time.monotonic())));part=sock.recv(min(65536,n-len(buffer)))
   if not part:raise EOFError('TCP EOF')
   buffer+=part
   if n>65536 and len(buffer)>=threshold:log('receive-progress',receivedBytes=len(buffer),declaredBytes=n);threshold+=65536
  r,buffer=buffer[:n],buffer[n:];return r
 def send(op,payload):
  mask=os.urandom(4);n=len(payload);head=bytes([0x80|op,0x80|n]) if n<126 else bytes([0x80|op,0x80|126])+struct.pack('!H',n)
  sock.sendall(head+mask+bytes(c^mask[i%4] for i,c in enumerate(payload)))
 try:
  u=urllib.parse.urlsplit(url);assert u.scheme=='ws';key=base64.b64encode(os.urandom(16)).decode();log('attempt',url=url)
  sock=socket.create_connection((u.hostname,u.port or 80),timeout=min(15,max(.1,end-time.monotonic())))
  sock.sendall((f'GET {u.path or "/"}{"?"+u.query if u.query else ""} HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1:4202\r\nX-IQ-Request-Id: pi-replay-history-r3-{case["name"]}\r\n\r\n').encode())
  while b'\r\n\r\n' not in buffer:
   sock.settimeout(min(15,max(.001,end-time.monotonic())));b=sock.recv(8192)
   if not b:raise EOFError('EOF before handshake')
   buffer+=b;assert len(buffer)<=65536
  header,buffer=buffer.split(b'\r\n\r\n',1);lines=header.decode().split('\r\n');assert ' 101 ' in lines[0],lines[0];headers=dict(l.split(': ',1) for l in lines[1:] if ': ' in l);expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode();assert any(k.lower()=='sec-websocket-accept' and v==expected for k,v in headers.items())
  state='OPEN';log('open');sub={'type':'subscribe','version':1,'market':'perpetual','after':after,'from':case['from']};send(1,json.dumps(sub).encode());log('subscription-send',after=after,fromMs=case['from'])
  while time.monotonic()<end:
   a,b=exact(2);fin=bool(a&128);op=a&15;n=b&127
   if n==126:n=struct.unpack('!H',exact(2))[0]
   elif n==127:n=struct.unpack('!Q',exact(8))[0]
   assert n<=2*1024*1024,'Bounded frame capacity';
   if op in [0,1]:log('frame-start',opcode=op,declaredBytes=n,final=fin)
   mask=exact(4) if b&128 else None;payload=exact(n)
   if mask:payload=bytes(c^mask[i%4] for i,c in enumerate(payload))
   if op==9:send(10,payload);log('ping',bytes=n);continue
   if op==10:continue
   if op==8:state='CLOSED';log('close',code=struct.unpack('!H',payload[:2])[0] if n>=2 else None,reason=payload[2:].decode(errors='replace'));break
   assert op in [0,1],op
   if op==1:assert not fragments;opcode0=op
   fragments.extend(payload);assert len(fragments)<=2*1024*1024
   if not fin:continue
   encoded=bytes(fragments);fragments.clear();last_message=time.monotonic();message=json.loads(encoded);kind=message.get('type')
   if kind=='health':log('health',watermark=(message.get('watermark') or {}).get('id'),collectorState=(message.get('collector') or {}).get('state'));continue
   if kind=='reset':log('reset',reason=message.get('reason'));break
   assert kind=='executions' and message.get('version')==1 and message['after']==after and message['cursor']>after and message['watermark']>=message['cursor']
   rows=message['executions'];assert 0<len(rows)<=1000;prior=after
   for row in rows:
    assert isinstance(row['id'],int) and row['id']>prior and all(math.isfinite(row[k]) for k in ['timeMs','price','quantity','quoteNotional']) and row['price']>0 and row['quantity']>0 and row['side'] in ['buy','sell'];prior=row['id']
   digest.update(json.dumps([[r[k] for k in ['id','timeMs','price','quantity','quoteNotional','side']] for r in rows],separators=(',',':')).encode());assert prior==message['cursor'];assert all(r['timeMs']>=case['from'] for r in rows)
   if pending is not None:assert message['after']==pending;confirmed+=1;log('ack-accepted',cursor=pending,confirmedBatches=confirmed)
   received+=1;log('execution-message',encodedBytes=len(encoded),count=len(rows),after=message['after'],cursor=message['cursor'],watermark=message['watermark']);after=message['cursor'];log('validation-complete',cursor=after)
   if confirmed>=target:log('finite-target-complete',receivedBatches=received,confirmedBatches=confirmed);break
   send(1,json.dumps({'type':'ack','version':1,'cursor':after}).encode());pending=after;log('ack-send',cursor=after)
 except Exception as e:
  if isinstance(e,TimeoutError) and time.monotonic()-last_message>=15:log('watchdog',reason='No complete message within existing15s client watchdog')
  log('error',category=type(e).__name__,detail=str(e))
 finally:
  if sock:
   try:
    if state=='OPEN':send(8,struct.pack('!H',1000));state='CLOSING';log('client-close',code=1000)
   except Exception:pass
   sock.close()
 return {'case':case,'url':url,'observationLimitMs':min(seconds,60)*1000,'elapsedMs':(time.monotonic()-start)*1000,'receivedBatches':received,'confirmedBatches':confirmed,'targetConfirmedBatches':target,'financialSequenceHash':digest.hexdigest(),'passed':confirmed>=target,'events':events}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('case');p.add_argument('--seconds',type=int,default=60);a=p.parse_args();print(json.dumps(replay(a.url,json.loads(a.case),a.seconds)))
