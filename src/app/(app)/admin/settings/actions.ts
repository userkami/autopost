'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { appSettings } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';

const settingsSchema = z.object({
  key: z.enum(['default_blog_limit', 'signups_mode', 'maintenance_mode', 'global_pause', 'default_max_posts_per_day', 'blocklist_keywords', 'announcement_text', 'announcement_active', 'custom_endpoints_allowed']),
  value: z.string(),
});

export async function adminSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse({
    key: formData.get('key'),
    value: formData.get('value') ?? '',
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid request');

  const { key, value } = parsed.data;

  let parsedValue: number | boolean | string | string[] | null;
  try {
    switch (key) {
      case 'default_blog_limit':
      case 'default_max_posts_per_day':
        parsedValue = parseInt(value, 10);
        if (isNaN(parsedValue) || parsedValue < 0) throw new Error('Invalid number');
        break;
      case 'signups_mode':
        if (!['open', 'invite_only', 'closed'].includes(value)) throw new Error('Invalid mode');
        parsedValue = value;
        break;
      case 'maintenance_mode':
      case 'global_pause':
      case 'custom_endpoints_allowed':
        parsedValue = value === 'true';
        break;
      case 'blocklist_keywords':
        parsedValue = value.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case 'announcement_text':
        parsedValue = value;
        break;
      case 'announcement_active':
        parsedValue = value === 'true';
        break;
      default:
        throw new Error('Unknown setting');
    }
  } catch {
    throw new Error('Invalid value format');
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key, value: parsedValue })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: parsedValue, updatedAt: new Date() } });
    await recordAuditSafe({ actorId: (await requireAdmin()).id, action: 'admin.set_app_setting', targetType: 'setting', targetId: key, meta: { value: parsedValue } }, tx);
  });

  revalidatePath('/admin/settings');
}