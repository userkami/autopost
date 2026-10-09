import { ProviderError } from './errors';
import { postJson } from './http';
import type { TextProvider, TextRequest, TextResult } from './types';

type AnthropicResponse = { content?: Array<{ type: string; text?: string }>; usage?: Record<string, number> };

export class AnthropicTextProvider implements TextProvider {
  constructor(private readonly apiKey: string) {}

  async generate(req: TextRequest): Promise<TextResult> {
    const response = await postJson<AnthropicResponse>(
      'https://api.anthropic.com/v1/messages',
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        tools: req.grounded ? [{ type: 'web_search_20250305', name: 'web_search' }] : undefined,
      },
      {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': req.grounded ? 'web-search-2025-03-05' : '',
        },
        signal: req.signal,
      },
    );
    const text = response.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n').trim();
    if (!text) throw new ProviderError('server', 'Anthropic returned no text');
    return { text, usage: response.usage };
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'Reply with OK', maxTokens: 20 });
  }
}