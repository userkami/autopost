import Link from 'next/link';
import { requireAdmin } from '@/lib/guards';

/**
 * Admin shell (PLAN.md §15). Guard: session → active admin user.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();

  return (
    <div className="min-h-screen">
      <header className="border-b bg-red-50">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold">
              AutoBlog
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/admin" className="font-medium text-red-700 hover:underline">
                Admin
              </Link>
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500">{user.email}</span>
            <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs text-white">admin</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}