import { ProviderError } from './errors';
import { assertImageBytes } from './image-utils';
import { fetchBytes, getJson, postJson, sleep } from './http';
import type { ImageProvider, ImageRequest, ImageResult } from './types';

/**
 * Leonardo.Ai image adapter (verified against docs.leonardo.ai 2026-10-10).
 * Async flow: POST /rest/v2/generations (model + parameters) → poll
 * GET /rest/v1/generations/{id} → download the first generated image. Auth:
 * `Authorization: Bearer <key>`. API credits are billed separately from the
 * web-app subscription (surfaced in the UI, PLAN.md §8.2).
 *
 * The v2 spec documents only the create endpoint; polling uses the v1 GET that
 * the official "generate your first images" recipe documents. See DECISIONS.md.
 */
type LeonardoCreateResponse = { generationId?: string };
type LeonardoPollResponse = {
  generations_by_pk?: {
    status?: string;
    generated_images?: Array<{ url?: string }>;
  };
  // Tolerate a v2-style shape if the service returns one.
  results?: Array<{ url?: string }>;
  status?: string;
};

const CREATE_URL = 'https://cloud.leonardo.ai/api/rest/v2/generations';
const POLL_BASE = 'https://cloud.leonardo.ai/api/rest/v1/generations';
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40; // ≈ 2 minutes

export class LeonardoImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string) {}

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model.trim();
    if (!model) throw new ProviderError('bad_request', 'A Leonardo model id is required');
    const headers = { authorization: `Bearer ${this.apiKey}` };
    const { width, height } = aspectToSize(req.aspect);

    const created = await postJson<LeonardoCreateResponse>(
      CREATE_URL,
      {
        model,
        parameters: { prompt: req.prompt, width, height, quantity: 1, prompt_enhance: 'OFF' },
        public: false,
      },
      { headers, signal: req.signal, timeoutMs: 120_000 },
    );
    const generationId = created.generationId;
    if (!generationId) throw new ProviderError('server', 'Leonardo did not return a generation id');

    const imageUrl = await this.pollForImage(generationId, headers, req.signal);
    const bytes = await fetchBytes(imageUrl, { signal: req.signal, timeoutMs: 180_000 });
    return { bytes, mime: assertImageBytes(bytes), usage: { images: 1 } };
  }

  private async pollForImage(
    generationId: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<string> {
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      const response = await getJson<LeonardoPollResponse>(`${POLL_BASE}/${generationId}`, {
        headers,
        signal,
        timeoutMs: 30_000,
      });
      const status = (response.generations_by_pk?.status ?? response.status ?? '').toUpperCase();
      const url =
        response.generations_by_pk?.generated_images?.[0]?.url ?? response.results?.[0]?.url;
      if (status === 'FAILED') throw new ProviderError('server', 'Leonardo generation failed');
      if (url) return url;
      if (status === 'COMPLETE' && !url) {
        throw new ProviderError('server', 'Leonardo returned no image');
      }
      await sleep(POLL_INTERVAL_MS, signal);
    }
    throw new ProviderError('timeout', 'Leonardo generation did not complete in time');
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'A tiny blue square icon', aspect: '1:1' });
  }
}

function aspectToSize(aspect: ImageRequest['aspect']): { width: number; height: number } {
  if (aspect === '16:9') return { width: 1376, height: 768 };
  if (aspect === '4:3') return { width: 1200, height: 896 };
  return { width: 1024, height: 1024 };
}