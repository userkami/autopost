import { count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { blogs } from '@/db/schema';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/guards';
import { env } from '@/lib/env';
import { bloggerConnectLimiter } from '@/lib/ratelimit';
import { effectiveBlogLimit } from '@/lib/settings';
import { buildAuthorizationUrl, createOauthState, pruneOauthStates } from '@/lib/blogger/oauth';

/**
 * GET /api/blogger/connect (PLAN.md §6.2.1).
 * Authenticated: enforce the blog limit BEFORE redirecting to Google, then
 * create a user-bound `state` + PKCE challenge (10-min TTL) and send the user
 * to Google's authorization endpoint.
 *
 * `?reconnect=1` skips the limit check — re-authorizing an existing connection
 * does not create a blog.
 */

function redirectTo(path: string, error?: string): NextResponse {
  const url = new URL(path, env.APP_URL);
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/login', env.APP_URL));

  if (!bloggerConnectLimiter.check(`blogger:${user.id}`)) {
    return redirectTo('/connect', 'Too many connect attempts — wait a minute and try again');
  }
  if (!env.AUTH_GOOGLE_ID) {
    return redirectTo('/connect', 'Google OAuth is not configured yet (see HUMAN_TASKS.md item 2)');
  }

  const { searchParams } = new URL(request.url);
  const isReconnect = searchParams.has('reconnect');

  if (!isReconnect) {
    const [row] = await db.select({ value: count() }).from(blogs).where(eq(blogs.userId, user.id));
    const limit = await effectiveBlogLimit(user.blogLimit);
    if ((row?.value ?? 0) >= limit) {
      return redirectTo(
        '/connect',
        `Blog limit reached (${limit}) — remove a blog or ask an admin to raise your limit`,
      );
    }
  }

  await pruneOauthStates(db).catch(() => undefined); // best-effort housekeeping
  const { state, codeChallenge } = await createOauthState(db, user.id);

  return NextResponse.redirect(
    buildAuthorizationUrl({
      clientId: env.AUTH_GOOGLE_ID,
      redirectUri: `${env.APP_URL}/api/blogger/callback`,
      state,
      codeChallenge,
    }),
  );
}
