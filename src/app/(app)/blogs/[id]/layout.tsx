import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/guards';
import { db } from '@/db';
import { and, eq } from 'drizzle-orm';
import { blogs } from '@/db/schema';

export default async function BlogLayout({
  children,
  params,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const user = await requireUser();
  const blogResult = await db
    .select()
    .from(blogs)
    .where(and(eq(blogs.id, id), eq(blogs.userId, user.id)))
    .limit(1);
  if (blogResult.length === 0) redirect('/dashboard');

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
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500">{user.email}</span>
            {user.isAdmin ? (
              <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white">admin</span>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}