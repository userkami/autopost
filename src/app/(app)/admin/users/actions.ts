'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { blogs, users, schedules } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';

const userActionSchema = z.object({
  action: z.enum(['suspend', 'unsuspend', 'set_blog_limit', 'set_max_posts_per_day', 'force_disconnect_blog', 'delete_user']),
  userId: z.string().uuid(),
  blogLimit: z.coerce.number().int().min(0).max(100).optional(),
  maxPostsPerDay: z.coerce.number().int().min(0).max(100).optional(),
  blogId: z.string().uuid().optional(),
});

function fail(message: string): never {
  throw new Error(message);
}

export async function adminUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = userActionSchema.safeParse({
    action: formData.get('action'),
    userId: formData.get('userId'),
    blogLimit: formData.get('blogLimit') ?? undefined,
    maxPostsPerDay: formData.get('maxPostsPerDay') ?? undefined,
    blogId: formData.get('blogId') ?? undefined,
  });
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid request');

  const { action, userId, blogLimit, maxPostsPerDay, blogId } = parsed.data;

  await db.transaction(async (tx) => {
    const [targetUser] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!targetUser) fail('User not found');
    if (targetUser.id === admin.id && (action === 'suspend' || action === 'delete_user')) {
      fail('Cannot suspend or delete yourself');
    }

    switch (action) {
      case 'suspend': {
        await tx.update(users).set({ status: 'suspended', updatedAt: new Date() }).where(eq(users.id, userId));
        // Disable all schedules for this user
        const userBlogs = await tx.select({ id: blogs.id }).from(blogs).where(eq(blogs.userId, userId));
        const blogIds = userBlogs.map((b) => b.id);
        if (blogIds.length > 0) {
          await tx
            .update(schedules)
            .set({ enabled: false, updatedAt: new Date() })
            .where(inArray(schedules.blogId, blogIds));
        }
        await recordAuditSafe({ actorId: admin.id, action: 'admin.suspend_user', targetType: 'user', targetId: userId }, tx);
        break;
      }
      case 'unsuspend': {
        await tx.update(users).set({ status: 'active', updatedAt: new Date() }).where(eq(users.id, userId));
        await recordAuditSafe({ actorId: admin.id, action: 'admin.unsuspend_user', targetType: 'user', targetId: userId }, tx);
        break;
      }
      case 'set_blog_limit': {
        if (blogLimit === undefined) fail('blogLimit required');
        await tx.update(users).set({ blogLimit: blogLimit === 0 ? null : blogLimit, updatedAt: new Date() }).where(eq(users.id, userId));
        await recordAuditSafe({ actorId: admin.id, action: 'admin.set_blog_limit', targetType: 'user', targetId: userId, meta: { blogLimit } }, tx);
        break;
      }
      case 'set_max_posts_per_day': {
        if (maxPostsPerDay === undefined) fail('maxPostsPerDay required');
        await tx.update(users).set({ maxPostsPerDay: maxPostsPerDay === 0 ? null : maxPostsPerDay, updatedAt: new Date() }).where(eq(users.id, userId));
        await recordAuditSafe({ actorId: admin.id, action: 'admin.set_max_posts_per_day', targetType: 'user', targetId: userId, meta: { maxPostsPerDay } }, tx);
        break;
      }
      case 'force_disconnect_blog': {
        if (!blogId) fail('blogId required');
        // Verify blog belongs to user
        const [blog] = await tx.select().from(blogs).where(and(eq(blogs.id, blogId), eq(blogs.userId, userId))).limit(1);
        if (!blog) fail('Blog not found for this user');
        // Disable schedule
        await tx.update(schedules).set({ enabled: false, updatedAt: new Date() }).where(eq(schedules.blogId, blogId));
        // Delete blog (cascades to posts, runs, etc.)
        await tx.delete(blogs).where(eq(blogs.id, blogId));
        await recordAuditSafe({ actorId: admin.id, action: 'admin.force_disconnect_blog', targetType: 'blog', targetId: blogId, meta: { userId } }, tx);
        break;
      }
      case 'delete_user': {
        // Hard delete: cascades to blogs, connections, posts, runs, etc. (FK cascade)
        await tx.delete(users).where(eq(users.id, userId));
        await recordAuditSafe({ actorId: admin.id, action: 'admin.delete_user', targetType: 'user', targetId: userId }, tx);
        break;
      }
    }
  });

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
}