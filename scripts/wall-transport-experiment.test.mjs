import test from 'node:test';
import assert from 'node:assert/strict';
import {selectWallTransport} from './wall-transport-experiment.mjs';

test('canonical experiment removes only optional transport capabilities', () => {
  const input={state:'ready',manifest:{key:'canonical'},source:{token:'proof'},eligibility:{request:{from:1,to:2}},projection:{manifest:{parts:[{hash:'exact'}],active:{segments:[{quantity:'0.123456789'}]}},delivery:{version:1,maxParts:32,maxDecodedBytes:8388608,pointTransport:1,productTransport:1}}};
  const original=structuredClone(input),out=selectWallTransport(input,'canonical');
  assert.deepEqual(input,original);
  assert.deepEqual(out,{...input,projection:{...input.projection,delivery:{version:1,maxParts:32,maxDecodedBytes:8388608}}});
  assert.equal(out.projection.manifest,input.projection.manifest);
  assert.equal(out.source,input.source);
  assert.equal(selectWallTransport(input,'product'),input);
  const point=selectWallTransport(input,'point');
  assert.equal(point.projection.manifest,input.projection.manifest);
  assert.deepEqual(point.projection.delivery,{version:1,maxParts:32,maxDecodedBytes:8388608,pointTransport:1});
});
test('building work is unchanged and unsupported experiment fails explicitly', () => {
  const building={state:'building',job:{id:'same'}};
  assert.equal(selectWallTransport(building,'canonical'),building);
  assert.throws(()=>selectWallTransport({},'bogus'),/Unknown/);
  assert.throws(()=>selectWallTransport({projection:{delivery:{version:1}}},'canonical'),/product-capable/);
});
