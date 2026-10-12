import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { BlogProfile } from '../lib/blog-profile';

/**
 * Full data model — PLAN.md §5.
 * - All IDs are UUID (default random).
 * - All timestamps are timestamptz; content tables have created_at/updated_at.
 * - All foreign keys are indexed.
 * - Secret columns end in _enc (AES-256-GCM via src/lib/crypto.ts).
 * - Adapter-managed auth tables keep the exact property names
 *   @auth/drizzle-adapter expects (id/name/email/emailVerified/image,
 *   providerAccountId/refresh_token/..., sessionToken/...).
 */

const now = () => sql`now()`;
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(now())
    .$onUpdateFn(() => new Date()),
};

// ---------------------------------------------------------------------------
// Enums (closed value sets from PLAN.md §5)
// ---------------------------------------------------------------------------
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended']);
export const connectionStatusEnum = pgEnum('connection_status', [
  'active',
  'needs_reconnect',
  'revoked',
]);
export const blogStatusEnum = pgEnum('blog_status', ['active', 'paused', 'needs_reconnect']);
export const publishModeEnum = pgEnum('publish_mode', ['auto', 'review', 'draft']);
export const aiRoleEnum = pgEnum('ai_role', ['research', 'writing', 'image']);
export const frequencyTypeEnum = pgEnum('frequency_type', ['interval_hours', 'daily', 'weekdays']);
export const topicSourceEnum = pgEnum('topic_source', ['manual', 'brainstorm', 'grounded']);
export const topicStatusEnum = pgEnum('topic_status', ['queued', 'used', 'skipped']);
export const runTriggerEnum = pgEnum('run_trigger', ['scheduled', 'manual']);
export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'canceled',
]);
export const postStatusEnum = pgEnum('post_status', [
  'generating',
  'pending_review',
  'approved',
  'publishing',
  'published',
  'draft_on_blogger',
  'rejected',
  'expired',
  'failed',
]);
export const pipelineStepEnum = pgEnum('pipeline_step', [
  'research',
  'write',
  'image',
  'upload',
  'assemble',
  'deliver',
]);
export const stepStatusEnum = pgEnum('step_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);
export const catalogRoleEnum = pgEnum('catalog_role', ['text', 'image']);

// ---------------------------------------------------------------------------
// Provider unions (kept as text; enforced by the Phase 2 registry)
// ---------------------------------------------------------------------------
export type AIProviderName =
  | 'gemini'
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'pollinations'
  | 'fal'
  | 'leonardo'
  | 'custom_openai'
  | 'mock';

export type ImageHostProviderName = 'imgbb' | 'cloudinary' | 'mock';

// ---------------------------------------------------------------------------
// Auth (PLAN.md §5 — accounts/sessions/verification_tokens from the Auth.js adapter)
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').notNull().unique(),
  // Required by @auth/drizzle-adapter (identity-only login; email is Google-verified).
  emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
  image: text('image'),
  isAdmin: boolean('is_admin').notNull().default(false),
  status: userStatusEnum('status').notNull().default('active'),
  blogLimit: integer('blog_limit'),
  maxPostsPerDay: integer('max_posts_per_day'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
});

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    id_token: text('id_token'),
    session_state: text('session_state'),
    scope: text('scope'),
    ...timestamps,
  },
  (t) => [
    unique('accounts_provider_provider_account_key').on(t.provider, t.providerAccountId),
    index('accounts_user_id_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Blog connections and blogs (PLAN.md §5)
// ---------------------------------------------------------------------------
export const blogConnections = pgTable(
  'blog_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    googleSub: text('google_sub').notNull(),
    googleEmail: text('google_email').notNull(),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    scopes: text('scopes').notNull().default(''),
    status: connectionStatusEnum('status').notNull().default('active'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    unique('blog_connections_user_google_sub_key').on(t.userId, t.googleSub),
    index('blog_connections_user_id_idx').on(t.userId),
  ],
);

export const imageHosts = pgTable('image_hosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<ImageHostProviderName>().notNull(),
  label: text('label').notNull(),
  configEnc: text('config_enc').notNull(),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  lastTestStatus: text('last_test_status'),
  ...timestamps,
});

export const blogs = pgTable(
  'blogs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => blogConnections.id, { onDelete: 'cascade' }),
    bloggerBlogId: text('blogger_blog_id').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    status: blogStatusEnum('status').notNull().default('active'),
    publishMode: publishModeEnum('publish_mode').notNull().default('review'),
    reviewExpiryHours: integer('review_expiry_hours').notNull().default(72),
    autoPublishOnExpiry: boolean('auto_publish_on_expiry').notNull().default(false),
    imageHostId: uuid('image_host_id').references(() => imageHosts.id, { onDelete: 'set null' }),
    profile: jsonb('profile').$type<BlogProfile>(),
    ...timestamps,
  },
  (t) => [
    unique('blogs_user_blogger_blog_key').on(t.userId, t.bloggerBlogId),
    index('blogs_user_id_idx').on(t.userId),
    index('blogs_connection_id_idx').on(t.connectionId),
    index('blogs_image_host_id_idx').on(t.imageHostId),
  ],
);

export const aiConnections = pgTable(
  'ai_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<AIProviderName>().notNull(),
    label: text('label').notNull(),
    baseUrl: text('base_url'),
    apiKeyEnc: text('api_key_enc').notNull(),
    extraEnc: text('extra_enc'),
    lastTestAt: timestamp('last_test_at', { withTimezone: true }),
    lastTestStatus: text('last_test_status'),
    lastTestError: text('last_test_error'),
    ...timestamps,
  },
  (t) => [index('ai_connections_user_id_idx').on(t.userId)],
);

export const blogRoles = pgTable(
  'blog_roles',
  {
    blogId: uuid('blog_id')
      .notNull()
      .references(() => blogs.id, { onDelete: 'cascade' }),
    role: aiRoleEnum('role').notNull(),
    aiConnectionId: uuid('ai_connection_id').references(() => aiConnections.id, {
      onDelete: 'set null',
    }),
    model: text('model'),
    params: jsonb('params'),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.blogId, t.role] }),
    index('blog_roles_ai_connection_id_idx').on(t.aiConnectionId),
  ],
);

export const schedules = pgTable(
  'schedules',
  {
    blogId: uuid('blog_id')
      .primaryKey()
      .references(() => blogs.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    frequencyType: frequencyTypeEnum('frequency_type').notNull().default('daily'),
    intervalHours: integer('interval_hours'),
    times: text('times')
      .array()
      .notNull()
      .default(sql`'{}'`),
    weekdays: integer('weekdays')
      .array()
      .notNull()
      .default(sql`'{}'`),
    timezone: text('timezone').notNull().default('UTC'),
    postsPerRun: integer('posts_per_run').notNull().default(1),
    // Set when a `needs_reconnect` failure disabled this schedule, so restore
    // re-enables exactly those (PLAN.md §6.3: "re-enables schedules that were
    // enabled before") without clobbering user-disabled schedules.
    pausedForReconnect: boolean('paused_for_reconnect').notNull().default(false),
    // Consecutive failed runs (PLAN.md §12: three in a row → auto-pause).
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    // Free-form log of scheduler actions (missed slots, auto-pauses) for the
    // admin health view and debugging.
    missedNotes: jsonb('missed_notes'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    ...timestamps,
  },
  () => [check('schedules_posts_per_run_range', sql`posts_per_run between 1 and 3`)],
);

// NOTE: @auth/drizzle-adapter requires sessionToken to be the primary key.
export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
    ...timestamps,
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * Custom Blogger OAuth flow state (PLAN.md §6.2, §14.5): a random `state` bound
 * to the session user, stored server-side with a short TTL and single-use.
 * The PKCE verifier is encrypted at rest.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    state: text('state').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeVerifierEnc: text('code_verifier_enc').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('oauth_states_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Pipeline (PLAN.md §5)
// ---------------------------------------------------------------------------
export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blogId: uuid('blog_id')
      .notNull()
      .references(() => blogs.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    source: topicSourceEnum('source').notNull().default('manual'),
    status: topicStatusEnum('status').notNull().default('queued'),
    // Queue order (PLAN.md §13 "reorder"; the pipeline takes the queue head).
    // Lower runs first; manual pastes append at max+1 (DECISIONS #31).
    position: integer('position').notNull().default(0),
    usedAt: timestamp('used_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('topics_blog_id_idx').on(t.blogId), index('topics_blog_position_idx').on(t.blogId, t.position)],
);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blogId: uuid('blog_id')
      .notNull()
      .references(() => blogs.id, { onDelete: 'cascade' }),
    trigger: runTriggerEnum('trigger').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    status: runStatusEnum('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    // Idempotent scheduling (PLAN.md §12): one run per (blog, slot).
    // Postgres unique allows multiple NULLs, so manual runs (NULL slot) are unaffected.
    unique('runs_blog_scheduled_for_key').on(t.blogId, t.scheduledFor),
    index('runs_blog_id_idx').on(t.blogId),
  ],
);

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blogId: uuid('blog_id')
      .notNull()
      .references(() => blogs.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    topic: text('topic'),
    title: text('title').notNull(),
    metaDescription: text('meta_description'),
    html: text('html').notNull(),
    labels: text('labels')
      .array()
      .notNull()
      .default(sql`'{}'`),
    imagePrompt: text('image_prompt'),
    imageAlt: text('image_alt'),
    imageUrl: text('image_url'),
    status: postStatusEnum('status').notNull().default('generating'),
    bloggerPostId: text('blogger_post_id'),
    bloggerUrl: text('blogger_url'),
    reviewExpiresAt: timestamp('review_expires_at', { withTimezone: true }),
    rejectedReason: text('rejected_reason'),
    usage: jsonb('usage'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('posts_blog_id_idx').on(t.blogId),
    index('posts_run_id_idx').on(t.runId),
    index('posts_blog_status_idx').on(t.blogId, t.status),
  ],
);

export const runSteps = pgTable(
  'run_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    step: pipelineStepEnum('step').notNull(),
    status: stepStatusEnum('status').notNull().default('pending'),
    attempt: integer('attempt').notNull().default(0),
    output: jsonb('output'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('run_steps_run_id_idx').on(t.runId), index('run_steps_post_id_idx').on(t.postId)],
);

// ---------------------------------------------------------------------------
// Catalog, settings, platform tables (PLAN.md §5)
// ---------------------------------------------------------------------------
export const providerCatalog = pgTable(
  'provider_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').$type<AIProviderName | ImageHostProviderName>().notNull(),
    role: catalogRoleEnum('role').notNull(),
    modelId: text('model_id').notNull(),
    label: text('label').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [unique('provider_catalog_provider_role_model_key').on(t.provider, t.role, t.modelId)],
);

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  ...timestamps,
});

export const invites = pgTable(
  'invites',
  {
    email: text('email').primaryKey(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  },
  (t) => [index('invites_created_by_idx').on(t.createdBy)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('notifications_user_id_idx').on(t.userId),
    index('notifications_user_unread_idx').on(t.userId, t.readAt),
  ],
);

/**
 * Worker heartbeat (PLAN.md §15 Health view). The worker writes one row per
 * tick (upsert on `id`) so the admin panel can show "worker down" when the
 * row is stale beyond a configurable threshold.
 */
export const workerHeartbeats = pgTable(
  'worker_heartbeats',
  {
    id: text('id').primaryKey().notNull(),
    lastTickAt: timestamp('last_tick_at', { withTimezone: true }).notNull().default(now()),
    lastTickOk: boolean('last_tick_ok').notNull().default(true),
    lastTickError: text('last_tick_error'),
    pendingJobs: integer('pending_jobs').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('worker_heartbeats_last_tick_at_idx').on(t.lastTickAt)],
);

/**
 * Email delivery log (PLAN.md §11 review delivery + §13). Every outbound
 * email is recorded before/at send so failures are visible even when SMTP
 * is misconfigured. `sentAt` is null on failure.
 */
export const notificationEmailLog = pgTable(
  'notification_email_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notificationType: text('notification_type').notNull(),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    index('notification_email_log_user_id_idx').on(t.userId),
    index('notification_email_log_sent_at_idx').on(t.sentAt),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    meta: jsonb('meta'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    index('audit_log_actor_id_idx').on(t.actorId),
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_action_idx').on(t.action),
  ],
);

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Blog = typeof blogs.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type WorkerHeartbeat = typeof workerHeartbeats.$inferSelect;

export type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;
/**
 * A drizzle database instance or one of its transactions.
 * (PgTransaction extends PgDatabase; schema param is structural/bivariant.)
 */
export type DbLike = Db;
