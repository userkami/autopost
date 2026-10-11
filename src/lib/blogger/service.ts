import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { blogs, blogConnections, notifications, schedules, users } from '@/db/schema';
import type { DbLike } from '@/db/schema';
import { db } from '@/db';
import { decrypt, encrypt } from '@/lib/crypto';
import { effectiveBlogLimit } from '@/lib/settings';
import { ProviderError } from '@/lib/providers/errors';
import { logger } from '@/lib/logger';
import { accessTokenCache } from './oauth';
import { listBlogs, type BloggerBlog } from './client';

/**
 * Blogger connection + blog persistence (PLAN.md §6.2, §6.3, §10).
 * Secrets (`refresh_token_enc`) are encrypted at rest and never appear in
 * public shapes (PLAN.md §14.2); every query is scoped by user_id (§14.4);
 * the blog limit is re-checked inside the creating transaction (§10).
 */

export type BlogConnectionRow = typeof blogConnections.$inferSelect;
export type BlogRow = typeof blogs.$inferSelect;

/** Browser-safe connection row: no refresh token, only a hint it exists. */
export type PublicBlogConnection = {
  id: string;
  googleEmail: string;
  status: 'active' | 'needs_reconnect' | 'revoked';
  scopes: string;
  lastError: string | null;
  createdAt: Date;
};

export function toPublicBlogConnection(row: BlogConnectionRow): PublicBlogConnection {
  return {
    id: row.id,
    googleEmail: row.googleEmail,
    status: row.status,
    scopes: row.scopes,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// lookups (always user-scoped — PLAN.md §14.4)
// ---------------------------------------------------------------------------

export async function listBlogConnections(
  database: DbLike,
  userId: string,
): Promise<BlogConnectionRow[]> {
  return database
    .select()
    .from(blogConnections)
    .where(eq(blogConnections.userId, userId))
    .orderBy(asc(blogConnections.createdAt));
}

export async function getBlogConnection(
  database: DbLike,
  userId: string,
  connectionId: string,
): Promise<BlogConnectionRow | null> {
  const [row] = await database
    .select()
    .from(blogConnections)
    .where(and(eq(blogConnections.id, connectionId), eq(blogConnections.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function listUserBlogs(database: DbLike, userId: string): Promise<BlogRow[]> {
  return database
    .select()
    .from(blogs)
    .where(eq(blogs.userId, userId))
    .orderBy(asc(blogs.createdAt));
}

// ---------------------------------------------------------------------------
// token access (PLAN.md §6.3)
// ---------------------------------------------------------------------------

/** Refresh token decrypted for the cache; auth failures flip the connection. */
export async function getValidAccessToken(
  database: DbLike,
  connection: BlogConnectionRow,
): Promise<string> {
  if (connection.status !== 'active') {
    throw new ProviderError('auth', 'This Google account needs to be reconnected');
  }
  try {
    return await accessTokenCache.get(connection.id, decrypt(connection.refreshTokenEnc));
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'auth') {
      await markNeedsReconnect(database, connection.id, error.message);
    }
    throw error;
  }
}

/**
 * Run a Blogger API call with a valid token; a 401 mid-call flips the
 * connection to `needs_reconnect` (PLAN.md §6.3).
 */
export async function withConnectionAuth<T>(
  database: DbLike,
  connection: BlogConnectionRow,
  call: (accessToken: string) => Promise<T>,
): Promise<T> {
  const accessToken = await getValidAccessToken(database, connection);
  try {
    return await call(accessToken);
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'auth') {
      await markNeedsReconnect(database, connection.id, error.message);
    }
    throw error;
  }
}

/** Blogs available to connect on a connection (remote list, minus ours). */
export async function listAvailableBlogs(
  database: DbLike,
  userId: string,
  connectionId: string,
): Promise<{ connection: BlogConnectionRow; available: BloggerBlog[] }> {
  const connection = await getBlogConnection(database, userId, connectionId);
  if (!connection) throw new ProviderError('not_found', 'Connection not found');
  const remote = await withConnectionAuth(database, connection, listBlogs);
  const mine = await database
    .select({ bloggerBlogId: blogs.bloggerBlogId })
    .from(blogs)
    .where(eq(blogs.userId, userId));
  const connected = new Set(mine.map((row) => row.bloggerBlogId));
  return { connection, available: remote.filter((blog) => !connected.has(blog.id)) };
}

// ---------------------------------------------------------------------------
// connection upsert + reconnect handling (PLAN.md §6.2.2, §6.3)
// ---------------------------------------------------------------------------

export type UpsertConnectionResult = {
  connection: BlogConnectionRow;
  isNew: boolean;
  wasNeedsReconnect: boolean;
};

/** Dedupe by `google_sub` per user — update instead of insert (PLAN.md §6.2.2). */
export async function upsertConnection(
  database: DbLike,
  input: { userId: string; sub: string; email: string; refreshToken: string; scopes: string },
): Promise<UpsertConnectionResult> {
  const [existing] = await database
    .select()
    .from(blogConnections)
    .where(and(eq(blogConnections.userId, input.userId), eq(blogConnections.googleSub, input.sub)))
    .limit(1);

  const refreshTokenEnc = encrypt(input.refreshToken);
  if (existing) {
    const [updated] = await database
      .update(blogConnections)
      .set({
        googleEmail: input.email,
        refreshTokenEnc,
        scopes: input.scopes,
        status: 'active',
        lastError: null,
      })
      .where(eq(blogConnections.id, existing.id))
      .returning();
    return {
      connection: updated ?? existing,
      isNew: false,
      wasNeedsReconnect: existing.status === 'needs_reconnect',
    };
  }

  const [inserted] = await database
    .insert(blogConnections)
    .values({
      userId: input.userId,
      googleSub: input.sub,
      googleEmail: input.email,
      refreshTokenEnc,
      scopes: input.scopes,
      status: 'active',
    })
    .returning();
  if (!inserted) throw new Error('failed to store blog connection');
  return { connection: inserted, isNew: true, wasNeedsReconnect: false };
}

/**
 * invalid_grant / 401 handling (PLAN.md §6.3): flip the connection and its
 * active blogs to `needs_reconnect`, DISABLE their schedules (remembering which
 * were on via `paused_for_reconnect`), and create an in-app notification.
 */
export async function markNeedsReconnect(
  database: DbLike,
  connectionId: string,
  reason: string,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [connection] = await tx
      .update(blogConnections)
      .set({ status: 'needs_reconnect', lastError: reason })
      .where(eq(blogConnections.id, connectionId))
      .returning();
    if (!connection) return;

    const affected = await tx
      .update(blogs)
      .set({ status: 'needs_reconnect', updatedAt: new Date() })
      .where(and(eq(blogs.connectionId, connectionId), eq(blogs.status, 'active')))
      .returning({ id: blogs.id });
    const blogIds = affected.map((row) => row.id);

    if (blogIds.length > 0) {
      await tx
        .update(schedules)
        .set({ enabled: false, pausedForReconnect: true, updatedAt: new Date() })
        .where(and(inArray(schedules.blogId, blogIds), eq(schedules.enabled, true)));
    }

    await tx.insert(notifications).values({
      userId: connection.userId,
      type: 'reconnect_needed',
      title: 'Blogger connection needs attention',
      body: `${connection.googleEmail} was rejected by Google (${reason}). Schedules for its blogs are paused until you reconnect.`,
      link: '/connect',
    });
  });
  logger.warn({ connectionId }, 'blog connection marked needs_reconnect');
}

/** Inverse of markNeedsReconnect after a successful re-auth (PLAN.md §6.3). */
export async function restoreConnection(database: DbLike, connectionId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [connection] = await tx
      .update(blogConnections)
      .set({ status: 'active', lastError: null })
      .where(
        and(eq(blogConnections.id, connectionId), eq(blogConnections.status, 'needs_reconnect')),
      )
      .returning();
    if (!connection) return;

    const affected = await tx
      .update(blogs)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(blogs.connectionId, connectionId), eq(blogs.status, 'needs_reconnect')))
      .returning({ id: blogs.id });
    const blogIds = affected.map((row) => row.id);

    if (blogIds.length > 0) {
      await tx
        .update(schedules)
        .set({ enabled: true, pausedForReconnect: false, updatedAt: new Date() })
        .where(and(inArray(schedules.blogId, blogIds), eq(schedules.pausedForReconnect, true)));
    }

    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, connection.userId),
          eq(notifications.type, 'reconnect_needed'),
          isNull(notifications.readAt),
        ),
      );
  });
  logger.info({ connectionId }, 'blog connection restored after reconnect');
}

// ---------------------------------------------------------------------------
// transactional blog connect (PLAN.md §6.2.3, §10)
// ---------------------------------------------------------------------------

export type ConnectBlogResult = { ok: true; blog: BlogRow } | { ok: false; reason: string };

/**
 * Create a `blogs` row with the limit re-checked INSIDE the transaction
 * (PLAN.md §6.2.3 / §10 "race-safe"): the user row is locked with FOR UPDATE so
 * two concurrent connects serialize and the second sees the first's insert.
 */
export async function connectBlogTransactional(
  database: DbLike,
  input: { userId: string; connectionId: string; blog: BloggerBlog },
): Promise<ConnectBlogResult> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${input.userId} for update`);

    const [userRow] = await tx
      .select({ blogLimit: users.blogLimit })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!userRow) return { ok: false, reason: 'Account not found' };

    const [connection] = await tx
      .select()
      .from(blogConnections)
      .where(
        and(eq(blogConnections.id, input.connectionId), eq(blogConnections.userId, input.userId)),
      )
      .limit(1);
    if (!connection) return { ok: false, reason: 'Google connection not found' };
    if (connection.status !== 'active')
      return { ok: false, reason: 'Reconnect your Google account first' };

    const [existing] = await tx
      .select({ id: blogs.id })
      .from(blogs)
      .where(and(eq(blogs.userId, input.userId), eq(blogs.bloggerBlogId, input.blog.id)))
      .limit(1);
    if (existing) return { ok: false, reason: 'This blog is already connected' };

    const [blogCount] = await tx
      .select({ value: count() })
      .from(blogs)
      .where(eq(blogs.userId, input.userId));
    const limit = await effectiveBlogLimit(userRow.blogLimit);
    if ((blogCount?.value ?? 0) >= limit) {
      return {
        ok: false,
        reason: `Blog limit reached (${limit}) — remove a blog or ask an admin to raise your limit`,
      };
    }

    const [row] = await tx
      .insert(blogs)
      .values({
        userId: input.userId,
        connectionId: connection.id,
        bloggerBlogId: input.blog.id,
        name: input.blog.name,
        url: input.blog.url,
      })
      .returning();
    if (!row) return { ok: false, reason: 'Could not save the blog' };
    return { ok: true, blog: row };
  });
}

/** Convenience for callers holding the default `db` (routes/actions). */
export async function connectBlog(input: {
  userId: string;
  connectionId: string;
  blog: BloggerBlog;
}): Promise<ConnectBlogResult> {
  return connectBlogTransactional(db, input);
}
