'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { posts, runs, topics } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';
import { getBlogForUser } from '@/lib/blog-settings';
import { getBlogConnection, withConnectionAuth } from '@/lib/blogger/service';
import { createPost, publishPost } from '@/lib/blogger/client';
import { toProviderError } from '@/lib/providers/errors';
import { enqueueRunExecute } from '@/lib/jobs';

/**
 * Review-flow actions (PLAN.md §11 review flow, §13 review queue). Every action
 * re-verifies the post belongs to a blog the user owns, and delivery is guarded
 * so two reviewers can't double-post (§11 publish-once).
 */

function postsPath(blogId: string): string {
  return `/blogs/${blogId}/posts`;
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function ok(path: string, message: string): never {
  redirect(`${path}?status=${encodeURIComponent(message)}`);
}

/** Load a post scoped to a blog the user owns, or redirect. */
async function requireOwnedPost(userId: string, blogId: string, postId: string) {
  const blog = await getBlogForUser(db, userId, blogId);
  if (!blog) fail('/dashboard', 'Blog not found or access denied');
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.blogId, blogId)))
    .limit(1);
  if (!post) fail(postsPath(blogId), 'Post not found');
  return { blog, post };
}

/**
 * Flip pending_review → publishing under a row guard so two concurrent
 * reviewers cannot both deliver (PLAN.md §11 publish-once).
 */
async function claimForPublish(postId: string): Promise<boolean> {
  const claimed = await db
    .update(posts)
    .set({ status: 'publishing', updatedAt: new Date() })
    .where(and(eq(posts.id, postId), eq(posts.status, 'pending_review')))
    .returning({ id: posts.id });
  return claimed.length > 0;
}

export async function approvePostAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = String(formData.get('postId') ?? '');
  const { blog, post } = await requireOwnedPost(user.id, blogId, postId);

  const connection = await getBlogConnection(db, user.id, blogId);
  if (!connection) fail(postsPath(blogId), 'Google connection not found');

  try {
    if (post.bloggerPostId) {
      // Already on Blogger (e.g. as a draft) → publish it live.
      const published = await withConnectionAuth(db, connection, (token) =>
        publishPost(token, blog.bloggerBlogId, post.bloggerPostId!),
      );
      await db
        .update(posts)
        .set({ status: 'published', publishedAt: new Date(), bloggerUrl: published.published ?? null, updatedAt: new Date() })
        .where(eq(posts.id, postId));
    } else {
      if (!(await claimForPublish(postId))) fail(postsPath(blogId), 'Post was already delivered');
      const created = await withConnectionAuth(db, connection, (token) =>
        createPost(token, blog.bloggerBlogId, {
          title: post.title,
          content: post.html,
          labels: Array.isArray(post.labels) ? (post.labels as string[]) : [],
        }, { isDraft: false }),
      );
      await db
        .update(posts)
        .set({ bloggerPostId: created.id, bloggerUrl: created.published ?? null, status: 'published', publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(posts.id, postId));
    }
  } catch (error) {
    await db.update(posts).set({ status: 'failed', updatedAt: new Date() }).where(eq(posts.id, postId));
    fail(postsPath(blogId), toProviderError(error, 'Publish failed').message);
  }

  await recordAuditSafe({ actorId: user.id, action: 'post.approve', targetType: 'post', targetId: postId });
  revalidatePath(postsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(postsPath(blogId), 'Post published live');
}

export async function draftPostAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = String(formData.get('postId') ?? '');
  const { blog, post } = await requireOwnedPost(user.id, blogId, postId);

  if (post.bloggerPostId) ok(postsPath(blogId), 'Already saved as a draft on Blogger');
  if (!(await claimForPublish(postId))) fail(postsPath(blogId), 'Post was already delivered');

  const connection = await getBlogConnection(db, user.id, blogId);
  if (!connection) fail(postsPath(blogId), 'Google connection not found');
  try {
    const created = await withConnectionAuth(db, connection, (token) =>
      createPost(token, blog.bloggerBlogId, {
        title: post.title,
        content: post.html,
        labels: Array.isArray(post.labels) ? (post.labels as string[]) : [],
      }, { isDraft: true }),
    );
    await db
      .update(posts)
      .set({ bloggerPostId: created.id, status: 'draft_on_blogger', updatedAt: new Date() })
      .where(eq(posts.id, postId));
  } catch (error) {
    await db.update(posts).set({ status: 'failed', updatedAt: new Date() }).where(eq(posts.id, postId));
    fail(postsPath(blogId), toProviderError(error, 'Saving draft failed').message);
  }

  await recordAuditSafe({ actorId: user.id, action: 'post.draft', targetType: 'post', targetId: postId });
  revalidatePath(postsPath(blogId));
  ok(postsPath(blogId), 'Saved as a Blogger draft');
}

export async function rejectPostAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = String(formData.get('postId') ?? '');
  await requireOwnedPost(user.id, blogId, postId);

  const reason = String(formData.get('reason') ?? '').trim() || 'Rejected during review';
  await db
    .update(posts)
    .set({ status: 'rejected', rejectedReason: reason, updatedAt: new Date() })
    .where(eq(posts.id, postId));

  await recordAuditSafe({ actorId: user.id, action: 'post.reject', targetType: 'post', targetId: postId, meta: { reason } });
  revalidatePath(postsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(postsPath(blogId), 'Post rejected');
}

/**
 * Regenerate text: keep the same topic, re-run write+image+upload+assemble+deliver.
 * We add the topic back to the queue and create a new manual run.
 */
export async function regenerateTextAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = String(formData.get('postId') ?? '');
  const { blog, post } = await requireOwnedPost(user.id, blogId, postId);

  if (!post.topic) fail(postsPath(blogId), 'No topic to regenerate from');

  // Add topic back to queue
  await db.insert(topics).values({
    blogId: blog.id,
    title: post.topic,
    source: 'manual',
    status: 'queued',
  });

  // Create new manual run
  const [run] = await db
    .insert(runs)
    .values({ blogId: blog.id, trigger: 'manual', status: 'queued' })
    .returning({ id: runs.id });

  if (run) {
    await enqueueRunExecute(run.id);
  }

  // Mark current post as rejected (it will be replaced by the new one)
  await db.update(posts).set({ status: 'rejected', rejectedReason: 'Regenerated', updatedAt: new Date() }).where(eq(posts.id, postId));

  await recordAuditSafe({ actorId: user.id, action: 'post.regenerate_text', targetType: 'post', targetId: postId });
  revalidatePath(postsPath(blogId));
  ok(postsPath(blogId), 'Text regeneration queued');
}

/**
 * Regenerate image: keep the same content, re-run image+upload+assemble+deliver.
 * We reset the post status to generating and create a new run that will pick up
 * the existing content (the pipeline resume logic handles this).
 */
export async function regenerateImageAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = String(formData.get('postId') ?? '');
  const { blog } = await requireOwnedPost(user.id, blogId, postId);

  // Reset post to generating so pipeline can redo image step
  await db.update(posts).set({ status: 'generating', imageUrl: null, updatedAt: new Date() }).where(eq(posts.id, postId));

  // Create new manual run
  const [run] = await db
    .insert(runs)
    .values({ blogId: blog.id, trigger: 'manual', status: 'queued' })
    .returning({ id: runs.id });

  if (run) {
    await enqueueRunExecute(run.id);
  }

  await recordAuditSafe({ actorId: user.id, action: 'post.regenerate_image', targetType: 'post', targetId: postId });
  revalidatePath(postsPath(blogId));
  ok(postsPath(blogId), 'Image regeneration queued');
}

