import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import Link from 'next/link';
import { notifications } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { markAllNotificationsReadAction } from './actions';

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const [{ status }] = await Promise.all([searchParams]);

  const filter = status === 'unread'
    ? and(eq(notifications.userId, user.id), isNull(notifications.readAt))
    : eq(notifications.userId, user.id);

  const rows = await db
    .select()
    .from(notifications)
    .where(filter)
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  const [unreadCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        {unreadCount?.count && unreadCount.count > 0 && (
          <form action={markAllNotificationsReadAction} className="inline">
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-100">
              Mark all as read ({unreadCount.count})
            </button>
          </form>
        )}
      </div>

      {status === 'unread' ? (
        <p className="text-sm text-neutral-500">Showing unread notifications only.</p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-neutral-500">
          {status === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((n) => (
            <li key={n.id} className={`flex items-start gap-4 px-4 py-3 ${n.readAt ? '' : 'bg-blue-50'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{n.title}</span>
                  <span className="text-xs text-neutral-400">{n.createdAt.toLocaleString()}</span>
                  {!n.readAt && <span className="rounded-full bg-blue-100 text-blue-800 text-xs px-1.5 py-0.5">Unread</span>}
                </div>
                <p className="mt-1 text-sm text-neutral-600">{n.body}</p>
                {n.link && (
                  <Link href={n.link} className="mt-2 inline-block text-sm underline text-blue-600 hover:text-blue-700">
                    View details
                  </Link>
                )}
              </div>
              {!n.readAt && (
                <form action={async (formData: FormData) => {
                  'use server';
                  const { markNotificationReadAction } = await import('./actions');
                  await markNotificationReadAction(formData.get('id') as string);
                }} className="flex-shrink-0">
                  <input type="hidden" name="id" value={n.id} />
                  <button className="text-sm text-neutral-500 hover:text-neutral-700">Mark read</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <nav className="flex justify-center gap-2">
        <Link href="/notifications" className={`rounded-md px-3 py-2 text-sm ${!status ? 'bg-neutral-900 text-white' : 'border hover:bg-neutral-100'}`}>
          All
        </Link>
        <Link href="/notifications?status=unread" className={`rounded-md px-3 py-2 text-sm ${status === 'unread' ? 'bg-neutral-900 text-white' : 'border hover:bg-neutral-100'}`}>
          Unread
        </Link>
      </nav>
    </div>
  );
}