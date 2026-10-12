# AutoBlog

AI-powered blog automation for Blogger. Research, write, generate images, and publish — automatically or with human review.

## Features

- **AI Research & Writing**: Grounded research, SEO-optimized articles with quality gates
- **Image Generation**: Featured images via your AI provider, uploaded to imgbb/Cloudinary
- **Blogger Publishing**: Draft, review queue, or auto-publish with scheduling
- **Multi-user**: Google OAuth sign-in, per-user blog limits (default 2, admin override)
- **Bring Your Own Keys**: OpenAI, Anthropic, Google, OpenRouter, custom OpenAI endpoints
- **Secure**: AES-256-GCM encryption at rest, SSRF protection, CSP, rate limiting
- **Scheduler**: DST-safe cron, missed-slot policy, per-user concurrency, failure auto-pause
- **Admin Panel**: User management, global settings, jobs monitor, health, audit log

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- PostgreSQL 16 (or Docker)
- pnpm/npm

### 1. Clone and Install
```bash
git clone https://github.com/your-org/autoblog.git
cd autoblog
npm install
```

### 2. Environment Setup
```bash
cp .env.example .env
# Edit .env with your values
```

Required variables:
```env
APP_NAME=AutoBlog
APP_URL=http://localhost:3000
DATABASE_URL=postgres://autoblog:password@localhost:5432/autoblog
AUTH_SECRET=<openssl rand -base64 32>
MASTER_KEY=<base64 32 bytes>
ADMIN_EMAILS=you@gmail.com
ENABLE_MOCK_PROVIDERS=true
```

### 3. Database
```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

### 4. Run
```bash
# Terminal 1: Next.js app
npm run dev

# Terminal 2: Worker (pg-boss jobs)
npm run worker
```

Visit `http://localhost:3000`

### 5. Sign In
- Use dev login form (enabled via `ENABLE_MOCK_PROVIDERS=true`)
- Or configure Google OAuth (see Production below)

## Production Deployment (Docker)

### 1. Server Setup
- VPS with Docker + Docker Compose
- Domain pointed to VPS (ports 80/443)
- PostgreSQL 16 (can use Docker)

### 2. Environment
```bash
# On server, create .env with production values
APP_URL=https://your-domain.com
DATABASE_URL=postgres://autoblog:password@db:5432/autoblog
AUTH_SECRET=<secure random>
AUTH_GOOGLE_ID=<from Google Cloud>
AUTH_GOOGLE_SECRET=<from Google Cloud>
MASTER_KEY=<base64 32 bytes, BACK THIS UP>
ADMIN_EMAILS=you@gmail.com
SMTP_URL=smtp://user:pass@host:587  # optional
MAIL_FROM=AutoBlog <no-reply@your-domain.com>
ENABLE_MOCK_PROVIDERS=false
```

### 3. Google Cloud Setup
1. Enable **Blogger API v3**
2. OAuth consent screen: add scopes `openid`, `email`, `profile`, `https://www.googleapis.com/auth/blogger`
3. Create Web OAuth client with redirect URIs:
   - `https://your-domain.com/api/auth/callback/google`
   - `https://your-domain.com/api/blogger/callback`
4. Publish consent screen to "In production" (not Testing)
5. Submit for OAuth verification (see `docs/VERIFICATION_CHECKLIST.md`)

### 4. Deploy
```bash
docker compose up -d --build
```

Services: `caddy` (HTTPS), `app` (Next.js), `worker` (pg-boss), `db` (PostgreSQL)

### 5. Verify
- Visit `https://your-domain.com`
- Sign in with Google (admin email → auto admin)
- Connect a Blogger blog
- Configure AI roles, image host, schedule
- Run now → review → approve → live on Blogger

## Project Structure

```
/
├── docker-compose.yml     # caddy, app, worker, db
├── Dockerfile             # Multi-stage build
├── Caddyfile              # HTTPS reverse proxy
├── drizzle/               # SQL migrations
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── (public)/      # landing, login, privacy, terms
│   │   ├── (app)/         # authenticated area
│   │   │   ├── admin/     # admin panel
│   │   │   ├── blogs/[id]/ # blog management
│   │   │   └── ...
│   │   └── api/           # API routes
│   ├── db/                # Drizzle schema, migrations, seed
│   ├── lib/               # Core libraries
│   │   ├── providers/     # AI provider adapters
│   │   ├── imagehosts/    # Image host adapters
│   │   ├── blogger/       # Blogger OAuth + client
│   │   ├── pipeline/      # 6-step generation pipeline
│   │   └── ...
│   └── worker/            # pg-boss worker entrypoint
├── tests/
│   ├── unit/              # Vitest unit tests
│   └── e2e/               # Playwright smoke tests
└── scripts/               # backup.sh, etc.
```

## Key Commands

```bash
npm run dev          # Next.js dev server
npm run worker       # Start pg-boss worker
npm run build        # Production build
npm run start        # Production server
npm run check        # typecheck + lint + test
npm run test         # Vitest unit tests
npm run test:watch   # Vitest watch mode
npx playwright test  # Playwright e2e tests
npm run db:generate  # Generate migration
npm run db:migrate   # Run migrations
npm run db:seed      # Seed database
npm run format       # Prettier format
```

## Admin Panel

Access `/admin` (admin users only):
- **Users**: Manage users, blog limits, suspensions, deletions
- **Settings**: Signups mode, maintenance, defaults, blocklist, announcements
- **Jobs**: Monitor runs, retry failed, cancel queued
- **Health**: Worker heartbeat, reconnect alerts, failure rates
- **Catalog**: CRUD for suggested AI models
- **Audit**: Searchable action log

## Security

- **Encryption**: AES-256-GCM for all secrets (`MASTER_KEY` in env only)
- **SSRF Protection**: DNS resolution + IP validation for all outbound requests
- **CSP**: Strict Content Security Policy headers
- **Rate Limiting**: Login, connection tests, manual runs
- **No Secrets in Logs**: Pino redaction for all sensitive fields
- **IDOR Protection**: All queries scoped by `user_id`

## Backup

```bash
# Automated via cron in worker container (daily 3 AM UTC)
# Manual:
docker compose exec app /app/scripts/backup.sh

# Restore:
gunzip -c backup.sql.gz | docker compose exec -T db psql -U autoblog -d autoblog
```

## Adding a Provider

See `docs/ADDING_A_PROVIDER.md` for step-by-step guide.

## Google OAuth Verification

See `docs/VERIFICATION_CHECKLIST.md` for production verification steps.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Worker DOWN" | Check `docker compose logs worker`; verify DB connectivity |
| "Needs reconnect" | Go to `/connect`, re-authorize Blogger |
| Schedule not firing | Check `global_pause` setting, worker logs, `next_run_at` |
| Images not uploading | Verify image host credentials, test in `/connections` |
| Google OAuth fails | Check redirect URIs, consent screen status, scopes |

## License

MIT — see LICENSE file.