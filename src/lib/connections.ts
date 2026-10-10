import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { aiConnections, imageHosts, providerCatalog } from '@/db/schema';
import type { AIProviderName, DbLike, ImageHostProviderName } from '@/db/schema';
import { decrypt, encrypt } from './crypto';
import { getImageHost } from './imagehosts/registry';
import { capabilitiesFor, getImageProvider, getTextProvider, type ProviderConnection } from './providers/registry';
import { ProviderError, toProviderError } from './providers/errors';

/**
 * Connection persistence + testing (PLAN.md §7, §8.4).
 * Secrets are encrypted at rest and NEVER returned to callers/browsers: every
 * public shape below omits `*Enc` fields (PLAN.md §14.2).
 */

export type AiConnectionRow = typeof aiConnections.$inferSelect;
export type ImageHostRow = typeof imageHosts.$inferSelect;

/** Browser-safe AI connection: no encrypted key, only a hint. */
export type PublicAiConnection = {
  id: string;
  provider: AIProviderName;
  label: string;
  baseUrl: string | null;
  hasKey: boolean;
  lastTestAt: Date | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  createdAt: Date;
};

/** Browser-safe image host: no encrypted config, only a hint. */
export type PublicImageHost = {
  id: string;
  provider: ImageHostProviderName;
  label: string;
  hasConfig: boolean;
  lastTestAt: Date | null;
  lastTestStatus: string | null;
  createdAt: Date;
};

export function toPublicAiConnection(row: AiConnectionRow): PublicAiConnection {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.baseUrl,
    hasKey: Boolean(row.apiKeyEnc),
    lastTestAt: row.lastTestAt,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    createdAt: row.createdAt,
  };
}

export function toPublicImageHost(row: ImageHostRow): PublicImageHost {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    hasConfig: Boolean(row.configEnc),
    lastTestAt: row.lastTestAt,
    lastTestStatus: row.lastTestStatus,
    createdAt: row.createdAt,
  };
}

/** Never throws on decrypt failure for listing; callers get a typed error instead. */
export function decryptConnection(row: AiConnectionRow): ProviderConnection {
  return {
    provider: row.provider,
    apiKey: row.apiKeyEnc ? decrypt(row.apiKeyEnc) : '',
    baseUrl: row.baseUrl,
    extra: row.extraEnc ? (JSON.parse(decrypt(row.extraEnc)) as Record<string, unknown>) : null,
  };
}

export function encryptAiConnectionSecrets(input: {
  apiKey: string;
  extra?: Record<string, unknown> | null;
}): { apiKeyEnc: string; extraEnc: string | null } {
  return {
    apiKeyEnc: encrypt(input.apiKey),
    extraEnc: input.extra ? encrypt(JSON.stringify(input.extra)) : null,
  };
}

export async function listAiConnections(database: DbLike, userId: string): Promise<AiConnectionRow[]> {
  return database
    .select()
    .from(aiConnections)
    .where(eq(aiConnections.userId, userId))
    .orderBy(asc(aiConnections.createdAt));
}

export async function listImageHosts(database: DbLike, userId: string): Promise<ImageHostRow[]> {
  return database
    .select()
    .from(imageHosts)
    .where(eq(imageHosts.userId, userId))
    .orderBy(asc(imageHosts.createdAt));
}

/**
 * Pick a model id for a connection Test (PLAN.md §8.4). Prefer the seeded,
 * non-deprecated default for the provider+role, else any non-deprecated entry.
 * Model ids are DATA — never hardcoded (PLAN.md §0.4).
 */
export async function resolveTestModel(
  database: DbLike,
  provider: AIProviderName,
  role: 'text' | 'image',
): Promise<string | null> {
  const candidates = await database
    .select()
    .from(providerCatalog)
    .where(
      and(eq(providerCatalog.provider, provider), eq(providerCatalog.role, role), isNull(providerCatalog.deprecatedAt)),
    )
    .orderBy(desc(providerCatalog.isDefault));
  return candidates[0]?.modelId ?? null;
}

export type TestResult = { ok: boolean; status: string; error?: string };

/** Runs the appropriate provider test for a connection (text, image, or both). */
export async function testAiConnection(database: DbLike, row: AiConnectionRow): Promise<TestResult> {
  const caps = capabilitiesFor(row.provider);
  try {
    const connection = decryptConnection(row);
    if (caps.text) {
      const model = await resolveTestModel(database, row.provider, 'text');
      if (model) await getTextProvider(connection).test(model);
    }
    if (caps.image) {
      const model = await resolveTestModel(database, row.provider, 'image');
      if (model) await getImageProvider(connection).test(model);
    }
    if (!caps.text && !caps.image) {
      throw new ProviderError('unsupported', 'This provider supports neither text nor image');
    }
    return { ok: true, status: 'ok' };
  } catch (error) {
    const providerError = toProviderError(error, 'Connection test failed');
    return { ok: false, status: 'failed', error: providerError.message };
  }
}

/** Test an image host by uploading a tiny fixture (PLAN.md §8.4). */
export async function testImageHost(row: ImageHostRow): Promise<TestResult> {
  try {
    const config = row.configEnc ? (JSON.parse(decrypt(row.configEnc)) as unknown) : {};
    await getImageHost({ provider: row.provider, config }).test();
    return { ok: true, status: 'ok' };
  } catch (error) {
    const providerError = toProviderError(error, 'Image host test failed');
    return { ok: false, status: 'failed', error: providerError.message };
  }
}

/** Records the outcome of a test on the connection row. */
export async function recordAiTestResult(database: DbLike, id: string, result: TestResult): Promise<void> {
  await database
    .update(aiConnections)
    .set({
      lastTestAt: new Date(),
      lastTestStatus: result.ok ? 'ok' : 'failed',
      lastTestError: result.ok ? null : (result.error ?? 'Test failed'),
      updatedAt: new Date(),
    })
    .where(eq(aiConnections.id, id));
}

export async function recordImageHostTestResult(database: DbLike, id: string, result: TestResult): Promise<void> {
  await database
    .update(imageHosts)
    .set({
      lastTestAt: new Date(),
      lastTestStatus: result.ok ? 'ok' : 'failed',
      updatedAt: new Date(),
    })
    .where(eq(imageHosts.id, id));
}