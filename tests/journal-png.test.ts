import { expect,it } from 'vitest';
import { validatePng } from '../src/journal/png';
import { pngBytes } from './helpers/journal';
it('rejects truncated, oversized and mislabeled PNG imports before decoding',()=>{const png=pngBytes();expect(()=>validatePng(png)).not.toThrow();expect(()=>validatePng(png.subarray(0,40))).toThrow();const large=png.slice();new DataView(large.buffer).setUint32(16,100000);expect(()=>validatePng(large)).toThrow(/megapixel/);expect(()=>validatePng(new Uint8Array([...png,0]))).toThrow(/trailing/);});
