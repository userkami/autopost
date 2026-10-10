'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { aiConnections, imageHosts } from '@/db/schema';
import type { AIProviderName, ImageHostProviderName } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';
import { testConnectionLimiter } from '@/lib/ratelimit';
import {
  encryptAiConnectionSecrets,
  recordAiTestResult,
  recordImageHostTestResult,
  testAiConnection,
  testImageHost,
} from '@/lib/connections';
import { encrypt } from '@/lib/crypto';
import { cloudinaryConfigSchema, imgbbConfigSchema } from '@/lib/imagehosts/config';

/**
 * Connections server actions (PLAN.md §7, §8.4, §13 /connections).
 * Every query is scoped by the current user's id (PLAN.md §14.4). Secrets are
 * encrypted before storage and never returned to the browser (§14.2).
 */

const AI_PROVIDERS = [
  'gemini',
  'openai',
  'openrouter',
  'anthropic',
  'pollinations',
  'fal',
  'leonardo',
  'custom_openai',
  'mock',
] as const satisfies readonly AIProviderName[];

const IMAGE_HOST_PROVIDERS = ['imgbb', 'cloudinary', 'mock'] as const satisfies readonly ImageHostProviderName[];

const aiConnectionInput = z.object({
  provider: z.enum(AI_PROVIDERS),
  label: z.string().trim().min(1, 'A label is required').max(80),
  apiKey: z.string().trim().min(1, 'An API key is required'),
  baseUrl: z.string().trim().url('Base URL must be a valid URL').optional().or(z.literal('')),
});

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createAiConnectionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = aiConnectionInput.safeParse({
    provider: formData.get('provider'),
    label: formData.get('label'),
    apiKey: formData.get('apiKey'),
    baseUrl: formData.get('baseUrl') ?? '',
  });
  if (!parsed.success) fail('/connections', parsed.error.issues[0]?.message ?? 'Invalid input');

  const { provider, label, apiKey, baseUrl } = parsed.data;
  if (provider === 'custom_openai' && !baseUrl) fail('/connections', 'A base URL is required');

  const { apiKeyEnc } = encryptAiConnectionSecrets({ apiKey });
  const [row] = await db
    .insert(aiConnections)
    .values({
      userId: user.id,
      provider,
      label,
      baseUrl: baseUrl || null,
      apiKeyEnc,
    })
    .returning({ id: aiConnections.id });

  await recordAuditSafe({
    actorId: user.id,
    action: 'ai_connection.create',
    targetType: 'ai_connection',
    targetId: row?.id,
    meta: { provider, label },
  });
  revalidatePath('/connections');
  redirect('/connections?status=Connection+added');
}

export async function deleteAiConnectionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  await db.delete(aiConnections).where(and(eq(aiConnections.id, id), eq(aiConnections.userId, user.id)));
  await recordAuditSafe({
    actorId: user.id,
    action: 'ai_connection.delete',
    targetType: 'ai_connection',
    targetId: id,
  });
  revalidatePath('/connections');
  redirect('/connections?status=Connection+removed');
}

export async function testAiConnectionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!testConnectionLimiter.check(`user:${user.id}`)) {
    fail('/connections', 'Too many tests — wait a minute and try again');
  }

  const [row] = await db
    .select()
    .from(aiConnections)
    .where(and(eq(aiConnections.id, id), eq(aiConnections.userId, user.id)))
    .limit(1);
  if (!row) fail('/connections', 'Connection not found');

  const result = await testAiConnection(db, row);
  await recordAiTestResult(db, row.id, result);
  revalidatePath('/connections');
  redirect(
    result.ok
      ? '/connections?status=Connection+test+passed'
      : `/connections?error=${encodeURIComponent(result.error ?? 'Connection test failed')}`,
  );
}

const imageHostInput = z.object({
  provider: z.enum(IMAGE_HOST_PROVIDERS),
  label: z.string().trim().min(1, 'A label is required').max(80),
});

export async function createImageHostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = imageHostInput.safeParse({
    provider: formData.get('provider'),
    label: formData.get('label'),
  });
  if (!parsed.success) fail('/connections', parsed.error.issues[0]?.message ?? 'Invalid input');
  const { provider, label } = parsed.data;

  let config: unknown;
  if (provider === 'imgbb') {
    const result = imgbbConfigSchema.safeParse({ apiKey: String(formData.get('apiKey') ?? '').trim() });
    if (!result.success) fail('/connections', result.error.issues[0]?.message ?? 'Invalid imgbb config');
    config = result.data;
  } else if (provider === 'cloudinary') {
    const result = cloudinaryConfigSchema.safeParse({
      cloudName: String(formData.get('cloudName') ?? '').trim(),
      apiKey: String(formData.get('apiKey') ?? '').trim() || undefined,
      apiSecret: String(formData.get('apiSecret') ?? '').trim() || undefined,
      uploadPreset: String(formData.get('uploadPreset') ?? '').trim() || undefined,
    });
    if (!result.success) fail('/connections', result.error.issues[0]?.message ?? 'Invalid Cloudinary config');
    config = result.data;
  } else {
    config = {};
  }

  const [row] = await db
    .insert(imageHosts)
    .values({ userId: user.id, provider, label, configEnc: encrypt(JSON.stringify(config)) })
    .returning({ id: imageHosts.id });

  await recordAuditSafe({
    actorId: user.id,
    action: 'image_host.create',
    targetType: 'image_host',
    targetId: row?.id,
    meta: { provider, label },
  });
  revalidatePath('/connections');
  redirect('/connections?status=Image+host+added');
}

export async function deleteImageHostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  await db.delete(imageHosts).where(and(eq(imageHosts.id, id), eq(imageHosts.userId, user.id)));
  await recordAuditSafe({
    actorId: user.id,
    action: 'image_host.delete',
    targetType: 'image_host',
    targetId: id,
  });
  revalidatePath('/connections');
  redirect('/connections?status=Image+host+removed');
}

export async function testImageHostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!testConnectionLimiter.check(`host:${user.id}`)) {
    fail('/connections', 'Too many tests — wait a minute and try again');
  }

  const [row] = await db
    .select()
    .from(imageHosts)
    .where(and(eq(imageHosts.id, id), eq(imageHosts.userId, user.id)))
    .limit(1);
  if (!row) fail('/connections', 'Image host not found');

  const result = await testImageHost(row);
  await recordImageHostTestResult(db, row.id, result);
  revalidatePath('/connections');
  redirect(
    result.ok
      ? '/connections?status=Image+host+test+passed'
      : `/connections?error=${encodeURIComponent(result.error ?? 'Image host test failed')}`,
  );
}