import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { appSettings, providerCatalog } from './schema';
import { env } from '@/lib/env';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { logger } from '@/lib/logger';

/**
 * Seed script — PLAN.md §17 Phase 1: app_settings defaults + provider_catalog
 * suggestions. Idempotent and non-destructive (ON CONFLICT DO NOTHING), so it
 * never overwrites values an admin has customized.
 *
 * Run: npm run db:seed   (after npm run db:migrate)
 *
 * Model IDs are DATA (PLAN.md §0.4): they are seeded as *suggestions* verified
 * against provider docs on 2026-10-09 (OpenAI gpt-6 family + gpt-image-2 per
 * plan §8.2, Anthropic claude-*-5-5, Gemini 3.8 flash + nano-banana 2.1).
 * The admin can CRUD them (Phase 7) and users can always type a free-text model
 * id (PLAN.md §8.6).
 */

type CatalogSeed = typeof providerCatalog.$inferInsert;

const SETTINGS_SEED: { key: string; value: unknown }[] = Object.entries(DEFAULT_SETTINGS).map(
  ([key, value]) => ({ key, value }),
);

const SUGGESTION_NOTE =
  'Suggested — models change often; verify with your provider (seeded 2026-10-09).';

const CATALOG_SEED: CatalogSeed[] = [
  // OpenAI
  {
    provider: 'openai',
    role: 'text',
    modelId: 'gpt-6-luna',
    label: 'GPT-6 Luna (fast, cost-effective)',
    isDefault: true,
    notes: SUGGESTION_NOTE,
  },
  {
    provider: 'openai',
    role: 'text',
    modelId: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol (balanced)',
    isDefault: false,
    notes: SUGGESTION_NOTE,
  },
  {
    provider: 'openai',
    role: 'text',
    modelId: 'gpt-6-astra',
    label: 'GPT-6 Astra (highest intelligence)',
    isDefault: false,
    notes: SUGGESTION_NOTE,
  },
  {
    provider: 'openai',
    role: 'image',
    modelId: 'gpt-image-2',
    label: 'GPT Image 2',
    isDefault: true,
    notes: `${SUGGESTION_NOTE} Default image model per build plan §8.2.`,
  },
  // Google Gemini
  {
    provider: 'gemini',
    role: 'text',
    modelId: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash (stable)',
    isDefault: true,
    notes: SUGGESTION_NOTE,
  },
  {
    provider: 'gemini',
    role: 'text',
    modelId: 'gemini-flash-latest',
    label: 'Gemini Flash (latest alias, hot-swaps)',
    isDefault: false,
    notes: SUGGESTION_NOTE,
  },
  {
    provider: 'gemini',
    role: 'image',
    modelId: 'gemini-nano-banana-2.1',
    label: 'Nano Banana 2.1 (Gemini image)',
    isDefault: true,
    notes: SUGGESTION_NOTE,
  },
  // Anthropic
  {
    provider: 'anthropic',
    role: 'text',
    modelId: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5 (speed/intelligence balance)',
    isDefault: true,
    notes: SUGGESTION_NOTE,
  },
  {
    provider: 'anthropic',
    role: 'text',
    modelId: 'claude-opus-5-5',
    label: 'Claude Opus 5.5 (long-running work)',
    isDefault: false,
    notes: SUGGESTION_NOTE,
  },
  {
    provider: 'anthropic',
    role: 'text',
    modelId: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5 (fast, high-volume)',
    isDefault: false,
    notes: SUGGESTION_NOTE,
  },
  // openrouter / pollinations / fal / leonardo / custom_openai are intentionally
  // not seeded: their model ids are user- or marketplace-specific — use the
  // "Fetch models" button or a free-text model id (PLAN.md §8.6).
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle({ client: pool, schema: { appSettings, providerCatalog } });

  let settingsInserted = 0;
  for (const row of SETTINGS_SEED) {
    const inserted = await db
      .insert(appSettings)
      .values(row)
      .onConflictDoNothing()
      .returning({ key: appSettings.key });
    settingsInserted += inserted.length;
  }

  let catalogInserted = 0;
  for (const row of CATALOG_SEED) {
    const inserted = await db
      .insert(providerCatalog)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: providerCatalog.id });
    catalogInserted += inserted.length;
  }

  logger.info(
    {
      settingsInserted,
      settingsSkipped: SETTINGS_SEED.length - settingsInserted,
      catalogInserted,
      catalogSkipped: CATALOG_SEED.length - catalogInserted,
    },
    'seed complete',
  );
  await pool.end();
}

main().catch((error) => {
  logger.error({ err: error }, 'seed failed');
  process.exitCode = 1;
});
