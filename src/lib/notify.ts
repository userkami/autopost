import { eq } from 'drizzle-orm';
import { notifications, users } from '@/db/schema';
import type { DbLike } from '@/db/schema';
import { logger } from '@/lib/logger';
import { sendEmail } from './mail';

/**
 * In-app notifications (PLAN.md §3 notify.ts, §11 review delivery). Email is
 * layered on top (Phase 6, optional SMTP); this always writes the in-app
 * row. Never throws — a notification failure must not break the caller.
 */

export type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
};

export type NotifyResult = { inApp: true; emailSent: boolean };

export async function notify(database: DbLike, input: NotificationInput): Promise<NotifyResult> {
  try {
    await database.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    });
  } catch (error) {
    logger.error({ err: error, type: input.type, userId: input.userId }, 'notification write failed');
  }
  return { inApp: true, emailSent: false };
}

/**
 * Notify and optionally send email. Email send is soft-failure; caller may
 * choose to track email delivery via `recordEmailLog` on the result.
 */
export type NotifyWithEmailInput = NotificationInput & {
  emailSubject?: string;
  emailHtml?: string;
  emailText?: string;
};

export async function notifyWithEmail(
  database: DbLike,
  input: NotifyWithEmailInput,
): Promise<NotifyResult> {
  // Always write in-app
  await notify(database, input);

  // Soft email send
  const user = await database
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  const recipient = user[0]?.email;
  if (!recipient || !input.emailSubject || !input.emailHtml) {
    return { inApp: true, emailSent: false };
  }

  const result = await sendEmail({
    to: recipient,
    subject: input.emailSubject,
    html: input.emailHtml,
    text: input.emailText,
  });
  return { inApp: true, emailSent: result.sent };
}

/** Record an email send attempt (success or failure) for audit/debug. */
export async function recordEmailLog(
  database: DbLike,
  input: {
    userId: string;
    notificationType: string;
    recipient: string;
    subject: string;
    sent: boolean;
    error?: string;
  },
): Promise<void> {
  try {
    const { notificationEmailLog } = await import('@/db/schema');
    await database.insert(notificationEmailLog).values({
      userId: input.userId,
      notificationType: input.notificationType,
      recipient: input.recipient,
      subject: input.subject,
      sentAt: input.sent ? new Date() : null,
      error: input.error ?? null,
    });
  } catch (error) {
    logger.error({ err: error, type: input.notificationType }, 'email log write failed');
  }
}

/** Typed notification creators — used by pipeline, scheduler, blogger service. */

export type ReviewPendingPayload = {
  blogId: string;
  blogName: string;
  postId: string;
  postTitle: string;
  reviewUrl: string;
  expiryHours: number;
};

export function createReviewPending(input: ReviewPendingPayload): NotifyWithEmailInput {
  return {
    userId: '', // filled by caller with blog.userId
    type: 'review_pending',
    title: 'Post ready for review',
    body: `"${input.postTitle}" is ready for review. It will auto-expire in ${input.expiryHours} hours.`,
    link: input.reviewUrl,
    emailSubject: `Review: "${input.postTitle}" — ${input.blogName}`,
    emailHtml: `
      <p>A new post is ready for your review:</p>
      <h2>${input.postTitle}</h2>
      <p>Blog: ${input.blogName}</p>
      <p><a href="${input.reviewUrl}">Open in review queue</a></p>
      <p style="color:#666;font-size:0.9em">Expires in ${input.expiryHours} hours.</p>
    `,
    emailText: `Review: "${input.postTitle}" — ${input.blogName}\nOpen: ${input.reviewUrl}\nExpires in ${input.expiryHours} hours.`,
  };
}

export type PostPublishedPayload = {
  blogId: string;
  blogName: string;
  postId: string;
  postTitle: string;
  bloggerUrl: string;
};

export function createPostPublished(input: PostPublishedPayload): NotifyWithEmailInput {
  return {
    userId: '',
    type: 'post_published',
    title: 'Post published',
    body: `"${input.postTitle}" has been published to Blogger.`,
    link: input.bloggerUrl,
    emailSubject: `Published: "${input.postTitle}" — ${input.blogName}`,
    emailHtml: `
      <p>Your post has been published:</p>
      <h2>${input.postTitle}</h2>
      <p>Blog: ${input.blogName}</p>
      <p><a href="${input.bloggerUrl}">View on Blogger</a></p>
    `,
    emailText: `Published: "${input.postTitle}" — ${input.blogName}\nView: ${input.bloggerUrl}`,
  };
}

export type RunFailedPayload = {
  blogId: string;
  blogName: string;
  runId: string;
  error: string;
};

export function createRunFailed(input: RunFailedPayload): NotifyWithEmailInput {
  return {
    userId: '',
    type: 'run_failed',
    title: 'Scheduled run failed',
    body: `Run failed on ${input.blogName}: ${input.error}`,
    link: `/blogs/${input.blogId}/runs`,
    emailSubject: `Run failed on ${input.blogName}`,
    emailHtml: `
      <p>A scheduled run failed:</p>
      <p>Blog: ${input.blogName}</p>
      <p>Error: ${input.error}</p>
      <p><a href="/blogs/${input.blogId}/runs">View run details</a></p>
    `,
    emailText: `Run failed on ${input.blogName}\nError: ${input.error}\nView: /blogs/${input.blogId}/runs`,
  };
}

export type ReconnectNeededPayload = {
  connectionId: string;
  googleEmail: string;
  reason: string;
};

export function createReconnectNeeded(input: ReconnectNeededPayload): NotifyWithEmailInput {
  return {
    userId: '',
    type: 'reconnect_needed',
    title: 'Blogger connection needs attention',
    body: `${input.googleEmail} was rejected by Google (${input.reason}). Schedules for its blogs are paused until you reconnect.`,
    link: '/connect',
    emailSubject: `Action required: Reconnect ${input.googleEmail}`,
    emailHtml: `
      <p>Your Google connection for <strong>${input.googleEmail}</strong> was rejected by Google.</p>
      <p>Reason: ${input.reason}</p>
      <p>All blogs using this connection are paused. Please <a href="/connect">reconnect</a> to resume scheduling.</p>
    `,
    emailText: `Action required: Reconnect ${input.googleEmail}\nReason: ${input.reason}\nReconnect: /connect`,
  };
}

export type ScheduleAutoPausedPayload = {
  blogId: string;
  blogName: string;
  consecutiveFailures: number;
  lastError: string;
};

export function createScheduleAutoPaused(input: ScheduleAutoPausedPayload): NotifyWithEmailInput {
  return {
    userId: '',
    type: 'schedule_auto_paused',
    title: 'Schedule auto-paused after consecutive failures',
    body: `Schedule for ${input.blogName} was paused after ${input.consecutiveFailures} consecutive failed runs. Last error: ${input.lastError}`,
    link: `/blogs/${input.blogId}/schedule`,
    emailSubject: `Schedule paused on ${input.blogName}`,
    emailHtml: `
      <p>The schedule for <strong>${input.blogName}</strong> has been automatically paused.</p>
      <p>Consecutive failures: ${input.consecutiveFailures}</p>
      <p>Last error: ${input.lastError}</p>
      <p><a href="/blogs/${input.blogId}/schedule">View schedule settings</a></p>
    `,
    emailText: `Schedule paused on ${input.blogName}\nConsecutive failures: ${input.consecutiveFailures}\nLast error: ${input.lastError}\nSettings: /blogs/${input.blogId}/schedule`,
  };
}