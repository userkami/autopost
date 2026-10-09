import { z } from 'zod';

/**
 * Env parsing (PLAN.md §4): every env var is validated with zod and the
 * process crashes on startup if invalid. Never echo values in errors.
 */

const boolFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const base64Key32 = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, 'base64').length === 32;
    } catch {
      return false;
    }
  },
  { message: 'must be base64 that decodes to exactly 32 bytes' },
);

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('AutoBlog'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_GOOGLE_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GOOGLE_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),

  MASTER_KEY: base64Key32,
  MASTER_KEY_ID: z.string().min(1).default('v1'),

  ADMIN_EMAILS: z.string().default(''),
  SMTP_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  MAIL_FROM: z.string().default('AutoBlog <no-reply@localhost>'),

  ENABLE_MOCK_PROVIDERS: boolFromString.default(false),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(3),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

// Structural input type (not NodeJS.ProcessEnv): Next.js augments ProcessEnv
// with a required NODE_ENV, and callers legitimately omit optional keys.
export function parseEnv(input: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
