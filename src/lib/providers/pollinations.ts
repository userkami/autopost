import { ProviderError } from './errors';
import { assertImageBytes } from './image-utils';
import { fetchBytes } from './http';
import type { ImageProvider, ImageRequest, ImageResult } from './types';

export class PollinationsImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string) {}

  async generate(req: ImageRequest): Promise<ImageResult> {
    const url = new URL(`https://gen.pollinations.ai/image/${encodeURIComponent(req.prompt)}`);
    url.searchParams.set('model', req.model);
    url.searchParams.set('nologo', 'true');
    url.searchParams.set('private', 'true');
    url.searchParams.set('width', req.aspect === '16:9' ? '1344' : req.aspect === '4:3' ? '1152' : '1024');
    url.searchParams.set('height', req.aspect === '16:9' ? '768' : req.aspect === '4:3' ? '864' : '1024');
    const bytes = await fetchBytes(url.toString(), { headers: { authorization: `Bearer ${this.apiKey}` }, signal: req.signal, timeoutMs: 180_000 });
    return { bytes, mime: assertImageBytes(bytes), usage: { images: 1 } };
  }

  async test(model: string): Promise<void> {
    if (!this.apiKey) throw new ProviderError('auth', 'Pollinations API key is required');
    await this.generate({ model, prompt: 'A tiny blue square icon', aspect: '1:1' });
  }
}