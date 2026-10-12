import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { users } from '@/db/schema';
import { db } from '@/db';
import { logger } from '@/lib/logger';

/**
 * Route guards for the authenticated area (PLAN.md §14.4: every route loads
 * the resource scoped by user_id; never trust ids from the client).
 * Guards live in server layouts/pages (database sessions cannot be checked in
 * edge middleware without a DB round trip).
 */

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  status: 'active' | 'suspended';
  blogLimit: number | null;
  maxPostsPerDay: number | null;
};

/** Returns the active, non-deleted user for the current session, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  try {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user || user.deletedAt || user.status !== 'active') return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
      status: user.status,
      blogLimit: user.blogLimit,
      maxPostsPerDay: user.maxPostsPerDay,
    };
  } catch (error) {
    // DB unavailable → deny rather than trust a stale session (fail closed).
    logger.error({ err: error }, 'failed to load current user');
    return null;
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect('/dashboard');
  return user;
}
