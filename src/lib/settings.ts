import { appSettings } from '@/db/schema';
import type { DbLike } from '@/db/schema';
import { db } from '@/db';
import { logger } from '@/lib/logger';

/**
 * app_settings access + cache — PLAN.md §3 (settings.ts).
 * Unknown/missing/invalid rows fall back to typed defaults so the app never
 * hard-fails on a missing setting; loader errors are logged and fall back too.
 */

export const SETTINGS_KEYS = [
  'default_blog_limit',
  'signups_mode',
  'maintenance_mode',
  'global_pause',
  'default_max_posts_per_day',
  'blocklist_keywords',
  'announcement',
  'custom_endpoints_allowed',
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];
export type SignupsMode = 'open' | 'invite_only' | 'closed';

export type Settings = {
  default_blog_limit: number;
  signups_mode: SignupsMode;
  maintenance_mode: boolean;
  global_pause: boolean;
  default_max_posts_per_day: number;
  blocklist_keywords: string[];
  announcement: { text: string; active: boolean };
  custom_endpoints_allowed: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  default_blog_limit: 2,
  signups_mode: 'open',
  maintenance_mode: false,
  global_pause: false,
  default_max_posts_per_day: 3,
  blocklist_keywords: [],
  announcement: { text: '', active: false },
  custom_endpoints_allowed: true,
};

export function coerce(key: SettingsKey, value: unknown): Settings[SettingsKey] | undefined {
  if (value === null || value === undefined) return undefined;
  switch (key) {
    case 'signups_mode':
      return (['open', 'invite_only', 'closed'] as const).includes(value as SignupsMode)
        ? (value as SignupsMode)
        : undefined;
    case 'default_blog_limit':
    case 'default_max_posts_per_day':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? (value as number)
        : undefined;
    case 'maintenance_mode':
    case 'global_pause':
    case 'custom_endpoints_allowed':
      return typeof value === 'boolean' ? (value as boolean) : undefined;
    case 'blocklist_keywords':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? (value as string[])
        : undefined;
    case 'announcement':
      return typeof value === 'object' &&
        value !== null &&
        typeof (value as { text?: unknown }).text === 'string' &&
        typeof (value as { active?: unknown }).active === 'boolean'
        ? (value as Settings['announcement'])
        : undefined;
  }
}

export type SettingsLoader = () => Promise<Record<string, unknown>>;

export type SettingsStore = {
  all(): Promise<Settings>;
  get<K extends SettingsKey>(key: K): Promise<Settings[K]>;
  /** Write a value to the DB (upsert) and invalidate the cache. */
  set(key: SettingsKey, value: Settings[SettingsKey], database?: DbLike): Promise<void>;
  invalidate(): void;
};

export function mergeSettings(raw: Record<string, unknown>): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const key of SETTINGS_KEYS) {
    const coerced = coerce(key, raw[key]);
    if (coerced !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[key] = coerced;
    }
  }
  return out;
}

export function createSettingsStore(
  load: SettingsLoader,
  opts: { ttlMs?: number; now?: () => number } = {},
): SettingsStore {
  const ttlMs = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  let cache: { value: Settings; expiresAt: number } | null = null;

  async function all(): Promise<Settings> {
    if (cache && now() < cache.expiresAt) return cache.value;
    let raw: Record<string, unknown> = {};
    try {
      raw = await load();
    } catch (error) {
      // Never let a settings read crash a request; fall back to defaults.
      logger.error({ err: error }, 'failed to load app_settings — falling back to defaults');
    }
    const value = mergeSettings(raw);
    cache = { value, expiresAt: now() + ttlMs };
    return value;
  }

  return {
    all,
    async get(key) {
      return (await all())[key];
    },
    async set(key, value, database) {
      const target = database ?? db;
      await target
        .insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
      cache = null;
    },
    invalidate() {
      cache = null;
    },
  };
}

async function loadFromDatabase(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(appSettings);
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export const settings = createSettingsStore(loadFromDatabase);

/** Helper for the dashboard "1 of 2 blogs used" display. */
export async function effectiveBlogLimit(userOverride: number | null): Promise<number> {
  if (userOverride !== null && userOverride >= 0) return userOverride;
  return settings.get('default_blog_limit');
}
