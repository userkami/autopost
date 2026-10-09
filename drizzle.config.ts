import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config.
 * - `npm run db:generate` writes SQL migrations to ./drizzle (offline, no DB needed).
 * - `npm run db:migrate` applies them to DATABASE_URL (loaded via --env-file-if-exists).
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/autoblog-placeholder',
  },
  strict: true,
  verbose: true,
});
