/** Worker-side canonical execution/ACK evidence, independent of a live badge,
 * historical completion and callback coalescing. This is not chart latency or
 * a causal claim about current freshness under all background workloads. */
export function currentExecutionProof(sample){
 const before=sample.baselineExecutionProof,after=sample.currentExecutionProof,failures=[];
 const counts=['socketStarts','disconnects','errors','resets','appliedBatches','appliedExecutions','acksSent','confirmedAckBatches','sourceCursorJumps'];
 const valid=p=>p&&Number.isSafeInteger(p.generation)&&p.generation>0&&counts.every(k=>Number.isSafeInteger(p[k])&&p[k]>=0)&&['lastAfter','lastAppliedCursor','lastConfirmedAckCursor'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=0);
 if(!valid(before)||!valid(after))return {pass:false,failures:['missing or invalid worker execution proof']};
 const applied=after.appliedBatches-before.appliedBatches,confirmed=after.confirmedAckBatches-before.confirmedAckBatches;
 if(after.generation!==before.generation||counts.some(k=>after[k]<before[k]))failures.push('counter regressed or stream identity replaced');
 if(before.confirmedAckBatches<1||before.errors||before.resets||before.disconnects)failures.push('baseline stream not independently healthy and confirmed');
 if(applied<=0||after.appliedExecutions-before.appliedExecutions<applied||confirmed<1||confirmed>applied||after.acksSent-before.acksSent!==applied)failures.push('no advancing validated execution and ACK chain');
 if(after.socketStarts!==before.socketStarts||after.errors!==before.errors||after.resets!==before.resets||after.disconnects!==before.disconnects)failures.push('stream restarted, failed or reset during observation');
 if(after.lastAppliedCursor<=before.lastAppliedCursor||after.lastAfter<before.lastAppliedCursor||after.lastAppliedCursor<=after.lastAfter||after.lastConfirmedAckCursor!==after.lastAfter)failures.push('cursor/confirmed ACK did not advance consistently');
 if(after.sourceCursorJumps!==before.sourceCursorJumps)failures.push('explicit source execution cursor jump; performance attribution required');
 if(!sample.currentExecutionConnected)failures.push('execution socket not connected at observation');
 const states=sample.measurement?.states?.filter(s=>s.at>=sample.measurement.observeStart)??[];
 // The incumbent 'reconnecting' enum also means a connected stream replaying
 // toward a newer durable watermark. Report it; counters must prove continuity
 // independently. Do not mistake that state alone for a socket reconnection.
 const catchingUpStatuses=states.filter(s=>s.state==='reconnecting').length;
 if(states.some(s=>s.state!=='live'&&s.state!=='reconnecting'))failures.push('loading/stale/failed current status during observation');
 return {pass:failures.length===0,failures,catchingUpStatuses,appliedBatches:applied,appliedExecutions:after.appliedExecutions-before.appliedExecutions,confirmedAckBatches:confirmed,fromCursor:before.lastAppliedCursor,toCursor:after.lastAppliedCursor,confirmedThrough:after.lastConfirmedAckCursor,sourceCursorJumps:after.sourceCursorJumps-before.sourceCursorJumps,maxWorkerApplyMs:after.maxApplyMs,maxWorkerLifetimeReceiptGapMs:after.maxReceiptGapMs};
}

/** The independent forming candle may paint at the right boundary. Account for
 * every requested closed slot without treating that live candle as history. */
export function closedFootprintProof(times,progress,from,to,step){
 const expected=Array.from({length:(to-from)/step},(_,i)=>(from+i*step)/1000);
 const eligible=times.filter(t=>t*1000>=from&&t*1000<to),outside=times.filter(t=>t*1000<from||t*1000>=to);
 return {expectedSlots:expected.length,paintedSlots:eligible.length,allPaintedSlots:times.length,outsideRequestedTimes:outside,
  validatedSlots:progress?.validatedSlots??0,exact:JSON.stringify(eligible)===JSON.stringify(expected)&&progress?.requestedSlots===expected.length&&progress.loadedSlots===expected.length&&progress.validatedSlots===expected.length};
}

/** Viewport rounding can request an extra edge candle. Prove each pinned slot
 * from explicit interval records instead of requiring identical outer bounds.
 * Missing, building, conflicting or unvalidated slots cannot pass. */
export function requestedFootprintProgress(ranges,from,to,step){
 const expected=Array.from({length:(to-from)/step},(_,i)=>from+i*step);
 const slots=expected.map(start=>{
  const entries=ranges.flatMap(range=>range.from<=start&&range.to>=start+step
   ?(range.progress?.slots??[]).filter(slot=>slot.from===start&&slot.to===start+step).map(slot=>({...slot,capacityLimited:range.progress?.capacityLimited})):[]);
  const loaded=entries.length>0&&entries.every(slot=>slot.state==='ready'&&!slot.capacityLimited);
  return {from:start,to:start+step,loaded,validated:loaded&&entries.every(slot=>slot.validated===true)};
 });
 return {requestedSlots:expected.length,loadedSlots:slots.filter(s=>s.loaded).length,validatedSlots:slots.filter(s=>s.validated).length,slots};
}
