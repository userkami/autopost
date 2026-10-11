import Link from 'next/link';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { getBlogForUser } from '@/lib/blog-settings';
import { getBlogTopics } from '@/lib/topics';
import { addTopicsAction, moveTopicAction, skipTopicAction } from './actions';

/**
 * Topic queue (PLAN.md §13 /blogs/[id]/topics): paste many (one per line),
 * reorder, skip, history. Server Component + server actions; positions are
 * managed by src/lib/topics.ts (normalize/swap) server-side.
 */

export default async function TopicsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
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

  const allTopics = await getBlogTopics(db, id);
  const queued = allTopics.filter((t) => t.status === 'queued');
  const history = allTopics.filter((t) => t.status !== 'queued');

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Topics</h1>
          <p className="text-sm text-neutral-500">
            {blog.name} ·{' '}
            <Link href={`/blogs/${blog.id}`} className="underline">
              overview
            </Link>{' '}
            ·{' '}
            <Link href={`/blogs/${blog.id}/settings`} className="underline">
              settings
            </Link>
          </p>
        </div>
        <p className="text-sm text-neutral-500">{queued.length} queued</p>
      </div>

      {sp.status ? (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">{sp.status}</div>
      ) : null}
      {sp.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{sp.error}</div>
      ) : null}

      {/* Paste many topics */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Add topics</h2>
        <form action={addTopicsAction.bind(null, blog.id)} className="space-y-3">
          <label className="block text-sm">
            One topic per line
            <textarea
              name="titles"
              required
              rows={5}
              placeholder={'How to file quarterly taxes as a freelancer\nBest budgeting apps for 2026\n...'}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Add to queue</button>
        </form>
        <p className="text-xs text-neutral-500">Duplicates (case-insensitive) are skipped automatically.</p>
      </section>

      {/* Queue */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Queue</h2>
        {queued.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            Queue is empty. Add topics above — the scheduler picks from the top.
          </p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {queued.map((topic, index) => (
              <li key={topic.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-right text-sm text-neutral-400">{index + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{topic.title}</p>
                    <p className="text-xs text-neutral-500">
                      {topic.source}
                      {topic.notes ? ` · ${topic.notes}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <form action={moveTopicAction.bind(null, blog.id)}>
                    <input type="hidden" name="topicId" value={topic.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      disabled={index === 0}
                      className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                  </form>
                  <form action={moveTopicAction.bind(null, blog.id)}>
                    <input type="hidden" name="topicId" value={topic.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      disabled={index === queued.length - 1}
                      className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </form>
                  <form action={skipTopicAction.bind(null, blog.id)}>
                    <input type="hidden" name="topicId" value={topic.id} />
                    <button className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-neutral-100">Skip</button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* History */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">History</h2>
        {history.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            No history yet — skipped and used topics appear here.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {history.map((topic) => (
              <li key={topic.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm">{topic.title}</p>
                  <p className="text-xs text-neutral-500">
                    {topic.status} · {topic.source} · added {topic.createdAt.toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    topic.status === 'used' ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-600'
                  }`}
                >
                  {topic.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

