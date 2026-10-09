# PROGRESS — AutoBlog

> Living checklist. Update after every task. Build source of truth: `PLAN.md`.

## Status

- **Current phase:** Phase 0 — Scaffold (code complete; `npm run check` ✅ green, `next build` ✅, server ✅ + worker ✅ smoke-tested)
- **Phase 0 remaining:** run `docker compose up -d --build` and verify `/api/health` returns 200 with DB status — **BLOCKED**: Docker not installed on this machine (run it on any Docker host; see `DECISIONS.md` #8).
- **Next after that:** Phase 1 — Database, crypto, auth, settings.

## Phase checklist (PLAN.md §17)

- [ ] **Phase 0 — Scaffold** — ✅ Next.js 16 + TS strict + Tailwind 4 + shadcn (`components.json`, `cn`, Button); ESLint 10/Prettier; Vitest (9 tests); Dockerfile, `docker-compose.yml` (db, app, worker, caddy), `Caddyfile`; `env.ts` (zod, crash-on-invalid); pino logger with redaction; `/api/health` (returns 200 + DB status / 503 + error when DB down); 4 living docs + `CLAUDE.md`; `npm run check` green. ⬜ `docker compose up` acceptance (no Docker on this machine).
- [ ] **Phase 1 — Database, crypto, auth, settings** — full Drizzle schema + migrations + seed; `crypto.ts`; Auth.js Google login; app shell/guards; `settings.ts`; `audit.ts`.
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

## Blocked / waiting on human

- Real Google login & Blogger connect → see `HUMAN_TASKS.md` items 2–4 (mock/dev credentials fallback per Phase 1 acceptance).
- Real secret storage in deployed env → `HUMAN_TASKS.md` item 5 (`MASTER_KEY`).
- Deploy/HTTPS verification → `HUMAN_TASKS.md` items 1, 6–8.
