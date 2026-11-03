import { describe, expect, it } from 'vitest';
import { imageMimeFromBytes, validateImageBytes } from '../src/journal/image-format';
import { imageAsset } from '../src/journal/repository';
import { pngBytes } from './helpers/journal';

function jpeg(width: number, height: number) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}
function webp(widthBytes: [number, number, number], heightBytes: [number, number]) {
  const bytes = new Uint8Array(26), view = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0); view.setUint32(4, 18, true); bytes.set([87, 69, 66, 80], 8);
  bytes.set([86, 80, 56, 76], 12); view.setUint32(16, 5, true);
  bytes.set([0x2f, widthBytes[0], widthBytes[1], heightBytes[0], heightBytes[1]], 20);
  return bytes;
}

describe('bounded journal image headers', () => {
  it('accepts a complete JPEG frame header and rejects truncation or oversized dimensions', () => {
    const bytes = jpeg(640, 480);
    expect(imageMimeFromBytes(bytes)).toBe('image/jpeg'); expect(() => validateImageBytes(bytes, 'image/jpeg')).not.toThrow();
    expect(() => validateImageBytes(bytes.subarray(0, 20), 'image/jpeg')).toThrow(/truncated|complete frame/i);
    expect(() => validateImageBytes(bytes.subarray(0, bytes.length - 2), 'image/jpeg')).toThrow(/complete frame/i);
    expect(() => validateImageBytes(jpeg(8192, 8192), 'image/jpeg')).toThrow(/32 megapixel/);
  });

  it('accepts complete WebP dimensions and rejects RIFF truncation or oversized frames', () => {
    const bytes = webp([0, 0, 0], [0, 0]);
    expect(imageMimeFromBytes(bytes)).toBe('image/webp'); expect(() => validateImageBytes(bytes, 'image/webp')).not.toThrow();
    expect(() => validateImageBytes(bytes.subarray(0, 25), 'image/webp')).toThrow(/RIFF size/);
    expect(() => validateImageBytes(webp([255, 63, 0], [255, 15]), 'image/webp')).toThrow(/32 megapixel/);
  });

  it('builds normalized asset metadata from supported content and rejects MIME or dimension mismatches', async () => {
    const valid = await imageAsset('jpeg-image', new Blob([jpeg(640, 480)], { type: 'image/jpeg' }));
    expect(valid).toMatchObject({ id: 'jpeg-image', mime: 'image/jpeg', bytes: valid.blob.size, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect((await imageAsset('png-image', new Blob([pngBytes()], { type: 'image/png' }))).mime).toBe('image/png');
    expect((await imageAsset('webp-image', new Blob([webp([0, 0, 0], [0, 0])], { type: 'image/webp' }))).mime).toBe('image/webp');
    await expect(imageAsset('mislabeled-image', new Blob([jpeg(640, 480)], { type: 'image/png' }))).rejects.toThrow(/content does not match/);
    await expect(imageAsset('oversized-image', new Blob([jpeg(8192, 8192)], { type: 'image/jpeg' }))).rejects.toThrow(/32 megapixel/);
  });
});
