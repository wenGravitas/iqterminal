import {test} from 'node:test';import assert from 'node:assert/strict';
import {finishResponseTraces,loadingObservationComplete} from './benchmark-traces.mjs';
test('a canceled response with an unresolved trace cannot prevent sample finalization',async()=>{
 const result=await finishResponseTraces([Promise.resolve(),new Promise(()=>{})],10);
 assert.deepEqual(result,{timedOut:true,taskCount:2});
});
test('completed and failed traces finish without retaining a cleanup timer',async()=>{
 const failed=Promise.reject(Error('context closed'));
 assert.deepEqual(await finishResponseTraces([Promise.resolve(),failed],1000),{timedOut:false,taskCount:2});
});

test('ready closed history cannot end a current-display observation before healthy current paint',()=>{
 assert.equal(loadingObservationComplete({currentCase:true,currentAt:null,completeAt:1823.5}),false);
 assert.equal(loadingObservationComplete({currentCase:true,currentAt:2070.1,completeAt:null}),true);
 assert.equal(loadingObservationComplete({currentCase:false,currentAt:null,completeAt:3638}),true);
 assert.equal(loadingObservationComplete({currentCase:false,currentAt:2070.1,completeAt:null}),false);
});
test('extended current observation remains active after both current and history paint',()=>{
 for(const currentCase of [true,false])assert.equal(loadingObservationComplete({currentCase,currentAt:2070.1,completeAt:3638,keepObserving:true}),false);
});
