import {test} from 'node:test';import assert from 'node:assert/strict';
import {finishResponseTraces} from './benchmark-traces.mjs';
test('a canceled response with an unresolved trace cannot prevent sample finalization',async()=>{
 const result=await finishResponseTraces([Promise.resolve(),new Promise(()=>{})],10);
 assert.deepEqual(result,{timedOut:true,taskCount:2});
});
test('completed and failed traces finish without retaining a cleanup timer',async()=>{
 const failed=Promise.reject(Error('context closed'));
 assert.deepEqual(await finishResponseTraces([Promise.resolve(),failed],1000),{timedOut:false,taskCount:2});
});
