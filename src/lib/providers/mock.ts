import { tinyPng } from './image-utils';
import type { ImageProvider, ImageRequest, ImageResult, TextProvider, TextRequest, TextResult } from './types';

export class MockTextProvider implements TextProvider {
  async generate(req: TextRequest): Promise<TextResult> {
    if (/reply with ok/i.test(req.prompt)) return { text: 'OK', usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } };
    const payload = req.json
      ? {
          title: 'Mock article title',
          summary: 'A deterministic mock article for tests.',
          sections: ['Intro', 'Body', 'Conclusion'],
        }
      : 'Mock article title\n\nA deterministic mock article for tests.';
    return { text: typeof payload === 'string' ? payload : JSON.stringify(payload), usage: { total_tokens: 42 } };
  }

  async listModels(): Promise<string[]> {
    return ['mock-text'];
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'Reply with OK', maxTokens: 20 });
  }
}

export class MockImageProvider implements ImageProvider {
  async generate(_req: ImageRequest): Promise<ImageResult> {
    return { bytes: tinyPng(), mime: 'image/png', usage: { images: 1 } };
  }

  async listModels(): Promise<string[]> {
    return ['mock-image'];
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'tiny test image', aspect: '1:1' });
  }
}