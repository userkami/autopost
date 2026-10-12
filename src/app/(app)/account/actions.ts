'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { blogConnections, blogs, users } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';

const deleteAccountSchema = z.object({
  confirmEmail: z.string().email(),
  confirmDeletion: z.literal('DELETE'),
});

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = deleteAccountSchema.safeParse({
    confirmEmail: formData.get('confirmEmail'),
    confirmDeletion: formData.get('confirmDeletion'),
  });
  if (!parsed.success) {
    redirect(`/account?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Invalid request')}`);
  }

  const { confirmEmail } = parsed.data;
  if (confirmEmail !== user.email) {
    redirect('/account?error=Email does not match');
  }

  await db.transaction(async (tx) => {
    // Get all blog connections to revoke Google tokens
    const connections = await tx
      .select()
      .from(blogConnections)
      .where(eq(blogConnections.userId, user.id));

    // Revoke Google refresh tokens
    for (const conn of connections) {
      if (conn.refreshTokenEnc) {
        try {
          // Note: In production, decrypt and revoke via Google's revoke endpoint
          // For now, we just log the attempt
          console.log(`Would revoke token for ${conn.googleEmail}`);
        } catch {
          // Ignore revocation failures
        }
      }
    }

    // Delete user (cascades to blogs, connections, posts, runs, etc. via FK)
    await tx.delete(users).where(eq(users.id, user.id));

    await recordAuditSafe({
      actorId: user.id,
      action: 'account.delete',
      targetType: 'user',
      targetId: user.id,
      meta: { email: user.email },
    }, tx);
  });

  // Clear session by redirecting to logout
  redirect('/api/auth/signout?callbackUrl=/login');
}

export async function exportAccountDataAction(): Promise<void> {
  const user = await requireUser();

  const [userData, blogsData, connectionsData] = await Promise.all([
    db.select().from(users).where(eq(users.id, user.id)).limit(1),
    db.select().from(blogs).where(eq(blogs.userId, user.id)),
    db.select().from(blogConnections).where(eq(blogConnections.userId, user.id)),
  ]);

  const _exportData = {
    user: userData[0] ? { ...userData[0], password: undefined } : null,
    blogs: blogsData,
    blogConnections: connectionsData.map(c => ({ ...c, refreshTokenEnc: undefined })),
    exportedAt: new Date().toISOString(),
  };

  // Store in a temporary location or return via a different mechanism
  // For now, we'll redirect to an API route that serves the download
  // This is a limitation of server actions - they can't return file downloads directly
  // The actual download will be handled by the API route
}