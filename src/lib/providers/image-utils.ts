import { ProviderError } from './errors';
import type { ImageResult } from './types';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function detectImageMime(bytes: Buffer): ImageResult['mime'] {
  if (bytes.length < 12) throw new ProviderError('bad_request', 'Generated file was not a valid image');
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  throw new ProviderError('bad_request', 'Generated file was not a supported image type');
}

export function assertImageBytes(bytes: Buffer): ImageResult['mime'] {
  if (bytes.length > MAX_IMAGE_BYTES) throw new ProviderError('bad_request', 'Generated image exceeded the 10 MB limit');
  return detectImageMime(bytes);
}

// 1x1 PNG fixture used by mock provider and host tests.
export function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XnP9QAAAAASUVORK5CYII=',
    'base64',
  );
}