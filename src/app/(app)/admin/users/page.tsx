import { and, count, desc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';
import { blogs, users } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';
import { adminUserAction } from './actions';

/**
 * Admin users list (PLAN.md §15) — table with search/filter/pagination;
 * actions: suspend/unsuspend, set blog_limit override, set max_posts_per_day,
 * force-disconnect a blog, delete user.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireAdmin();
  const [{ q }, { status }, { page }] = await Promise.all([searchParams, searchParams, searchParams]);
  const pageNum = Math.max(1, parseInt(page ?? '1', 10));
  const pageSize = 20;
  const offset = (pageNum - 1) * pageSize;

  const where = and(
    q ? sql`(${users.email} ILIKE ${'%' + q + '%'} OR ${users.name} ILIKE ${'%' + q + '%'})` : undefined,
    status ? eq(users.status, status as 'active' | 'suspended') : undefined,
  );

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isAdmin: users.isAdmin,
        status: users.status,
        blogLimit: users.blogLimit,
        maxPostsPerDay: users.maxPostsPerDay,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        blogCount: sql<number>`(${db.select({ value: count() }).from(blogs).where(eq(blogs.userId, users.id)).limit(1)})`,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(users).where(where),
  ]);

  const totalPages = Math.ceil((total?.value ?? 0) / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-neutral-500">
          {total?.value ?? 0} user{total?.value === 1 ? '' : 's'}
        </p>
      </div>

      <form className="flex gap-3" method="GET">
        <input
          name="q"
          value={q ?? ''}
          placeholder="Search email or name"
          className="flex-1 max-w-md rounded border px-3 py-2 text-sm"
        />
        <select name="status" className="rounded border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button className="rounded border px-3 py-2 text-sm hover:bg-neutral-100">Filter</button>
        {q && <Link href="/admin/users" className="rounded border px-3 py-2 text-sm hover:bg-neutral-100">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-neutral-500">No users found.</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Blogs</th>
                <th className="text-left px-4 py-3 font-medium">Limits</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Last login</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((user) => (
                <tr key={user.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">
                      {user.email}
                    </Link>
                    {user.name && <p className="text-xs text-neutral-500">{user.name}</p>}
                    {user.isAdmin && <span className="rounded bg-red-100 text-red-800 text-xs px-1.5 py-0.5">admin</span>}
                  </td>
                  <td className="px-4 py-3">{user.blogCount ?? 0}</td>
                  <td className="px-4 py-3 text-neutral-500">
                    Blog limit: {user.blogLimit ?? 'default'} · Posts/day: {user.maxPostsPerDay ?? 'default'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${user.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <form action={adminUserAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        {user.status === 'active' ? (
                          <>
                            <input type="hidden" name="action" value="suspend" />
                            <button className="text-red-600 hover:underline text-sm" onClick={(e) => { if (!confirm('Suspend this user? This disables their schedules.')) e.preventDefault(); }}>Suspend</button>
                          </>
                        ) : (
                          <>
                            <input type="hidden" name="action" value="unsuspend" />
                            <button className="text-green-600 hover:underline text-sm">Unsuspend</button>
                          </>
                        )}
                      </form>

                      <form action={adminUserAction} className="flex items-center gap-1">
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="action" value="set_blog_limit" />
                        <input type="number" name="blogLimit" min={0} max={100} placeholder="Blog limit" value={user.blogLimit ?? ''} className="rounded border px-2 py-1 text-xs w-24" />
                        <button className="text-sm text-neutral-600 hover:underline">Set</button>
                      </form>

                      <form action={adminUserAction} className="flex items-center gap-1">
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="action" value="set_max_posts_per_day" />
                        <input type="number" name="maxPostsPerDay" min={0} max={100} placeholder="Posts/day" value={user.maxPostsPerDay ?? ''} className="rounded border px-2 py-1 text-xs w-24" />
                        <button className="text-sm text-neutral-600 hover:underline">Set</button>
                      </form>

                      <form action={adminUserAction} onSubmit={(e) => { if (!confirm('Force disconnect this blog?')) e.preventDefault(); }}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="action" value="force_disconnect_blog" />
                        <input type="hidden" name="blogId" value="" />
                        <button className="text-amber-600 hover:underline text-sm">Disconnect blog</button>
                      </form>

                      <form action={adminUserAction} onSubmit={(e) => { if (!confirm('DELETE this user and all their data? This cannot be undone.')) e.preventDefault(); }}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="action" value="delete_user" />
                        <button className="text-red-600 hover:underline text-sm">Delete</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-neutral-500">Page {pageNum} of {totalPages}</span>
              <div className="flex gap-2">
                {pageNum > 1 && <Link href={`/admin/users?page=${pageNum - 1}&q=${q ?? ''}&status=${status ?? ''}`} className="rounded border px-3 py-1 text-sm hover:bg-neutral-100">Prev</Link>}
                {pageNum < totalPages && <Link href={`/admin/users?page=${pageNum + 1}&q=${q ?? ''}&status=${status ?? ''}`} className="rounded border px-3 py-1 text-sm hover:bg-neutral-100">Next</Link>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}