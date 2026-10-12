import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { blogs, runSteps, runs, users } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminJobDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [run, steps] = await Promise.all([
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
      .where(eq(runs.id, id))
      .limit(1),
    db.select().from(runSteps).where(eq(runSteps.runId, id)).orderBy(desc(runSteps.startedAt)),
  ]);

  if (!run[0]) {
    return <div className="text-red-600">Run not found</div>;
  }

  const r = run[0];

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <Link href="/admin/jobs" className="text-sm text-neutral-500 hover:underline">← Back to jobs</Link>
          <h1 className="text-2xl font-bold mt-1">Run {r.id.slice(0, 8)}...</h1>
        </div>
        <span className={`rounded px-1.5 py-0.5 text-xs ${r.status === 'running' ? 'bg-blue-100 text-blue-800' : r.status === 'succeeded' ? 'bg-green-100 text-green-800' : r.status === 'failed' ? 'bg-red-100 text-red-800' : r.status === 'canceled' ? 'bg-neutral-100 text-neutral-600' : r.status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'}`}>
          {r.status}
        </span>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 divide-y rounded-lg border p-4">
        <div>
          <dt className="text-neutral-500">Blog</dt>
          <dd className="font-medium"><Link href={`/blogs/${r.blogId}`} className="hover:underline">{r.blogName}</Link></dd>
        </div>
        <div>
          <dt className="text-neutral-500">User</dt>
          <dd className="font-medium">{r.userEmail}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Trigger</dt>
          <dd className="font-medium">{r.trigger}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Scheduled for</dt>
          <dd className="font-medium">{r.scheduledFor ? new Date(r.scheduledFor).toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Started</dt>
          <dd className="font-medium">{r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Finished</dt>
          <dd className="font-medium">{r.finishedAt ? new Date(r.finishedAt).toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Created</dt>
          <dd className="font-medium">{new Date(r.createdAt).toLocaleString()}</dd>
        </div>
        {r.error && (
          <div className="sm:col-span-2">
            <dt className="text-neutral-500">Error</dt>
            <dd className="font-medium text-red-600">{r.error}</dd>
          </div>
        )}
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Steps ({steps.length})</h2>
        {steps.length === 0 ? (
          <p className="text-sm text-neutral-500">No steps recorded.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {steps.map((step) => (
              <li key={step.id} className="flex items-start justify-between px-4 py-3">
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{step.step}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${step.status === 'running' ? 'bg-blue-100 text-blue-800' : step.status === 'succeeded' ? 'bg-green-100 text-green-800' : step.status === 'failed' ? 'bg-red-100 text-red-800' : step.status === 'skipped' ? 'bg-neutral-100 text-neutral-600' : 'bg-neutral-100 text-neutral-600'}`}>
                      {step.status}
                    </span>
                    {step.attempt > 0 && <span className="text-xs text-neutral-500">Attempt {step.attempt}</span>}
                  </div>
                  {step.error && <p className="mt-1 text-sm text-red-600 font-mono text-xs">{step.error}</p>}
                  {(() => {
                    const out = step.output;
                    if (out && typeof out === 'object') {
                      return <pre className="mt-1 text-xs text-neutral-600 overflow-auto max-h-48">{JSON.stringify(out, null, 2)}</pre>;
                    }
                    return null;
                  })()}
                  <div className="mt-1 text-xs text-neutral-500">
                    Started: {step.startedAt ? new Date(step.startedAt).toLocaleString() : '—'} ·{' '}
                    Finished: {step.finishedAt ? new Date(step.finishedAt).toLocaleString() : '—'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}