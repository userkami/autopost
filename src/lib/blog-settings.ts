import { and, asc, eq } from 'drizzle-orm';
import { aiConnections, blogConnections, blogRoles, blogs, imageHosts } from '@/db/schema';
import type { DbLike } from '@/db/schema';
import { capabilitiesFor } from '@/lib/providers/registry';
import { computeReadiness, type AIRole, type Readiness, type ReadinessInput, type TestStatus } from '@/lib/readiness';

/**
 * Blog settings persistence (PLAN.md §7, §13 /blogs/[id]/settings).
 * Every query is scoped by user_id (§14.4); role assignments are validated
 * against the provider capability matrix server-side — the UI filtering is a
 * convenience, never the enforcement (§7).
 */

export type BlogRow = typeof blogs.$inferSelect;
export type BlogRoleRow = typeof blogRoles.$inferSelect;
export type AiConnectionRow = typeof aiConnections.$inferSelect;
export type ImageHostRow = typeof imageHosts.$inferSelect;

export const ALL_ROLES: readonly AIRole[] = ['research', 'writing', 'image'] as const;

/** Roles a connection may serve (research/writing need text; image needs image). */
export function roleAllowedForProvider(provider: AiConnectionRow['provider'], role: AIRole): boolean {
  const caps = capabilitiesFor(provider);
  return role === 'image' ? caps.image : caps.text;
}

export async function getBlogForUser(database: DbLike, userId: string, blogId: string): Promise<BlogRow | null> {
  const [row] = await database
    .select()
    .from(blogs)
    .where(and(eq(blogs.id, blogId), eq(blogs.userId, userId)))
    .limit(1);
  return row ?? null;
}

export type BlogSettingsData = {
  blog: BlogRow;
  roles: BlogRoleRow[];
  aiConnections: AiConnectionRow[];
  imageHosts: ImageHostRow[];
  googleConnection: (typeof blogConnections.$inferSelect) | null;
};

/** Everything the settings page needs, all loaded scoped by user_id. */
export async function loadBlogSettings(
  database: DbLike,
  userId: string,
  blogId: string,
): Promise<BlogSettingsData | null> {
  const blog = await getBlogForUser(database, userId, blogId);
  if (!blog) return null;

  const [roles, aiRows, hostRows, googleRows] = await Promise.all([
    database.select().from(blogRoles).where(eq(blogRoles.blogId, blogId)).orderBy(asc(blogRoles.role)),
    database.select().from(aiConnections).where(eq(aiConnections.userId, userId)).orderBy(asc(aiConnections.createdAt)),
    database.select().from(imageHosts).where(eq(imageHosts.userId, userId)).orderBy(asc(imageHosts.createdAt)),
    database
      .select()
      .from(blogConnections)
      .where(and(eq(blogConnections.id, blog.connectionId), eq(blogConnections.userId, userId)))
      .limit(1),
  ]);

  return { blog, roles, aiConnections: aiRows, imageHosts: hostRows, googleConnection: googleRows[0] ?? null };
}

export type UpsertRoleResult = { ok: true } | { ok: false; reason: string };

/** Save one role's (connection, model) with capability + ownership checks (§7). */
export async function upsertBlogRole(
  database: DbLike,
  input: { userId: string; blogId: string; role: AIRole; aiConnectionId: string; model: string },
): Promise<UpsertRoleResult> {
  const model = input.model.trim();
  if (!model) return { ok: false, reason: 'A model id is required (free text is fine)' };

  const [connection] = await database
    .select()
    .from(aiConnections)
    .where(and(eq(aiConnections.id, input.aiConnectionId), eq(aiConnections.userId, input.userId)))
    .limit(1);
  if (!connection) return { ok: false, reason: 'AI connection not found' };
  if (!roleAllowedForProvider(connection.provider, input.role)) {
    return { ok: false, reason: `${connection.provider} cannot serve the ${input.role} role` };
  }

  await database
    .insert(blogRoles)
    .values({
      blogId: input.blogId,
      role: input.role,
      aiConnectionId: connection.id,
      model,
    })
    .onConflictDoUpdate({
      target: [blogRoles.blogId, blogRoles.role],
      set: { aiConnectionId: connection.id, model, updatedAt: new Date() },
    });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Shared readiness derivation (PLAN.md §7 line 224, §17 Phase 4)
// ---------------------------------------------------------------------------

/** Map a connection's stored last_test_status text to the readiness enum. */
function toTestStatus(status: string | null): TestStatus {
  return status === 'ok' ? 'ok' : status === 'failed' ? 'failed' : 'untested';
}

/**
 * Turn loaded blog settings into a `ReadinessInput` so the overview page,
 * the schedule page and the schedule-enable gate all compute readiness the
 * same way. Role tests come from the backing AI connection; the image-host
 * test comes from the selected host row.
 */
export function deriveReadiness(data: BlogSettingsData): ReadinessInput {
  const connById = new Map(data.aiConnections.map((c) => [c.id, c]));
  const roles = {} as ReadinessInput['roles'];
  for (const role of ['research', 'writing', 'image'] as const) {
    const row = data.roles.find((r) => r.role === role);
    const connection = row?.aiConnectionId ? (connById.get(row.aiConnectionId) ?? null) : null;
    roles[role] = {
      configured: Boolean(row?.aiConnectionId && row?.model),
      test: connection ? toTestStatus(connection.lastTestStatus) : 'untested',
      connectionPresent: Boolean(row?.aiConnectionId) && Boolean(connection),
    };
  }

  const selectedHost = data.imageHosts.find((h) => h.id === data.blog.imageHostId) ?? null;
  const profile = data.blog.profile;
  return {
    googleStatus: data.googleConnection?.status ?? 'missing',
    profileComplete: Boolean(profile?.niche && profile?.audience && profile?.language),
    roles,
    imageHost: {
      selected: Boolean(selectedHost),
      test: selectedHost ? toTestStatus(selectedHost.lastTestStatus) : 'untested',
    },
  };
}

/** Convenience wrapper: loaded settings → computed readiness. */
export function blogReadiness(data: BlogSettingsData): Readiness {
  return computeReadiness(deriveReadiness(data));
}

