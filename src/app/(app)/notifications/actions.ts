'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { notifications } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';

export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)));
  revalidatePath('/notifications');
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  revalidatePath('/notifications');
}