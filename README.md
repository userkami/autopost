# AutoBlog

Multi-user web app that researches topics, writes SEO articles, generates a featured image, and publishes to **Blogger** — automatically or after human review. Users bring their own AI and image-host keys.

> **Build source of truth: [`PLAN.md`](./PLAN.md).** Start with `CLAUDE.md` for agent working rules. Living docs: [`PROGRESS.md`](./PROGRESS.md), [`DECISIONS.md`](./DECISIONS.md), [`HUMAN_TASKS.md`](./HUMAN_TASKS.md).

## Stack

Next.js (App Router) · TypeScript strict · Tailwind CSS + shadcn/ui · Auth.js (Google) · PostgreSQL 16 · Drizzle ORM · pg-boss · Vitest + Playwright · Docker Compose (Caddy + app + worker + db)

## Local development

```bash
# 1. prerequisites: Node 24+, Docker (for Postgres), npm
cp .env.example .env
# generate secrets into .env:
#   AUTH_SECRET  = openssl rand -base64 32
#   MASTER_KEY   = openssl rand -base64 32
# then edit APP_URL, ADMIN_EMAILS, and set ENABLE_MOCK_PROVIDERS=true for dev

npm install
docker compose up -d db        # just Postgres for local dev

npm run check                  # typecheck + lint + test
npm run dev                    # http://localhost:3000
npm run worker                 # worker entry (separate terminal)
```

## Scripts

| Script                            | Purpose                                        |
| --------------------------------- | ---------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js                                        |
| `npm run worker`                  | background worker (pg-boss jobs)               |
| `npm run typecheck`               | `tsc --noEmit`                                 |
| `npm run lint`                    | ESLint                                         |
| `npm run format`                  | Prettier write                                 |
| `npm test`                        | Vitest (unit/integration)                      |
| `npm run check`                   | typecheck + lint + test — run after every task |

## Full stack (Docker Compose)

Requires a filled `.env` (see `.env.example`):

```bash
docker compose up -d --build
# app behind Caddy on ports 80/443 using APP_URL for auto-HTTPS
# health: curl http://localhost/api/health
```

Services: `db` (Postgres 16) · `app` (Next.js) · `worker` (same image, `npm run worker`) · `caddy` (auto-HTTPS reverse proxy).

## Secrets

- Never commit `.env`. API keys and OAuth tokens are stored AES-256-GCM-encrypted (`*_enc` columns) using `MASTER_KEY` from the environment.
- Losing `MASTER_KEY` makes stored keys unrecoverable — back it up securely (see `HUMAN_TASKS.md`).
