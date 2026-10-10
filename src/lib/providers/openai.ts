import { safeFetchBuffer } from '@/lib/ssrf';
import { ProviderError } from './errors';
import { assertImageBytes } from './image-utils';
import { postJson, getJson } from './http';
import type { ImageProvider, ImageRequest, ImageResult, TextProvider, TextRequest, TextResult } from './types';

type OpenAIResponse = { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; usage?: Record<string, number> };
type OpenAIImageResponse = { data?: Array<{ b64_json?: string; url?: string }>; usage?: Record<string, number> };

export class OpenAITextProvider implements TextProvider {
  constructor(private readonly apiKey: string) {}

  async generate(req: TextRequest): Promise<TextResult> {
    const input = [req.system ? { role: 'system', content: req.system } : null, { role: 'user', content: req.prompt }].filter(Boolean);
    const response = await postJson<OpenAIResponse>(
      'https://api.openai.com/v1/responses',
      {
        model: req.model,
        input,
        temperature: req.temperature,
        max_output_tokens: req.maxTokens,
        text: req.json ? { format: { type: 'json_object' } } : undefined,
        tools: req.grounded ? [{ type: 'web_search_preview' }] : undefined,
      },
      { headers: { authorization: `Bearer ${this.apiKey}` }, signal: req.signal },
    );
    const text = response.output_text ?? response.output?.flatMap((item) => item.content ?? []).find((part) => part.text)?.text;
    if (!text) throw new ProviderError('server', 'OpenAI returned no text');
    return { text, usage: response.usage };
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'Reply with OK', maxTokens: 20 });
  }

  async listModels(): Promise<string[]> {
    const response = await getJson<{ data?: Array<{ id?: string }> }>('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${this.apiKey}` },
      timeoutMs: 30_000,
    });
    return (response.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => Boolean(id));
  }
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl = 'https://api.openai.com/v1') {}

  async generate(req: ImageRequest): Promise<ImageResult> {
    const response = await postJson<OpenAIImageResponse>(
      `${this.baseUrl.replace(/\/$/, '')}/images/generations`,
      { model: req.model, prompt: req.prompt, size: aspectToSize(req.aspect), response_format: 'b64_json' },
      { headers: { authorization: `Bearer ${this.apiKey}` }, signal: req.signal, timeoutMs: 180_000 },
    );
    const first = response.data?.[0];
    const bytes = first?.b64_json ? Buffer.from(first.b64_json, 'base64') : first?.url ? (await safeFetchBuffer(first.url, { maxBytes: 10 * 1024 * 1024, signal: req.signal })).bytes : null;
    if (!bytes) throw new ProviderError('server', 'OpenAI returned no image');
    return { bytes, mime: assertImageBytes(bytes), usage: response.usage };
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'A tiny blue square icon', aspect: '1:1' });
  }
}

export class CustomOpenAITextProvider implements TextProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

  async generate(req: TextRequest): Promise<TextResult> {
    await safeFetchBuffer(this.baseUrl, { method: 'HEAD', maxBytes: 1 }).catch(() => undefined);
    const response = await postJson<{ choices?: Array<{ message?: { content?: string } }>; usage?: Record<string, number> }>(
      `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        model: req.model,
        messages: [req.system ? { role: 'system', content: req.system } : null, { role: 'user', content: req.prompt }].filter(Boolean),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        response_format: req.json ? { type: 'json_object' } : undefined,
      },
      { headers: { authorization: `Bearer ${this.apiKey}` }, signal: req.signal },
    );
    const text = response.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError('server', 'Custom provider returned no text');
    return { text, usage: response.usage };
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'Reply with OK', maxTokens: 20 });
  }
}

export class CustomOpenAIImageProvider extends OpenAIImageProvider {}

function aspectToSize(aspect: ImageRequest['aspect']): string {
  if (aspect === '16:9') return '1792x1024';
  if (aspect === '4:3') return '1024x768';
  return '1024x1024';
}