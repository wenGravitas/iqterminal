/** Worker-side canonical execution/ACK evidence, independent of a live badge,
 * historical completion and callback coalescing. This is not chart latency or
 * a causal claim about current freshness under all background workloads. */
export function currentExecutionProof(sample){
 const before=sample.baselineExecutionProof,after=sample.currentExecutionProof,failures=[];
 const counts=['socketStarts','disconnects','errors','resets','appliedBatches','appliedExecutions','acksSent','confirmedAckBatches','sourceCursorJumps'];
 const valid=p=>p&&counts.every(k=>Number.isSafeInteger(p[k])&&p[k]>=0)&&['lastAfter','lastAppliedCursor','lastConfirmedAckCursor'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=0);
 if(!valid(before)||!valid(after))return {pass:false,failures:['missing or invalid worker execution proof']};
 const applied=after.appliedBatches-before.appliedBatches,confirmed=after.confirmedAckBatches-before.confirmedAckBatches;
 if(counts.some(k=>after[k]<before[k]))failures.push('counter regressed or stream identity replaced');
 if(before.confirmedAckBatches<1||before.errors||before.resets||before.disconnects)failures.push('baseline stream not independently healthy and confirmed');
 if(applied<=0||after.appliedExecutions-before.appliedExecutions<applied||confirmed<1||confirmed>applied||after.acksSent-before.acksSent!==applied)failures.push('no advancing validated execution and ACK chain');
 if(after.socketStarts!==before.socketStarts||after.errors!==before.errors||after.resets!==before.resets||after.disconnects!==before.disconnects)failures.push('stream restarted, failed or reset during observation');
 if(after.lastAppliedCursor<=before.lastAppliedCursor||after.lastAfter<before.lastAppliedCursor||after.lastAppliedCursor<=after.lastAfter||after.lastConfirmedAckCursor!==after.lastAfter)failures.push('cursor/confirmed ACK did not advance consistently');
 if(after.sourceCursorJumps!==before.sourceCursorJumps)failures.push('explicit source execution cursor jump; performance attribution required');
 if(!sample.currentExecutionConnected)failures.push('execution socket not connected at observation');
 const nonlive=sample.measurement?.states?.filter(s=>s.at>=sample.measurement.observeStart&&s.state!=='live')??[];
 if(nonlive.length)failures.push('non-live current status during observation');
 return {pass:failures.length===0,failures,appliedBatches:applied,appliedExecutions:after.appliedExecutions-before.appliedExecutions,confirmedAckBatches:confirmed,fromCursor:before.lastAppliedCursor,toCursor:after.lastAppliedCursor,confirmedThrough:after.lastConfirmedAckCursor,sourceCursorJumps:after.sourceCursorJumps-before.sourceCursorJumps,maxWorkerApplyMs:after.maxApplyMs,maxWorkerLifetimeReceiptGapMs:after.maxReceiptGapMs};
}
