'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { blogs, runs, schedules } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';
import { getBlogForUser, loadBlogSettings, blogReadiness } from '@/lib/blog-settings';
import { getSchedule, refreshNextRunAt, upsertSchedule } from '@/lib/schedule';
import { manualRunLimiter } from '@/lib/ratelimit';

/**
 * Schedule server actions (PLAN.md §7, §12, §13 /blogs/[id]/schedule).
 * Enabling a schedule is gated by the readiness checklist (§7 line 224) and
 * "Run now" is rate-limited to 1 per 5 minutes per blog with an active-run
 * guard (§12). All queries are scoped by user_id (§14.4).
 */

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function schedulePath(blogId: string): string {
  return `/blogs/${blogId}/schedule`;
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function ok(path: string, message: string): never {
  redirect(`${path}?status=${encodeURIComponent(message)}`);
}

async function requireOwnedBlog(userId: string, blogId: string) {
  const blog = await getBlogForUser(db, userId, blogId);
  if (!blog) fail('/dashboard', 'Blog not found or access denied');
  return blog;
}

function parseTimes(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const scheduleFormSchema = z.object({
  frequencyType: z.enum(['interval_hours', 'daily', 'weekdays']),
  intervalHours: z.coerce.number().int().min(1).max(8760).default(24),
  times: z.string().default(''),
  weekdays: z.string().default(''),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  postsPerRun: z.coerce.number().int().min(1).max(20).default(1),
});

/** Save schedule settings. Does NOT enable the schedule (§12 gate). */
export async function saveScheduleAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const parsed = scheduleFormSchema.safeParse({
    frequencyType: formData.get('frequencyType') ?? 'daily',
    intervalHours: formData.get('intervalHours') ?? 24,
    times: formData.get('times') ?? '',
    weekdays: formData.get('weekdays') ?? '',
    timezone: formData.get('timezone') ?? 'UTC',
    postsPerRun: formData.get('postsPerRun') ?? 1,
  });
  if (!parsed.success) {
    fail(schedulePath(blogId), parsed.error.issues[0]?.message ?? 'Invalid schedule settings');
  }

  const data = parsed.data;
  const times = parseTimes(data.times);
  if (data.frequencyType !== 'interval_hours' && times.length === 0) {
    fail(schedulePath(blogId), 'Add at least one time (HH:mm) for daily/weekdays');
  }

  const weekdayValues = data.weekdays
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .map(Number)
    .filter((w) => (WEEKDAYS as readonly number[]).includes(w));
  if (data.frequencyType === 'weekdays' && weekdayValues.length === 0) {
    fail(schedulePath(blogId), 'Pick at least one weekday');
  }

  const existing = await getSchedule(db, blogId);
  const row = await upsertSchedule(db, blogId, {
    frequencyType: data.frequencyType,
    intervalHours: data.intervalHours,
    times,
    weekdays: data.frequencyType === 'weekdays' ? weekdayValues : [],
    timezone: data.timezone,
    postsPerRun: data.postsPerRun,
  });

  // If already enabled, recompute the next run so the change takes effect now.
  if (existing?.enabled) await refreshNextRunAt(db, row);

  await recordAuditSafe({
    actorId: user.id,
    action: 'schedule.save',
    targetType: 'blog',
    targetId: blogId,
    meta: { frequencyType: data.frequencyType, postsPerRun: data.postsPerRun },
  });
  revalidatePath(schedulePath(blogId));
  ok(schedulePath(blogId), 'Schedule saved');
}

const enableFormSchema = z.object({
  action: z.enum(['enable', 'disable']),
  /** Required only for enable; confirms the user saw the readiness state. */
  skipTest: z.boolean().default(false),
});

/**
 * Enable/disable the schedule (PLAN.md §7 line 224 + §12). Enabling is gated
 * on the readiness checklist unless the user explicitly confirms a skipped
 * test (the "skip test" escape hatch belongs to this action, not readiness).
 */
export async function toggleScheduleAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const parsed = enableFormSchema.safeParse({
    action: formData.get('action') ?? 'disable',
    skipTest: formData.get('skipTest') === 'on' || formData.get('skipTest') === 'true',
  });
  if (!parsed.success) {
    fail(schedulePath(blogId), parsed.error.issues[0]?.message ?? 'Invalid request');
  }

  const schedule = await getSchedule(db, blogId);
  if (!schedule) fail(schedulePath(blogId), 'Save the schedule settings first');

  if (parsed.data.action === 'disable') {
    await db
      .update(schedules)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(schedules.blogId, blogId));
    await recordAuditSafe({
      actorId: user.id,
      action: 'schedule.disable',
      targetType: 'blog',
      targetId: blogId,
    });
    revalidatePath(schedulePath(blogId));
    revalidatePath(`/blogs/${blogId}`);
    ok(schedulePath(blogId), 'Schedule paused');
  }

  // Enable path: re-check readiness server-side (§7 line 224).
  const settings = await loadBlogSettings(db, user.id, blogId);
  if (!settings) fail(schedulePath(blogId), 'Blog not found or access denied');
  const readiness = blogReadiness(settings);
  if (!readiness.ready && !parsed.data.skipTest) {
    const firstUnmet = readiness.items.find((i) => !i.ready);
    fail(
      schedulePath(blogId),
      `Not ready: ${firstUnmet?.label ?? 'checklist'} — ${firstUnmet?.detail ?? 'complete setup first'}`,
    );
  }

  await db
    .update(schedules)
    .set({ enabled: true, pausedForReconnect: false, updatedAt: new Date() })
    .where(eq(schedules.blogId, blogId));
  const refreshed = await getSchedule(db, blogId);
  if (refreshed) await refreshNextRunAt(db, refreshed);

  await recordAuditSafe({
    actorId: user.id,
    action: 'schedule.enable',
    targetType: 'blog',
    targetId: blogId,
    meta: { skippedTest: parsed.data.skipTest && !readiness.ready },
  });
  revalidatePath(schedulePath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(schedulePath(blogId), 'Schedule enabled');
}


// ---------------------------------------------------------------------------
// Run now (PLAN.md §12: 1 manual run per 5 min per blog; reject if a run is
// already active for the user). The worker executes queued runs (Phase 5/6).
// ---------------------------------------------------------------------------

export async function runNowAction(blogId: string, _formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  if (!manualRunLimiter.check(`run:${blogId}`)) {
    fail(schedulePath(blogId), 'Manual runs are limited to once every 5 minutes per blog');
  }

  // At most one active (queued/running) run per user across all their blogs.
  const userBlogs = await db.select({ id: blogs.id }).from(blogs).where(eq(blogs.userId, user.id));
  const blogIds = userBlogs.map((b) => b.id);
  if (blogIds.length > 0) {
    const active = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(inArray(runs.blogId, blogIds), inArray(runs.status, ['queued', 'running'])))
      .limit(1);
    if (active.length > 0) {
      fail(schedulePath(blogId), 'A run is already in progress — wait for it to finish');
    }
  }

  const [run] = await db
    .insert(runs)
    .values({ blogId, trigger: 'manual', status: 'queued' })
    .returning({ id: runs.id });

  await recordAuditSafe({
    actorId: user.id,
    action: 'run.manual',
    targetType: 'blog',
    targetId: blogId,
    meta: { runId: run?.id },
  });
  revalidatePath(schedulePath(blogId));
  ok(schedulePath(blogId), 'Run queued — it will start shortly');
}

