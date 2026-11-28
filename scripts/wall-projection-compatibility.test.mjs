import test from 'node:test';import assert from 'node:assert/strict';
import {wallProjectionCompatibility} from './wall-projection-compatibility.mjs';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
test('only the exact equivalence-tested scheduling source retains the prepared format identity',()=>{
 const source='101dfc7cf817d6c0a4b28fa264842100053f507b2d5e41f98fa917700a073383',prior='c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c';
 assert.equal(wallProjectionCompatibility(source),prior);assert.equal(wallProjectionCompatibility(prior),prior);
 assert.equal(wallProjectionCompatibility('1a86cb47e20943c9c71f4614e267abe22ae507c84834cd184559ff97df041c73'),prior);
 assert.equal(wallProjectionCompatibility('9503052a3756b3c5b1432e97e4e321269c686b6f92b91a64bf7a7a79395497b1'),prior);
 const changed='0'+source.slice(1);assert.equal(wallProjectionCompatibility(changed),changed);
 assert.equal(wallProjectionCompatibility('a'.repeat(64)),'a'.repeat(64));
 assert.throws(()=>wallProjectionCompatibility('not-a-checksum'),/checksum/);
});
test('validation-only API preserves the financial core apart from the reviewed aggregation type widening',()=>{
 const source=readFileSync(new URL('../src/shared/order-walls-projection.ts',import.meta.url),'utf8');
 const start=source.indexOf('  /** Validate a progressive presentation'),end=source.indexOf('  private static *restoreCheckpointSteps',start);
 assert.ok(start>=0&&end>start);
 // 1dfddf7 widened this TypeScript-only profile declaration to match numeric
 // aggregation metadata. Normalize only that reviewed declaration; retain the
 // original checksum for every executable byte of the financial projector.
 const stripped=source.slice(0,start)+source.slice(end);
 assert.equal(stripped.match(/^  aggregation: string \| number;$/gm)?.length,1);
 const incumbent=stripped.replace(/^  aggregation: string \| number;$/m,'  aggregation: string;');
 assert.equal(createHash('sha256').update(incumbent).digest('hex'),'101dfc7cf817d6c0a4b28fa264842100053f507b2d5e41f98fa917700a073383');
});
