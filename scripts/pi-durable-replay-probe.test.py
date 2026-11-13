"""Deterministic protocol assertions only; never touches staging."""
import base64,hashlib,importlib.util,json,socketserver,struct,threading,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('probe',Path(__file__).with_name('pi-durable-replay-probe.py'));probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
def exact(s,n):
 b=b''
 while len(b)<n:
  part=s.recv(n-len(b))
  if not part:raise EOFError()
  b+=part
 return b
def receive(s):
 a,b=exact(s,2);n=b&127
 if n==126:n=struct.unpack('!H',exact(s,2))[0]
 mask=exact(s,4);wire=exact(s,n);return json.loads(bytes(c^mask[i%4] for i,c in enumerate(wire)))
def send(s,data):
 p=json.dumps(data).encode();s.sendall(bytes([129,126])+struct.pack('!H',len(p))+p)
class ProtocolTest(unittest.TestCase):
 def run_case(self,mode):
  commands=[]
  class Handler(socketserver.BaseRequestHandler):
   def handle(self):
    self.request.settimeout(2);header=b''
    while not header.endswith(b'\r\n\r\n'):header+=exact(self.request,1)
    key=next(l.split(b': ',1)[1] for l in header.split(b'\r\n') if l.lower().startswith(b'sec-websocket-key:'))
    accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest());self.request.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n');commands.append(receive(self.request))
    after=10
    for i in range(4):
     cursor=after+1;row={'id':cursor if mode!='invalid-order' else after,'timeMs':100,'price':10,'quantity':2,'quoteNotional':20,'side':'buy'}
     send(self.request,{'type':'executions','version':1,'after':after,'cursor':cursor,'watermark':30,'executions':[row]})
     if mode=='invalid-order':break
     if i<3:
      commands.append(receive(self.request))
      if mode=='unconfirmed-ack':break
     after=cursor
  server=socketserver.TCPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.handle_request);thread.start()
  try:r=probe.replay('ws://127.0.0.1:%d/v1/stream'%server.server_address[1],{'name':'fixture','after':10,'from':100},seconds=2)
  finally:thread.join(3);server.server_close()
  return r,commands
 def test_confirmation_requires_next_after(self):
  r,c=self.run_case('valid');self.assertTrue(r['passed']);self.assertEqual(r['confirmedBatches'],3);self.assertEqual(c[0],{'type':'subscribe','version':1,'market':'perpetual','after':10,'from':100});self.assertEqual([x['cursor'] for x in c[1:]],[11,12,13])
 def test_send_ack_is_not_confirmation(self):
  r,c=self.run_case('unconfirmed-ack');self.assertFalse(r['passed']);self.assertEqual(r['confirmedBatches'],0);self.assertEqual(c[-1]['type'],'ack')
 def test_rejects_nonmonotonic_ids(self):
  r,c=self.run_case('invalid-order');self.assertFalse(r['passed']);self.assertEqual(r['receivedBatches'],0);self.assertEqual(len(c),1)
if __name__=='__main__':unittest.main()
