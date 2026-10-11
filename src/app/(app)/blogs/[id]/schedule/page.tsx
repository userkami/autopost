import Link from 'next/link';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { getBlogForUser, loadBlogSettings, blogReadiness } from '@/lib/blog-settings';
import { getSchedule, previewNextRuns, type ScheduleRow } from '@/lib/schedule';
import {
  runNowAction,
  saveScheduleAction,
  toggleScheduleAction,
} from './actions';

/**
 * Schedule (PLAN.md §13 /blogs/[id]/schedule): frequency, times, weekdays,
 * timezone, posts per run, enable toggle gated by the readiness checklist
 * (§7 line 224), Run now (§12 rate-limited), pause/resume and a "next 5 run
 * times" preview from the shared DST-safe computeNext.
 */

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function previewConfig(row: ScheduleRow) {
  return {
    frequencyType: row.frequencyType,
    intervalHours: row.intervalHours ?? 24,
    times: row.times,
    weekdays: row.weekdays,
    timezone: row.timezone,
  };
}

export default async function SchedulePage({
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

  const [schedule, settings] = await Promise.all([getSchedule(db, id), loadBlogSettings(db, user.id, id)]);
  const readiness = settings ? blogReadiness(settings) : null;
  const preview = schedule ? previewNextRuns(previewConfig(schedule), new Date(), 5) : [];
  const isPausedForReconnect = schedule?.pausedForReconnect ?? false;

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Schedule</h1>
          <p className="text-sm text-neutral-500">
            {blog.name} ·{' '}
            <Link href={`/blogs/${blog.id}`} className="underline">
              overview
            </Link>{' '}
            ·{' '}
            <Link href={`/blogs/${blog.id}/topics`} className="underline">
              topics
            </Link>
          </p>
        </div>
        {schedule ? (
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              schedule.enabled && !isPausedForReconnect
                ? 'bg-green-100 text-green-800'
                : isPausedForReconnect
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-neutral-100 text-neutral-600'
            }`}
          >
            {isPausedForReconnect ? 'paused (reconnect needed)' : schedule.enabled ? 'enabled' : 'disabled'}
          </span>
        ) : null}
      </div>

      {sp.status ? (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">{sp.status}</div>
      ) : null}
      {sp.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{sp.error}</div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Schedule configuration                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Configuration</h2>
          <p className="text-sm text-neutral-500">When runs should fire. Saving does not enable the schedule.</p>
        </div>
        <form action={saveScheduleAction.bind(null, blog.id)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Frequency
            <select
              name="frequencyType"
              defaultValue={schedule?.frequencyType ?? 'daily'}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            >
              <option value="interval_hours">Every N hours</option>
              <option value="daily">Daily at set times</option>
              <option value="weekdays">Certain weekdays</option>
            </select>
          </label>
          <label className="text-sm">
            Interval (hours)
            <input
              name="intervalHours"
              type="number"
              min={1}
              max={8760}
              defaultValue={schedule?.intervalHours ?? 24}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Times (HH:mm, comma or newline separated — used for daily/weekdays)
            <textarea
              name="times"
              rows={2}
              defaultValue={(schedule?.times ?? []).join(', ')}
              placeholder="09:00, 17:30"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm">Weekdays (used for the weekdays frequency)</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {WEEKDAY_NAMES.map((name, index) => (
                <label key={name} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={String(index)}
                    defaultChecked={(schedule?.weekdays ?? [1, 2, 3, 4, 5]).includes(index)}
                    className="h-4 w-4"
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm">
            Timezone (IANA)
            <input
              name="timezone"
              defaultValue={schedule?.timezone ?? 'UTC'}
              placeholder="America/New_York"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Posts per run
            <input
              name="postsPerRun"
              type="number"
              min={1}
              max={20}
              defaultValue={schedule?.postsPerRun ?? 1}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Save settings</button>
          </div>
        </form>
      </section>


      {/* ---------------------------------------------------------------- */}
      {/* Readiness checklist + enable toggle                               */}
      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Enable schedule</h2>
          <p className="text-sm text-neutral-500">
            A schedule can only be enabled once the blog is ready (PLAN §7): all three AI roles + an image
            host configured and tested, plus a complete profile.
          </p>
        </div>

        {readiness ? (
          <ul className="space-y-1 text-sm">
            {readiness.items.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
                <span aria-hidden className="mt-0.5">
                  {item.ready ? '✅' : '❌'}
                </span>
                <span className={item.ready ? 'text-neutral-700' : 'text-red-700'}>
                  {item.label} — <span className="text-neutral-500">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">Readiness unavailable.</p>
        )}

        {isPausedForReconnect ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Scheduling is paused because the Google connection needs attention.{' '}
            <Link href="/connect" className="underline">
              Reconnect
            </Link>{' '}
            to resume.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {schedule?.enabled ? (
            <form action={toggleScheduleAction.bind(null, blog.id)}>
              <input type="hidden" name="action" value="disable" />
              <button className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">
                Pause schedule
              </button>
            </form>
          ) : (
            <form action={toggleScheduleAction.bind(null, blog.id)} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="action" value="enable" />
              {readiness && !readiness.ready ? (
                <label className="flex items-center gap-2 text-sm text-neutral-600">
                  <input name="skipTest" type="checkbox" className="h-4 w-4" />
                  Skip failing checks and enable anyway
                </label>
              ) : null}
              <button
                disabled={!schedule}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
              >
                Enable schedule
              </button>
            </form>
          )}

          <form action={runNowAction.bind(null, blog.id)}>
            <button
              disabled={!schedule}
              className="rounded-md border px-4 py-2 text-sm hover:bg-neutral-100 disabled:opacity-40"
            >
              Run now
            </button>
          </form>
          <span className="text-xs text-neutral-500">Manual runs are limited to once every 5 minutes.</span>
        </div>
      </section>


      {/* ---------------------------------------------------------------- */}
      {/* Next 5 run times preview                                          */}
      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Next run times</h2>
          <p className="text-sm text-neutral-500">
            {schedule ? `Computed in ${schedule.timezone}.` : 'Save the configuration to see a preview.'}
          </p>
        </div>
        {preview.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            No upcoming runs to preview yet.
          </p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {preview.map((date, index) => (
              <li key={date.toISOString()} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="tabular-nums">
                  {index + 1}. {date.toISOString()}
                </span>
                <span className="text-xs text-neutral-400">
                  {date.toLocaleString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

