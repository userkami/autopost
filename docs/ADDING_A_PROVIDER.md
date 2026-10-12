# Adding a New AI Provider

Guide for integrating a new text or image generation provider into AutoBlog.

## Overview

AutoBlog uses a provider registry pattern. Each provider implements either `TextProvider` or `ImageProvider` interface (or both).

## Architecture

```
src/lib/providers/
├── types.ts          # Interfaces: TextProvider, ImageProvider, ProviderError
├── registry.ts       # getTextProvider, getImageProvider, capability matrix
├── http.ts           # HTTP helpers (getJson, postJson, SSRF-safe fetch)
└── text/             # Text adapters
│   ├── gemini.ts
│   ├── openai.ts
│   ├── openrouter.ts
│   ├── anthropic.ts
│   ├── custom_openai.ts
│   └── mock.ts
└── image/            # Image adapters
    ├── gemini.ts
    ├── openai.ts
    ├── pollinations.ts
    ├── fal.ts
    ├── leonardo.ts
    ├── custom_openai.ts
    └── mock.ts
```

## Step 1: Verify Provider Documentation

Before coding, read the provider's **current** official documentation:
- Base URL, authentication method
- Request/response formats
- Model IDs and capabilities
- Rate limits, error codes
- Streaming support (if any)

**Never hardcode model IDs** — they live in `provider_catalog` table only.

## Step 2: Add to Capability Matrix

Edit `src/lib/providers/registry.ts`:

```typescript
const CAPABILITY_MATRIX: Record<AIProviderName, ProviderCapabilities> = {
  // ... existing entries
  your_provider: {
    text: true,      // or false
    image: false,    // or true
    grounded: false, // web search support
  },
};
```

Add to `AIProviderName` type in `src/db/schema.ts`:
```typescript
export type AIProviderName =
  | 'gemini'
  | // ...
  | 'your_provider'
  | 'mock';
```

## Step 3: Create Text Adapter (if text-capable)

Create `src/lib/providers/text/your_provider.ts`:

```typescript
import { TextProvider, TextRequest, TextResult, ProviderError } from '../types';
import { postJson } from '../http';

export class YourProviderText implements TextProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = 'https://api.yourprovider.com/v1',
  ) {}

  async generate(req: TextRequest): Promise<TextResult> {
    const body = {
      model: req.model,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ],
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      response_format: req.json ? { type: 'json_object' } : undefined,
    };

    const response = await postJson(`${this.baseUrl}/chat/completions`, body, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: req.signal,
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      usage: response.usage
        ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
        : undefined,
    };
  }

  async listModels(): Promise<string[]> {
    const response = await this.getJson(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return response.data.map((m: any) => m.id);
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'Reply with OK', maxTokens: 5 });
  }
}
```

## Step 4: Create Image Adapter (if image-capable)

Create `src/lib/providers/image/your_provider.ts`:

```typescript
import { ImageProvider, ImageRequest, ImageResult, ProviderError } from '../types';
import { postJson } from '../http';

export class YourProviderImage implements ImageProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = 'https://api.yourprovider.com/v1',
  ) {}

  async generate(req: ImageRequest): Promise<ImageResult> {
    const sizeMap: Record<string, string> = {
      '16:9': '1792x1024',
      '1:1': '1024x1024',
      '4:3': '1152x896',
    };

    const response = await postJson(`${this.baseUrl}/images/generations`, {
      model: req.model,
      prompt: req.prompt,
      size: sizeMap[req.aspect] ?? '1024x1024',
      response_format: 'b64_json',
    }, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: req.signal,
    });

    const b64 = response.data[0]?.b64_json;
    if (!b64) throw new ProviderError('server', 'No image returned');

    return {
      bytes: Buffer.from(b64, 'base64'),
      mime: 'image/png',
    };
  }

  async listModels(): Promise<string[]> { /* ... */ }
  async test(model: string): Promise<void> { /* ... */ }
}
```

## Step 5: Register Adapter

Edit `src/lib/providers/registry.ts`:

```typescript
import { YourProviderText } from './text/your_provider';
import { YourProviderImage } from './image/your_provider';

export function getTextProvider(conn: ProviderConnection): TextProvider {
  switch (conn.provider) {
    // ...
    case 'your_provider':
      return new YourProviderText(conn.apiKey, conn.baseUrl);
  }
}

export function getImageProvider(conn: ProviderConnection): ImageProvider {
  switch (conn.provider) {
    // ...
    case 'your_provider':
      return new YourProviderImage(conn.apiKey, conn.baseUrl);
  }
}
```

## Step 6: Seed Catalog Suggestions

Edit `src/db/seed.ts` to add suggested models:

```typescript
await db.insert(providerCatalog).values([
  // ...
  { provider: 'your_provider', role: 'text', modelId: 'model-1', label: 'Model 1', isDefault: true },
  { provider: 'your_provider', role: 'image', modelId: 'image-model-1', label: 'Image Model 1', isDefault: true },
]).onConflictDoNothing();
```

## Step 7: Add Tests

Create `tests/unit/providers/your_provider.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { YourProviderText } from '@/lib/providers/text/your_provider';
import { httpMock } from '../http-mock';

describe('YourProviderText', () => {
  it('generates text', async () => {
    const mock = httpMock();
    mock.onPost('/chat/completions').reply(200, {
      choices: [{ message: { content: 'Hello world' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = new YourProviderText('test-key', mock.baseUrl);
    const result = await provider.generate({ model: 'test', prompt: 'Hi' });

    expect(result.text).toBe('Hello world');
  });
});
```

Run: `npm run test`

## Step 8: Handle Provider Errors

Map HTTP errors to `ProviderError` kinds in `src/lib/providers/errors.ts`:

```typescript
export function mapHttpError(status: number, body: unknown): ProviderError {
  if (status === 401) return new ProviderError('auth', 'Invalid API key');
  if (status === 429) return new ProviderError('rate_limit', 'Rate limited');
  if (status === 402) return new ProviderError('quota', 'Quota exceeded');
  // ...
}
```

## Step 9: Update Documentation

- [ ] Add provider to `docs/ADDING_A_PROVIDER.md` (this file)
- [ ] Update `provider_catalog` seed with real model IDs
- [ ] Document any special configuration (base URLs, extra params)

## Step 10: Verify

- [ ] `npm run check` passes (typecheck, lint, tests)
- [ ] `npm run test:live` works with real API key (optional)
- [ ] UI shows provider in connection form
- [ ] Test button works
- [ ] Model fetch works (if `listModels` implemented)

## Checklist for Review

- [ ] No hardcoded model IDs in adapter code
- [ ] Uses SSRF-safe HTTP (`src/lib/http.ts`)
- [ ] Maps all error codes to `ProviderError` kinds
- [ ] Supports `json: true` for text (if provider allows)
- [ ] Supports `grounded: true` for text (if provider allows)
- [ ] Image adapter returns bytes + mime, handles aspect ratios
- [ ] Timeout: 120s text, 180s image
- [ ] Max image size: 10MB
- [ ] Validates downloaded image magic bytes
- [ ] Unit tests with HTTP mocks (success + each error kind)