'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runs, runSteps } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';
import { enqueueRunExecute } from '@/lib/jobs';

const jobActionSchema = z.object({
  action: z.enum(['retry', 'cancel']),
  runId: z.string().uuid(),
});

export async function adminJobAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = jobActionSchema.safeParse({
    action: formData.get('action'),
    runId: formData.get('runId'),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid request');

  const { action, runId } = parsed.data;
  const admin = await requireAdmin();

  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) throw new Error('Run not found');

    if (action === 'retry') {
      // Reset run to queued, clear error, reset steps
      await tx.update(runs).set({ status: 'queued', error: null, startedAt: null, finishedAt: null, updatedAt: new Date() }).where(eq(runs.id, runId));
      await tx.update(runSteps).set({ status: 'pending', error: null, startedAt: null, finishedAt: null, updatedAt: new Date() }).where(eq(runSteps.runId, runId));
      await enqueueRunExecute(runId);
    } else if (action === 'cancel') {
      // Only cancel if queued
      if (run.status !== 'queued') throw new Error('Can only cancel queued runs');
      await tx.update(runs).set({ status: 'canceled', finishedAt: new Date(), updatedAt: new Date() }).where(eq(runs.id, runId));
    }

    await recordAuditSafe({ actorId: admin.id, action: `admin.run_${action}`, targetType: 'run', targetId: runId }, tx);
  });

  revalidatePath('/admin/jobs');
  revalidatePath(`/admin/jobs/${runId}`);
}