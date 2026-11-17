import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {browserWorkerHeaps} from './browser-worker-heaps.mjs';
function fixture(fail=false){
 const root=new EventEmitter(),calls=[];root.detach=async()=>calls.push('root-detach');
 root.send=async(method,params)=>{
  calls.push(method);
  if(method==='Target.getTargets')return {targetInfos:[{type:'page',targetId:'page'},{type:'worker',targetId:'worker'}]};
  if(method==='Target.attachToTarget'){assert.equal(params.targetId,'worker');return {sessionId:'owned-worker'};}
  if(method==='Target.sendMessageToTarget'){
   const message=JSON.parse(params.message);calls.push(message.method);
   queueMicrotask(()=>root.emit('Target.receivedMessageFromTarget',{sessionId:params.sessionId,message:JSON.stringify({id:message.id,...(fail&&message.method==='HeapProfiler.collectGarbage'?{error:{message:'GC unavailable'}}:{result:message.method==='Runtime.getHeapUsage'?{usedSize:123,totalSize:456}:{}})})}));
  }
  return {};
 };
 return {root,calls,browser:{newBrowserCDPSession:async()=>root}};
}
test('retained heap diagnostics target only owned dedicated workers and detach every session',async()=>{
 const f=fixture(),r=await browserWorkerHeaps(f.browser);assert.equal(r.forcedCollection,true);assert.equal(r.workers.length,1);assert.deepEqual(r.workers[0].heap,{usedSize:123,totalSize:456});
 assert.ok(f.calls.includes('HeapProfiler.collectGarbage'));assert.ok(f.calls.includes('Target.detachFromTarget'));assert.equal(f.calls.at(-1),'root-detach');assert.equal(f.root.listenerCount('Target.receivedMessageFromTarget'),0);
});
test('failed collection releases target, root and command listener',async()=>{
 const f=fixture(true);await assert.rejects(browserWorkerHeaps(f.browser),/GC unavailable/);assert.ok(f.calls.includes('Target.detachFromTarget'));assert.equal(f.calls.at(-1),'root-detach');assert.equal(f.root.listenerCount('Target.receivedMessageFromTarget'),0);
});
test('natural heap observation never forces collection',async()=>{
 const f=fixture(),r=await browserWorkerHeaps(f.browser,{collectGarbage:false});assert.equal(r.forcedCollection,false);
 assert.ok(!f.calls.includes('HeapProfiler.collectGarbage'));assert.equal(f.calls.at(-1),'root-detach');
});
