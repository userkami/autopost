import { redirect } from 'next/navigation';
import Link from 'next/link';
import { settings } from '@/lib/settings';
import { requireUser } from '@/lib/guards';
import { signOutAction } from './actions';

/**
 * Authenticated shell (PLAN.md §17 Phase 1 / §13).
 * Guard: session → active user; maintenance mode blocks non-admins.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const maintenance = await settings.get('maintenance_mode');
  if (maintenance && !user.isAdmin) redirect('/maintenance');

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold">
              AutoBlog
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              <Link href="/account" className="hover:underline">
                Account
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500">{user.email}</span>
            {user.isAdmin ? (
              <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white">admin</span>
            ) : null}
            <form action={signOutAction}>
              <button type="submit" className="rounded border px-2 py-1 hover:bg-neutral-100">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
