import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  request: vi.fn(),
}));

import { AnthropicTextProvider } from '@/lib/providers/anthropic';
import { ProviderError } from '@/lib/providers/errors';
import { FalImageProvider } from '@/lib/providers/fal';
import { GeminiImageProvider, GeminiTextProvider } from '@/lib/providers/gemini';
import { LeonardoImageProvider } from '@/lib/providers/leonardo';
import { MockImageProvider, MockTextProvider } from '@/lib/providers/mock';
import { OpenAIImageProvider, OpenAITextProvider } from '@/lib/providers/openai';
import { OpenRouterTextProvider } from '@/lib/providers/openrouter';
import { PollinationsImageProvider } from '@/lib/providers/pollinations';
import { mockedRequest, queueResponses } from './http-mock';

/** 1x1 PNG (same fixture the mock/registry use). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XnP9QAAAAASUVORK5CYII=',
  'base64',
);

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('text adapters (PLAN.md §8.2, §17 Phase 2 acceptance)', () => {
  it('OpenAI parses output_text and maps 401 → auth', async () => {
    queueResponses({ text: JSON.stringify({ output_text: 'hello', usage: { total_tokens: 5 } }) });
    const provider = new OpenAITextProvider('sk-test');
    await expect(provider.generate({ model: 'gpt-x', prompt: 'hi' })).resolves.toMatchObject({
      text: 'hello',
    });

    queueResponses({ statusCode: 401, text: '{"error":"bad key"}' });
    await expect(provider.generate({ model: 'gpt-x', prompt: 'hi' })).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('Gemini joins candidate parts and maps 429 → rate_limit', async () => {
    queueResponses({
      text: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hel' }, { text: 'lo' }] } }] }),
    });
    const provider = new GeminiTextProvider('key');
    await expect(provider.generate({ model: 'gemini-x', prompt: 'hi' })).resolves.toMatchObject({
      text: 'Hello',
    });

    queueResponses({ statusCode: 429, text: '{}' });
    await expect(provider.generate({ model: 'gemini-x', prompt: 'hi' })).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
  });

  it('Anthropic merges text blocks and maps 500 → server', async () => {
    queueResponses({ text: JSON.stringify({ content: [{ type: 'text', text: 'answer' }] }) });
    const provider = new AnthropicTextProvider('key');
    await expect(provider.generate({ model: 'claude-x', prompt: 'hi' })).resolves.toMatchObject({
      text: 'answer',
    });

    queueResponses({ statusCode: 500, text: 'oops' });
    await expect(provider.generate({ model: 'claude-x', prompt: 'hi' })).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('OpenRouter reads choices[0] and surfaces malformed JSON as a provider error', async () => {
    queueResponses({ text: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) });
    const provider = new OpenRouterTextProvider('key');
    await expect(provider.generate({ model: 'x', prompt: 'hi' })).resolves.toMatchObject({ text: 'ok' });

    queueResponses({ text: 'not json at all' });
    const error = await provider.generate({ model: 'x', prompt: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
  });

  it('maps an aborted request to a retryable timeout', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('The operation was aborted'));
    const provider = new OpenAITextProvider('key');
    await expect(provider.generate({ model: 'x', prompt: 'hi' })).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
  });

  it('test() throws when the provider returns no text', async () => {
    queueResponses({ text: JSON.stringify({}) });
    await expect(new OpenAITextProvider('key').test('x')).rejects.toThrow(/no text/i);
  });
});

describe('image adapters (PLAN.md §8.2)', () => {
  it('OpenAI decodes b64_json and validates the image bytes', async () => {
    queueResponses({ text: JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }) });
    const provider = new OpenAIImageProvider('key');
    const result = await provider.generate({ model: 'gpt-image-2', prompt: 'blue', aspect: '1:1' });
    expect(result.mime).toBe('image/png');
    expect(result.bytes.length).toBe(PNG.length);
  });

  it('OpenAI rejects a non-image payload', async () => {
    queueResponses({ text: JSON.stringify({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }) });
    await expect(
      new OpenAIImageProvider('key').generate({ model: 'x', prompt: 'p', aspect: '1:1' }),
    ).rejects.toThrow(/valid image|supported image/i);
  });

  it('Gemini decodes inlineData', async () => {
    queueResponses({
      text: JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }],
      }),
    });
    const result = await new GeminiImageProvider('key').generate({ model: 'img', prompt: 'p', aspect: '16:9' });
    expect(result.mime).toBe('image/png');
  });

  it('Pollinations downloads raw image bytes', async () => {
    queueResponses({ chunks: [PNG] });
    const result = await new PollinationsImageProvider('key').generate({
      model: 'flux',
      prompt: 'p',
      aspect: '1:1',
    });
    expect(result.mime).toBe('image/png');
  });

  it('fal submits, polls, fetches the result URL, then downloads', async () => {
    queueResponses(
      { text: JSON.stringify({ request_id: 'req-1', status_url: 'https://q/status', response_url: 'https://q/response' }) },
      { text: JSON.stringify({ status: 'COMPLETED' }) },
      { text: JSON.stringify({ images: [{ url: 'https://cdn/image.png' }] }) },
      { chunks: [PNG] },
    );
    const result = await new FalImageProvider('key').generate({
      model: 'fal-ai/flux/schnell',
      prompt: 'p',
      aspect: '1:1',
    });
    expect(result.mime).toBe('image/png');
    expect(mockedRequest).toHaveBeenCalledTimes(4);
  });

  it('fal surfaces a queue error after completion', async () => {
    queueResponses(
      { text: JSON.stringify({ request_id: 'r', status_url: 'https://q/s', response_url: 'https://q/r' }) },
      { text: JSON.stringify({ status: 'COMPLETED', error: 'nsfw' }) },
    );
    await expect(
      new FalImageProvider('key').generate({ model: 'fal-ai/flux', prompt: 'p', aspect: '1:1' }),
    ).rejects.toThrow(/nsfw/i);
  });

  it('Leonardo creates, polls and downloads', async () => {
    queueResponses(
      { text: JSON.stringify({ generationId: 'gen-1' }) },
      { text: JSON.stringify({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: 'https://cdn/l.png' }] } }) },
      { chunks: [PNG] },
    );
    const result = await new LeonardoImageProvider('key').generate({
      model: 'nano-banana-2',
      prompt: 'p',
      aspect: '1:1',
    });
    expect(result.mime).toBe('image/png');
  });

  it('Leonardo maps a FAILED status to a server error', async () => {
    queueResponses(
      { text: JSON.stringify({ generationId: 'gen-1' }) },
      { text: JSON.stringify({ generations_by_pk: { status: 'FAILED' } }) },
    );
    await expect(
      new LeonardoImageProvider('key').generate({ model: 'nano-banana-2', prompt: 'p', aspect: '1:1' }),
    ).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('mock providers (PLAN.md §8.5)', () => {
  it('text returns deterministic JSON and answers the test prompt', async () => {
    const provider = new MockTextProvider();
    await expect(provider.generate({ model: 'mock', prompt: 'Reply with OK' })).resolves.toMatchObject({ text: 'OK' });
    const json = await provider.generate({ model: 'mock', prompt: 'article', json: true });
    expect(() => JSON.parse(json.text)).not.toThrow();
  });

  it('image returns a valid tiny PNG', async () => {
    const result = await new MockImageProvider().generate({ model: 'mock', prompt: 'p', aspect: '1:1' });
    expect(result.mime).toBe('image/png');
  });
});