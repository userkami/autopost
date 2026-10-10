import { describe, expect, it } from 'vitest';
import {
  PROVIDER_MATRIX,
  capabilitiesFor,
  getImageProvider,
  getTextProvider,
  rolesForProvider,
} from '@/lib/providers/registry';
import { MockTextProvider } from '@/lib/providers/mock';
import { OpenAITextProvider } from '@/lib/providers/openai';
import { PollinationsImageProvider } from '@/lib/providers/pollinations';

/**
 * Registry capability tests (PLAN.md §7, §8.3, §17 Phase 2 acceptance).
 */
describe('provider registry (PLAN.md §8.3)', () => {
  it('matches the documented capability matrix (PLAN.md §7)', () => {
    expect(PROVIDER_MATRIX.openai).toEqual({ text: true, image: true, groundedSearch: true });
    expect(PROVIDER_MATRIX.anthropic).toEqual({ text: true, image: false, groundedSearch: true });
    expect(PROVIDER_MATRIX.openrouter).toEqual({ text: true, image: false, groundedSearch: false });
    expect(PROVIDER_MATRIX.pollinations).toEqual({ text: false, image: true, groundedSearch: false });
    expect(PROVIDER_MATRIX.fal).toEqual({ text: false, image: true, groundedSearch: false });
    expect(PROVIDER_MATRIX.leonardo).toEqual({ text: false, image: true, groundedSearch: false });
    expect(PROVIDER_MATRIX.custom_openai).toEqual({ text: true, image: true, groundedSearch: false });
  });

  it('rolesForProvider leaves unsupported roles unset ("use same for all")', () => {
    expect(rolesForProvider('anthropic')).toEqual(['research', 'writing']);
    expect(rolesForProvider('leonardo')).toEqual(['image']);
    expect(rolesForProvider('openai')).toEqual(['research', 'writing', 'image']);
  });

  it('enforces capabilities when getting an adapter', () => {
    expect(() => getImageProvider({ provider: 'anthropic', apiKey: 'k' })).toThrow(/cannot generate images/i);
    expect(() => getTextProvider({ provider: 'fal', apiKey: 'k' })).toThrow(/cannot generate text/i);
  });

  it('returns the expected adapter classes', () => {
    expect(getTextProvider({ provider: 'openai', apiKey: 'k' })).toBeInstanceOf(OpenAITextProvider);
    expect(getImageProvider({ provider: 'pollinations', apiKey: 'k' })).toBeInstanceOf(PollinationsImageProvider);
  });

  it('requires a base URL for custom providers and honours the custom-endpoints gate', () => {
    expect(() => getTextProvider({ provider: 'custom_openai', apiKey: 'k' })).toThrow(/base URL/i);
    expect(() =>
      getTextProvider({ provider: 'custom_openai', apiKey: 'k', baseUrl: 'https://x.test/v1' }, { customEndpointsAllowed: false }),
    ).toThrow(/disabled/i);
  });

  it('exposes mock providers when ENABLE_MOCK_PROVIDERS=true (test env)', () => {
    expect(getTextProvider({ provider: 'mock', apiKey: '' })).toBeInstanceOf(MockTextProvider);
    expect(capabilitiesFor('mock')).toEqual({ text: true, image: true, groundedSearch: false });
  });
});