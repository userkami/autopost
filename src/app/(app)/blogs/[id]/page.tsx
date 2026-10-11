import { computeReadiness } from '@/lib/readiness';
import { loadBlogSettings } from '@/lib/blog-settings';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import Link from 'next/link';

export default async function BlogOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const settingsData = await loadBlogSettings(db, user.id, id);
  if (!settingsData) {
    return (
      <div className="p-6 text-sm text-neutral-600">
        Blog not found or access denied.
      </div>
    );
  }

  const { blog, roles, aiConnections, imageHosts, googleConnection } =
    settingsData;
  const rolesMap: Record<string, typeof roles[0]> = {};
  for (const r of roles) rolesMap[r.role] = r;

  const aiConnMap: Record<string, typeof aiConnections[0]> = {};
  for (const c of aiConnections) aiConnMap[c.id] = c;

  function getRoleTestStatus(role: typeof roles[0] | undefined): 'ok' | 'failed' | 'untested' {
    if (!role?.aiConnectionId) return 'untested';
    const conn = aiConnMap[role.aiConnectionId];
    if (!conn) return 'untested';
    return conn.lastTestStatus === 'ok' ? 'ok' : conn.lastTestStatus === 'failed' ? 'failed' : 'untested';
  }

  const readinessInput = {
    googleStatus:
      (googleConnection?.status as 'active' | 'needs_reconnect' | 'revoked' | 'missing') ?? 'missing',
    profileComplete: !!(
      blog.profile?.niche &&
      blog.profile?.audience &&
      blog.profile?.language
    ),
    roles: {
      research: {
        configured: !!rolesMap.research?.aiConnectionId,
        test: getRoleTestStatus(rolesMap.research),
        connectionPresent: !!rolesMap.research?.aiConnectionId && !!aiConnMap[rolesMap.research!.aiConnectionId!],
      },
      writing: {
        configured: !!rolesMap.writing?.aiConnectionId,
        test: getRoleTestStatus(rolesMap.writing),
        connectionPresent: !!rolesMap.writing?.aiConnectionId && !!aiConnMap[rolesMap.writing!.aiConnectionId!],
      },
      image: {
        configured: !!rolesMap.image?.aiConnectionId,
        test: getRoleTestStatus(rolesMap.image),
        connectionPresent: !!rolesMap.image?.aiConnectionId && !!aiConnMap[rolesMap.image!.aiConnectionId!],
      },
    } as const,
    imageHost: {
      selected: !!imageHosts.length,
      test: 'ok' as const, // TODO: real test status per host
    },
  };

  const { items, ready } = computeReadiness(readinessInput);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold">
          Blog: {blog.name ?? id}
        </h1>
      </section>

      {/* Readiness checklist */}
      <section>
        <h2 className="text-lg font-semibold">Ready for blogging</h2>
        {ready ? (
          <p className="text-sm text-neutral-500">
            All systems ready — you can enable scheduling.
          </p>
        ) : (
          <>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {items.map((item) => (
                <li key={item.key} className={item.ready ? '' : 'text-red-600'}>
                  {item.label}: {item.detail}
                </li>
              ))}
            </ul>
          </>
        )}
        {ready && (
          <p className="mt-2">
            <Link
              href={`/blogs/${blog.id}/schedule`}
              className="bg-neutral-900 text-white px-4 py-2 rounded hover:bg-neutral-700"
            >
              Create schedule
            </Link>
          </p>
        )}
      </section>

      {/* Quick links */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Link
          href={`/blogs/${blog.id}/settings`}
          className="group border rounded-md px-4 py-3 text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path
                d="M12 6v6l4 2"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
            Settings
          </div>
        </Link>

        <Link
          href={`/blogs/${blog.id}/topics`}
          className="group border rounded-md px-4 py-3 text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M3 4h18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <path d="M3 10h12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <path d="M3 16h12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
            Topics
          </div>
        </Link>

        <Link
          href={`/blogs/${blog.id}/schedule`}
          className="group border rounded-md px-4 py-3 text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 5v.01M12 12v.01M12 19v.01M5 12h.01M12 12l4-3 4 3M19 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0 9 9 0 0 1-18 0z" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" />
            </svg>
            Schedule
          </div>
        </Link>
      </section>
    </div>
  );
}