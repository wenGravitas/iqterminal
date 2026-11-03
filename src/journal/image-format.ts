import type { JournalImageMime } from './model';
import { validatePng } from './png';

/** Identify the supported raster formats from their file signatures before storage or import. */
export function imageMimeFromBytes(bytes: Uint8Array): JournalImageMime {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  throw Error('Journal attachments must be PNG, JPEG, or WebP images');
}

export function validateImageBytes(bytes: Uint8Array, mime: string) {
  const actual = imageMimeFromBytes(bytes);
  if (actual !== mime) throw Error('Journal image content does not match its declared MIME type');
  if (bytes.byteLength <= 0 || bytes.byteLength > 20 * 1024 * 1024) throw Error('Journal image exceeds the 20 MB asset limit');
  if (actual === 'image/png') validatePng(bytes);
  else if (actual === 'image/jpeg') validateJpegHeader(bytes);
  else validateWebpHeader(bytes);
}

function validateDimensions(width: number, height: number) {
  if (!width || !height || width > 16384 || height > 16384 || width * height > 32_000_000) throw Error('Journal image exceeds the 32 megapixel image limit');
}

function validateJpegHeader(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw Error('Journal JPEG is truncated');
  let offset = 2, dimensions: { width: number; height: number } | undefined, scan = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw Error('Malformed JPEG marker header');
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) throw Error('Truncated JPEG marker');
    const marker = bytes[offset++]!;
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw Error('Truncated JPEG segment length');
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) throw Error('Truncated JPEG segment');
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof) {
      if (length < 8) throw Error('Malformed JPEG frame header');
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!, width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      validateDimensions(width, height); dimensions = { width, height };
    }
    offset += length;
    if (marker === 0xda) { scan = true; break; }
  }
  if (!dimensions || !scan || !completeJpegScan(bytes, offset)) throw Error('JPEG is missing a complete frame or scan header');
}

function completeJpegScan(bytes: Uint8Array, offset: number) {
  let scanData = 0;
  for (let index = offset; index + 1 < bytes.length; index++) {
    if (bytes[index] !== 0xff) { scanData++; continue; }
    const marker = bytes[index + 1]!;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) { scanData++; index++; continue; }
    if (marker === 0xd9) return scanData > 0;
    if (marker === 0xff) continue;
  }
  return false;
}

function validateWebpHeader(bytes: Uint8Array) {
  if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') throw Error('Journal WebP is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(4, true) + 8;
  if (declaredSize !== bytes.length) throw Error('WebP RIFF size does not match its content');
  let offset = 12, hasImage = false, dimensions: { width: number; height: number } | undefined;
  while (offset < declaredSize) {
    if (offset + 8 > declaredSize) throw Error('Truncated WebP chunk header');
    const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4)), size = view.getUint32(offset + 4, true), payload = offset + 8, end = payload + size, paddedEnd = end + (size & 1);
    if (end > declaredSize || paddedEnd > declaredSize) throw Error('Truncated WebP chunk');
    if (kind === 'VP8X') {
      if (size < 10) throw Error('Truncated WebP extended header');
      const width = 1 + bytes[payload + 4]! + (bytes[payload + 5]! << 8) + (bytes[payload + 6]! << 16);
      const height = 1 + bytes[payload + 7]! + (bytes[payload + 8]! << 8) + (bytes[payload + 9]! << 16);
      validateDimensions(width, height); dimensions = { width, height };
    } else if (kind === 'VP8 ') {
      if (size < 10 || bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) throw Error('Malformed WebP lossy frame header');
      const width = ((bytes[payload + 6]! | (bytes[payload + 7]! << 8)) & 0x3fff), height = ((bytes[payload + 8]! | (bytes[payload + 9]! << 8)) & 0x3fff);
      validateDimensions(width, height); dimensions ??= { width, height }; hasImage = true;
    } else if (kind === 'VP8L') {
      if (size < 5 || bytes[payload] !== 0x2f) throw Error('Malformed WebP lossless frame header');
      const width = 1 + bytes[payload + 1]! + ((bytes[payload + 2]! & 0x3f) << 8);
      const height = 1 + (bytes[payload + 2]! >> 6) + (bytes[payload + 3]! << 2) + ((bytes[payload + 4]! & 0x0f) << 10);
      validateDimensions(width, height); dimensions ??= { width, height }; hasImage = true;
    }
    offset = paddedEnd;
  }
  if (!hasImage || !dimensions || offset !== declaredSize) throw Error('WebP is missing a complete image frame');
}
