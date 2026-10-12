import { appSettings } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';
import { adminSettingsAction } from './actions';

export default async function AdminSettingsPage() {
  await requireAdmin();

  const rows = await db.select().from(appSettings);
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value])) as {
    default_blog_limit?: number;
    default_max_posts_per_day?: number;
    signups_mode?: 'open' | 'invite_only' | 'closed';
    maintenance_mode?: boolean;
    global_pause?: boolean;
    custom_endpoints_allowed?: boolean;
    blocklist_keywords?: string[];
    announcement_text?: string;
    announcement_active?: boolean;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Global settings</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">General</h2>
        <form action={adminSettingsAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="key" value="default_blog_limit" />
          <label className="text-sm">
            Default blog limit per user
            <input name="value" type="number" min={0} max={100} defaultValue={settings.default_blog_limit ?? 2} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            Default max posts per day
            <input name="value" type="number" min={0} max={100} defaultValue={settings.default_max_posts_per_day ?? 3} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            Signups mode
            <select name="value" defaultValue={settings.signups_mode ?? 'open'} className="mt-1 w-full rounded border px-3 py-2 text-sm">
              <option value="open">Open</option>
              <option value="invite_only">Invite only</option>
              <option value="closed">Closed</option>
            </select>
            <input type="hidden" name="key" value="signups_mode" />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="value" defaultChecked={settings.maintenance_mode === true} />
              <input type="hidden" name="key" value="maintenance_mode" />
              Maintenance mode (blocks non-admins)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="value" defaultChecked={settings.global_pause === true} />
              <input type="hidden" name="key" value="global_pause" />
              Global pause (stops all schedules)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="value" defaultChecked={settings.custom_endpoints_allowed !== false} />
              <input type="hidden" name="key" value="custom_endpoints_allowed" />
              Allow custom endpoints
            </label>
          </div>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Save general settings</button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Blocklist keywords</h2>
        <form action={adminSettingsAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="key" value="blocklist_keywords" />
          <label className="sm:col-span-2 text-sm">
            Comma-separated keywords to block in generated content
            <textarea name="value" rows={3} defaultValue={(settings.blocklist_keywords as string[])?.join(', ') ?? ''} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Save blocklist</button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Announcement banner</h2>
        <form action={adminSettingsAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="key" value="announcement_text" />
          <label className="text-sm">
            Text
            <input name="value" defaultValue={settings.announcement_text ?? ''} placeholder="Announcement text" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <div className="flex items-center gap-4">
            <input type="hidden" name="key" value="announcement_active" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="value" defaultChecked={settings.announcement_active === true} />
              Active
            </label>
          </div>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Save announcement</button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Invite management</h2>
        <p className="text-sm text-neutral-500">Invites are managed via the <code>invites</code> table. Add email rows to allow signups when mode is &apos;invite_only&apos;.</p>
      </section>
    </div>
  );
}