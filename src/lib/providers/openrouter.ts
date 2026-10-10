import { ProviderError } from './errors';
import { postJson, getJson } from './http';
import type { TextProvider, TextRequest, TextResult } from './types';

type OpenRouterResponse = { choices?: Array<{ message?: { content?: string } }>; usage?: Record<string, number> };

export class OpenRouterTextProvider implements TextProvider {
  constructor(private readonly apiKey: string) {}

  async generate(req: TextRequest): Promise<TextResult> {
    const response = await postJson<OpenRouterResponse>(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: req.model,
        messages: [req.system ? { role: 'system', content: req.system } : null, { role: 'user', content: req.prompt }].filter(Boolean),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        response_format: req.json ? { type: 'json_object' } : undefined,
      },
      {
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'http-referer': 'https://autoblog.local',
          'x-title': 'AutoBlog',
        },
        signal: req.signal,
      },
    );
    const text = response.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError('server', 'OpenRouter returned no text');
    return { text, usage: response.usage };
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'Reply with OK', maxTokens: 20 });
  }

  async listModels(): Promise<string[]> {
    const response = await getJson<{ data?: Array<{ id?: string }> }>('https://openrouter.ai/api/v1/models', {
      timeoutMs: 30_000,
    });
    return (response.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => Boolean(id));
  }
}