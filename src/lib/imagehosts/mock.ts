import type { ImageHost, ImageHostMetadata, ImageUploadRequest, ImageUploadResult } from '@/lib/providers/types';

/**
 * Mock image host (PLAN.md §8.5) — returns a deterministic fake URL so the whole
 * pipeline is testable without any real image-host key. Gated by
 * ENABLE_MOCK_PROVIDERS at the registry layer, not here.
 */

export const MOCK_HOST_METADATA: ImageHostMetadata = {
  provider: 'mock',
  label: 'Mock (dev/test)',
  notes: 'Returns a fake URL; only available when ENABLE_MOCK_PROVIDERS=true.',
};

export class MockImageHost implements ImageHost {
  async upload(img: ImageUploadRequest): Promise<ImageUploadResult> {
    const slug = img.filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    return { url: `https://mock.invalid/images/${slug}` };
  }

  async test(): Promise<void> {
    await this.upload({
      bytes: Buffer.from('mock'),
      mime: 'image/png',
      filename: 'autoblog-test.png',
    });
  }
}