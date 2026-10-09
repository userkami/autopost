import { describe, expect, it } from 'vitest';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  mergeSettings,
  type SettingsLoader,
} from '@/lib/settings';

describe('settings store (PLAN.md §3)', () => {
  it('returns typed defaults for an empty database', async () => {
    const store = createSettingsStore(async () => ({}));
    expect(await store.all()).toEqual(DEFAULT_SETTINGS);
  });

  it('applies valid overrides and ignores invalid values', async () => {
    const store = createSettingsStore(async () => ({
      default_blog_limit: 5,
      signups_mode: 'invite_only',
      maintenance_mode: true,
      blocklist_keywords: ['gambling'],
      announcement: { text: 'hi', active: true },
      // invalid values must fall back to defaults:
      custom_endpoints_allowed: 'yes',
      default_max_posts_per_day: -3,
    }));
    const s = await store.all();
    expect(s.default_blog_limit).toBe(5);
    expect(s.signups_mode).toBe('invite_only');
    expect(s.maintenance_mode).toBe(true);
    expect(s.blocklist_keywords).toEqual(['gambling']);
    expect(s.announcement).toEqual({ text: 'hi', active: true });
    expect(s.custom_endpoints_allowed).toBe(DEFAULT_SETTINGS.custom_endpoints_allowed);
    expect(s.default_max_posts_per_day).toBe(DEFAULT_SETTINGS.default_max_posts_per_day);
  });

  it('caches until TTL expires', async () => {
    let t = 0;
    let calls = 0;
    const load: SettingsLoader = async () => {
      calls += 1;
      return { default_blog_limit: calls };
    };
    const store = createSettingsStore(load, { ttlMs: 1000, now: () => t });

    expect((await store.all()).default_blog_limit).toBe(1);
    t = 999;
    expect((await store.all()).default_blog_limit).toBe(1);
    expect(calls).toBe(1);

    t = 1000;
    expect((await store.all()).default_blog_limit).toBe(2);
    expect(calls).toBe(2);
  });

  it('invalidate() forces a reload', async () => {
    let calls = 0;
    const store = createSettingsStore(
      async () => {
        calls += 1;
        return {};
      },
      { ttlMs: 60_000 },
    );
    await store.all();
    store.invalidate();
    await store.all();
    expect(calls).toBe(2);
  });

  it('falls back to defaults when the loader throws (DB down)', async () => {
    const store = createSettingsStore(async () => {
      throw new Error('connection refused');
    });
    await expect(store.all()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('mergeSettings coerces unknown keys away', () => {
    const s = mergeSettings({ signups_mode: 'bogus', evil_key: 123 });
    expect(s.signups_mode).toBe(DEFAULT_SETTINGS.signups_mode);
    expect('evil_key' in s).toBe(false);
  });
});
