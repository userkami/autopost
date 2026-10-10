import { FormData, request, type Dispatcher } from 'undici';
import { providerErrorFromStatus, toProviderError } from './errors';

/**
 * Provider HTTP helpers (PLAN.md §8). Every outbound call:
 * - caps the wall-clock time (text 120s, image 180s)
 * - never follows redirects (undici's `request()` does not follow them unless a
 *   redirect interceptor is configured — PLAN.md §14.3 requires re-validating
 *   each hop instead of auto-following)
 * - maps non-2xx to a typed ProviderError
 */

export async function postJson<T>(
  url: string,
  body: unknown,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) throw providerErrorFromStatus(response.statusCode);
    return JSON.parse(text) as T;
  } catch (error) {
    throw toProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function postForm<T>(
  url: string,
  form: FormData,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await request(url, {
      method: 'POST' as Dispatcher.HttpMethod,
      headers: opts.headers,
      body: form,
      signal: controller.signal,
    });
    const text = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) throw providerErrorFromStatus(response.statusCode);
    return JSON.parse(text) as T;
  } catch (error) {
    throw toProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBytes(
  url: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {},
): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await request(url, {
      method: 'GET',
      headers: opts.headers,
      signal: controller.signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) throw providerErrorFromStatus(response.statusCode);
    const chunks: Buffer[] = [];
    let total = 0;
    const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw providerErrorFromStatus(413, 'Downloaded file exceeded the size limit');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    throw toProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

/** Abortable sleep used by async/polling adapters (fal, Leonardo). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(toProviderError(signal.reason, 'Request aborted'));
      },
      { once: true },
    );
  });
}

export async function getJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await request(url, {
      method: 'GET',
      headers: opts.headers,
      signal: controller.signal,
    });
    const text = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) throw providerErrorFromStatus(response.statusCode);
    return JSON.parse(text) as T;
  } catch (error) {
    throw toProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}