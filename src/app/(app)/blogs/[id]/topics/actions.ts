'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';
import { addTopics, moveTopic, skipTopic } from '@/lib/topics';
import { getBlogForUser } from '@/lib/blog-settings';

/**
 * Topic queue server actions (PLAN.md §13 /blogs/[id]/topics): paste many,
 * reorder, skip. Every operation is scoped to a blog the user owns; the topic
 * itself is re-fetched server-side and never trusted from the client (§14.4).
 */

function topicsPath(blogId: string): string {
  return `/blogs/${blogId}/topics`;
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function ok(path: string, message: string): never {
  redirect(`${path}?status=${encodeURIComponent(message)}`);
}

async function requireOwnedBlog(userId: string, blogId: string) {
  const blog = await getBlogForUser(db, userId, blogId);
  if (!blog) fail('/dashboard', 'Blog not found or access denied');
  return blog;
}

/** Paste many topics, one per line. Dedup is case-insensitive (lib-side). */
export async function addTopicsAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const raw = String(formData.get('titles') ?? '');
  const titles = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (titles.length === 0) fail(topicsPath(blogId), 'Paste at least one topic (one per line)');

  const result = await addTopics(db, blogId, titles);
  await recordAuditSafe({
    actorId: user.id,
    action: 'topics.add',
    targetType: 'blog',
    targetId: blogId,
    meta: { added: result.added, duplicates: result.duplicates.length },
  });
  revalidatePath(topicsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  const dupNote = result.duplicates.length ? ` (${result.duplicates.length} duplicate skipped)` : '';
  ok(topicsPath(blogId), `Added ${result.added} topic${result.added === 1 ? '' : 's'}${dupNote}`);
}

/** Move a queued topic up or down one slot. */
export async function moveTopicAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const topicId = String(formData.get('topicId') ?? '');
  const direction = String(formData.get('direction') ?? '');
  if (!topicId || (direction !== 'up' && direction !== 'down')) {
    fail(topicsPath(blogId), 'Invalid move request');
  }

  const moved = await moveTopic(db, blogId, topicId, direction);
  if (!moved) fail(topicsPath(blogId), 'Topic not found or already at the edge');

  revalidatePath(topicsPath(blogId));
  redirect(topicsPath(blogId));
}

/** Skip a queued topic (kept in history with status=skipped). */
export async function skipTopicAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const topicId = String(formData.get('topicId') ?? '');
  if (!topicId) fail(topicsPath(blogId), 'Missing topic');

  const skipped = await skipTopic(db, blogId, topicId);
  if (!skipped) fail(topicsPath(blogId), 'Topic not found');

  await recordAuditSafe({
    actorId: user.id,
    action: 'topics.skip',
    targetType: 'blog',
    targetId: blogId,
    meta: { topicId },
  });
  revalidatePath(topicsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(topicsPath(blogId), 'Topic skipped');
}
