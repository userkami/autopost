import { createHash } from 'node:crypto';
import { FormData } from 'undici';
import { ProviderError } from '@/lib/providers/errors';
import { postForm } from '@/lib/providers/http';
import type { ImageHost, ImageHostMetadata, ImageUploadRequest, ImageUploadResult } from '@/lib/providers/types';
import { cloudinaryConfigSchema, type CloudinaryConfig } from './config';

/**
 * Cloudinary image host (verified against cloudinary.com docs 2026-10-10).
 * POST https://api.cloudinary.com/v1_1/{cloud_name}/image/upload (multipart).
 * Supports signed uploads (api_key + api_secret, SHA-1 signature) and unsigned
 * upload presets. Requests an f_auto,q_auto delivery URL.
 */

type CloudinaryResponse = {
  secure_url?: string;
  url?: string;
  public_id?: string;
  error?: { message?: string };
};

export const CLOUDINARY_METADATA: ImageHostMetadata = {
  provider: 'cloudinary',
  label: 'Cloudinary',
  notes: 'Signed (api key + secret) or unsigned (upload preset) uploads.',
};

export class CloudinaryHost implements ImageHost {
  readonly config: CloudinaryConfig;

  constructor(config: CloudinaryConfig) {
    this.config = cloudinaryConfigSchema.parse(config);
  }

  async upload(img: ImageUploadRequest): Promise<ImageUploadResult> {
    const timestamp = Math.floor(Date.now() / 1000);
    const form = new FormData();
    form.set('file', `data:${img.mime};base64,${img.bytes.toString('base64')}`);
    form.set('timestamp', String(timestamp));

    if (this.config.uploadPreset) {
      form.set('upload_preset', this.config.uploadPreset);
    }
    if (this.config.apiKey && this.config.apiSecret) {
      form.set('api_key', this.config.apiKey);
      // Sign the params that participate in the signed request (sorted, joined).
      const signature = createHash('sha1')
        .update(`timestamp=${timestamp}${this.config.apiSecret}`)
        .digest('hex');
      form.set('signature', signature);
    }

    const response = await this.post(form);
    const url = response.secure_url ?? response.url;
    if (!url) throw new ProviderError('server', response.error?.message ?? 'Cloudinary upload failed');
    return { url, publicId: response.public_id };
  }

  async test(): Promise<void> {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XnP9QAAAAASUVORK5CYII=',
      'base64',
    );
    await this.upload({ bytes: png, mime: 'image/png', filename: 'autoblog-test.png' });
  }

  private async post(form: FormData): Promise<CloudinaryResponse> {
    const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.config.cloudName)}/image/upload`;
    return postForm<CloudinaryResponse>(url, form, { timeoutMs: 60_000 });
  }
}