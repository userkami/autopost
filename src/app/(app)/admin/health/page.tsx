import { and, count, eq, gte, sql } from 'drizzle-orm';
import { blogs, blogConnections, runs, users, workerHeartbeats, aiConnections, imageHosts } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';

export default async function AdminHealthPage() {
  await requireAdmin();

  const [
    heartbeat,
    needsReconnectConns,
    needsReconnectBlogs,
    suspendedUsers,
    failedRuns24h,
    failedRuns7d,
    totalRuns24h,
    totalRuns7d,
    aiConnFailures,
    imageHostFailures,
  ] = await Promise.all([
    db.select().from(workerHeartbeats).where(eq(workerHeartbeats.id, 'worker-1')).limit(1),
    db.select({ value: count() }).from(blogConnections).where(eq(blogConnections.status, 'needs_reconnect')),
    db.select({ value: count() }).from(blogs).where(eq(blogs.status, 'needs_reconnect')),
    db.select({ value: count() }).from(users).where(eq(users.status, 'suspended')),
    db.select({ value: count() }).from(runs).where(and(eq(runs.status, 'failed'), gte(runs.createdAt, sql`now() - interval '24 hours'`))),
    db.select({ value: count() }).from(runs).where(and(eq(runs.status, 'failed'), gte(runs.createdAt, sql`now() - interval '7 days'`))),
    db.select({ value: count() }).from(runs).where(gte(runs.createdAt, sql`now() - interval '24 hours'`)),
    db.select({ value: count() }).from(runs).where(gte(runs.createdAt, sql`now() - interval '7 days'`)),
    db
      .select({
        provider: aiConnections.provider,
        failed: sql<number>`count(*)`,
      })
      .from(aiConnections)
      .where(and(eq(aiConnections.lastTestStatus, 'failed'), gte(aiConnections.lastTestAt, sql`now() - interval '7 days'`)))
      .groupBy(aiConnections.provider),
    db
      .select({
        provider: imageHosts.provider,
        failed: sql<number>`count(*)`,
      })
      .from(imageHosts)
      .where(and(eq(imageHosts.lastTestStatus, 'failed'), gte(imageHosts.lastTestAt, sql`now() - interval '7 days'`)))
      .groupBy(imageHosts.provider),
  ]);

  const hb = heartbeat[0];
  const now = Date.now(); // eslint-disable-line react-hooks/purity
  const workerDown = !hb || !hb.lastTickOk || now - new Date(hb.lastTickAt).getTime() > 60_000;
  const failureRate24h = (totalRuns24h[0]?.value ?? 0) > 0 ? ((failedRuns24h[0]?.value ?? 0) / totalRuns24h[0]!.value * 100).toFixed(1) : '0';
  const failureRate7d = (totalRuns7d[0]?.value ?? 0) > 0 ? ((failedRuns7d[0]?.value ?? 0) / totalRuns7d[0]!.value * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Health</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Worker heartbeat</h2>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-4">
            <span className={`w-3 h-3 rounded-full ${workerDown ? 'bg-red-500' : 'bg-green-500'}`} />
            <div>
              <p className="font-medium">{workerDown ? 'Worker DOWN' : 'Worker UP'}</p>
              <p className="text-sm text-neutral-500">
                Last tick: {hb ? new Date(hb.lastTickAt).toLocaleString() : 'Never'}
                {hb?.lastTickError && ` · Error: ${hb.lastTickError}`}
              </p>
            </div>
          </div>
          {hb && (
            <p className="mt-2 text-sm text-neutral-500">
              Pending jobs: {hb.pendingJobs} · Last tick OK: {hb.lastTickOk ? 'Yes' : 'No'}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Reconnect alerts</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-4 bg-amber-50">
            <p className="text-sm text-neutral-500">Connections needing reconnect</p>
            <p className="text-3xl font-bold text-amber-700">{needsReconnectConns[0]?.value ?? 0}</p>
          </div>
          <div className="rounded-lg border p-4 bg-amber-50">
            <p className="text-sm text-neutral-500">Blogs needing reconnect</p>
            <p className="text-3xl font-bold text-amber-700">{needsReconnectBlogs[0]?.value ?? 0}</p>
          </div>
          <div className="rounded-lg border p-4 bg-red-50">
            <p className="text-sm text-neutral-500">Suspended users</p>
            <p className="text-3xl font-bold text-red-700">{suspendedUsers[0]?.value ?? 0}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Run failure rates</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-neutral-500">Last 24 hours</p>
            <p className="text-3xl font-bold">{failureRate24h}%</p>
            <p className="text-sm text-neutral-500">{failedRuns24h[0]?.value ?? 0} / {totalRuns24h[0]?.value ?? 0} runs failed</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-neutral-500">Last 7 days</p>
            <p className="text-3xl font-bold">{failureRate7d}%</p>
            <p className="text-sm text-neutral-500">{failedRuns7d[0]?.value ?? 0} / {totalRuns7d[0]?.value ?? 0} runs failed</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">AI connection failures (7d)</h2>
        {aiConnFailures.length === 0 ? (
          <p className="text-sm text-neutral-500">No AI connection failures in the last 7 days.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {aiConnFailures.map((f) => (
              <li key={f.provider} className="flex justify-between px-4 py-3">
                <span className="font-medium capitalize">{f.provider}</span>
                <span className="text-red-600 font-bold">{f.failed} failures</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Image host failures (7d)</h2>
        {imageHostFailures.length === 0 ? (
          <p className="text-sm text-neutral-500">No image host failures in the last 7 days.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {imageHostFailures.map((f) => (
              <li key={f.provider} className="flex justify-between px-4 py-3">
                <span className="font-medium capitalize">{f.provider}</span>
                <span className="text-red-600 font-bold">{f.failed} failures</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Recent errors (last 20 failed runs)</h2>
        {failedRuns24h[0]?.value === 0 && failedRuns7d[0]?.value === 0 ? (
          <p className="text-sm text-neutral-500">No recent errors.</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Run ID</th>
                  <th className="text-left px-4 py-3 font-medium">Blog</th>
                  <th className="text-left px-4 py-3 font-medium">Error</th>
                  <th className="text-left px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[]} {/* Would need a query for recent errors */}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}