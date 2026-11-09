import {test,expect} from 'vitest';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {WALL_PROJECTION_CORE_SHA256,WALL_PROJECTION_SOURCE_SHA256} from '../src/shared/order-walls-projection-version';
test('portable source remains pinned separately from its equivalence-tested prepared checkpoint identity',async()=>{
 const bytes=await readFile(new URL('../src/shared/order-walls-projection.ts',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(WALL_PROJECTION_SOURCE_SHA256);
 expect(WALL_PROJECTION_CORE_SHA256).toBe('c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c');
});
