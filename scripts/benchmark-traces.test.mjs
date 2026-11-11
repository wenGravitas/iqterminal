import {test} from 'node:test';import assert from 'node:assert/strict';
import {finishResponseTraces,loadingObservationComplete,nativeClosedCoverage} from './benchmark-traces.mjs';
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

test('wall history observation stays open until native closed coverage is inspected',()=>{
 assert.equal(loadingObservationComplete({currentCase:false,currentAt:null,completeAt:2500,coverageReady:false}),false);
 assert.equal(loadingObservationComplete({currentCase:true,currentAt:1200,completeAt:null,coverageReady:false}),true);
});
test('native coverage cannot hide a missing interior candle behind endpoints, extra bars or a forming bar',()=>{
 const range={from:60000,to:360000},step=60000,closed=300000;
 assert.deepEqual(nativeClosedCoverage([0,60000,120000,240000,300000,360000],range,step,closed),{valid:false,capacityLimited:false,from:60000,to:300000,requestedSlots:4,loadedSlots:3,missing:[180000]});
 assert.equal(nativeClosedCoverage([60000,120000,180000,240000],range,step,closed).valid,true);
 assert.equal(nativeClosedCoverage([],{from:0,to:10000*step},step,10000*step).capacityLimited,true);
});

test('future whitespace leaves five eligible closed slots and requires independent forming paint',()=>{
 const hour=3600000,range={from:11*hour,to:19*hour},closed=16*hour;
 assert.deepEqual(nativeClosedCoverage([11,12,13,14,15].map(h=>h*hour),range,hour,closed),{valid:true,capacityLimited:false,from:11*hour,to:16*hour,requestedSlots:5,loadedSlots:5,missing:[]});
 assert.equal(loadingObservationComplete({currentCase:true,requireCurrentAndHistory:true,currentAt:null,completeAt:2200}),false);
 assert.equal(loadingObservationComplete({currentCase:true,requireCurrentAndHistory:true,currentAt:1800,completeAt:null}),false);
 assert.equal(loadingObservationComplete({currentCase:true,requireCurrentAndHistory:true,currentAt:1800,completeAt:2200}),true);
});
