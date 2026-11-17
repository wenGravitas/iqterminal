/** Retained-heap diagnostic for workers in an owned browser. Forced collection
 * is explicit and must stay outside loading/frame latency observations. */
export async function browserWorkerHeaps(browser,options={}) {
  const root=await browser.newBrowserCDPSession(),results=[];let sequence=0;
  async function command(sessionId,method,params,snapshotChunk){
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);root.off('Target.receivedMessageFromTarget',receive);};
      const timer=setTimeout(()=>{cleanup();reject(Error('Worker heap command expired: '+method));},method==='HeapProfiler.takeHeapSnapshot'?60000:5000);
      function receive(event){if(event.sessionId!==sessionId)return;const value=JSON.parse(event.message);
        if(snapshotChunk&&value.method==='HeapProfiler.addHeapSnapshotChunk'){try{snapshotChunk(value.params.chunk);}catch(error){cleanup();reject(error);}return;}
        if(value.id!==id)return;cleanup();value.error?reject(Error(value.error.message)):resolve(value.result);}
      root.on('Target.receivedMessageFromTarget',receive);
      void root.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,...(params?{params}:{})})}).catch(error=>{cleanup();reject(error);});
    });
  }
  try{
    const {targetInfos}=await root.send('Target.getTargets');
    for(const target of targetInfos.filter(t=>t.type==='worker')){
      const {sessionId}=await root.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
      try{
        await command(sessionId,'HeapProfiler.enable');
        if(options.collectGarbage!==false)await command(sessionId,'HeapProfiler.collectGarbage');
        let projectorOwners;
        if(options.queryProjectors){
          const objectGroup='iq-wall-retained-owner-probe';
          try{
            const prototype=await command(sessionId,'Runtime.evaluate',{expression:'Object.prototype',objectGroup});
            const objects=await command(sessionId,'Runtime.queryObjects',{prototypeObjectId:prototype.result.objectId,objectGroup});
            const inspected=await command(sessionId,'Runtime.callFunctionOn',{objectId:objects.objects.objectId,returnByValue:true,functionDeclaration:`function(){
              const owners=[];for(const object of this){const queue=Object.getOwnPropertyDescriptor(object,'valueRunQueue')?.value;
                if(Array.isArray(queue)){const segments=Object.getOwnPropertyDescriptor(object,'segments')?.value;
                  owners.push({queueLength:queue.length,segments:segments instanceof Map?segments.size:null});if(owners.length>32)throw Error('Projector owner capacity');}}
              return {enumeratedObjects:this.length,owners};
            }`});
            projectorOwners=inspected.result.value;
          }finally{await command(sessionId,'Runtime.releaseObjectGroup',{objectGroup});}
        }
        if(options.snapshotChunk)await command(sessionId,'HeapProfiler.takeHeapSnapshot',{reportProgress:false},chunk=>options.snapshotChunk(target,chunk));
        results.push({target,projectorOwners,heap:await command(sessionId,'Runtime.getHeapUsage')});
      }finally{await root.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}
    }
    return {forcedCollection:options.collectGarbage!==false||Boolean(options.queryProjectors)||Boolean(options.snapshotChunk),scope:'Owned-browser JavaScript heap; explicit collection, owner enumeration and snapshots are opt-in diagnostics outside paint timing. Not RSS or foreground acceptance.',workers:results};
  }finally{await root.detach();}
}
