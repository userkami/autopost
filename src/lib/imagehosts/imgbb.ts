import { FormData } from 'undici';
import { ProviderError } from '@/lib/providers/errors';
import { postForm } from '@/lib/providers/http';
import type { ImageHost, ImageHostMetadata, ImageUploadRequest, ImageUploadResult } from '@/lib/providers/types';
import { imgbbConfigSchema, type ImgbbConfig } from './config';

/**
 * imgbb image host (verified against api.imgbb.com 2026-10-10).
 * POST https://api.imgbb.com/1/upload?key=KEY (multipart; `image` = base64 data).
 */

type ImgbbResponse = {
  success?: boolean;
  status?: number;
  error?: { message?: string };
  data?: { url?: string; display_url?: string; delete_url?: string };
};

export const IMGBB_METADATA: ImageHostMetadata = {
  provider: 'imgbb',
  label: 'imgbb',
  notes: 'Free/paid key-based image hosting; returns a direct HTTPS URL.',
};

export class ImgbbHost implements ImageHost {
  readonly config: ImgbbConfig;

  constructor(config: ImgbbConfig) {
    this.config = imgbbConfigSchema.parse(config);
  }

  async upload(img: ImageUploadRequest): Promise<ImageUploadResult> {
    const form = new FormData();
    form.set('image', img.bytes.toString('base64'));
    form.set('name', img.filename);
    const response = await this.post(form);
    const url = response.data?.display_url ?? response.data?.url;
    if (!response.success || !url) {
      throw new ProviderError('server', response.error?.message ?? 'imgbb upload failed');
    }
    return { url };
  }

  async test(): Promise<void> {
    // A tiny 1x1 PNG keeps test cost at essentially zero.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XnP9QAAAAASUVORK5CYII=',
      'base64',
    );
    await this.upload({ bytes: png, mime: 'image/png', filename: 'autoblog-test.png' });
  }

  private async post(form: FormData): Promise<ImgbbResponse> {
    const url = `https://api.imgbb.com/1/upload?key=${encodeURIComponent(this.config.apiKey)}`;
    return postForm<ImgbbResponse>(url, form, { timeoutMs: 60_000 });
  }
}