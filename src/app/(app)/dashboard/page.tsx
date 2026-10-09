import { count, eq } from 'drizzle-orm';
import { blogs } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { effectiveBlogLimit, settings } from '@/lib/settings';

/**
 * Dashboard (PLAN.md §13) — blog cards, "N of M blogs used", announcement
 * banner. Blog connect flow arrives in Phase 3; cards render as we grow.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  const [blogCount] = await db
    .select({ value: count() })
    .from(blogs)
    .where(eq(blogs.userId, user.id));
  const limit = await effectiveBlogLimit(user.blogLimit);
  const used = blogCount?.value ?? 0;
  const announcement = await settings.get('announcement');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {announcement.active && announcement.text ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          {announcement.text}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your blogs</h2>
        {/* Connect flow arrives in Phase 3 (PLAN.md §17). */}
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-md bg-neutral-900 px-3 py-2 text-sm text-white opacity-50"
          title="Available once Blogger connect ships (Phase 3)"
        >
          Add blog ({used} of {limit} used)
        </button>
      </div>

      {used === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-neutral-500">
          No blogs connected yet. Connect a Blogger blog to start researching, writing and
          publishing.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{/* blog cards — Phase 4 */}</div>
      )}
    </div>
  );
}
