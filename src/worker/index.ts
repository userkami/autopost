import { logger } from '../lib/logger';
import { PgBoss } from 'pg-boss';
import { executeRun } from '../lib/pipeline/run';
import { expireReviews, autoPublishCandidates } from '../lib/review';
import { db } from '../db';
import { eq, sql } from 'drizzle-orm';
import { schedules, runs, posts, blogs, blogConnections, users, workerHeartbeats } from '../db/schema';
import { withConnectionAuth } from '../lib/blogger/service';
import { publishPost, createPost } from '../lib/blogger/client';
import { computeNext, type ScheduleConfig } from '../lib/schedule';
import { notify, recordEmailLog, createScheduleAutoPaused } from '../lib/notify';
import { settings } from '../lib/settings';

/**
 * Worker entrypoint (PLAN.md §3, §12).
 * Registers pg-boss jobs for pipeline execution, review expiry, schedule ticks,
 * and worker heartbeat.
 */

const MISSED_SLOT_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
const MAX_CONSECUTIVE_FAILURES = 3;

async function startWorker(): Promise<void> {
  logger.info('worker starting');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error('DATABASE_URL not set - worker cannot start');
    process.exit(1);
  }

  const boss: PgBoss = new PgBoss(connectionString);

  // Register job: run.execute
  // Executes a pipeline run for a given run ID
  boss.work('run.execute', async (jobs: Array<{ data: { runId: string } }>) => {
    for (const job of jobs) {
      const { runId: runIdFromJob } = job.data;
      logger.info({ runIdFromJob }, 'starting pipeline run');
      try {
        const result = await executeRun(runIdFromJob, {
          interPostDelayMs: 10_000,
          maxWriteAttempts: 2,
        });
        logger.info({ runIdFromJob, result }, 'pipeline run completed');

        // On success, reset consecutive_failures
        const run = await db.query.runs.findFirst({ where: eq(runs.id, runIdFromJob) });
        if (run) {
          await db
            .update(schedules)
            .set({ consecutiveFailures: 0, updatedAt: new Date() })
            .where(eq(schedules.blogId, run.blogId));
        }
      } catch (error) {
        logger.error({ err: error, runId: runIdFromJob }, 'pipeline run failed');

        // On failure, increment consecutive_failures and check for auto-pause
        const run = await db.query.runs.findFirst({ where: eq(runs.id, runIdFromJob) });
        if (run) {
          const [sched] = await db
            .select()
            .from(schedules)
            .where(eq(schedules.blogId, run.blogId))
            .limit(1);

          if (sched) {
            const newFailures = (sched.consecutiveFailures ?? 0) + 1;
            if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
              // Auto-pause the schedule
              await db
                .update(schedules)
                .set({ enabled: false, pausedForReconnect: false, consecutiveFailures: newFailures, updatedAt: new Date() })
                .where(eq(schedules.blogId, run.blogId));

              // Notify user
              const [blog] = await db
                .select({ userId: blogs.userId, name: blogs.name })
                .from(blogs)
                .where(eq(blogs.id, run.blogId))
                .limit(1);

              if (blog) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                const notification = createScheduleAutoPaused({
                  blogId: run.blogId,
                  blogName: blog.name,
                  consecutiveFailures: newFailures,
                  lastError: errorMsg,
                });
                notification.userId = blog.userId;
                const notifyResult = await notify(db, notification);

                // Log email attempt
                const user = await db
                  .select({ email: users.email })
                  .from(users)
                  .where(eq(users.id, blog.userId))
                  .limit(1);
                if (user[0]?.email) {
                  await recordEmailLog(db, {
                    userId: blog.userId,
                    notificationType: 'schedule_auto_paused',
                    recipient: user[0].email,
                    subject: notification.emailSubject!,
                    sent: notifyResult.emailSent,
                    error: notifyResult.emailSent ? undefined : 'SMTP not configured or send failed',
                  });
                }
              }
            } else {
              await db
                .update(schedules)
                .set({ consecutiveFailures: newFailures, updatedAt: new Date() })
                .where(eq(schedules.blogId, run.blogId));
            }
          }
        }

        throw error;
      }
    }
  });

  // Register job: review.expire
  boss.work('review.expire', async () => {
    logger.info('starting review expiry job');
    try {
      const result = await expireReviews(db);
      logger.info({ expired: result.expired.length, toPublish: result.toPublish.length }, 'review expiry completed');

      if (result.toPublish.length > 0) {
        const candidates = await autoPublishCandidates(db, result.toPublish);
        for (const postId of candidates) {
          try {
            const [post] = await db
              .select({
                id: posts.id,
                blogId: posts.blogId,
                title: posts.title,
                html: posts.html,
                labels: posts.labels,
                bloggerPostId: posts.bloggerPostId,
              })
              .from(posts)
              .where(eq(posts.id, postId))
              .limit(1);

            if (!post) {
              logger.warn({ postId }, 'Post not found for auto-publish');
              continue;
            }

            const [blog] = await db
              .select({
                id: blogs.id,
                bloggerBlogId: blogs.bloggerBlogId,
                connectionId: blogs.connectionId,
              })
              .from(blogs)
              .where(eq(blogs.id, post.blogId))
              .limit(1);

            if (!blog) {
              logger.warn({ blogId: post.blogId }, 'Blog not found for auto-publish');
              continue;
            }

            const connection = await db
              .select()
              .from(blogConnections)
              .where(eq(blogConnections.id, blog.connectionId))
              .limit(1);

            if (!connection[0]) {
              logger.warn({ connectionId: blog.connectionId }, 'Connection not found for auto-publish');
              continue;
            }

            if (post.bloggerPostId) {
              await withConnectionAuth(db, connection[0], async (token) => {
                await publishPost(token, blog.bloggerBlogId, post.bloggerPostId!);
              });
              await db.update(posts).set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() }).where(eq(posts.id, postId));
            } else {
              const created = await withConnectionAuth(db, connection[0], async (token) => {
                return createPost(token, blog.bloggerBlogId, {
                  title: post.title,
                  content: post.html,
                  labels: Array.isArray(post.labels) ? (post.labels as string[]) : [],
                }, { isDraft: false });
              });
              await db.update(posts).set({ bloggerPostId: created.id, bloggerUrl: created.published ?? null, status: 'published', publishedAt: new Date(), updatedAt: new Date() }).where(eq(posts.id, postId));
            }

            logger.info({ postId }, 'auto-published post on expiry');
          } catch (error) {
            logger.error({ err: error, postId }, 'auto-publish failed');
            await db.update(posts).set({ status: 'failed', updatedAt: new Date() }).where(eq(posts.id, postId));
          }
        }
      }

      return result;
    } catch (error) {
      logger.error({ err: error }, 'review expiry failed');
      throw error;
    }
  });

  // Register job: schedule.tick
  // Finds schedules due and creates queued runs with SKIP LOCKED, missed-slot policy,
  // per-user concurrency (singletonKey), and consecutive-failure auto-pause.
  boss.work('schedule.tick', async () => {
    logger.info('starting schedule tick');
    const now = new Date();

    try {
      // Check global pause
      const globalPause = await settings.get('global_pause');
      if (globalPause) {
        logger.info('global_pause is true, skipping schedule tick');
        await writeHeartbeat(true, 0, null);
        return { runsCreated: [], skipped: true };
      }

      // Find due schedules with SKIP LOCKED, joining to active blogs and non-suspended users.
      // Uses a CTE to lock schedules and filter in one query.
      const dueSchedules = await db.transaction(async (tx) => {
        const result = await tx.execute(sql`
          WITH due AS (
            SELECT s.blog_id, s.frequency_type, s.interval_hours, s.times, s.weekdays, s.timezone,
                   s.posts_per_run, s.consecutive_failures, s.next_run_at,
                   b.user_id, b.name as blog_name, u.status as user_status
            FROM schedules s
            INNER JOIN blogs b ON b.id = s.blog_id
            INNER JOIN users u ON u.id = b.user_id
            WHERE s.enabled = true
              AND s.paused_for_reconnect = false
              AND s.next_run_at <= ${now}
              AND u.status = 'active'
            FOR UPDATE OF s SKIP LOCKED
          )
          SELECT * FROM due
        `);
        return result.rows as Array<{
          blog_id: string;
          frequency_type: string;
          interval_hours: number | null;
          times: string[];
          weekdays: number[];
          timezone: string;
          posts_per_run: number;
          consecutive_failures: number;
          next_run_at: Date;
          user_id: string;
          blog_name: string;
          user_status: string;
        }>;
      });

      logger.info({ count: dueSchedules.length }, `found ${dueSchedules.length} schedules due`);

      const runsCreated: string[] = [];
      const usersWithRuns = new Set<string>();

      for (const sched of dueSchedules) {
        // Per-user concurrency: skip if this user already has a run being created this tick
        if (usersWithRuns.has(sched.user_id)) {
          logger.info({ blogId: sched.blog_id, userId: sched.user_id }, 'skipping: user already has a run this tick');
          continue;
        }

        // Missed-slot policy: if next_run_at is > 60 min in the past, skip to next future slot
        const msSinceNextRun = now.getTime() - new Date(sched.next_run_at).getTime();
        if (msSinceNextRun > MISSED_SLOT_THRESHOLD_MS) {
          // Compute the next future slot and update next_run_at, logging a missed note
          const config: ScheduleConfig = {
            frequencyType: sched.frequency_type as 'interval_hours' | 'daily' | 'weekdays',
            intervalHours: sched.interval_hours ?? 24,
            times: sched.times,
            weekdays: sched.weekdays,
            timezone: sched.timezone,
          };
          const nextFuture = computeNext(config, now);
          if (nextFuture) {
            await db
              .update(schedules)
              .set({
                nextRunAt: nextFuture,
                missedNotes: sql`jsonb_set(coalesce(missed_notes, '[]'::jsonb), '{0}', to_jsonb(${JSON.stringify({
                  missedAt: now.toISOString(),
                  originalNextRunAt: sched.next_run_at,
                  newNextRunAt: nextFuture.toISOString(),
                  reason: 'missed_slot',
                })}))`,
                updatedAt: new Date(),
              })
              .where(eq(schedules.blogId, sched.blog_id));
            logger.warn({ blogId: sched.blog_id, originalNextRunAt: sched.next_run_at, newNextRunAt: nextFuture }, 'missed slot: skipped to next future run');
          } else {
            logger.warn({ blogId: sched.blog_id, nextRunAt: sched.next_run_at }, 'missed slot: could not compute next future run');
          }
          continue;
        }

        // Create a queued run (idempotent via unique (blog_id, scheduled_for))
        const scheduledFor = sched.next_run_at;
        let runId: string | null = null;

        try {
          const [run] = await db
            .insert(runs)
            .values({
              blogId: sched.blog_id,
              trigger: 'scheduled',
              scheduledFor,
              status: 'queued',
            })
            .onConflictDoNothing({ target: [runs.blogId, runs.scheduledFor] })
            .returning({ id: runs.id });

          if (!run) {
            // Race: another worker already created this run
            logger.info({ blogId: sched.blog_id, scheduledFor }, 'run already exists for this slot');
            continue;
          }

          runId = run.id;
          runsCreated.push(runId);
          usersWithRuns.add(sched.user_id);

          logger.info({ blogId: sched.blog_id, runId }, 'created scheduled run');

          // Enqueue run.execute with singletonKey for per-user concurrency
          await boss.send('run.execute', { runId }, { singletonKey: `user:${sched.user_id}` });
          logger.info({ runId }, 'enqueued run.execute job');

          // Update schedule's nextRunAt and lastRunAt
          const next = computeNext(
            {
              frequencyType: sched.frequency_type as 'interval_hours' | 'daily' | 'weekdays',
              intervalHours: sched.interval_hours ?? 24,
              times: sched.times,
              weekdays: sched.weekdays,
              timezone: sched.timezone,
            },
            now,
          );
          await db
            .update(schedules)
            .set({ nextRunAt: next, lastRunAt: now, updatedAt: new Date() })
            .where(eq(schedules.blogId, sched.blog_id));
          logger.info({ blogId: sched.blog_id, nextRunAt: next }, 'updated nextRunAt');
        } catch (error) {
          logger.error({ err: error, blogId: sched.blog_id, runId }, 'failed to create scheduled run');
        }
      }

      await writeHeartbeat(true, runsCreated.length, null);
      logger.info({ created: runsCreated.length }, 'schedule tick completed');
      return { runsCreated };
    } catch (error) {
      logger.error({ err: error }, 'schedule tick failed');
      await writeHeartbeat(false, 0, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  });

  // Register job: worker.heartbeat
  // Writes a heartbeat row every 30s for admin health view
  boss.work('worker.heartbeat', async () => {
    await writeHeartbeat(true, 0, null);
  });

  // Start the job queues
  await boss.start();
  logger.info('worker started and listening for jobs');

  // Schedule recurring jobs
  await boss.schedule('schedule.tick', 'every 1 minute', {});
  await boss.schedule('worker.heartbeat', 'every 30 seconds', {});
  await boss.schedule('review.expire', 'every 1 hour', {});

  // Heartbeat for visibility (fallback if pg-boss scheduling fails)
  const heartbeatInterval = setInterval(() => {
    logger.debug('worker heartbeat (interval fallback)');
  }, 30_000);

  function shutdown(signal: NodeJS.Signals): void {
    logger.info({ signal }, 'worker shutting down');
    clearInterval(heartbeatInterval);
    boss.stop().then(() => {
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Write a heartbeat row to worker_heartbeats table (upsert).
 * Never throws - failure is logged but doesn't break the tick.
 */
async function writeHeartbeat(
  ok: boolean,
  pendingJobs: number,
  error: string | null,
): Promise<void> {
  try {
    await db
      .insert(workerHeartbeats)
      .values({
        id: 'worker-1',
        lastTickAt: new Date(),
        lastTickOk: ok,
        lastTickError: error,
        pendingJobs,
      })
      .onConflictDoUpdate({
        target: workerHeartbeats.id,
        set: { lastTickAt: new Date(), lastTickOk: ok, lastTickError: error, pendingJobs, updatedAt: new Date() },
      });
  } catch (err) {
    logger.error({ err }, 'failed to write worker heartbeat');
  }
}

// Start the worker
startWorker().catch((error) => {
  logger.error({ err: error }, 'failed to start worker');
  process.exit(1);
});