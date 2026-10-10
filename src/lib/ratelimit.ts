/**
 * Rate limiting (PLAN.md §14.7). In-memory is sufficient for a single VPS;
 * abstracted behind an interface so a shared store can replace it later.
 */

export type RateLimiter = {
  /** Returns true if the action is allowed; false if the limit is exceeded. */
  check(key: string): boolean;
  reset(key?: string): void;
};

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();

  return {
    check(key) {
      const current = now();
      const windowStart = current - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > windowStart);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(current);
      hits.set(key, recent);
      return true;
    },
    reset(key) {
      if (key) hits.delete(key);
      else hits.clear();
    },
  };
}

/** One limiter per concern; distinct keys (usually `user:<id>`) are independent. */
export const testConnectionLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
export const loginLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
export const manualRunLimiter = createRateLimiter({ limit: 1, windowMs: 5 * 60_000 });