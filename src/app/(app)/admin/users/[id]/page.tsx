import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { aiConnections, blogConnections, blogs, imageHosts, runs, users } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [user, userBlogs, userAiConns, userImageHosts, userBlogConns, recentRuns] = await Promise.all([
    db.select().from(users).where(eq(users.id, id)).limit(1),
    db.select().from(blogs).where(eq(blogs.userId, id)).orderBy(desc(blogs.createdAt)),
    db.select().from(aiConnections).where(eq(aiConnections.userId, id)).orderBy(desc(aiConnections.createdAt)),
    db.select().from(imageHosts).where(eq(imageHosts.userId, id)).orderBy(desc(imageHosts.createdAt)),
    db.select().from(blogConnections).where(eq(blogConnections.userId, id)).orderBy(desc(blogConnections.createdAt)),
    db.select().from(runs).where(eq(runs.blogId, id)).orderBy(desc(runs.createdAt)).limit(20),
  ]);

  if (!user[0]) {
    return <div className="text-red-600">User not found</div>;
  }

  const u = user[0];

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <Link href="/admin/users" className="text-sm text-neutral-500 hover:underline">← Back to users</Link>
          <h1 className="text-2xl font-bold mt-1">{u.email}</h1>
        </div>
        {u.isAdmin && <span className="rounded bg-red-100 text-red-800 text-xs px-1.5 py-0.5">admin</span>}
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 divide-y rounded-lg border p-4">
        <div>
          <dt className="text-neutral-500">Name</dt>
          <dd className="font-medium">{u.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Status</dt>
          <dd className="font-medium">
            <span className={`rounded px-1.5 py-0.5 text-xs ${u.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {u.status}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Blog limit</dt>
          <dd className="font-medium">{u.blogLimit ?? 'default'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Max posts/day</dt>
          <dd className="font-medium">{u.maxPostsPerDay ?? 'default'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Last login</dt>
          <dd className="font-medium">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Created</dt>
          <dd className="font-medium">{new Date(u.createdAt).toLocaleString()}</dd>
        </div>
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Blogs ({userBlogs.length})</h2>
        {userBlogs.length === 0 ? (
          <p className="text-sm text-neutral-500">No blogs connected.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {userBlogs.map((blog) => (
              <li key={blog.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <Link href={`/blogs/${blog.id}`} className="font-medium hover:underline">{blog.name}</Link>
                  <p className="text-xs text-neutral-500">{blog.url}</p>
                </div>
                <span className={`rounded px-1.5 py-0.5 text-xs ${blog.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                  {blog.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">AI connections ({userAiConns.length})</h2>
        {userAiConns.length === 0 ? (
          <p className="text-sm text-neutral-500">No AI connections.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {userAiConns.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="font-medium capitalize">{c.provider}</span>
                  {c.label && <span className="ml-2 text-sm text-neutral-500">{c.label}</span>}
                  <p className="text-xs text-neutral-500">Test: {c.lastTestStatus ?? 'untested'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Image hosts ({userImageHosts.length})</h2>
        {userImageHosts.length === 0 ? (
          <p className="text-sm text-neutral-500">No image hosts.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {userImageHosts.map((h) => (
              <li key={h.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="font-medium capitalize">{h.provider}</span>
                  {h.label && <span className="ml-2 text-sm text-neutral-500">{h.label}</span>}
                  <p className="text-xs text-neutral-500">Test: {h.lastTestStatus ?? 'untested'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Blogger connections ({userBlogConns.length})</h2>
        {userBlogConns.length === 0 ? (
          <p className="text-sm text-neutral-500">No Blogger connections.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {userBlogConns.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="font-medium">{c.googleEmail}</span>
                  <p className="text-xs text-neutral-500">Status: {c.status}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent runs ({recentRuns.length})</h2>
        {recentRuns.length === 0 ? (
          <p className="text-sm text-neutral-500">No runs.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {recentRuns.map((run) => (
              <li key={run.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="font-mono text-xs">{run.id.slice(0, 8)}</span>
                  <span className="ml-2 text-sm text-neutral-500">{run.trigger}</span>
                </div>
                <span className={`rounded px-1.5 py-0.5 text-xs ${run.status === 'running' ? 'bg-blue-100 text-blue-800' : run.status === 'succeeded' ? 'bg-green-100 text-green-800' : run.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-neutral-100 text-neutral-600'}`}>
                  {run.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}