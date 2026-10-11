import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { topics } from '@/db/schema';
import type { DbLike } from '@/db/schema';

/** Topic queue operations (PLAN.md §13). Queue order by `position ASC`. */

/** Normalize positions to 1..N without gaps. */
export async function normalizePositions(database: DbLike, blogId: string): Promise<void> {
  const rows = await database
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.blogId, blogId))
    .orderBy(asc(topics.position));
  for (let i = 0; i < rows.length; i++) {
    await database
      .update(topics)
      .set({ position: i + 1, updatedAt: new Date() })
      .where(eq(topics.id, rows[i].id));
  }
}

/** Append new topics at max position + 1, deduplicating by title (case-insensitive). */
export async function addTopics(
  database: DbLike,
  blogId: string,
  titles: string[],
): Promise<{ added: number; duplicates: string[] }> {
  const cleaned = titles
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t, i, arr) => arr.indexOf(t) === i); // dedupe input
  if (cleaned.length === 0) return { added: 0, duplicates: [] };

  // Find existing titles (case-insensitive) to avoid duplicates
  const existing = await database
    .select({ title: topics.title })
    .from(topics)
    .where(
      and(
        eq(topics.blogId, blogId),
        inArray(
          sql`LOWER(${topics.title})`,
          cleaned.map((t) => t.toLowerCase()),
        ),
      ),
    );
  const existingSet = new Set(existing.map((e) => e.title.toLowerCase()));
  const toAdd = cleaned.filter((t) => !existingSet.has(t.toLowerCase()));
  const duplicates = cleaned.filter((t) => existingSet.has(t.toLowerCase()));

  if (toAdd.length === 0) return { added: 0, duplicates };

  const [maxPos] = await database
    .select({ max: sql<number>`COALESCE(MAX(${topics.position}), 0)` })
    .from(topics)
    .where(eq(topics.blogId, blogId));
  const startPos = (maxPos?.max ?? 0) + 1;

  await database.insert(topics).values(
    toAdd.map((title, i) => ({
      blogId,
      title,
      position: startPos + i,
      status: 'queued' as const,
      source: 'manual' as const,
    })),
  );

  return { added: toAdd.length, duplicates };
}

/** Skip a topic: set status = 'skipped'. */
export async function skipTopic(database: DbLike, blogId: string, topicId: string): Promise<boolean> {
  const res = await database
    .update(topics)
    .set({ status: 'skipped', updatedAt: new Date() })
    .where(and(eq(topics.id, topicId), eq(topics.blogId, blogId)));
  const count = (res as { rowCount?: number | null }).rowCount ?? 0;
  return count > 0;
}

/** Move a topic up/down by swapping positions with adjacent sibling. */
export async function moveTopic(
  database: DbLike,
  blogId: string,
  topicId: string,
  direction: 'up' | 'down',
): Promise<boolean> {
  const [row] = await database
    .select({ position: topics.position })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.blogId, blogId)))
    .limit(1);
  if (!row) return false;

  const adj = await database
    .select({ id: topics.id, position: topics.position })
    .from(topics)
    .where(
      and(
        eq(topics.blogId, blogId),
        direction === 'up'
          ? sql`${topics.position} < ${row.position}`
          : sql`${topics.position} > ${row.position}`,
      ),
    )
    .orderBy(direction === 'up' ? desc(topics.position) : asc(topics.position))
    .limit(1);
  if (!adj.length) return false;

  await database.transaction(async (tx) => {
    await tx
      .update(topics)
      .set({ position: adj[0].position, updatedAt: new Date() })
      .where(eq(topics.id, topicId));
    await tx
      .update(topics)
      .set({ position: row.position, updatedAt: new Date() })
      .where(eq(topics.id, adj[0].id));
  });
  return true;
}

/** Get all topics for a blog, ordered by position. */
export async function getBlogTopics(database: DbLike, blogId: string) {
  return database
    .select()
    .from(topics)
    .where(eq(topics.blogId, blogId))
    .orderBy(asc(topics.position));
}