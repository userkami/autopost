import type { AIProviderName, ImageHostProviderName } from '@/db/schema';

export type TextRequest = {
  model: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  grounded?: boolean;
  signal?: AbortSignal;
};

export type TextResult = {
  text: string;
  usage?: Record<string, number>;
  citations?: Array<{ title?: string; url: string }>;
};

export interface TextProvider {
  generate(req: TextRequest): Promise<TextResult>;
  listModels?(): Promise<string[]>;
  test(model: string): Promise<void>;
}

export type ImageRequest = {
  model: string;
  prompt: string;
  aspect: '16:9' | '1:1' | '4:3';
  signal?: AbortSignal;
};

export type ImageResult = {
  bytes: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  usage?: Record<string, number>;
};

export interface ImageProvider {
  generate(req: ImageRequest): Promise<ImageResult>;
  listModels?(): Promise<string[]>;
  test(model: string): Promise<void>;
}

export type ImageUploadRequest = {
  bytes: Buffer;
  mime: ImageResult['mime'];
  filename: string;
  alt?: string;
  signal?: AbortSignal;
};

export type ImageUploadResult = {
  url: string;
  publicId?: string;
};

export interface ImageHost {
  upload(req: ImageUploadRequest): Promise<ImageUploadResult>;
  test(): Promise<void>;
}

export type ProviderCapabilities = {
  text: boolean;
  image: boolean;
  groundedSearch: boolean;
};

export type ProviderMetadata = ProviderCapabilities & {
  provider: AIProviderName;
  label: string;
  notes?: string;
};

export type ImageHostMetadata = {
  provider: ImageHostProviderName;
  label: string;
  notes?: string;
};