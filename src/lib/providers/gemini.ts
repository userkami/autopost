import { ProviderError } from './errors';
import { assertImageBytes } from './image-utils';
import { postJson, getJson } from './http';
import type { ImageProvider, ImageRequest, ImageResult, TextProvider, TextRequest, TextResult } from './types';

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> } }>;
  usageMetadata?: Record<string, number>;
};

export class GeminiTextProvider implements TextProvider {
  constructor(private readonly apiKey: string) {}

  async generate(req: TextRequest): Promise<TextResult> {
    const response = await postJson<GeminiResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: {
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens,
          responseMimeType: req.json ? 'application/json' : undefined,
        },
        tools: req.grounded ? [{ googleSearch: {} }] : undefined,
      },
      { signal: req.signal, timeoutMs: 120_000 },
    );
    const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) throw new ProviderError('server', 'Gemini returned no text');
    return { text, usage: response.usageMetadata };
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'Reply with OK', maxTokens: 20 });
  }

  async listModels(): Promise<string[]> {
    const response = await getJson<{ models?: Array<{ name?: string }> }>(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(this.apiKey)}`,
      { timeoutMs: 30_000 },
    );
    return (response.models ?? [])
      .map((model) => model.name?.replace(/^models\//, ''))
      .filter((name): name is string => Boolean(name));
  }
}

export class GeminiImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string) {}

  async generate(req: ImageRequest): Promise<ImageResult> {
    const response = await postJson<GeminiResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      { contents: [{ role: 'user', parts: [{ text: `${req.prompt}\nAspect ratio: ${req.aspect}` }] }] },
      { signal: req.signal, timeoutMs: 180_000 },
    );
    const inline = response.candidates?.flatMap((c) => c.content?.parts ?? []).find((part) => part.inlineData)?.inlineData;
    if (!inline?.data) throw new ProviderError('server', 'Gemini returned no inline image');
    const bytes = Buffer.from(inline.data, 'base64');
    return { bytes, mime: assertImageBytes(bytes), usage: response.usageMetadata };
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'A tiny blue square icon', aspect: '1:1' });
  }
}