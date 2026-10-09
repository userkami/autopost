import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '@/lib/env';
import * as schema from './schema';

/** Shared Postgres pool. */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});

/** Drizzle instance (query builder for the whole app). */
export const db = drizzle({ client: pool, schema });

export type DatabaseStatus = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors
      .map((item) => (item instanceof Error ? item.message : String(item)))
      .join('; ');
  }
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

/** Cheap readiness probe used by /api/health. */
export async function checkDatabase(): Promise<DatabaseStatus> {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: describeError(error),
    };
  }
}
