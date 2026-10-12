'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { providerCatalog } from '@/db/schema';
import type { AIProviderName, ImageHostProviderName } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';

type CatalogProvider = AIProviderName | ImageHostProviderName;

const catalogSchema = z.object({
  action: z.enum(['create', 'update', 'delete', 'deprecate']),
  id: z.string().uuid().optional(),
  provider: z.string().optional(),
  role: z.enum(['text', 'image']).optional(),
  modelId: z.string().optional(),
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
  deprecatedAt: z.string().optional(),
  notes: z.string().optional(),
});

export async function adminCatalogAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = catalogSchema.safeParse({
    action: formData.get('action'),
    id: formData.get('id') ?? undefined,
    provider: formData.get('provider') ?? undefined,
    role: formData.get('role') ?? undefined,
    modelId: formData.get('modelId') ?? undefined,
    label: formData.get('label') ?? undefined,
    isDefault: formData.get('isDefault') === 'on' ? true : formData.get('isDefault') === 'true' ? true : undefined,
    deprecatedAt: formData.get('deprecatedAt') ?? undefined,
    notes: formData.get('notes') ?? undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid request');

  const { action, id, provider, role, modelId, label, isDefault, deprecatedAt, notes } = parsed.data;
  const admin = await requireAdmin();

  await db.transaction(async (tx) => {
    switch (action) {
      case 'create': {
        if (!provider || !role || !modelId || !label) throw new Error('All fields required for create');
        const catalogProvider = provider as CatalogProvider;
        await tx.insert(providerCatalog).values({ provider: catalogProvider, role, modelId, label, isDefault: isDefault ?? false, notes });
        await recordAuditSafe({ actorId: admin.id, action: 'admin.catalog_create', targetType: 'catalog', meta: { provider, role, modelId } }, tx);
        break;
      }
      case 'update': {
        if (!id) throw new Error('ID required for update');
        const updateData: Record<string, unknown> = {};
        if (label !== undefined) updateData.label = label;
        if (isDefault !== undefined) updateData.isDefault = isDefault;
        if (notes !== undefined) updateData.notes = notes;
        if (deprecatedAt !== undefined) updateData.deprecatedAt = deprecatedAt ? new Date(deprecatedAt) : null;
        if (Object.keys(updateData).length > 0) {
          updateData.updatedAt = new Date();
          await tx.update(providerCatalog).set(updateData).where(eq(providerCatalog.id, id));
          await recordAuditSafe({ actorId: admin.id, action: 'admin.catalog_update', targetType: 'catalog', targetId: id, meta: updateData }, tx);
        }
        break;
      }
      case 'delete': {
        if (!id) throw new Error('ID required for delete');
        await tx.delete(providerCatalog).where(eq(providerCatalog.id, id));
        await recordAuditSafe({ actorId: admin.id, action: 'admin.catalog_delete', targetType: 'catalog', targetId: id }, tx);
        break;
      }
      case 'deprecate': {
        if (!id) throw new Error('ID required for deprecate');
        await tx.update(providerCatalog).set({ deprecatedAt: new Date(), updatedAt: new Date() }).where(eq(providerCatalog.id, id));
        await recordAuditSafe({ actorId: admin.id, action: 'admin.catalog_deprecate', targetType: 'catalog', targetId: id }, tx);
        break;
      }
    }
  });

  revalidatePath('/admin/catalog');
}