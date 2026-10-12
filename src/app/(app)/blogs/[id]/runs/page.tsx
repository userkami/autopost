import Link from 'next/link';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { posts, runSteps, runs } from '@/db/schema';
import { requireUser } from '@/lib/guards';
import { getBlogForUser } from '@/lib/blog-settings';

/**
 * Runs (PLAN.md §13 /blogs/[id]/runs): a list of runs, each expanding to its
 * per-post step timeline with statuses and error messages (from run_steps).
 */

const RUN_BADGE: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  queued: 'bg-neutral-100 text-neutral-600',
  canceled: 'bg-neutral-100 text-neutral-500',
};

const STEP_BADGE: Record<string, string> = {
  succeeded: 'text-green-700',
  failed: 'text-red-700',
  running: 'text-blue-700',
  skipped: 'text-neutral-400',
  pending: 'text-neutral-400',
};

export default async function RunsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const blog = await getBlogForUser(db, user.id, id);
  if (!blog) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">Blog not found or access denied.</p>
        <Link href="/dashboard" className="text-sm underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const runRows = await db
    .select()
    .from(runs)
    .where(eq(runs.blogId, id))
    .orderBy(desc(runs.createdAt))
    .limit(50);

  // Load steps + posts for the runs on this page in two batched queries.
  const runIds = runRows.map((r) => r.id);
  const allSteps = runIds.length
    ? await db.select().from(runSteps).where(inArray(runSteps.runId, runIds)).orderBy(asc(runSteps.createdAt))
    : [];
  const allPosts = runIds.length
    ? await db.select().from(posts).where(inArray(posts.runId, runIds)).orderBy(asc(posts.createdAt))
    : [];

  const stepsByPost = new Map<string, typeof allSteps>();
  for (const step of allSteps) {
    if (!step.postId) continue;
    const list = stepsByPost.get(step.postId) ?? [];
    list.push(step);
    stepsByPost.set(step.postId, list);
  }
  const postsByRun = new Map<string, typeof allPosts>();
  for (const post of allPosts) {
    if (!post.runId) continue;
    const list = postsByRun.get(post.runId) ?? [];
    list.push(post);
    postsByRun.set(post.runId, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Runs</h1>
          <p className="text-sm text-neutral-500">
            {blog.name} ·{' '}
            <Link href={`/blogs/${blog.id}`} className="underline">
              overview
            </Link>{' '}
            ·{' '}
            <Link href={`/blogs/${blog.id}/schedule`} className="underline">
              schedule
            </Link>
          </p>
        </div>
      </div>

      {runRows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
          No runs yet. Enable the schedule or use Run now to trigger one.
        </p>
      ) : (
        <ul className="space-y-4">
          {runRows.map((run) => {
            const runPosts = postsByRun.get(run.id) ?? [];
            return (
              <li key={run.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${RUN_BADGE[run.status] ?? 'bg-neutral-100'}`}>
                      {run.status}
                    </span>
                    <span className="text-sm font-medium">{run.trigger} run</span>
                    <span className="text-xs text-neutral-500">{run.createdAt.toLocaleString()}</span>
                  </div>
                  <span className="text-xs text-neutral-500">
                    {runPosts.length} post{runPosts.length === 1 ? '' : 's'}
                    {run.error ? ` · ${run.error}` : ''}
                  </span>
                </div>

                {runPosts.length > 0 ? (
                  <ol className="mt-3 space-y-3">
                    {runPosts.map((post) => (
                      <li key={post.id} className="rounded border p-3">
                        <p className="text-sm font-medium">{post.title}</p>
                        <p className="text-xs text-neutral-500">
                          {post.topic ? `${post.topic} · ` : ''}
                          status: {post.status}
                        </p>
                        <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {(stepsByPost.get(post.id) ?? []).map((step) => (
                            <li key={step.id} className={STEP_BADGE[step.status] ?? ''}>
                              {step.step}: {step.status}
                              {step.error ? ` — ${step.error}` : ''}
                            </li>
                          ))}
                        </ol>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
