import { and, count, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { blogs, runs, users } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';
import { adminJobAction } from './actions';

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; userId?: string; page?: string }>;
}) {
  await requireAdmin();
  const [{ status }, { userId }, { page }] = await Promise.all([searchParams, searchParams, searchParams]);
  const pageNum = Math.max(1, parseInt(page ?? '1', 10));
  const pageSize = 20;
  const offset = (pageNum - 1) * pageSize;

  const where = and(
    status ? eq(runs.status, status as typeof runs.$inferSelect.status) : undefined,
    userId ? eq(runs.blogId, userId) : undefined, // Note: filtering by user requires join
  );

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: runs.id,
        trigger: runs.trigger,
        scheduledFor: runs.scheduledFor,
        status: runs.status,
        error: runs.error,
        startedAt: runs.startedAt,
        finishedAt: runs.finishedAt,
        createdAt: runs.createdAt,
        blogId: runs.blogId,
        blogName: blogs.name,
        userEmail: users.email,
      })
      .from(runs)
      .innerJoin(blogs, eq(runs.blogId, blogs.id))
      .innerJoin(users, eq(blogs.userId, users.id))
      .where(where)
      .orderBy(desc(runs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(runs).where(where),
  ]);

  const totalPages = Math.ceil((total?.value ?? 0) / pageSize);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Jobs & runs</h1>

      <form className="flex flex-wrap gap-3" method="GET">
        <select name="status" className="rounded border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="succeeded">Succeeded</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
          <option value="canceled">Canceled</option>
        </select>
        <button className="rounded border px-3 py-2 text-sm hover:bg-neutral-100">Filter</button>
        {status && <Link href="/admin/jobs" className="rounded border px-3 py-2 text-sm hover:bg-neutral-100">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-neutral-500">No runs found.</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Run ID</th>
                <th className="text-left px-4 py-3 font-medium">Blog</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Trigger</th>
                <th className="text-left px-4 py-3 font-medium">Scheduled</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Error</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((run) => (
                <tr key={run.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-mono text-xs">{run.id.slice(0, 8)}...</td>
                  <td className="px-4 py-3">
                    <Link href={`/blogs/${run.blogId}`} className="hover:underline">{run.blogName}</Link>
                  </td>
                  <td className="px-4 py-3">{run.userEmail}</td>
                  <td className="px-4 py-3">{run.trigger}</td>
                  <td className="px-4 py-3 text-neutral-500">{run.scheduledFor ? new Date(run.scheduledFor).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${run.status === 'running' ? 'bg-blue-100 text-blue-800' : run.status === 'succeeded' ? 'bg-green-100 text-green-800' : run.status === 'failed' ? 'bg-red-100 text-red-800' : run.status === 'canceled' ? 'bg-neutral-100 text-neutral-600' : run.status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-red-600 truncate max-w-xs">{run.error ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/admin/jobs/${run.id}`} className="text-sm text-blue-600 hover:underline">View</Link>
                      {run.status === 'failed' && (
                        <form action={adminJobAction}>
                          <input type="hidden" name="runId" value={run.id} />
                          <input type="hidden" name="action" value="retry" />
                          <button className="text-sm text-green-600 hover:underline">Retry</button>
                        </form>
                      )}
                      {run.status === 'queued' && (
                        <form action={adminJobAction} onSubmit={(e) => { if (!confirm('Cancel this queued run?')) e.preventDefault(); }}>
                          <input type="hidden" name="runId" value={run.id} />
                          <input type="hidden" name="action" value="cancel" />
                          <button className="text-sm text-red-600 hover:underline">Cancel</button>
                        </form>
                      )}
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
                {pageNum > 1 && <Link href={`/admin/jobs?page=${pageNum - 1}&status=${status ?? ''}`} className="rounded border px-3 py-1 text-sm hover:bg-neutral-100">Prev</Link>}
                {pageNum < totalPages && <Link href={`/admin/jobs?page=${pageNum + 1}&status=${status ?? ''}`} className="rounded border px-3 py-1 text-sm hover:bg-neutral-100">Next</Link>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}