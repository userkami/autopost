import Link from 'next/link';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { effectiveBlogLimit } from '@/lib/settings';
import { toProviderError } from '@/lib/providers/errors';
import {
  listAvailableBlogs,
  listBlogConnections,
  listUserBlogs,
  toPublicBlogConnection,
} from '@/lib/blogger/service';
import { selectBlogAction } from './actions';

/**
 * Connect a blog (PLAN.md §6.2.3, §13 /connect): Google connections with a
 * prominent Reconnect button for `needs_reconnect`, the picker of blogs not yet
 * connected, and the already-connected list. Refresh tokens are never shown
 * (PLAN.md §14.2).
 */

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; connectionId?: string }>;
}) {
  const user = await requireUser();
  const [params, connectionRows, blogRows] = await Promise.all([
    searchParams,
    listBlogConnections(db, user.id),
    listUserBlogs(db, user.id),
  ]);
  const connections = connectionRows.map(toPublicBlogConnection);
  const limit = await effectiveBlogLimit(user.blogLimit);
  const used = blogRows.length;
  const atLimit = used >= limit;

  const selected = params.connectionId
    ? (connections.find((c) => c.id === params.connectionId) ?? null)
    : null;
  const unknownConnection = Boolean(params.connectionId) && !selected;

  let available: { id: string; name: string; url: string }[] = [];
  let pickerError: string | null = null;
  if (selected?.status === 'active') {
    try {
      const result = await listAvailableBlogs(db, user.id, selected.id);
      available = result.available;
    } catch (error) {
      const providerError = toProviderError(error, 'Could not load blogs from Google');
      pickerError =
        providerError.kind === 'auth'
          ? 'Google rejected this connection — use Reconnect below'
          : providerError.message;
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Connect a blog</h1>
        <p className="text-sm text-neutral-500">
          {used} of {limit} blogs used
        </p>
      </div>

      {params.status ? (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {params.status}
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {params.error}
        </div>
      ) : null}
      {unknownConnection ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Google connection not found.
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Google accounts</h2>
          <Link
            href={atLimit ? '/connect?error=Blog+limit+reached' : '/api/blogger/connect'}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              atLimit
                ? 'cursor-not-allowed bg-neutral-200 text-neutral-500'
                : 'bg-neutral-900 text-white hover:bg-neutral-700'
            }`}
            aria-disabled={atLimit}
          >
            Connect Google account
          </Link>
        </div>

        {connections.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            No Google account connected yet. Connect one to see your Blogger blogs.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{connection.googleEmail}</span>
                    <StatusBadge status={connection.status} />
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {connection.status === 'needs_reconnect' && connection.lastError
                      ? connection.lastError
                      : `Connected ${connection.createdAt.toISOString().slice(0, 10)}`}
                  </div>
                </div>
                <div className="flex gap-2">
                  {connection.status === 'needs_reconnect' ? (
                    <Link
                      href="/api/blogger/connect?reconnect=1"
                      className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
                    >
                      Reconnect
                    </Link>
                  ) : (
                    <Link
                      href={`/connect?connectionId=${connection.id}`}
                      className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-100"
                    >
                      Pick blogs
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Blogs on {selected.googleEmail}</h2>
          {selected.status !== 'active' ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This account needs to be reconnected before you can pick blogs.
            </p>
          ) : pickerError ? (
            <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {pickerError}
            </p>
          ) : available.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
              All blogs on this account are already connected (or none exist).
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {available.map((blog) => (
                <li
                  key={blog.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <div className="font-medium">{blog.name}</div>
                    <div className="mt-1 text-xs text-neutral-500">{blog.url}</div>
                  </div>
                  <form action={selectBlogAction}>
                    <input type="hidden" name="connectionId" value={selected.id} />
                    <input type="hidden" name="bloggerBlogId" value={blog.id} />
                    <button
                      disabled={atLimit}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                        atLimit
                          ? 'cursor-not-allowed bg-neutral-200 text-neutral-500'
                          : 'bg-neutral-900 text-white hover:bg-neutral-700'
                      }`}
                      title={atLimit ? `Blog limit reached (${limit})` : undefined}
                    >
                      Connect
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Connected blogs</h2>
        {blogRows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            No blogs connected yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {blogRows.map((blog) => (
              <li
                key={blog.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{blog.name}</span>
                    <StatusBadge status={blog.status} />
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">{blog.url}</div>
                </div>
                <Link
                  href="/dashboard"
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-100"
                >
                  Open dashboard
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === 'active'
      ? 'bg-green-100 text-green-800'
      : status === 'needs_reconnect'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-neutral-100 text-neutral-600';
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${style}`}>{status.replace('_', ' ')}</span>
  );
}
