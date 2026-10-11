import { DateTime } from 'luxon';
import { and, eq } from 'drizzle-orm';
import { schedules } from '@/db/schema';
import type { DbLike } from '@/db/schema';

/**
 * Scheduler math + persistence (PLAN.md §12, §13 /blogs/[id]/schedule).
 * `computeNext` is pure and DST-safe (luxon): it always returns the next
 * instant strictly after `from` in the schedule's own timezone. The worker
 * tick (Phase 6) and the "next 5 run times" preview both rely on this single
 * implementation so they can never disagree.
 */

export type FrequencyType = 'interval_hours' | 'daily' | 'weekdays';

/** Plain config — deliberately decoupled from the DB row so it stays pure. */
export type ScheduleConfig = {
  frequencyType: FrequencyType;
  intervalHours: number;
  /** "HH:mm" 24h local times in `timezone` (for daily/weekdays). */
  times: string[];
  /** 0 = Sunday … 6 = Saturday (for weekdays). */
  weekdays: number[];
  timezone: string;
};

export type ScheduleRow = typeof schedules.$inferSelect;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validTimes(times: string[]): string[] {
  return times.filter((t) => TIME_RE.test(t)).sort();
}

/**
 * Next run instant strictly after `from`, or null when the config cannot
 * produce one (e.g. daily/weekdays with no valid times, or weekdays with an
 * empty day set).
 */
export function computeNext(config: ScheduleConfig, from: Date): Date | null {
  if (config.frequencyType === 'interval_hours') {
    const hours = Math.max(1, Math.floor(config.intervalHours));
    return DateTime.fromJSDate(from).plus({ hours }).toJSDate();
  }

  const times = validTimes(config.times);
  if (times.length === 0) return null;
  if (config.frequencyType === 'weekdays' && config.weekdays.length === 0) return null;

  const zone = config.timezone || 'UTC';
  const fromZ = DateTime.fromJSDate(from).setZone(zone);
  if (!fromZ.isValid) return DateTime.fromJSDate(from).plus({ hours: 1 }).toJSDate();

  // Scan up to 8 days ahead so a full week plus a DST boundary is covered.
  let best: DateTime | null = null;
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const day = fromZ.startOf('day').plus({ days: dayOffset });
    if (config.frequencyType === 'weekdays' && !config.weekdays.includes(day.weekday % 7)) {
      continue;
    }
    for (const time of times) {
      const [h, m] = time.split(':').map(Number);
      const candidate = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (!candidate.isValid) continue;
      if (candidate.toMillis() <= from.getTime()) continue;
      if (!best || candidate < best) best = candidate;
    }
  }
  return best ? best.toJSDate() : null;
}

/** The next `count` run instants after `from` (for the "next 5" preview). */
export function previewNextRuns(config: ScheduleConfig, from: Date, count = 5): Date[] {
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = computeNext(config, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence — scoped to a blog (ownership is enforced by the caller).
// ---------------------------------------------------------------------------

export async function getSchedule(database: DbLike, blogId: string): Promise<ScheduleRow | null> {
  const [row] = await database.select().from(schedules).where(eq(schedules.blogId, blogId)).limit(1);
  return row ?? null;
}

export type ScheduleInput = {
  frequencyType: FrequencyType;
  intervalHours: number;
  times: string[];
  weekdays: number[];
  timezone: string;
  postsPerRun: number;
};

/**
 * Insert or update the blog's schedule (one row per blog, PK = blog_id).
 * `enabled`/`pausedForReconnect`/`nextRunAt` are managed by the toggle action,
 * not here, so a plain settings save never accidentally turns the schedule on.
 */
export async function upsertSchedule(
  database: DbLike,
  blogId: string,
  input: ScheduleInput,
): Promise<ScheduleRow> {
  const [row] = await database
    .insert(schedules)
    .values({ blogId, ...input })
    .onConflictDoUpdate({
      target: schedules.blogId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning();
  return row as ScheduleRow;
}

/** Recompute and persist next_run_at from the schedule's own config. */
export async function refreshNextRunAt(
  database: DbLike,
  row: ScheduleRow,
  from: Date = new Date(),
): Promise<Date | null> {
  const next = computeNext(
    {
      frequencyType: row.frequencyType,
      intervalHours: row.intervalHours ?? 24,
      times: row.times,
      weekdays: row.weekdays,
      timezone: row.timezone,
    },
    from,
  );
  await database
    .update(schedules)
    .set({ nextRunAt: next, updatedAt: new Date() })
    .where(and(eq(schedules.blogId, row.blogId)));
  return next;
}
