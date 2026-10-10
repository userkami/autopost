import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  request: vi.fn(),
}));

import { CloudinaryHost } from '@/lib/imagehosts/cloudinary';
import { cloudinaryConfigSchema, imgbbConfigSchema } from '@/lib/imagehosts/config';
import { ImgbbHost } from '@/lib/imagehosts/imgbb';
import { MockImageHost } from '@/lib/imagehosts/mock';
import { getImageHost } from '@/lib/imagehosts/registry';
import { mockedRequest, queueResponses } from './http-mock';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XnP9QAAAAASUVORK5CYII=',
  'base64',
);

beforeEach(() => mockedRequest.mockReset());

describe('image hosts (PLAN.md §9, §17 Phase 2 acceptance)', () => {
  it('imgbb uploads base64 and prefers display_url', async () => {
    queueResponses({
      text: JSON.stringify({
        success: true,
        status: 200,
        data: { url: 'https://i.ibb.co/a.png', display_url: 'https://i.ibb.co/b.png' },
      }),
    });
    const host = new ImgbbHost({ apiKey: 'key' });
    await expect(host.upload({ bytes: PNG, mime: 'image/png', filename: 'a.png' })).resolves.toEqual({
      url: 'https://i.ibb.co/b.png',
    });
  });

  it('imgbb surfaces a failure as a provider error', async () => {
    queueResponses({ text: JSON.stringify({ success: false, status: 400, error: { message: 'bad key' } }) });
    await expect(
      new ImgbbHost({ apiKey: 'key' }).upload({ bytes: PNG, mime: 'image/png', filename: 'a.png' }),
    ).rejects.toThrow(/bad key/i);
  });

  it('Cloudinary unsigned uploads return secure_url', async () => {
    queueResponses({ text: JSON.stringify({ secure_url: 'https://res.cloudinary.com/x/a.png', public_id: 'a' }) });
    const host = new CloudinaryHost({ cloudName: 'x', uploadPreset: 'preset' });
    await expect(host.upload({ bytes: PNG, mime: 'image/png', filename: 'a.png' })).resolves.toMatchObject({
      url: 'https://res.cloudinary.com/x/a.png',
      publicId: 'a',
    });
  });

  it('Cloudinary config requires a preset or key+secret', () => {
    expect(() => cloudinaryConfigSchema.parse({ cloudName: 'x' })).toThrow(/preset|secret/i);
    expect(() => cloudinaryConfigSchema.parse({ cloudName: 'x', apiKey: 'k' })).toThrow(/preset|secret/i);
    expect(() => cloudinaryConfigSchema.parse({ cloudName: 'x', apiKey: 'k', apiSecret: 's' })).not.toThrow();
  });

  it('imgbb config requires an api key', () => {
    expect(() => imgbbConfigSchema.parse({})).toThrow();
    expect(imgbbConfigSchema.parse({ apiKey: 'k' }).apiKey).toBe('k');
  });

  it('mock host returns a fake URL without any network call', async () => {
    const result = await new MockImageHost().upload({ bytes: PNG, mime: 'image/png', filename: 'x.png' });
    expect(result.url).toContain('mock.invalid');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('registry builds hosts from decrypted config', () => {
    expect(getImageHost({ provider: 'imgbb', config: { apiKey: 'k' } })).toBeInstanceOf(ImgbbHost);
    expect(getImageHost({ provider: 'mock', config: {} })).toBeInstanceOf(MockImageHost);
  });
});