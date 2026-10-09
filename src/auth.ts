import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { and, eq, isNull } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { accounts, invites, sessions, users, verificationTokens } from '@/db/schema';
import { db } from '@/db';
import { env } from '@/lib/env';
import { evaluateSignIn, isAdminEmail, parseAdminEmails } from '@/lib/auth-policy';
import { logger } from '@/lib/logger';
import { settings } from '@/lib/settings';

/**
 * Auth.js v5 (beta) — PLAN.md §2/§6.
 * - Login scopes: openid email profile ONLY (no Blogger scope here; that is the
 *   separate /api/blogger/connect flow from PLAN.md §6.2).
 * - Database sessions (immediate revocation on suspend/delete).
 * - Gate every sign-in through evaluateSignIn (signups_mode, invites,
 *   suspension, ADMIN_EMAILS bootstrap) in callbacks.signIn; apply per-login
 *   updates (last_login_at, is_admin, invite consumption) in events.signIn.
 * - Dev credentials login is implemented as a direct database-session login
 *   (src/lib/dev-login.ts), NOT an Auth.js Credentials provider: with
 *   strategy "database" Auth.js's credentials branch issues a JWT cookie that
 *   the database-session reader cannot resolve (verified in
 *   @auth/core/lib/actions/callback). See DECISIONS.md.
 */

export const googleConfigured = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

const providers: NextAuthConfig['providers'] = [];
if (googleConfigured) {
  providers.push(
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      // Identity only — no Blogger scope (PLAN.md §6.1).
      authorization: { params: { scope: 'openid email profile' } },
    }),
  );
}

const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

export const authConfig = {
  trustHost: true,
  adapter,
  session: { strategy: 'database' },
  pages: { signIn: '/login' },
  providers,
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) {
        logger.warn('sign-in rejected: no email claim');
        return false;
      }

      const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const signupsMode = await settings.get('signups_mode');

      let hasInvite = false;
      if (signupsMode === 'invite_only') {
        const [invite] = await db
          .select()
          .from(invites)
          .where(and(eq(invites.email, email), isNull(invites.usedAt)))
          .limit(1);
        hasInvite = Boolean(invite);
      }

      const decision = evaluateSignIn({
        email,
        isAdminEmail: isAdminEmail(email, parseAdminEmails(env.ADMIN_EMAILS)),
        signupsMode,
        hasInvite,
        existingUser: existing ? { status: existing.status, deletedAt: existing.deletedAt } : null,
      });

      if (!decision.allow) {
        logger.info({ email, reason: decision.reason }, 'sign-in denied');
        return false;
      }
      return true;
    },
    async session({ session, user }) {
      session.user.id = user.id;
      session.user.isAdmin = user.isAdmin ?? false;
      session.user.status = user.status ?? 'active';
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        // fall through
      }
      return baseUrl;
    },
  },
  events: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email || !user.id) return;

      const grantAdmin = isAdminEmail(email, parseAdminEmails(env.ADMIN_EMAILS));
      await db
        .update(users)
        .set({ lastLoginAt: new Date(), ...(grantAdmin ? { isAdmin: true } : {}) })
        .where(eq(users.id, user.id));

      const signupsMode = await settings.get('signups_mode');
      if (signupsMode === 'invite_only') {
        await db
          .update(invites)
          .set({ usedAt: new Date() })
          .where(and(eq(invites.email, email), isNull(invites.usedAt)));
      }
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
