import {test,expect} from 'vitest';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {WALL_PROJECTION_CORE_SHA256} from '../src/shared/order-walls-projection-version';
test('prepared projection compatibility identifies the exact portable financial algorithm',async()=>{
 const bytes=await readFile(new URL('../src/shared/order-walls-projection.ts',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(WALL_PROJECTION_CORE_SHA256);
});
