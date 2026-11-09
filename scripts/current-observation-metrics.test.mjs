import test from 'node:test';
import assert from 'node:assert/strict';
import {completedObservation,observationMetric} from './current-observation-metrics.mjs';
const sample=()=>({observationMs:20000,measurement:{observeStart:100,now:20100,maxReceiveGapMs:1000}});
test('complete measured interval is eligible',()=>{assert.equal(completedObservation(sample()),true);assert.equal(observationMetric(sample(),m=>m.maxReceiveGapMs),1000);});
test('finite startup measurements cannot hide a failed or missing observation',()=>{
 for(const change of [s=>s.error='no ACK',s=>delete s.measurement.observeStart,s=>s.measurement.now=20099,s=>s.observationMs=NaN,s=>s.measurement=null]){
  const s=sample();change(s);assert.equal(completedObservation(s),false);assert.equal(observationMetric(s,()=>{throw Error('must not read incomplete interval');}),null);
 }
});
