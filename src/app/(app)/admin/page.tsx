import { count, eq } from 'drizzle-orm';
import Link from 'next/link';
import { blogs, users, runs, blogConnections, workerHeartbeats } from '@/db/schema';
import type { WorkerHeartbeat } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';

/**
 * Admin dashboard (PLAN.md §15) — overview stats and quick links to all admin views.
 */
export default async function AdminDashboardPage() {
  await requireAdmin();

  const [
    [userCount],
    [blogCount],
    [activeRunCount],
    [needsReconnectCount],
    [staleWorker],
  ] = await Promise.all([
    db.select({ value: count() }).from(users).where(eq(users.status, 'active')),
    db.select({ value: count() }).from(blogs),
    db.select({ value: count() }).from(runs).where(eq(runs.status, 'running')),
    db.select({ value: count() }).from(blogConnections).where(eq(blogConnections.status, 'needs_reconnect')),
    db.select().from(workerHeartbeats).where(eq(workerHeartbeats.id, 'worker-1')).limit(1),
  ]);

  const hb = staleWorker as WorkerHeartbeat | undefined;
  const now = Date.now(); // eslint-disable-line react-hooks/purity
  const workerDown = !hb || !hb.lastTickOk || now - new Date(hb.lastTickAt).getTime() > 60_000;

  const stats = [
    { label: 'Active users', value: userCount?.value ?? 0, href: '/admin/users', color: 'blue' },
    { label: 'Connected blogs', value: blogCount?.value ?? 0, href: '/admin/users', color: 'green' },
    { label: 'Active runs', value: activeRunCount?.value ?? 0, href: '/admin/jobs', color: 'amber' },
    { label: 'Needs reconnect', value: needsReconnectCount?.value ?? 0, href: '/admin/health', color: 'red' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Admin dashboard</h1>
        <span className={`rounded px-2 py-0.5 text-xs ${workerDown ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
          Worker: {workerDown ? 'DOWN' : 'UP'}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="rounded-lg border p-4 hover:bg-neutral-50">
            <p className="text-sm text-neutral-500">{stat.label}</p>
            <p className="mt-1 text-3xl font-bold text-neutral-900">{stat.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/users" className="rounded-lg border p-4 hover:bg-neutral-50">
          <h3 className="font-semibold">Users</h3>
          <p className="mt-1 text-sm text-neutral-500">Manage users, blog limits, suspensions</p>
        </Link>
        <Link href="/admin/settings" className="rounded-lg border p-4 hover:bg-neutral-50">
          <h3 className="font-semibold">Global settings</h3>
          <p className="mt-1 text-sm text-neutral-500">Signups mode, maintenance, defaults, invites</p>
        </Link>
        <Link href="/admin/jobs" className="rounded-lg border p-4 hover:bg-neutral-50">
          <h3 className="font-semibold">Jobs & runs</h3>
          <p className="mt-1 text-sm text-neutral-500">Monitor runs, filter failed, retry/cancel</p>
        </Link>
        <Link href="/admin/health" className="rounded-lg border p-4 hover:bg-neutral-50">
          <h3 className="font-semibold">Health</h3>
          <p className="mt-1 text-sm text-neutral-500">Worker heartbeat, reconnects, failure rates</p>
        </Link>
        <Link href="/admin/catalog" className="rounded-lg border p-4 hover:bg-neutral-50">
          <h3 className="font-semibold">Provider catalog</h3>
          <p className="mt-1 text-sm text-neutral-500">CRUD for suggested models</p>
        </Link>
        <Link href="/admin/audit" className="rounded-lg border p-4 hover:bg-neutral-50">
          <h3 className="font-semibold">Audit log</h3>
          <p className="mt-1 text-sm text-neutral-500">Searchable admin action log</p>
        </Link>
      </div>
    </div>
  );
}