import { ProviderError } from './errors';
import { assertImageBytes } from './image-utils';
import { fetchBytes, getJson, postJson, sleep } from './http';
import type { ImageProvider, ImageRequest, ImageResult } from './types';

/**
 * fal.ai image adapter — queue API (verified against docs.fal.ai 2026-10-10).
 * One connection serves many models (FLUX, Ideogram, Recraft, Seedream) by the
 * user-configured model id. Auth: `Authorization: Key <key>`.
 *
 * Flow: POST queue/{model} → GET status_url (poll) → GET response_url → download.
 */
type FalSubmitResponse = { request_id?: string; status_url?: string; response_url?: string };
type FalStatusResponse = { status?: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'; error?: string };
type FalResultResponse = { images?: Array<{ url?: string; content_type?: string }> };

const QUEUE_BASE = 'https://queue.fal.run';
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 80; // ≈ 2 minutes

export class FalImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string) {}

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model.replace(/^\/+/, '');
    if (!model) throw new ProviderError('bad_request', 'A fal model id is required');
    const endpoint = `${QUEUE_BASE}/${model}`;
    const headers = { authorization: `Key ${this.apiKey}` };

    const submitted = await postJson<FalSubmitResponse>(
      endpoint,
      { prompt: req.prompt, image_size: aspectToFalSize(req.aspect) },
      { headers, signal: req.signal, timeoutMs: 120_000 },
    );
    const requestId = submitted.request_id;
    if (!requestId) throw new ProviderError('server', 'fal did not return a request id');
    const statusUrl = submitted.status_url ?? `${endpoint}/requests/${requestId}/status`;
    const responseUrl = submitted.response_url ?? `${endpoint}/requests/${requestId}`;

    await this.pollUntilComplete(statusUrl, headers, req.signal);

    const result = await getJson<FalResultResponse>(responseUrl, { headers, signal: req.signal });
    const imageUrl = result.images?.[0]?.url;
    if (!imageUrl) throw new ProviderError('server', 'fal returned no image');
    const bytes = await fetchBytes(imageUrl, { signal: req.signal, timeoutMs: 180_000 });
    return { bytes, mime: assertImageBytes(bytes), usage: { images: 1 } };
  }

  private async pollUntilComplete(
    statusUrl: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      const status = await getJson<FalStatusResponse>(statusUrl, { headers, signal, timeoutMs: 30_000 });
      if (status.status === 'COMPLETED') {
        if (status.error) throw new ProviderError('server', `fal generation failed: ${status.error}`);
        return;
      }
      await sleep(POLL_INTERVAL_MS, signal);
    }
    throw new ProviderError('timeout', 'fal generation did not complete in time');
  }

  async test(model: string): Promise<void> {
    await this.generate({ model, prompt: 'A tiny blue square icon', aspect: '1:1' });
  }
}

function aspectToFalSize(aspect: ImageRequest['aspect']): string {
  if (aspect === '16:9') return 'landscape_16_9';
  if (aspect === '4:3') return 'landscape_4_3';
  return 'square_hd';
}