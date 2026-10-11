import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  request: vi.fn(),
}));

import {
  ACCESS_TOKEN_SKEW_MS,
  AccessTokenCache,
  CONNECT_SCOPES,
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  decodeIdToken,
  exchangeCode,
  refreshAccessToken,
} from '@/lib/blogger/oauth';
import {
  createPost,
  deletePost,
  listBlogs,
  listRecentPosts,
  publishPost,
} from '@/lib/blogger/client';
import { ProviderError } from '@/lib/providers/errors';
import { mockedRequest, queueResponses } from './http-mock';

/**
 * Phase 3 unit tests (PLAN.md §6.2, §6.3, §17): authorization URL + PKCE,
 * ID token claims, code exchange (refresh token REQUIRED), token refresh,
 * the in-memory access token cache, and the Blogger client with mocked HTTP
 * (backoff, 401/403 mapping). DB-backed flows live in tests/integration.
 */

beforeEach(() => {
  mockedRequest.mockReset();
});

function makeIdToken(claims: Record<string, unknown>): string {
  return ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join(
    '.',
  );
}

describe('authorization URL + PKCE (PLAN.md §6.2.1, §14.5)', () => {
  it('builds the Google consent URL with state, PKCE, offline and consent prompts', () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: 'client-123',
        redirectUri: 'https://app.test/api/blogger/callback',
        state: 'state-abc',
        codeChallenge: 'challenge-xyz',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/blogger/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent select_account');
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/blogger');
    expect(scope).toContain('openid');
    expect(scope).toBe(CONNECT_SCOPES);
  });

  it('PKCE challenge is base64url(SHA-256(verifier)) and values are random', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    const expected = createHash('sha256').update(a.verifier).digest('base64url');
    expect(a.challenge).toBe(expected);
    expect(a.verifier).not.toBe(a.challenge);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('state values are long and unique', () => {
    const one = createState();
    expect(one).not.toBe(createState());
    expect(one.length).toBeGreaterThanOrEqual(40);
  });
});

describe('ID token claims (PLAN.md §6.2.2)', () => {
  it('decodes sub and email', () => {
    const token = makeIdToken({ sub: 'google-sub-1', email: 'writer@gmail.com' });
    expect(decodeIdToken(token)).toEqual({ sub: 'google-sub-1', email: 'writer@gmail.com' });
  });

  it('rejects malformed tokens or missing sub', () => {
    expect(decodeIdToken('not-a-jwt')).toBeNull();
    expect(decodeIdToken('a.%%%,b')).toBeNull();
    expect(decodeIdToken(makeIdToken({ email: 'x@y.z' }))).toBeNull();
  });
});

describe('code exchange + refresh (PLAN.md §6.2.2, §6.3)', () => {
  it('exchanges the code with PKCE and returns the refresh token', async () => {
    queueResponses({
      text: JSON.stringify({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3599,
        scope: CONNECT_SCOPES,
        id_token: makeIdToken({ sub: 's1', email: 'a@b.c' }),
      }),
    });
    const result = await exchangeCode({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://app.test/api/blogger/callback',
    });
    expect(result).toMatchObject({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresInSeconds: 3599,
    });

    const [url, opts] = mockedRequest.mock.calls[0] as [string, { body?: string }];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(opts.body ?? '');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('code-1');
    expect(form.get('code_verifier')).toBe('verifier-1');
    expect(form.get('redirect_uri')).toBe('https://app.test/api/blogger/callback');
  });

  it('requires a refresh token with a "retry and approve all permissions" error', async () => {
    queueResponses({ text: JSON.stringify({ access_token: 'at-only', expires_in: 3600 }) });
    await expect(
      exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'https://app.test/r' }),
    ).rejects.toThrow(/retry and approve all permissions/i);
  });

  it('maps invalid_grant to an auth error telling the user to reconnect', async () => {
    queueResponses({ statusCode: 400, text: JSON.stringify({ error: 'invalid_grant' }) });
    const error = await refreshAccessToken('rt-old').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'auth' });
    expect((error as Error).message).toMatch(/reconnect/i);
  });

  it('refresh returns the new access token', async () => {
    queueResponses({ text: JSON.stringify({ access_token: 'at-2', expires_in: 1800 }) });
    await expect(refreshAccessToken('rt-1')).resolves.toEqual({
      accessToken: 'at-2',
      expiresInSeconds: 1800,
    });
  });
});

describe('access token cache (PLAN.md §6.3)', () => {
  it('serves primed tokens and refreshes ~60s before expiry', async () => {
    let now = 0;
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'at-fresh', expiresInSeconds: 3600 });
    const cache = new AccessTokenCache({ refresh, now: () => now });

    cache.prime('conn-1', 'at-primed', 3600);
    await expect(cache.get('conn-1', 'rt-1')).resolves.toBe('at-primed');
    expect(refresh).not.toHaveBeenCalled();

    // Inside the skew window → refresh.
    now = 3600 * 1000 - ACCESS_TOKEN_SKEW_MS + 1;
    await expect(cache.get('conn-1', 'rt-1')).resolves.toBe('at-fresh');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('rt-1');

    // Fresh token is cached again.
    await expect(cache.get('conn-1', 'rt-1')).resolves.toBe('at-fresh');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('clears the entry when the refresh fails so the next call retries', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('auth', 'expired'))
      .mockResolvedValueOnce({ accessToken: 'at-retry', expiresInSeconds: 3600 });
    const cache = new AccessTokenCache({ refresh, now: () => 0 });
    cache.prime('conn-2', 'at-old', 0); // already expired

    await expect(cache.get('conn-2', 'rt')).rejects.toMatchObject({ kind: 'auth' });
    await expect(cache.get('conn-2', 'rt')).resolves.toBe('at-retry');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('Blogger client with mocked HTTP (PLAN.md §6.3, §17 Phase 3)', () => {
  it('listBlogs parses items and skips malformed entries', async () => {
    queueResponses({
      text: JSON.stringify({
        items: [
          { id: '1', name: 'My Blog', url: 'https://my.blogspot.com' },
          { id: '2', name: 'No url' },
          'garbage',
        ],
      }),
    });
    await expect(listBlogs('at')).resolves.toEqual([
      { id: '1', name: 'My Blog', url: 'https://my.blogspot.com' },
    ]);

    const [url, opts] = mockedRequest.mock.calls[0] as [
      string,
      { headers?: Record<string, string> },
    ];
    expect(url).toBe('https://www.googleapis.com/blogger/v3/users/self/blogs');
    expect(opts.headers?.authorization).toBe('Bearer at');
  });

  it('listRecentPosts requests titles only for dedupe', async () => {
    queueResponses({
      text: JSON.stringify({ items: [{ id: 'p1', title: 'Hello', published: '2026-01-01' }] }),
    });
    await expect(listRecentPosts('at', 'blog-1')).resolves.toMatchObject([
      { id: 'p1', title: 'Hello' },
    ]);
    const [url] = mockedRequest.mock.calls[0] as [string];
    expect(url).toBe(
      'https://www.googleapis.com/blogger/v3/blogs/blog-1/posts?fetchBodies=false&maxResults=50&orderBy=published',
    );
  });

  it('createPost sends the blogger#post body and isDraft flag', async () => {
    queueResponses({ text: JSON.stringify({ id: 'p9', title: 'T', published: null }) });
    await expect(
      createPost(
        'at',
        'blog-1',
        { title: 'T', content: '<p>c</p>', labels: ['ai'] },
        { isDraft: true },
      ),
    ).resolves.toMatchObject({ id: 'p9' });
    const [url, opts] = mockedRequest.mock.calls[0] as [string, { body?: string }];
    expect(url).toBe('https://www.googleapis.com/blogger/v3/blogs/blog-1/posts?isDraft=true');
    expect(JSON.parse(opts.body ?? '{}')).toMatchObject({
      kind: 'blogger#post',
      title: 'T',
      content: '<p>c</p>',
      labels: ['ai'],
    });
  });

  it('publishPost and deletePost target the post paths (ids are encoded)', async () => {
    queueResponses({ text: JSON.stringify({ id: 'p9', title: 'T', published: 'now' }) });
    await publishPost('at', 'blog/1', 'post/9');
    const [publishUrl] = mockedRequest.mock.calls[0] as [string];
    expect(publishUrl).toBe(
      'https://www.googleapis.com/blogger/v3/blogs/blog%2F1/posts/post%2F9/publish',
    );

    queueResponses({ text: '' });
    await deletePost('at', 'blog-1', 'p9');
    const [deleteUrl, deleteOpts] = mockedRequest.mock.calls[0] as [string, { method?: string }];
    expect(deleteUrl).toBe('https://www.googleapis.com/blogger/v3/blogs/blog-1/posts/p9');
    expect(deleteOpts.method).toBe('DELETE');
  });

  it('maps 401 → auth and 403 → "API not enabled / not permitted"', async () => {
    queueResponses({ statusCode: 401, text: '{}' });
    await expect(listBlogs('at')).rejects.toMatchObject({ kind: 'auth' });

    queueResponses({ statusCode: 403, text: '{}' });
    const error = await listBlogs('at').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('unsupported');
    expect((error as Error).message).toMatch(/not enabled|not permitted/i);
  });

  it('retries 429 with backoff then succeeds (Retry-After honoured)', async () => {
    queueResponses(
      { statusCode: 429, headers: { 'retry-after': '0' }, text: '{}' },
      { text: JSON.stringify({ items: [{ id: '1', name: 'B', url: 'https://b.test' }] }) },
    );
    await expect(listBlogs('at')).resolves.toHaveLength(1);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 attempts with a retryable rate_limit error', async () => {
    queueResponses(
      { statusCode: 429, headers: { 'retry-after': '0' }, text: '{}' },
      { statusCode: 429, headers: { 'retry-after': '0' }, text: '{}' },
      { statusCode: 429, headers: { 'retry-after': '0' }, text: '{}' },
    );
    await expect(listBlogs('at')).rejects.toMatchObject({ kind: 'rate_limit', retryable: true });
    expect(mockedRequest).toHaveBeenCalledTimes(3);
  });

  it('surfaces malformed JSON as a typed provider error', async () => {
    queueResponses({ text: 'not json' });
    const error = await listBlogs('at').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('bad_request');
  });
});
