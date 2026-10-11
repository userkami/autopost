'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { aiConnections, blogRoles, blogs, imageHosts } from '@/db/schema';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { recordAuditSafe } from '@/lib/audit';
import { blogProfileSchema, type BlogProfile } from '@/lib/blog-profile';
import { getBlogForUser, upsertBlogRole } from '@/lib/blog-settings';
import { rolesForProvider } from '@/lib/providers/registry';

/**
 * Blog settings server actions (PLAN.md §7, §13 /blogs/[id]/settings).
 * Every query is scoped by the current user's id (PLAN.md §14.4) and the blog
 * is re-verified as owned before any write. Role assignments go through
 * `upsertBlogRole`, which re-validates provider capabilities server-side (§7).
 */

const ROLE_VALUES = ['research', 'writing', 'image'] as const;
type RoleValue = (typeof ROLE_VALUES)[number];

function settingsPath(blogId: string): string {
  return `/blogs/${blogId}/settings`;
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function ok(path: string, message: string): never {
  redirect(`${path}?status=${encodeURIComponent(message)}`);
}

async function requireOwnedBlog(userId: string, blogId: string) {
  const blog = await getBlogForUser(db, userId, blogId);
  if (!blog) fail('/dashboard', 'Blog not found or access denied');
  return blog;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Blog profile (blogs.profile jsonb)
// ---------------------------------------------------------------------------

const profileFormSchema = z.object({
  niche: z.string().trim().max(200).default(''),
  audience: z.string().trim().max(300).default(''),
  tone: z.string().trim().max(120).default(''),
  language: z.string().trim().min(2).max(10).default('en'),
  min_words: z.coerce.number().int().min(100).max(10_000).default(800),
  max_words: z.coerce.number().int().min(200).max(20_000).default(1600),
  keywords: z.string().default(''),
  default_labels: z.string().default(''),
  ai_disclosure: z.boolean().default(false),
  research_mode: z.enum(['manual', 'brainstorm', 'grounded']).default('brainstorm'),
  prompt_research: z.string().max(4000).default(''),
  prompt_writer: z.string().max(4000).default(''),
  prompt_image: z.string().max(4000).default(''),
});

export async function updateBlogProfileAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const parsed = profileFormSchema.safeParse({
    niche: formData.get('niche') ?? '',
    audience: formData.get('audience') ?? '',
    tone: formData.get('tone') ?? '',
    language: formData.get('language') ?? 'en',
    min_words: formData.get('min_words') ?? 800,
    max_words: formData.get('max_words') ?? 1600,
    keywords: formData.get('keywords') ?? '',
    default_labels: formData.get('default_labels') ?? '',
    ai_disclosure: formData.get('ai_disclosure') === 'on',
    research_mode: formData.get('research_mode') ?? 'brainstorm',
    prompt_research: formData.get('prompt_research') ?? '',
    prompt_writer: formData.get('prompt_writer') ?? '',
    prompt_image: formData.get('prompt_image') ?? '',
  });
  if (!parsed.success) {
    fail(settingsPath(blogId), parsed.error.issues[0]?.message ?? 'Invalid profile input');
  }

  const data = parsed.data;
  const profile: BlogProfile = blogProfileSchema.parse({
    niche: data.niche,
    audience: data.audience,
    tone: data.tone,
    language: data.language,
    min_words: data.min_words,
    max_words: data.max_words,
    keywords: splitList(data.keywords),
    default_labels: splitList(data.default_labels),
    ai_disclosure: data.ai_disclosure,
    research_mode: data.research_mode,
    prompt_overrides: {
      research: data.prompt_research || undefined,
      writer: data.prompt_writer || undefined,
      image: data.prompt_image || undefined,
    },
  });

  await db
    .update(blogs)
    .set({ profile })
    .where(and(eq(blogs.id, blogId), eq(blogs.userId, user.id)));

  await recordAuditSafe({
    actorId: user.id,
    action: 'blog.profile_update',
    targetType: 'blog',
    targetId: blogId,
    meta: { niche: profile.niche, research_mode: profile.research_mode },
  });
  revalidatePath(settingsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(settingsPath(blogId), 'Profile saved');
}

// ---------------------------------------------------------------------------
// Publish mode (publish_mode, review_expiry_hours, auto_publish_on_expiry)
// ---------------------------------------------------------------------------

const publishFormSchema = z.object({
  publishMode: z.enum(['auto', 'review', 'draft']),
  reviewExpiryHours: z.coerce.number().int().min(1).max(720).default(72),
  autoPublishOnExpiry: z.boolean().default(false),
});

export async function updatePublishSettingsAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const parsed = publishFormSchema.safeParse({
    publishMode: formData.get('publishMode') ?? 'review',
    reviewExpiryHours: formData.get('reviewExpiryHours') ?? 72,
    autoPublishOnExpiry: formData.get('autoPublishOnExpiry') === 'on',
  });
  if (!parsed.success) {
    fail(settingsPath(blogId), parsed.error.issues[0]?.message ?? 'Invalid publish settings');
  }

  await db
    .update(blogs)
    .set(parsed.data)
    .where(and(eq(blogs.id, blogId), eq(blogs.userId, user.id)));

  await recordAuditSafe({
    actorId: user.id,
    action: 'blog.publish_settings_update',
    targetType: 'blog',
    targetId: blogId,
    meta: parsed.data,
  });
  revalidatePath(settingsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(settingsPath(blogId), 'Publish settings saved');
}

// ---------------------------------------------------------------------------
// AI roles (blog_roles)
// ---------------------------------------------------------------------------

const roleFormSchema = z.object({
  role: z.enum(ROLE_VALUES),
  aiConnectionId: z.string().trim().min(1, 'Pick a connection'),
  model: z.string().trim().min(1, 'A model id is required').max(200),
});

export async function saveRoleAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const parsed = roleFormSchema.safeParse({
    role: formData.get('role'),
    aiConnectionId: formData.get('aiConnectionId'),
    model: formData.get('model'),
  });
  if (!parsed.success) {
    fail(settingsPath(blogId), parsed.error.issues[0]?.message ?? 'Invalid role input');
  }

  const result = await upsertBlogRole(db, { userId: user.id, blogId, ...parsed.data });
  if (!result.ok) fail(settingsPath(blogId), result.reason);

  await recordAuditSafe({
    actorId: user.id,
    action: 'blog.role_save',
    targetType: 'blog',
    targetId: blogId,
    meta: { role: parsed.data.role, aiConnectionId: parsed.data.aiConnectionId },
  });
  revalidatePath(settingsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(settingsPath(blogId), `${parsed.data.role} role saved`);
}

export async function clearRoleAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const role = String(formData.get('role') ?? '') as RoleValue;
  if (!ROLE_VALUES.includes(role)) fail(settingsPath(blogId), 'Unknown role');

  await db.delete(blogRoles).where(and(eq(blogRoles.blogId, blogId), eq(blogRoles.role, role)));

  await recordAuditSafe({
    actorId: user.id,
    action: 'blog.role_clear',
    targetType: 'blog',
    targetId: blogId,
    meta: { role },
  });
  revalidatePath(settingsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(settingsPath(blogId), `${role} role cleared`);
}


const sameAllFormSchema = z.object({
  aiConnectionId: z.string().trim().min(1, 'Pick a connection'),
  model: z.string().trim().min(1, 'A model id is required').max(200),
});

/**
 * "Use same settings for all three" (PLAN.md §7): applies the connection to
 * every role the provider can serve; unsupported roles are left unchanged and
 * reported back so the page can show the inline warning.
 */
export async function useSameConnectionForAllAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const parsed = sameAllFormSchema.safeParse({
    aiConnectionId: formData.get('aiConnectionId'),
    model: formData.get('model'),
  });
  if (!parsed.success) {
    fail(settingsPath(blogId), parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  const [connection] = await db
    .select()
    .from(aiConnections)
    .where(and(eq(aiConnections.id, parsed.data.aiConnectionId), eq(aiConnections.userId, user.id)))
    .limit(1);
  if (!connection) fail(settingsPath(blogId), 'AI connection not found');

  const supported = rolesForProvider(connection.provider);
  for (const role of supported) {
    const result = await upsertBlogRole(db, {
      userId: user.id,
      blogId,
      role,
      aiConnectionId: connection.id,
      model: parsed.data.model,
    });
    if (!result.ok) fail(settingsPath(blogId), result.reason);
  }

  const skipped = ROLE_VALUES.filter((role) => !supported.includes(role));
  await recordAuditSafe({
    actorId: user.id,
    action: 'blog.role_use_same',
    targetType: 'blog',
    targetId: blogId,
    meta: { provider: connection.provider, applied: supported, skipped },
  });
  revalidatePath(settingsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  const skippedNote = skipped.length
    ? ` — ${skipped.join(', ')} not supported by ${connection.provider} and left unchanged`
    : '';
  ok(settingsPath(blogId), `Applied to ${supported.join(', ')}${skippedNote}`);
}

// ---------------------------------------------------------------------------
// Image host selection (blogs.image_host_id)
// ---------------------------------------------------------------------------

export async function setImageHostAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  const hostId = String(formData.get('imageHostId') ?? '').trim();
  if (hostId) {
    const [host] = await db
      .select()
      .from(imageHosts)
      .where(and(eq(imageHosts.id, hostId), eq(imageHosts.userId, user.id)))
      .limit(1);
    if (!host) fail(settingsPath(blogId), 'Image host not found');
  }

  await db
    .update(blogs)
    .set({ imageHostId: hostId || null })
    .where(and(eq(blogs.id, blogId), eq(blogs.userId, user.id)));

  await recordAuditSafe({
    actorId: user.id,
    action: 'blog.image_host_set',
    targetType: 'blog',
    targetId: blogId,
    meta: { imageHostId: hostId || null },
  });
  revalidatePath(settingsPath(blogId));
  revalidatePath(`/blogs/${blogId}`);
  ok(settingsPath(blogId), hostId ? 'Image host selected' : 'Image host cleared');
}

// ---------------------------------------------------------------------------
// Danger zone — delete the blog; child rows (roles/schedules/topics/runs/posts)
// go with it via ON DELETE CASCADE (PLAN.md §5).
// ---------------------------------------------------------------------------

export async function deleteBlogAction(blogId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireOwnedBlog(user.id, blogId);

  // No-JS confirmation: the form requires typing "delete" (pattern + this check).
  if (String(formData.get('confirm') ?? '') !== 'delete') {
    fail(settingsPath(blogId), 'Type "delete" to confirm removing this blog');
  }

  await db.delete(blogs).where(and(eq(blogs.id, blogId), eq(blogs.userId, user.id)));

  await recordAuditSafe({
    actorId: user.id,
    action: 'blog.delete',
    targetType: 'blog',
    targetId: blogId,
  });
  revalidatePath('/dashboard');
  redirect(`/dashboard?status=${encodeURIComponent('Blog removed')}`);
}

