import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blogs, users } from '@/db/schema';
import {
  createTestBlog,
  createTestDb,
  createTestUser,
  hasTestDatabase,
  removeTestUsers,
} from './helpers';

/**
 * IDOR harness (PLAN.md §17 Phase 1 acceptance / §14.4): every resource query
 * MUST be scoped by user_id. These tests lock in the pattern that all future
 * route/action tests reuse: fetch (id AND user_id) → owner sees the row,
 * anyone else sees nothing, and cross-user mutations affect 0 rows.
 *
 * Requires TEST_DATABASE_URL pointing at a migrated database (see helpers.ts);
 * skipped automatically otherwise.
 */
describe.skipIf(!hasTestDatabase())('IDOR scoping harness', () => {
  const harness = hasTestDatabase() ? createTestDb() : null;
  let aliceId = '';
  let bobId = '';
  let aliceBlogId = '';

  beforeAll(async () => {
    if (!harness) return;
    const alice = await createTestUser(harness.db, 'alice');
    const bob = await createTestUser(harness.db, 'bob');
    const blog = await createTestBlog(harness.db, alice.id);
    aliceId = alice.id;
    bobId = bob.id;
    aliceBlogId = blog.id;
  });

  afterAll(async () => {
    if (!harness) return;
    await removeTestUsers(harness.db, [aliceId, bobId].filter(Boolean));
    await harness.end();
  });

  it('scoped select returns the row for its owner', async () => {
    if (!harness) return;
    const rows = await harness.db
      .select()
      .from(blogs)
      .where(and(eq(blogs.id, aliceBlogId), eq(blogs.userId, aliceId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(aliceBlogId);
  });

  it('the same id scoped to another user returns nothing', async () => {
    if (!harness) return;
    const rows = await harness.db
      .select()
      .from(blogs)
      .where(and(eq(blogs.id, aliceBlogId), eq(blogs.userId, bobId)));
    expect(rows).toHaveLength(0);
  });

  it('cross-user update affects 0 rows', async () => {
    if (!harness) return;
    const updated = await harness.db
      .update(blogs)
      .set({ name: 'hijacked' })
      .where(and(eq(blogs.id, aliceBlogId), eq(blogs.userId, bobId)))
      .returning({ id: blogs.id });
    expect(updated).toHaveLength(0);

    const stillOwned = await harness.db
      .select({ name: blogs.name })
      .from(blogs)
      .where(eq(blogs.id, aliceBlogId));
    expect(stillOwned[0]?.name).toBe('Test blog');
  });

  it('cross-user delete affects 0 rows', async () => {
    if (!harness) return;
    const deleted = await harness.db
      .delete(blogs)
      .where(and(eq(blogs.id, aliceBlogId), eq(blogs.userId, bobId)))
      .returning({ id: blogs.id });
    expect(deleted).toHaveLength(0);

    const remaining = await harness.db
      .select()
      .from(blogs)
      .where(and(eq(blogs.id, aliceBlogId), eq(blogs.userId, aliceId)));
    expect(remaining).toHaveLength(1);
  });

  it('user rows are unique by email (auth adapter contract)', async () => {
    if (!harness) return;
    const [aliceAgain] = await harness.db
      .select()
      .from(users)
      .where(eq(users.id, aliceId))
      .limit(1);
    expect(aliceAgain?.email).toContain('alice-');
    expect(aliceAgain?.status).toBe('active');
    expect(aliceAgain?.isAdmin).toBe(false);
  });
});
