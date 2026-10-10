import { z } from 'zod';

/**
 * Image host config schemas (PLAN.md §9). Configs are stored encrypted
 * (`image_hosts.config_enc`) and validated with zod before use.
 */

export const imgbbConfigSchema = z.object({
  apiKey: z.string().min(1, 'An imgbb API key is required'),
});
export type ImgbbConfig = z.infer<typeof imgbbConfigSchema>;

export const cloudinaryConfigSchema = z
  .object({
    cloudName: z.string().min(1, 'A Cloudinary cloud name is required'),
    apiKey: z.string().optional(),
    apiSecret: z.string().optional(),
    uploadPreset: z.string().optional(),
  })
  .refine((config) => Boolean(config.uploadPreset) || Boolean(config.apiKey && config.apiSecret), {
    message: 'Provide either an unsigned upload preset, or an API key + secret for signed uploads',
  });
export type CloudinaryConfig = z.infer<typeof cloudinaryConfigSchema>;

export const mockConfigSchema = z.object({}).passthrough();
export type MockConfig = z.infer<typeof mockConfigSchema>;

export type ImageHostConfigMap = {
  imgbb: ImgbbConfig;
  cloudinary: CloudinaryConfig;
  mock: MockConfig;
};