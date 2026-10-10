import type { ImageHostProviderName } from '@/db/schema';
import { ProviderError } from '@/lib/providers/errors';
import type { ImageHost, ImageHostMetadata } from '@/lib/providers/types';
import { env } from '@/lib/env';
import { cloudinaryConfigSchema, imgbbConfigSchema, mockConfigSchema } from './config';
import { CLOUDINARY_METADATA, CloudinaryHost } from './cloudinary';
import { IMGBB_METADATA, ImgbbHost } from './imgbb';
import { MOCK_HOST_METADATA, MockImageHost } from './mock';

/**
 * Image-host registry (PLAN.md §9): decrypt config → validated host instance.
 * `mock` is only available when ENABLE_MOCK_PROVIDERS=true.
 */

export const IMAGE_HOST_METADATA: ImageHostMetadata[] = [
  IMGBB_METADATA,
  CLOUDINARY_METADATA,
  MOCK_HOST_METADATA,
];

export type ImageHostConnection = {
  provider: ImageHostProviderName;
  /** Already-decrypted config (never log it). */
  config: unknown;
};

export function getImageHost(connection: ImageHostConnection): ImageHost {
  const { provider, config } = connection;
  if (provider === 'mock' && !env.ENABLE_MOCK_PROVIDERS) {
    throw new ProviderError('unsupported', 'Mock image hosts are disabled in this environment');
  }
  switch (provider) {
    case 'imgbb':
      return new ImgbbHost(imgbbConfigSchema.parse(config));
    case 'cloudinary':
      return new CloudinaryHost(cloudinaryConfigSchema.parse(config));
    case 'mock':
      mockConfigSchema.parse(config ?? {});
      return new MockImageHost();
    default:
      throw new ProviderError('unsupported', `Unknown image host provider: ${provider}`);
  }
}