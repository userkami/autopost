import { request } from 'undici';
import { ProviderError, providerErrorFromStatus, toProviderError } from '@/lib/providers/errors';

/**
 * Blogger v3 API client (PLAN.md §6.3).
 *
 * - 429/5xx retried with exponential backoff (honouring `Retry-After`), max 3 attempts.
 * - 401 surfaces as `auth` (callers flip the connection to `needs_reconnect`).
 * - 403 surfaces as "API not enabled / not permitted" (PLAN.md §6.3).
 * - IDs from callers are percent-encoded so they cannot alter the path.
 */

const API_BASE = 'https://www.googleapis.com/blogger/v3';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

export type BloggerBlog = { id: string; name: string; url: string };
export type BloggerPost = { id: string; title: string; published: string | null };
export type BloggerPostInput = { title: string; content: string; labels?: string[] };

function retryDelayMs(
  headers: Record<string, string | string[] | undefined> | undefined,
  attempt: number,
): number {
  const raw = headers?.['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 10) * 1000;
  }
  return BACKOFF_BASE_MS * 2 ** (attempt - 1);
}

async function bloggerRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  accessToken: string,
  body?: unknown,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await request(`${API_BASE}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.body.text();
      const status = response.statusCode;

      if (status === 401) {
        throw new ProviderError('auth', 'Google rejected the access token', { status });
      }
      if (status === 403) {
        throw new ProviderError(
          'unsupported',
          'Blogger API is not enabled or not permitted for this Google account',
          { status },
        );
      }
      if (status < 200 || status >= 300) {
        const providerError = providerErrorFromStatus(status, 'Blogger request failed');
        if (providerError.retryable && attempt < MAX_ATTEMPTS) {
          await sleep(retryDelayMs(response.headers, attempt));
          continue;
        }
        throw providerError;
      }
      if (text.length === 0) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ProviderError('bad_request', 'Blogger returned a malformed response', { status });
      }
    } catch (error) {
      const providerError = toProviderError(error, 'Blogger request failed');
      if (providerError instanceof ProviderError && !providerError.retryable) throw providerError;
      if (providerError.retryable && attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw providerError;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `GET /users/self/blogs` — the blogs the authorized Google account can edit. */
export async function listBlogs(accessToken: string): Promise<BloggerBlog[]> {
  const payload = await bloggerRequest<{ items?: unknown }>(
    'GET',
    '/users/self/blogs',
    accessToken,
  );
  const items = Array.isArray(payload.items) ? payload.items : [];
  const blogs: BloggerBlog[] = [];
  for (const item of items) {
    const record = item as Record<string, unknown>;
    const id = asString(record.id);
    const name = asString(record.name);
    const url = asString(record.url);
    if (id && name && url) blogs.push({ id, name, url });
  }
  return blogs;
}

/** Recent titles for dedupe (PLAN.md §6.3) — bodies skipped for speed. */
export async function listRecentPosts(accessToken: string, blogId: string): Promise<BloggerPost[]> {
  const payload = await bloggerRequest<{ items?: unknown }>(
    'GET',
    `/blogs/${encodeURIComponent(blogId)}/posts?fetchBodies=false&maxResults=50&orderBy=published`,
    accessToken,
  );
  const items = Array.isArray(payload.items) ? payload.items : [];
  const posts: BloggerPost[] = [];
  for (const item of items) {
    const record = item as Record<string, unknown>;
    const id = asString(record.id);
    if (id)
      posts.push({
        id,
        title: asString(record.title) ?? '',
        published: asString(record.published),
      });
  }
  return posts;
}

/** Create a post or draft (PLAN.md §6.3). */
export async function createPost(
  accessToken: string,
  blogId: string,
  input: BloggerPostInput,
  opts: { isDraft: boolean },
): Promise<BloggerPost> {
  const payload = await bloggerRequest<Record<string, unknown>>(
    'POST',
    `/blogs/${encodeURIComponent(blogId)}/posts?isDraft=${opts.isDraft ? 'true' : 'false'}`,
    accessToken,
    {
      kind: 'blogger#post',
      title: input.title,
      content: input.content,
      labels: input.labels ?? [],
    },
  );
  const id = asString(payload.id);
  if (!id) throw new ProviderError('server', 'Blogger did not return the created post id');
  return {
    id,
    title: asString(payload.title) ?? input.title,
    published: asString(payload.published),
  };
}

/** Publish an existing draft (PLAN.md §6.3). */
export async function publishPost(
  accessToken: string,
  blogId: string,
  postId: string,
): Promise<BloggerPost> {
  const payload = await bloggerRequest<Record<string, unknown>>(
    'POST',
    `/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}/publish`,
    accessToken,
  );
  const id = asString(payload.id);
  if (!id) throw new ProviderError('server', 'Blogger did not return the published post id');
  return { id, title: asString(payload.title) ?? '', published: asString(payload.published) };
}

/** Delete a post (used by the Phase 3 acceptance: create + delete a test draft). */
export async function deletePost(
  accessToken: string,
  blogId: string,
  postId: string,
): Promise<void> {
  await bloggerRequest<unknown>(
    'DELETE',
    `/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`,
    accessToken,
  );
}
