/** Opt-in sampling of workers in this owned browser only. No worker is paused,
 * no execution/source is replaced, and profiled runs are not latency acceptance.
 */
export async function profileBrowserWorkers(browser){
 const root=await browser.newBrowserCDPSession(),sessions=new Map(),pending=new Set();let sequence=0;
 async function command(sessionId,method){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);root.off('Target.receivedMessageFromTarget',receive);};
   const timer=setTimeout(()=>{cleanup();reject(Error('Worker profiler command expired: '+method));},5000);
   function receive(event){if(event.sessionId!==sessionId)return;const value=JSON.parse(event.message);if(value.id!==id)return;cleanup();value.error?reject(Error(value.error.message)):resolve(value.result);}
   root.on('Target.receivedMessageFromTarget',receive);
   void root.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method})}).catch(error=>{cleanup();reject(error);});
  });
 }
 function created({targetInfo}){
  if(targetInfo.type!=='worker'||sessions.has(targetInfo.targetId))return;
  const record={target:targetInfo,observedAt:performance.now()};sessions.set(targetInfo.targetId,record);
  const setup=(async()=>{try{
   const {sessionId}=await root.send('Target.attachToTarget',{targetId:targetInfo.targetId,flatten:false});record.sessionId=sessionId;
   await command(sessionId,'Profiler.enable');await command(sessionId,'Profiler.start');record.startedAt=performance.now();
  }catch(error){record.error=String(error);}})();pending.add(setup);void setup.finally(()=>pending.delete(setup));
 }
 root.on('Target.targetCreated',created);await root.send('Target.setDiscoverTargets',{discover:true});
 return {async stop(){
  root.off('Target.targetCreated',created);await Promise.all([...pending]);const results=[];
  try{for(const record of sessions.values()){
   try{if(record.startedAt){const {profile}=await command(record.sessionId,'Profiler.stop');record.stoppedAt=performance.now();record.profile=profile;}}
   catch(error){record.error=String(error);}
   finally{if(record.sessionId)await root.send('Target.detachFromTarget',{sessionId:record.sessionId}).catch(()=>{});}
   results.push(record);
  }return {scope:'Owned-browser dedicated-worker CPU sampling. No pause or source substitution. Observer clocks and worker profile clocks are separate; samples add overhead and are not loading acceptance. Initial attachment may miss early startup.',results};}
  finally{await root.detach();}
 }};
}
