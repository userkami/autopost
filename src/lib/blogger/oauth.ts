import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { request } from 'undici';
import { oauthStates } from '@/db/schema';
import type { DbLike } from '@/db/schema';
import { decrypt, encrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { ProviderError, toProviderError } from '@/lib/providers/errors';

/**
 * Custom Blogger OAuth flow (PLAN.md §6.2, §14.5).
 *
 * - `state` is random, bound to the session user, stored server-side with a
 *   10-minute TTL and consumed atomically (single-use).
 * - PKCE (S256); the verifier is encrypted at rest (`oauth_states.code_verifier_enc`).
 * - The code exchange REQUIRES a refresh token — the Blogger scope is sensitive
 *   and offline access is the whole point of the flow.
 * - Access tokens are cached in memory per connection and refreshed ~60s before
 *   expiry (PLAN.md §6.3); refresh tokens live encrypted in `blog_connections`.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** PLAN.md §6.2 — 10-min state TTL. */
export const STATE_TTL_MS = 10 * 60_000;

/**
 * Scopes for the connect flow. PLAN.md §6.2 names the Blogger scope; we also
 * request `openid email` because §6.2.2 dedupes by `google_sub` and §5 stores
 * `google_email` — both come from the ID token (DECISIONS #28).
 */
export const CONNECT_SCOPES = 'openid email https://www.googleapis.com/auth/blogger';

/** PLAN.md §6.3 — refresh the access token ~60s before it expires. */
export const ACCESS_TOKEN_SKEW_MS = 60_000;

const TOKEN_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// state + PKCE (pure helpers — unit-tested)
// ---------------------------------------------------------------------------

export type PkcePair = { verifier: string; challenge: string };

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(32).toString('base64url');
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', CONNECT_SCOPES);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Offline access + explicit consent so Google returns a refresh token every
  // time (PLAN.md §6.2.1); select_account lets users pick a different account
  // than the one used to sign in (§5: "may be a different Google account").
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  return url.toString();
}

// ---------------------------------------------------------------------------
// state persistence (DB-backed — integration-tested)
// ---------------------------------------------------------------------------

export async function createOauthState(
  database: DbLike,
  userId: string,
): Promise<{ state: string; codeChallenge: string }> {
  const { verifier, challenge } = createPkcePair();
  const state = createState();
  await database.insert(oauthStates).values({
    state,
    userId,
    codeVerifierEnc: encrypt(verifier),
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return { state, codeChallenge: challenge };
}

/**
 * Atomically consume a state row (DELETE ... RETURNING) — single-use, TTL and
 * user match enforced in one statement (PLAN.md §14.5).
 */
export async function consumeOauthState(
  database: DbLike,
  state: string,
  userId: string,
): Promise<{ verifier: string } | null> {
  const [row] = await database
    .delete(oauthStates)
    .where(
      and(
        eq(oauthStates.state, state),
        eq(oauthStates.userId, userId),
        gt(oauthStates.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) return null;
  return { verifier: decrypt(row.codeVerifierEnc) };
}

/** Best-effort cleanup of expired states (called opportunistically on connect). */
export async function pruneOauthStates(database: DbLike): Promise<void> {
  await database.delete(oauthStates).where(gt(oauthStates.expiresAt, new Date()));
}

// ---------------------------------------------------------------------------
// token endpoint
// ---------------------------------------------------------------------------

export type TokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  scope: string | null;
  idToken: string | null;
};

type TokenPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  id_token?: unknown;
  error?: unknown;
  error_description?: unknown;
};

async function postToken(form: Record<string, string>): Promise<Partial<TokenResponse>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  try {
    const response = await request(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    const text = await response.body.text();
    let payload: TokenPayload = {};
    try {
      payload = JSON.parse(text) as TokenPayload;
    } catch {
      // malformed body — status handling below carries the error
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const error = typeof payload.error === 'string' ? payload.error : 'unknown_error';
      const description =
        typeof payload.error_description === 'string' ? payload.error_description : '';
      if (error === 'invalid_grant') {
        throw new ProviderError(
          'auth',
          'Google rejected the authorization — it may have expired or been revoked. Please reconnect.',
          { status: response.statusCode },
        );
      }
      throw new ProviderError(
        'auth',
        `Google token request failed (${error})${description ? `: ${description}` : ''}`,
        { status: response.statusCode },
      );
    }
    if (typeof payload.access_token !== 'string') {
      throw new ProviderError('auth', 'Google returned no access token — please retry.', {
        status: response.statusCode,
      });
    }
    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      expiresInSeconds: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
      scope: typeof payload.scope === 'string' ? payload.scope : null,
      idToken: typeof payload.id_token === 'string' ? payload.id_token : null,
    };
  } catch (error) {
    throw toProviderError(error, 'Could not reach Google token endpoint');
  } finally {
    clearTimeout(timeout);
  }
}

function tokenFormExtras(): Record<string, string> {
  // A web client has a secret; PKCE alone is sufficient if it is not set.
  return env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
    ? { client_id: env.AUTH_GOOGLE_ID, client_secret: env.AUTH_GOOGLE_SECRET }
    : { client_id: env.AUTH_GOOGLE_ID ?? '' };
}

/** Exchange the authorization code (PLAN.md §6.2.2) — a refresh token is REQUIRED. */
export async function exchangeCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const payload = await postToken({
    ...tokenFormExtras(),
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  if (!payload.refreshToken) {
    throw new ProviderError(
      'auth',
      'Google did not return a refresh token — please retry and approve all permissions.',
    );
  }
  return {
    accessToken: payload.accessToken ?? '',
    refreshToken: payload.refreshToken,
    expiresInSeconds: payload.expiresInSeconds ?? 3600,
    scope: payload.scope ?? null,
    idToken: payload.idToken ?? null,
  };
}

/** Refresh the access token (PLAN.md §6.3). `invalid_grant` → ProviderError(auth). */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresInSeconds: number;
}> {
  const payload = await postToken({
    ...tokenFormExtras(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  return {
    accessToken: payload.accessToken ?? '',
    expiresInSeconds: payload.expiresInSeconds ?? 3600,
  };
}

/**
 * Decode the ID token payload for `sub` / `email` claims. The token comes
 * directly from Google's token endpoint over TLS (never browser-passed), so the
 * payload is trusted without JWT signature verification — no JWT dependency
 * needed (DECISIONS #29, PLAN.md §14.12).
 */
export function decodeIdToken(idToken: string): { sub: string; email: string | null } | null {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
    const email = typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : null;
    return { sub: claims.sub, email };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// in-memory access token cache (PLAN.md §6.3)
// ---------------------------------------------------------------------------

export type AccessTokenRefresh = (
  refreshToken: string,
) => Promise<{ accessToken: string; expiresInSeconds: number }>;

type CachedToken = { accessToken: string; expiresAt: number };

/**
 * Per-process access token cache keyed by connection id. Refreshes ~60s before
 * expiry; clears on auth failure so the next call retries from scratch.
 */
export class AccessTokenCache {
  private readonly entries = new Map<string, CachedToken>();
  private readonly refresh: AccessTokenRefresh;
  private readonly now: () => number;

  constructor(opts: { refresh?: AccessTokenRefresh; now?: () => number } = {}) {
    this.refresh = opts.refresh ?? refreshAccessToken;
    this.now = opts.now ?? Date.now;
  }

  /** Prime the cache after a fresh code exchange (PLAN.md §6.2.2). */
  prime(connectionId: string, accessToken: string, expiresInSeconds: number): void {
    this.entries.set(connectionId, {
      accessToken,
      expiresAt: this.now() + Math.max(expiresInSeconds, 0) * 1000,
    });
  }

  async get(connectionId: string, refreshToken: string): Promise<string> {
    const cached = this.entries.get(connectionId);
    if (cached && cached.expiresAt - this.now() > ACCESS_TOKEN_SKEW_MS) return cached.accessToken;
    try {
      const fresh = await this.refresh(refreshToken);
      this.entries.set(connectionId, {
        accessToken: fresh.accessToken,
        expiresAt: this.now() + Math.max(fresh.expiresInSeconds, 0) * 1000,
      });
      return fresh.accessToken;
    } catch (error) {
      this.entries.delete(connectionId);
      throw error;
    }
  }

  clear(connectionId?: string): void {
    if (connectionId) this.entries.delete(connectionId);
    else this.entries.clear();
  }
}

/** App-wide cache instance (PLAN.md §6.3 — "cache access tokens in memory"). */
export const accessTokenCache = new AccessTokenCache();
