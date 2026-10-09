import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { invites, sessions, users } from '@/db/schema';
import { db } from '@/db';
import { env } from '@/lib/env';
import {
  evaluateSignIn,
  isAdminEmail,
  parseAdminEmails,
  type SignInDenyReason,
} from '@/lib/auth-policy';
import { logger } from '@/lib/logger';
import { settings } from '@/lib/settings';

/**
 * Dev-only login (PLAN.md §17 Phase 1 acceptance) — enabled only when
 * ENABLE_MOCK_PROVIDERS=true AND NODE_ENV !== 'production'.
 *
 * This creates a normal database session row and sets the same cookie Auth.js
 * uses, so `auth()`, guards and `signOut` work unchanged. It does NOT use an
 * Auth.js Credentials provider because that branch issues a JWT cookie that
 * database sessions cannot read (verified in @auth/core source; see DECISIONS.md).
 */

export const DEV_CREDENTIALS = { email: 'dev@example.com', password: 'dev' } as const;

export const devLoginEnabled = env.ENABLE_MOCK_PROVIDERS && env.NODE_ENV !== 'production';

/** Matches Auth.js default session maxAge (30 days). */
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type DevLoginError = 'disabled' | 'invalid_credentials' | SignInDenyReason;
export type DevLoginResult = { ok: true } | { ok: false; error: DevLoginError };

export async function devLogin(email: string, password: string): Promise<DevLoginResult> {
  if (!devLoginEnabled) return { ok: false, error: 'disabled' };

  const normalized = email.trim().toLowerCase();
  if (normalized !== DEV_CREDENTIALS.email || password !== DEV_CREDENTIALS.password) {
    return { ok: false, error: 'invalid_credentials' };
  }

  const now = new Date();
  await db
    .insert(users)
    .values({ email: normalized, name: 'Dev User', emailVerified: now })
    .onConflictDoNothing();

  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!user) throw new Error('dev user could not be created');

  const signupsMode = await settings.get('signups_mode');
  let hasInvite = false;
  if (signupsMode === 'invite_only') {
    const [invite] = await db
      .select()
      .from(invites)
      .where(and(eq(invites.email, normalized), isNull(invites.usedAt)))
      .limit(1);
    hasInvite = Boolean(invite);
  }

  const decision = evaluateSignIn({
    email: normalized,
    isAdminEmail: isAdminEmail(normalized, parseAdminEmails(env.ADMIN_EMAILS)),
    signupsMode,
    hasInvite,
    existingUser: { status: user.status, deletedAt: user.deletedAt },
  });
  if (!decision.allow) return { ok: false, error: decision.reason ?? 'invalid_credentials' };

  await db
    .update(users)
    .set({
      lastLoginAt: now,
      ...(decision.grantAdmin ? { isAdmin: true } : {}),
    })
    .where(eq(users.id, user.id));
  if (decision.consumeInvite) {
    await db
      .update(invites)
      .set({ usedAt: now })
      .where(and(eq(invites.email, normalized), isNull(invites.usedAt)));
  }

  const sessionToken = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS);
  await db.insert(sessions).values({ sessionToken, userId: user.id, expires });

  // Same cookie name/attributes Auth.js uses (lib/utils/cookie.js: defaultCookies).
  const secure = env.APP_URL.startsWith('https://');
  const cookieName = `${secure ? '__Secure-' : ''}authjs.session-token`;
  (await cookies()).set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    expires,
  });

  logger.info({ email: normalized }, 'dev login succeeded');
  return { ok: true };
}
