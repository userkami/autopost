import { auditLog } from '@/db/schema';
import type { DbLike } from '@/db/schema';
import { db } from '@/db';
import { logger } from '@/lib/logger';

/** Every admin/significant action appends here — PLAN.md §5 / §14.4. */

export type AuditEntry = {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
};

export async function recordAudit(entry: AuditEntry, database: DbLike = db): Promise<void> {
  await database.insert(auditLog).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    meta: entry.meta ?? {},
    ip: entry.ip ?? null,
  });
}

/** Never lets an audit failure break the caller; logs loudly instead. */
export async function recordAuditSafe(entry: AuditEntry, database: DbLike = db): Promise<void> {
  try {
    await recordAudit(entry, database);
  } catch (error) {
    logger.error({ err: error, action: entry.action }, 'audit write failed');
  }
}
