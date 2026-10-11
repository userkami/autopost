import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blogs, blogConnections, notifications, oauthStates, schedules, users } from '@/db/schema';
import { encrypt } from '@/lib/crypto';
import { consumeOauthState, createOauthState } from '@/lib/blogger/oauth';
import {
  connectBlogTransactional,
  markNeedsReconnect,
  restoreConnection,
  upsertConnection,
} from '@/lib/blogger/service';
import { createTestDb, createTestUser, hasTestDatabase, removeTestUsers } from './helpers';

/**
 * Phase 3 DB-backed acceptance (PLAN.md §17): single-use OAuth state,
 * google_sub dedupe, transactional blog limit (incl. concurrent attempts),
 * and the invalid_grant flip (statuses + schedule disable + notification)
 * with its restore path.
 *
 * Requires TEST_DATABASE_URL pointing at a migrated database (helpers.ts);
 * skipped automatically otherwise.
 */
describe.skipIf(!hasTestDatabase())('Blogger connect integration (Phase 3)', () => {
  const harness = hasTestDatabase() ? createTestDb() : null;
  let aliceId = '';
  let bobId = '';

  beforeAll(async () => {
    if (!harness) return;
    aliceId = (await createTestUser(harness.db, 'blogger-alice')).id;
    bobId = (await createTestUser(harness.db, 'blogger-bob')).id;
  });

  afterAll(async () => {
    if (!harness) return;
    await removeTestUsers(harness.db, [aliceId, bobId].filter(Boolean));
    await harness.end();
  });

  it('oauth state is single-use, user-bound and TTL-checked', async () => {
    if (!harness || !aliceId) return;
    const { state, codeChallenge } = await createOauthState(harness.db, aliceId);
    expect(codeChallenge.length).toBeGreaterThan(20);

    // Wrong user cannot consume (and must not burn the state).
    expect(await consumeOauthState(harness.db, state, bobId)).toBeNull();
    const first = await consumeOauthState(harness.db, state, aliceId);
    expect(first?.verifier).toBeTruthy();
    // Second attempt: gone.
    expect(await consumeOauthState(harness.db, state, aliceId)).toBeNull();

    // Expired state is rejected.
    const expired = `expired-${randomUUID()}`;
    await harness.db.insert(oauthStates).values({
      state: expired,
      userId: aliceId,
      codeVerifierEnc: encrypt('verifier'),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await consumeOauthState(harness.db, expired, aliceId)).toBeNull();
    await harness.db.delete(oauthStates).where(eq(oauthStates.state, expired));
  });

  it('upsert dedupes by google_sub per user (update, not insert)', async () => {
    if (!harness || !aliceId) return;
    const sub = `sub-${randomUUID().slice(0, 8)}`;
    const first = await upsertConnection(harness.db, {
      userId: aliceId,
      sub,
      email: 'first@example.com',
      refreshToken: 'refresh-one',
      scopes: 'openid email',
    });
    expect(first.isNew).toBe(true);
    expect(first.wasNeedsReconnect).toBe(false);

    const second = await upsertConnection(harness.db, {
      userId: aliceId,
      sub,
      email: 'first@example.com',
      refreshToken: 'refresh-two',
      scopes: 'openid email https://www.googleapis.com/auth/blogger',
    });
    expect(second.isNew).toBe(false);
    expect(second.connection.id).toBe(first.connection.id);
    expect(second.connection.refreshTokenEnc).not.toBe(first.connection.refreshTokenEnc);

    const rows = await harness.db
      .select()
      .from(blogConnections)
      .where(eq(blogConnections.userId, aliceId));
    expect(rows.filter((row) => row.googleSub === sub)).toHaveLength(1);
  });

  it('transactional connect enforces the limit and rejects duplicates', async () => {
    if (!harness || !aliceId) return;
    await harness.db.update(users).set({ blogLimit: 1 }).where(eq(users.id, aliceId));
    const { connection } = await upsertConnection(harness.db, {
      userId: aliceId,
      sub: `sub-limit-${randomUUID().slice(0, 8)}`,
      email: 'limit@example.com',
      refreshToken: 'rt',
      scopes: 'blogger',
    });

    const first = await connectBlogTransactional(harness.db, {
      userId: aliceId,
      connectionId: connection.id,
      blog: { id: 'b-1', name: 'One', url: 'https://one.test' },
    });
    expect(first.ok).toBe(true);

    const duplicate = await connectBlogTransactional(harness.db, {
      userId: aliceId,
      connectionId: connection.id,
      blog: { id: 'b-1', name: 'One again', url: 'https://one.test' },
    });
    expect(duplicate).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/already connected/i),
    });

    const overLimit = await connectBlogTransactional(harness.db, {
      userId: aliceId,
      connectionId: connection.id,
      blog: { id: 'b-2', name: 'Two', url: 'https://two.test' },
    });
    expect(overLimit).toMatchObject({ ok: false, reason: expect.stringMatching(/limit/i) });

    await harness.db.update(users).set({ blogLimit: null }).where(eq(users.id, aliceId));
  });

  it('concurrent connects cannot exceed the limit (FOR UPDATE serialization)', async () => {
    if (!harness || !aliceId) return;
    // Start from a clean slate: no blogs for alice.
    await harness.db.delete(blogs).where(eq(blogs.userId, aliceId));
    await harness.db.update(users).set({ blogLimit: 1 }).where(eq(users.id, aliceId));
    const { connection } = await upsertConnection(harness.db, {
      userId: aliceId,
      sub: `sub-race-${randomUUID().slice(0, 8)}`,
      email: 'race@example.com',
      refreshToken: 'rt',
      scopes: 'blogger',
    });

    const attempt = (id: string) =>
      connectBlogTransactional(harness.db, {
        userId: aliceId,
        connectionId: connection.id,
        blog: { id, name: id, url: `https://${id}.test` },
      });

    const results = await Promise.all([attempt('race-a'), attempt('race-b')]);
    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/limit/i) });

    await harness.db.update(users).set({ blogLimit: null }).where(eq(users.id, aliceId));
  });

  it('invalid_grant flips statuses, disables schedules, notifies — restore reverses it', async () => {
    if (!harness || !aliceId) return;
    const suffix = randomUUID().slice(0, 8);
    const { connection } = await upsertConnection(harness.db, {
      userId: aliceId,
      sub: `sub-flip-${suffix}`,
      email: 'flip@example.com',
      refreshToken: 'rt',
      scopes: 'blogger',
    });

    // Blog 1: schedule enabled (should be paused then restored).
    const [blogOne] = await harness.db
      .insert(blogs)
      .values({
        userId: aliceId,
        connectionId: connection.id,
        bloggerBlogId: `flip-one-${suffix}`,
        name: 'Flip One',
        url: 'https://flip-one.test',
      })
      .returning();
    await harness.db
      .insert(schedules)
      .values({ blogId: blogOne!.id, enabled: true, frequencyType: 'daily' });

    // Blog 2: schedule disabled by the user (must stay disabled).
    const [blogTwo] = await harness.db
      .insert(blogs)
      .values({
        userId: aliceId,
        connectionId: connection.id,
        bloggerBlogId: `flip-two-${suffix}`,
        name: 'Flip Two',
        url: 'https://flip-two.test',
      })
      .returning();
    await harness.db
      .insert(schedules)
      .values({ blogId: blogTwo!.id, enabled: false, frequencyType: 'daily' });

    await markNeedsReconnect(harness.db, connection.id, 'invalid_grant: token expired');

    const [flippedConn] = await harness.db
      .select()
      .from(blogConnections)
      .where(eq(blogConnections.id, connection.id));
    expect(flippedConn?.status).toBe('needs_reconnect');
    expect(flippedConn?.lastError).toMatch(/invalid_grant/);

    const flippedBlogs = await harness.db
      .select()
      .from(blogs)
      .where(inArray(blogs.id, [blogOne!.id, blogTwo!.id]));
    expect(flippedBlogs.every((blog) => blog.status === 'needs_reconnect')).toBe(true);

    const [schedOne, schedTwo] = await harness.db
      .select()
      .from(schedules)
      .where(inArray(schedules.blogId, [blogOne!.id, blogTwo!.id]));
    expect(schedOne).toMatchObject({ enabled: false, pausedForReconnect: true });
    expect(schedTwo).toMatchObject({ enabled: false, pausedForReconnect: false });

    const [notification] = await harness.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, aliceId))
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    expect(notification?.type).toBe('reconnect_needed');
    expect(notification?.link).toBe('/connect');
    expect(notification?.readAt).toBeNull();

    // Restore path (what the callback runs after a successful re-auth).
    await restoreConnection(harness.db, connection.id);

    const [restoredConn] = await harness.db
      .select()
      .from(blogConnections)
      .where(eq(blogConnections.id, connection.id));
    expect(restoredConn?.status).toBe('active');
    expect(restoredConn?.lastError).toBeNull();

    const restoredBlogs = await harness.db
      .select()
      .from(blogs)
      .where(inArray(blogs.id, [blogOne!.id, blogTwo!.id]));
    expect(restoredBlogs.every((blog) => blog.status === 'active')).toBe(true);

    const [restoredOne, restoredTwo] = await harness.db
      .select()
      .from(schedules)
      .where(inArray(schedules.blogId, [blogOne!.id, blogTwo!.id]));
    expect(restoredOne).toMatchObject({ enabled: true, pausedForReconnect: false });
    expect(restoredTwo).toMatchObject({ enabled: false, pausedForReconnect: false });

    const [readNotification] = await harness.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notification!.id));
    expect(readNotification?.readAt).not.toBeNull();

    // Cleanup rows tied to this test's connection (user cascade covers the rest).
    await harness.db.delete(blogConnections).where(eq(blogConnections.id, connection.id));
  });
});
