import type { AIProviderName } from '@/db/schema';
import { AnthropicTextProvider } from './anthropic';
import { ProviderError } from './errors';
import { FalImageProvider } from './fal';
import { GeminiImageProvider, GeminiTextProvider } from './gemini';
import { LeonardoImageProvider } from './leonardo';
import { MockImageProvider, MockTextProvider } from './mock';
import {
  CustomOpenAIImageProvider,
  CustomOpenAITextProvider,
  OpenAIImageProvider,
  OpenAITextProvider,
} from './openai';
import { OpenRouterTextProvider } from './openrouter';
import { PollinationsImageProvider } from './pollinations';
import type { ImageProvider, ProviderCapabilities, ProviderMetadata, TextProvider } from './types';
import { env } from '@/lib/env';

/**
 * Provider registry — PLAN.md §7 (capability matrix) and §8.3.
 * Decrypts the stored key, enforces capabilities, and blocks `mock` unless
 * ENABLE_MOCK_PROVIDERS=true. Custom endpoints are gated by the caller-supplied
 * `customEndpointsAllowed` flag (PLAN.md §14.3, app setting custom_endpoints_allowed).
 */

export type ProviderConnection = {
  provider: AIProviderName;
  /** Already-decrypted API key (never log it). */
  apiKey: string;
  /** custom_openai only. */
  baseUrl?: string | null;
  /** Optional provider-specific extras (e.g. custom headers). */
  extra?: Record<string, unknown> | null;
};

export const PROVIDER_MATRIX: Record<AIProviderName, ProviderCapabilities> = {
  gemini: { text: true, image: true, groundedSearch: true },
  openai: { text: true, image: true, groundedSearch: true },
  openrouter: { text: true, image: false, groundedSearch: false },
  anthropic: { text: true, image: false, groundedSearch: true },
  pollinations: { text: false, image: true, groundedSearch: false },
  fal: { text: false, image: true, groundedSearch: false },
  leonardo: { text: false, image: true, groundedSearch: false },
  custom_openai: { text: true, image: true, groundedSearch: false },
  mock: { text: true, image: true, groundedSearch: false },
};

export const PROVIDER_METADATA: ProviderMetadata[] = [
  {
    provider: 'gemini',
    label: 'Google Gemini',
    ...PROVIDER_MATRIX.gemini,
    notes: 'Text, image and Google Search grounding from one key.',
  },
  { provider: 'openai', label: 'OpenAI', ...PROVIDER_MATRIX.openai, notes: 'Text and image models.' },
  { provider: 'openrouter', label: 'OpenRouter', ...PROVIDER_MATRIX.openrouter, notes: 'Text only (v1).' },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    ...PROVIDER_MATRIX.anthropic,
    notes: 'Text with optional web search; no image generation.',
  },
  {
    provider: 'pollinations',
    label: 'Pollinations',
    ...PROVIDER_MATRIX.pollinations,
    notes: 'Image only; requires your Pollinations API key.',
  },
  {
    provider: 'fal',
    label: 'fal.ai',
    ...PROVIDER_MATRIX.fal,
    notes: 'Image only; one key covers FLUX/Ideogram/Recraft/Seedream by model id.',
  },
  {
    provider: 'leonardo',
    label: 'Leonardo.Ai',
    ...PROVIDER_MATRIX.leonardo,
    notes: 'Image only; API credits are billed separately from the web app.',
  },
  {
    provider: 'custom_openai',
    label: 'Custom (OpenAI-compatible)',
    ...PROVIDER_MATRIX.custom_openai,
    notes: 'Your own base URL for /chat/completions and /images/generations.',
  },
  {
    provider: 'mock',
    label: 'Mock (dev/test)',
    ...PROVIDER_MATRIX.mock,
    notes: 'Deterministic local outputs; only available when ENABLE_MOCK_PROVIDERS=true.',
  },
];

export function capabilitiesFor(provider: AIProviderName): ProviderCapabilities {
  return PROVIDER_MATRIX[provider];
}

function assertMockAllowed(provider: AIProviderName): void {
  if (provider === 'mock' && !env.ENABLE_MOCK_PROVIDERS) {
    throw new ProviderError('unsupported', 'Mock providers are disabled in this environment');
  }
}

function requireCustomEndpoint(connection: ProviderConnection, customEndpointsAllowed: boolean): string {
  if (!customEndpointsAllowed) {
    throw new ProviderError('unsupported', 'Custom endpoints are disabled by the administrator');
  }
  const baseUrl = connection.baseUrl?.trim();
  if (!baseUrl) throw new ProviderError('bad_request', 'A base URL is required for custom providers');
  return baseUrl;
}

export type RegistryOptions = {
  /** app setting custom_endpoints_allowed (default true). */
  customEndpointsAllowed?: boolean;
};

export function getTextProvider(connection: ProviderConnection, opts: RegistryOptions = {}): TextProvider {
  const { provider } = connection;
  assertMockAllowed(provider);
  if (!capabilitiesFor(provider).text) {
    throw new ProviderError('unsupported', `${provider} cannot generate text`);
  }
  switch (provider) {
    case 'gemini':
      return new GeminiTextProvider(connection.apiKey);
    case 'openai':
      return new OpenAITextProvider(connection.apiKey);
    case 'openrouter':
      return new OpenRouterTextProvider(connection.apiKey);
    case 'anthropic':
      return new AnthropicTextProvider(connection.apiKey);
    case 'custom_openai':
      return new CustomOpenAITextProvider(
        connection.apiKey,
        requireCustomEndpoint(connection, opts.customEndpointsAllowed ?? true),
      );
    case 'mock':
      return new MockTextProvider();
    default:
      throw new ProviderError('unsupported', `${provider} does not support text generation`);
  }
}

export function getImageProvider(connection: ProviderConnection, opts: RegistryOptions = {}): ImageProvider {
  const { provider } = connection;
  assertMockAllowed(provider);
  if (!capabilitiesFor(provider).image) {
    throw new ProviderError('unsupported', `${provider} cannot generate images`);
  }
  switch (provider) {
    case 'gemini':
      return new GeminiImageProvider(connection.apiKey);
    case 'openai':
      return new OpenAIImageProvider(connection.apiKey);
    case 'pollinations':
      return new PollinationsImageProvider(connection.apiKey);
    case 'fal':
      return new FalImageProvider(connection.apiKey);
    case 'leonardo':
      return new LeonardoImageProvider(connection.apiKey);
    case 'custom_openai':
      return new CustomOpenAIImageProvider(
        connection.apiKey,
        requireCustomEndpoint(connection, opts.customEndpointsAllowed ?? true),
      );
    case 'mock':
      return new MockImageProvider();
    default:
      throw new ProviderError('unsupported', `${provider} does not support image generation`);
  }
}

/**
 * "Use same for all" support (PLAN.md §7): returns which roles a provider can
 * serve, so the UI can leave unsupported roles unset with a warning.
 */
export function rolesForProvider(provider: AIProviderName): Array<'research' | 'writing' | 'image'> {
  const caps = capabilitiesFor(provider);
  const roles: Array<'research' | 'writing' | 'image'> = [];
  if (caps.text) roles.push('research', 'writing');
  if (caps.image) roles.push('image');
  return roles;
}

/**
 * "Fetch models" (PLAN.md §8.6) — best-effort `listModels` for a connection.
 * Returns [] for providers/adapters that do not expose a model list.
 */
export async function fetchModels(
  connection: ProviderConnection,
  role: 'text' | 'image',
  opts: RegistryOptions = {},
): Promise<string[]> {
  const provider = role === 'text' ? getTextProvider(connection, opts) : getImageProvider(connection, opts);
  if (!provider.listModels) return [];
  return provider.listModels();
}