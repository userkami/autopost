# DECISIONS — AutoBlog

Every deviation from `PLAN.md` with a reason. Where `PLAN.md` is ambiguous: choose the stated default, then log it here.

| #   | Date       | Decision                                                                                                          | Reason                                                                                                                |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-10-09 | Kept the provided source document at `AUTOBLOG_BUILD_PLAN.md` and created the required working copy at `PLAN.md`. | PLAN.md §0 requires a copy at the repo root named `PLAN.md`.                                                          |
| 2   | 2026-10-09 | Created `CLAUDE.md` as a short pointer to `PLAN.md` instead of duplicating plan content.                          | PLAN.md §0: reference the plan from `CLAUDE.md` / `AGENTS.md`. Duplicated content would drift; docs beat duplication. |
| 3   | 2026-10-09 | Task-log dates use ISO `YYYY-MM-DD`.                                                                              | PLAN.md gives no date format; ISO is unambiguous.                                                                     |

## Decisions

### Phase 0 (2026-10-09)

| #   | Date       | Decision                                                                                                         | Reason                                                                                                                                                                                |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | 2026-10-09 | Pinned `typescript` to **6.x** (6.0.3) instead of latest (7.0.x).                                                | `typescript@latest` resolved to TS 7.0; typescript-eslint (via `eslint-config-next`) rejects TS 7.0 (support tracked for ≥7.1). Lint must run per §0.5. Revisit later.                |
| 5   | 2026-10-09 | `eslint.config.mjs` imports `eslint-config-next/core-web-vitals` and `/typescript` as native flat-config arrays. | `eslint-config-next@16` ships ESLint 9 flat configs; the `FlatCompat`/`@eslint/eslintrc` bridge crashed on them.                                                                      |
| 6   | 2026-10-09 | Worker runs as `node --env-file-if-exists=.env --import tsx src/worker/index.ts`; `tsx` is a regular dependency. | Next loads `.env` itself but plain `tsx` does not — the worker crashed at startup until fixed. Compose supplies env at runtime, so `--if-exists` works without a `.env` in the image. |
| 7   | 2026-10-09 | `env.ts` takes a structural input type (`Record<string, string \| undefined>`), not `NodeJS.ProcessEnv`.         | Next.js augments `ProcessEnv` with a required `NODE_ENV`, which broke test call sites.                                                                                                |
| 8   | 2026-10-09 | Phase 0 `docker compose up` acceptance is **not yet verified** — Docker is not installed on this dev machine.    | Never pretend an environmental check passed (§0.6). Tracked in `PROGRESS.md`.                                                                                                         |
| 9   | 2026-10-09 | Added `.dockerignore` excluding `.env` (and `.env.*`).                                                           | §0.6: never bake secrets into images — `Dockerfile` does `COPY . .` in the build stage.                                                                                               |

## Installed versions (2026-10-09, latest stable per §0.3)

| Package                                          | Version                 |
| ------------------------------------------------ | ----------------------- |
| next                                             | 16.4.0                  |
| react / react-dom                                | 19.3.0                  |
| typescript                                       | 6.0.3 (pinned — see #4) |
| eslint                                           | 10.12.0                 |
| eslint-config-next                               | 16.4.0                  |
| vitest                                           | 5.0.3                   |
| zod                                              | 4.6.5                   |
| pino                                             | 10.4.0                  |
| pg                                               | 8.23.1                  |
| tailwindcss / @tailwindcss/postcss               | 4.3.3                   |
| prettier                                         | 3.9.9                   |
| tsx                                              | 4.23.15                 |
| clsx / tailwind-merge / class-variance-authority | 2.1.1 / 3.7.0 / 0.7.1   |
| lucide-react                                     | 1.54.0                  |
| @radix-ui/react-slot                             | 1.4.0                   |
