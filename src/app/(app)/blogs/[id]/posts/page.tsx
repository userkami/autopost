import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { posts } from '@/db/schema';
import { requireUser } from '@/lib/guards';
import { getBlogForUser } from '@/lib/blog-settings';
import { approvePostAction, draftPostAction, rejectPostAction, regenerateTextAction, regenerateImageAction } from './actions';

/**
 * Posts + review queue (PLAN.md §13 /blogs/[id]/posts): status filters, links
 * to Blogger, and — for pending_review — the review actions (approve & publish,
 * send to draft, reject). Regenerate text/image live on the detail view.
 */

const STATUS_FILTERS = [
  { key: 'pending_review', label: 'Needs review' },
  { key: 'published', label: 'Published' },
  { key: 'draft_on_blogger', label: 'Drafts' },
  { key: 'failed', label: 'Failed' },
  { key: 'all', label: 'All' },
] as const;

const STATUS_BADGE: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-800',
  draft_on_blogger: 'bg-neutral-100 text-neutral-600',
  failed: 'bg-red-100 text-red-800',
  rejected: 'bg-red-100 text-red-800',
  expired: 'bg-neutral-100 text-neutral-500',
  generating: 'bg-blue-100 text-blue-800',
  publishing: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
};

export default async function PostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; filter?: string; error?: string }>;
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

  const filter = sp.filter ?? 'pending_review';
  const rows = await db
    .select()
    .from(posts)
    .where(filter === 'all' ? eq(posts.blogId, id) : and(eq(posts.blogId, id), eq(posts.status, filter as never)))
    .orderBy(desc(posts.createdAt))
    .limit(100);

  const pendingCount = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.blogId, id), eq(posts.status, 'pending_review')));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Posts</h1>
          <p className="text-sm text-neutral-500">
            {blog.name} ·{' '}
            <Link href={`/blogs/${blog.id}`} className="underline">
              overview
            </Link>
          </p>
        </div>
        {pendingCount.length > 0 ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            {pendingCount.length} awaiting review
          </span>
        ) : null}
      </div>

      {sp.status ? (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">{sp.status}</div>
      ) : null}
      {sp.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{sp.error}</div>
      ) : null}

      {/* Status filter tabs */}
      <nav className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/blogs/${blog.id}/posts?filter=${f.key}`}
            className={`rounded-md px-3 py-1.5 text-sm ${
              filter === f.key ? 'bg-neutral-900 text-white' : 'border hover:bg-neutral-100'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {/* Posts list */}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
          {filter === 'pending_review'
            ? 'Nothing waiting for review. Posts in review mode appear here after a run.'
            : 'No posts yet. Enable a schedule or run the pipeline to generate posts.'}
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((post) => (
            <li key={post.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[post.status] ?? 'bg-neutral-100'}`}>
                      {post.status.replace(/_/g, ' ')}
                    </span>
                    <h2 className="truncate text-sm font-medium">{post.title}</h2>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    {post.topic ? `Topic: ${post.topic} · ` : ''}
                    {post.createdAt.toLocaleString()}
                    {post.rejectedReason ? ` · rejected: ${post.rejectedReason}` : ''}
                    {post.reviewExpiresAt && post.status === 'pending_review'
                      ? ` · expires ${post.reviewExpiresAt.toLocaleString()}`
                      : ''}
                  </p>
                  {post.bloggerUrl ? (
                    <a
                      href={post.bloggerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs underline"
                    >
                      View on Blogger
                    </a>
                  ) : null}
                </div>

{post.status === 'pending_review' ? (
                  <div className="flex flex-wrap gap-2">
                    <form action={approvePostAction.bind(null, blog.id)}>
                      <input type="hidden" name="postId" value={post.id} />
                      <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700">
                        Approve & publish
                      </button>
                    </form>
                    <form action={draftPostAction.bind(null, blog.id)}>
                      <input type="hidden" name="postId" value={post.id} />
                      <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-neutral-100">
                        Save as draft
                      </button>
                    </form>
                    <form action={regenerateTextAction.bind(null, blog.id)}>
                      <input type="hidden" name="postId" value={post.id} />
                      <button className="rounded-md border border-blue-300 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50">
                        Regenerate text
                      </button>
                    </form>
                    <form action={regenerateImageAction.bind(null, blog.id)}>
                      <input type="hidden" name="postId" value={post.id} />
                      <button className="rounded-md border border-purple-300 px-3 py-1.5 text-xs text-purple-700 hover:bg-purple-50">
                        Regenerate image
                      </button>
                    </form>
                    <form action={rejectPostAction.bind(null, blog.id)} className="flex gap-2">
                      <input type="hidden" name="postId" value={post.id} />
                      <input
                        name="reason"
                        placeholder="Reason (optional)"
                        className="w-40 rounded border px-2 py-1 text-xs"
                      />
                      <button className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50">
                        Reject
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>

              {/* Rendered preview for review */}
              {post.status === 'pending_review' && post.html ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-neutral-500">Preview</summary>
                  <div
                    className="prose prose-sm mt-2 max-w-none rounded border p-3"
                    dangerouslySetInnerHTML={{ __html: post.html }}
                  />
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

