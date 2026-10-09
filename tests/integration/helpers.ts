import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { blogs, blogConnections, users } from '@/db/schema';
import * as schema from '@/db/schema';
import type { User } from '@/db/schema';

/**
 * Integration test harness (PLAN.md §18) — needs a real Postgres.
 *
 * Setup (once): create a dedicated database and migrate it:
 *   $env:DATABASE_URL='postgres://.../autoblog_test'
 *   npm run db:migrate
 *   $env:TEST_DATABASE_URL=$env:DATABASE_URL
 *   npm test
 *
 * Tests using these helpers skip automatically when TEST_DATABASE_URL is not
 * set, so `npm run check` stays green on machines without Docker/Postgres.
 */

export function hasTestDatabase(): boolean {
  return Boolean(process.env.TEST_DATABASE_URL);
}

function makeDb(pool: Pool) {
  return drizzle({ client: pool, schema });
}

export type TestDb = ReturnType<typeof makeDb>;

export function createTestDb(): { db: TestDb; pool: Pool; end: () => Promise<void> } {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = makeDb(pool);
  return { db, pool, end: async () => pool.end() };
}

export async function createTestUser(db: TestDb, label: string): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${label}-${randomUUID().slice(0, 8)}@test.local`,
      name: label,
      emailVerified: new Date(),
    })
    .returning();
  if (!row) throw new Error('failed to create test user');
  return row;
}

export async function createTestBlog(
  db: TestDb,
  userId: string,
  bloggerBlogId = `blog-${randomUUID().slice(0, 8)}`,
): Promise<typeof blogs.$inferSelect> {
  const [connection] = await db
    .insert(blogConnections)
    .values({
      userId,
      googleSub: `sub-${randomUUID().slice(0, 8)}`,
      googleEmail: 'conn@test.local',
      refreshTokenEnc: 'v1:test:enc',
      scopes: 'https://www.googleapis.com/auth/blogger',
    })
    .returning();
  if (!connection) throw new Error('failed to create test connection');

  const [blog] = await db
    .insert(blogs)
    .values({
      userId,
      connectionId: connection.id,
      bloggerBlogId,
      name: 'Test blog',
      url: 'https://test.blogspot.com',
    })
    .returning();
  if (!blog) throw new Error('failed to create test blog');
  return blog;
}

/** Cascade on users removes connections/blogs automatically. */
export async function removeTestUsers(db: TestDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(users).where(ids.length === 1 ? eq(users.id, ids[0]!) : inArray(users.id, ids));
}
