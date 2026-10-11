import { count, eq } from 'drizzle-orm';
import Link from 'next/link';
import { blogs } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { effectiveBlogLimit, settings } from '@/lib/settings';

/**
 * Dashboard (PLAN.md §13) — blog cards, "N of M blogs used", announcement
 * banner. Blog connect flow ships in Phase 3 (/connect → /api/blogger/*).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const user = await requireUser();

  const [params, [blogCount], blogRows, announcement] = await Promise.all([
    searchParams,
    db.select({ value: count() }).from(blogs).where(eq(blogs.userId, user.id)),
    db.select().from(blogs).where(eq(blogs.userId, user.id)),
    settings.get('announcement'),
  ]);
  const limit = await effectiveBlogLimit(user.blogLimit);
  const used = blogCount?.value ?? 0;
  const atLimit = used >= limit;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {announcement.active && announcement.text ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          {announcement.text}
        </div>
      ) : null}

      {params.status ? (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {params.status}
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {params.error}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your blogs</h2>
        <Link
          href={atLimit ? '/connect?error=Blog+limit+reached' : '/connect'}
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            atLimit
              ? 'cursor-not-allowed bg-neutral-200 text-neutral-500'
              : 'bg-neutral-900 text-white hover:bg-neutral-700'
          }`}
          aria-disabled={atLimit}
        >
          Add blog ({used} of {limit} used)
        </Link>
      </div>

      {used === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-neutral-500">
          No blogs connected yet. Connect a Blogger blog to start researching, writing and
          publishing.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {blogRows.map((blog) => (
            <div key={blog.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{blog.name}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    blog.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : blog.status === 'needs_reconnect'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-neutral-100 text-neutral-600'
                  }`}
                >
                  {blog.status.replace('_', ' ')}
                </span>
              </div>
              <a
                href={blog.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-xs text-neutral-500 hover:underline"
              >
                {blog.url}
              </a>
              {blog.status === 'needs_reconnect' ? (
                <Link
                  href="/connect"
                  className="mt-3 inline-block text-sm font-medium text-amber-700 hover:underline"
                >
                  Reconnect required →
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
