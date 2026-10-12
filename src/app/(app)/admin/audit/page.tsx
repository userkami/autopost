import { and, count, desc, eq, sql } from 'drizzle-orm';
import { auditLog, users } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actorId?: string; page?: string }>;
}) {
  await requireAdmin();
  const [{ action }, { actorId }, { page }] = await Promise.all([searchParams, searchParams, searchParams]);
  const pageNum = Math.max(1, parseInt(page ?? '1', 10));
  const pageSize = 50;
  const offset = (pageNum - 1) * pageSize;

  const where = and(
    action ? eq(auditLog.action, action) : undefined,
    actorId ? eq(auditLog.actorId, actorId) : undefined,
  );

  const [rows, [total], actions, actors] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        meta: auditLog.meta,
        ip: auditLog.ip,
        createdAt: auditLog.createdAt,
        actorEmail: users.email,
        actorName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorId, users.id))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(auditLog).where(where),
    db.select({ action: auditLog.action }).from(auditLog).groupBy(auditLog.action).orderBy(desc(sql`count(*)`)).limit(20),
    db.select({ id: users.id, email: users.email }).from(users).where(eq(users.isAdmin, true)).limit(20),
  ]);

  const totalPages = Math.ceil((total?.value ?? 0) / pageSize);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit log</h1>

      <form className="flex flex-wrap gap-3" method="GET">
        <select name="action" className="rounded border px-3 py-2 text-sm">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a.action} value={a.action}>{a.action}</option>)}
        </select>
        <select name="actorId" className="rounded border px-3 py-2 text-sm">
          <option value="">All actors</option>
          {actors.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
        </select>
        <button className="rounded border px-3 py-2 text-sm hover:bg-neutral-100">Filter</button>
        {(action || actorId) && <a href="/admin/audit" className="rounded border px-3 py-2 text-sm hover:bg-neutral-100">Clear</a>}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-neutral-500">No audit entries found.</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Actor</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Target</th>
                <th className="text-left px-4 py-3 font-medium">Meta</th>
                <th className="text-left px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 text-neutral-500">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {row.actorEmail ? (
                      <>
                        {row.actorName && <span className="font-medium">{row.actorName}</span>}
                        <p className="text-xs text-neutral-500">{row.actorEmail}</p>
                      </>
                    ) : (
                      <span className="text-neutral-400">System</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{row.action}</td>
                  <td className="px-4 py-3">
                    {row.targetType && <span className="font-medium">{row.targetType}</span>}
                    {row.targetId && <p className="text-xs font-mono text-neutral-500">{row.targetId.slice(0, 12)}...</p>}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-md overflow-hidden">
                    <pre className="text-neutral-600">{row.meta ? JSON.stringify(row.meta) : '—'}</pre>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500 font-mono">{row.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-neutral-500">Page {pageNum} of {totalPages}</span>
              <div className="flex gap-2">
                {pageNum > 1 && <a href={`/admin/audit?page=${pageNum - 1}&action=${action ?? ''}&actorId=${actorId ?? ''}`} className="rounded border px-3 py-1 text-sm hover:bg-neutral-100">Prev</a>}
                {pageNum < totalPages && <a href={`/admin/audit?page=${pageNum + 1}&action=${action ?? ''}&actorId=${actorId ?? ''}`} className="rounded border px-3 py-1 text-sm hover:bg-neutral-100">Next</a>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}