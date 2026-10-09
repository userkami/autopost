# PROGRESS — AutoBlog

> Living checklist. Update after every task. Build source of truth: `PLAN.md`.

## Status

- **Current phase:** Phase 1 — Database, crypto, auth, settings (**code complete**; `npm run check` ✅ 34 tests, `next build` ✅, dev-server smoke ✅)
- **Phase 0 remaining:** `docker compose up` acceptance on any Docker host (DECISIONS #8).
- **Phase 1 remaining:** DB-dependent acceptance where Postgres exists — `npm run db:migrate` + `npm run db:seed`, dev-login round trip, IDOR harness (`TEST_DATABASE_URL`), then real Google login once `HUMAN_TASKS.md` #2 credentials exist — **BLOCKED** locally: no Docker/Postgres on this machine.
- **Next:** Phase 2 — Connections and providers (`ssrf.ts` first).

## Phase checklist (PLAN.md §17)

- [ ] **Phase 0 — Scaffold** — ✅ Next.js 16 + TS strict + Tailwind 4 + shadcn (`components.json`, `cn`, Button); ESLint 10/Prettier; Vitest (9 tests); Dockerfile, `docker-compose.yml` (db, app, worker, caddy), `Caddyfile`; `env.ts` (zod, crash-on-invalid); pino logger with redaction; `/api/health` (returns 200 + DB status / 503 + error when DB down); 4 living docs + `CLAUDE.md`; `npm run check` green. ⬜ `docker compose up` acceptance (no Docker on this machine).
- [ ] **Phase 1 — Database, crypto, auth, settings** — ✅ full Drizzle schema (19 tables / 14 enums, PLAN §5) + generated migration + idempotent `seed.ts` (settings defaults + `provider_catalog` suggestions with docs-verified model IDs); `crypto.ts` (AES-256-GCM `v1:<keyId>:<iv>:<tag>:<ct>`, 9 tests); Auth.js v5 database sessions + Google (identity scopes only) + sign-in policy (signups/invites/suspension/ADMIN_EMAILS, 10 tests); dev login behind `ENABLE_MOCK_PROVIDERS` (direct DB session — DECISIONS #11); app shell/layout guards + maintenance redirect; login/dashboard/account/maintenance pages; `settings.ts` TTL cache (6 tests); `audit.ts`; IDOR harness (5 tests, need `TEST_DATABASE_URL`). ⬜ migrate/seed + live login rounds (no local Postgres).
- [ ] **Phase 2 — Connections and providers** — `ssrf.ts`; provider types/registry; all text + image adapters; mocks; image hosts; Connections UI + Test buttons.
- [ ] **Phase 3 — Blogger connect** — OAuth connect/callback, token store/refresh, blog picker, transactional limit, Blogger client, reconnect handling.
- [ ] **Phase 4 — Blog settings** — blog profile, AI roles UI + "Use same for all", publish mode, image host selection, topics UI, readiness checklist.
- [ ] **Phase 5 — Pipeline, Run now, review queue** — prompts, 6 steps with resume, quality gates, dedupe, worker job, review UI, `review.expire`.
- [ ] **Phase 6 — Scheduler, notifications, email** — `computeNext` tests, tick with SKIP LOCKED, missed-slot policy, concurrency, schedule UI, notifications/email.
- [ ] **Phase 7 — Admin panel** — users/settings/jobs/health/catalog/audit views, blog-limit override.
- [ ] **Phase 8 — Hardening, legal, docs, release** — CSP, rate limits, deletion, legal pages, Playwright smoke, backups, README, checklists.

## Task log

| Date       | Task                                                                                                                                                                                                                                                               | Result                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 2026-10-09 | Seeded living docs: `PLAN.md` (copy of `AUTOBLOG_BUILD_PLAN.md`), `PROGRESS.md`, `DECISIONS.md`, `HUMAN_TASKS.md`, `CLAUDE.md`                                                                                                                                     | done                                                          |
| 2026-10-09 | Phase 0 scaffold: Next 16 + TS 6 strict + Tailwind 4 + shadcn; ESLint 10 flat config + Prettier; Vitest; `env.ts`; pino redaction; `/api/health`; Docker/Caddy files; README                                                                                       | done                                                          |
| 2026-10-09 | Validated: `npm run check` green (typecheck + lint + 9/9 tests); `next build` OK (`/` static, `/api/health` dynamic); `next start` serves `/` 200 and health responds with DB status (503 degraded locally — no Postgres); worker starts and logs `worker started` | done                                                          |
| 2026-10-09 | `docker compose up` acceptance test                                                                                                                                                                                                                                | BLOCKED — Docker not installed on this machine (DECISIONS #8) |
| 2026-10-09 | Phase 1 data layer: schema (19 tables, 14 enums), migration generated, `seed.ts`, `crypto.ts`, `settings.ts`, `audit.ts`, blog profile zod type; unit tests for crypto/settings (15 tests)                                                                         | done                                                          |
| 2026-10-09 | Phase 1 auth: Auth.js 5.0.0-beta.32 + drizzle adapter, database sessions, sign-in policy + tests, dev login, guards, app shell, login/dashboard/account/maintenance/privacy/terms pages, IDOR harness                                                              | done                                                          |
| 2026-10-09 | Validated: `npm run check` green (34 passed, 5 skipped — integration needs `TEST_DATABASE_URL`); `next build` all 11 routes; dev-server smoke: `/` 200, `/login` 200 (dev form + Google hint), `/dashboard` 307→login, `/maintenance` 200                          | done                                                          |
| 2026-10-09 | DB-dependent Phase 1 acceptance (migrate/seed, login round trips, IDOR run)                                                                                                                                                                                        | BLOCKED — no local Postgres/Docker (see Status)               |

## Blocked / waiting on human

- Real Google login & Blogger connect → see `HUMAN_TASKS.md` items 2–4 (mock/dev credentials fallback per Phase 1 acceptance).
- Real secret storage in deployed env → `HUMAN_TASKS.md` item 5 (`MASTER_KEY`).
- Deploy/HTTPS verification → `HUMAN_TASKS.md` items 1, 6–8.
