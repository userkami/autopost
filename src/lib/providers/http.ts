import { request, type Dispatcher } from 'undici';
import { providerErrorFromStatus, toProviderError } from './errors';

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
      maxRedirections: 0,
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
      maxRedirections: 0,
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
      maxRedirections: 0,
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