'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';
import { bloggerConnectLimiter } from '@/lib/ratelimit';
import { toProviderError } from '@/lib/providers/errors';
import { connectBlog, getBlogConnection, listAvailableBlogs } from '@/lib/blogger/service';

/**
 * Blog picker actions (PLAN.md §6.2.3). The candidate blog is RE-FETCHED from
 * Blogger — the browser only supplies ids, and names/urls are never trusted
 * (PLAN.md §14.4). The limit is re-checked inside the creating transaction (§10).
 */

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function selectBlogAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const connectionId = String(formData.get('connectionId') ?? '');
  const bloggerBlogId = String(formData.get('bloggerBlogId') ?? '');
  if (!connectionId || !bloggerBlogId) fail('/connect', 'Missing blog selection');
  if (!bloggerConnectLimiter.check(`pick:${user.id}`)) {
    fail('/connect', 'Too many attempts — wait a minute and try again');
  }

  const connection = await getBlogConnection(db, user.id, connectionId);
  if (!connection) fail('/connect', 'Google connection not found');
  if (connection.status !== 'active') fail('/connect', 'Reconnect your Google account first');

  let remote;
  try {
    const { available } = await listAvailableBlogs(db, user.id, connectionId);
    remote = available.find((blog) => blog.id === bloggerBlogId);
  } catch (error) {
    const providerError = toProviderError(error, 'Could not list blogs from Google');
    fail('/connect', providerError.message);
  }
  if (!remote) fail('/connect', 'That blog was not found on this Google account');

  const result = await connectBlog({ userId: user.id, connectionId, blog: remote });
  if (!result.ok) fail('/connect', result.reason);

  await recordAuditSafe({
    actorId: user.id,
    action: 'blogger.blog_connect',
    targetType: 'blog',
    targetId: result.blog.id,
    meta: { blogger_blog_id: result.blog.bloggerBlogId, name: result.blog.name },
  });
  revalidatePath('/connect');
  revalidatePath('/dashboard');
  redirect(`/dashboard?status=${encodeURIComponent(`Blog connected: ${result.blog.name}`)}`);
}
