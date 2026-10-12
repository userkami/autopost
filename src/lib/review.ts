import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { blogs, posts } from '@/db/schema';
import type { DbLike } from '@/db/schema';
import { logger } from '@/lib/logger';

/**
 * Review expiry (PLAN.md §11 review flow + §13): a worker job `review.expire`
 * runs hourly. Posts past `review_expires_at` become `expired`, unless the blog
 * has `auto_publish_on_expiry`, in which case they are left for the publish
 * path (the caller re-delivers them). Returns the posts it acted on so the
 * worker can enqueue follow-up publishes.
 */

export type ExpireResult = { expired: string[]; toPublish: string[] };

export async function expireReviews(database: DbLike, now: Date = new Date()): Promise<ExpireResult> {
  const due = await database
    .select({
      postId: posts.id,
      blogId: posts.blogId,
      autoPublishOnExpiry: blogs.autoPublishOnExpiry,
      blogName: blogs.name,
      title: posts.title,
    })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(and(eq(posts.status, 'pending_review'), isNotNull(posts.reviewExpiresAt), lt(posts.reviewExpiresAt, now)));

  const expired: string[] = [];
  const toPublish: string[] = [];

  for (const row of due) {
    if (row.autoPublishOnExpiry) {
      toPublish.push(row.postId);
      continue;
    }
    await database
      .update(posts)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(posts.id, row.postId));
    expired.push(row.postId);
  }

  if (expired.length > 0) {
    logger.info({ count: expired.length }, 'review: expired pending posts');
  }
  return { expired, toPublish };
}

/** Post ids in `pending_review` that are due for auto-publish (used by the worker). */
export async function autoPublishCandidates(database: DbLike, postIds: readonly string[]): Promise<string[]> {
  if (postIds.length === 0) return [];
  const rows = await database
    .select({ id: posts.id })
    .from(posts)
    .where(and(inArray(posts.id, [...postIds]), eq(posts.status, 'pending_review')));
  return rows.map((r) => r.id);
}
