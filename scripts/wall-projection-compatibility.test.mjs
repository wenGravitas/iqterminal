import test from 'node:test';import assert from 'node:assert/strict';
import {wallProjectionCompatibility} from './wall-projection-compatibility.mjs';
test('only the exact equivalence-tested scheduling source retains the prepared format identity',()=>{
 const source='101dfc7cf817d6c0a4b28fa264842100053f507b2d5e41f98fa917700a073383',prior='c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c';
 assert.equal(wallProjectionCompatibility(source),prior);assert.equal(wallProjectionCompatibility(prior),prior);
 const changed='0'+source.slice(1);assert.equal(wallProjectionCompatibility(changed),changed);
 assert.equal(wallProjectionCompatibility('a'.repeat(64)),'a'.repeat(64));
 assert.throws(()=>wallProjectionCompatibility('not-a-checksum'),/checksum/);
});
