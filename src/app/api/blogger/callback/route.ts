import { NextResponse } from 'next/server';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/guards';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { recordAuditSafe } from '@/lib/audit';
import { toProviderError } from '@/lib/providers/errors';
import {
  accessTokenCache,
  consumeOauthState,
  decodeIdToken,
  exchangeCode,
} from '@/lib/blogger/oauth';
import { restoreConnection, upsertConnection } from '@/lib/blogger/service';

/**
 * GET /api/blogger/callback (PLAN.md §6.2.2).
 * Validates `state` (single-use, TTL, user match), exchanges the code —
 * requiring a refresh token — encrypts it into `blog_connections` (dedupe by
 * `google_sub` per user), then lands the user on the blog picker. A successful
 * re-auth of a `needs_reconnect` connection restores it and its schedules.
 */

function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  const url = new URL(path, env.APP_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

function failWith(message: string): NextResponse {
  logger.warn('blogger callback failed'); // message goes to the user, not the log (may carry provider details)
  return redirectTo('/connect', { error: message });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return redirectTo('/login', { error: 'Your session expired — sign in and connect again' });
  }

  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get('error');
  if (oauthError) {
    const message =
      oauthError === 'access_denied'
        ? 'Google authorization was cancelled'
        : `Google returned an error (${oauthError})`;
    return failWith(message);
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code || !state) return failWith('Incomplete authorization response — please try again');

  const consumed = await consumeOauthState(db, state, user.id);
  if (!consumed)
    return failWith('The authorization session expired or was already used — please try again');

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode({
      code,
      codeVerifier: consumed.verifier,
      redirectUri: `${env.APP_URL}/api/blogger/callback`,
    });
  } catch (error) {
    // ProviderError messages here are written for users (no secrets).
    const providerError = toProviderError(error, 'Could not complete Google authorization');
    return failWith(providerError.message);
  }

  const identity = tokens.idToken ? decodeIdToken(tokens.idToken) : null;
  if (!identity?.sub || !identity.email) {
    return failWith(
      'Google did not return the account details — please retry and approve all permissions',
    );
  }

  let result: Awaited<ReturnType<typeof upsertConnection>>;
  try {
    result = await upsertConnection(db, {
      userId: user.id,
      sub: identity.sub,
      email: identity.email,
      refreshToken: tokens.refreshToken ?? '',
      scopes: tokens.scope ?? '',
    });
  } catch (error) {
    logger.error({ err: error }, 'failed to store blog connection');
    return failWith('Could not save the Google connection — please try again');
  }

  accessTokenCache.prime(result.connection.id, tokens.accessToken, tokens.expiresInSeconds);
  if (result.wasNeedsReconnect) await restoreConnection(db, result.connection.id);

  await recordAuditSafe({
    actorId: user.id,
    action: result.isNew ? 'blogger.connect' : 'blogger.reconnect',
    targetType: 'blog_connection',
    targetId: result.connection.id,
    meta: { google_email: identity.email, scopes: tokens.scope },
  });

  return redirectTo('/connect', {
    connectionId: result.connection.id,
    status: result.isNew
      ? 'Google account connected — pick a blog below'
      : 'Google account reconnected — schedules were restored',
  });
}
