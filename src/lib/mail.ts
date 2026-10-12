import { createTransport, type TransportOptions } from 'nodemailer';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Email delivery (PLAN.md §13 — optional SMTP). `SMTP_URL` is optional: when
 * missing, `send` is a no-op that returns `sent: false` with a reason, so the
 * pipeline and scheduler never hard-fail on email. Every attempt (success or
 * failure) is recorded by the caller via `recordEmailLog`.
 */

type SendResult = { sent: true } | { sent: false; reason: string };

let transporter: ReturnType<typeof createTransport> | null = null;

function getTransporter(): ReturnType<typeof createTransport> | null {
  if (transporter) return transporter;
  if (!env.SMTP_URL) return null;
  try {
    transporter = createTransport(env.SMTP_URL as unknown as TransportOptions);
    return transporter;
  } catch (error) {
    logger.error({ err: error }, 'failed to create SMTP transporter');
    return null;
  }
}

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Send one email. Never throws — callers treat a failure as a soft event and
 * log it themselves (see `sendAndLog`).
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const transport = getTransporter();
  if (!transport) return { sent: false, reason: 'SMTP not configured' };
  try {
    await transport.sendMail({
      to: message.to,
      from: env.MAIL_FROM,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { sent: true };
  } catch (error) {
    logger.error({ err: error, to: message.to, subject: message.subject }, 'email send failed');
    return { sent: false, reason: error instanceof Error ? error.message : 'Unknown email error' };
  }
}

/** Convenience: send + return the reason when not sent. */
export async function sendAndLog(
  message: EmailMessage,
  log: (reason: string | null) => Promise<void>,
): Promise<SendResult> {
  const result = await sendEmail(message);
  await log(result.sent ? null : result.reason);
  return result;
}

/** Verify transporter connectivity once (used by /connections Test). */
export async function verifyTransport(): Promise<{ ok: boolean; error?: string }> {
  const transport = getTransporter();
  if (!transport) return { ok: false, error: 'SMTP not configured' };
  try {
    await transport.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}