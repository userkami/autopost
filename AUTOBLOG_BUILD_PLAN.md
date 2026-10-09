# AutoBlog — Build Plan for an AI Coding Agent

> Hand this file to the coding agent as the single source of truth. Put a copy at the repo root as `PLAN.md` (and reference it from `CLAUDE.md` / `AGENTS.md`).
> Working name: **AutoBlog** (configurable via `APP_NAME`).

---

## 0. How the agent must work

1. **Work phase by phase** (Section 17). Do not start a phase until the previous phase's acceptance criteria pass.
2. **Keep three living files** in the repo root:
   - `PROGRESS.md` — checklist of tasks, status, what's next.
   - `DECISIONS.md` — every deviation from this plan, with reason. If this plan is ambiguous, choose the stated default, then log it here.
   - `HUMAN_TASKS.md` — things only the owner can do (Google Cloud setup, DNS, SMTP, verification). Mark dependent work `BLOCKED`; never fake credentials or pretend an external call works.
3. **Verify external facts.** This plan names external API endpoints and model names from memory of the docs as of Oct 2026. **Before writing each provider adapter, read the provider's current official documentation.** If the docs differ from this plan, the docs win; log it in `DECISIONS.md`. Do not pin library versions from memory — install latest stable and record versions.
4. **Model names are data, never code.** Provider models change often (e.g. OpenAI removed `dall-e-2/3` on 2026-05-12 and is retiring `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5` in favor of `gpt-image-2`). Model IDs live only in the seeded `provider_catalog` table and in user config. Never hardcode a model ID in adapter logic.
5. **After every task:** run `typecheck`, `lint`, `test`; fix failures; commit with a conventional message (`feat:`, `fix:`, `chore:`). Small commits.
6. **Security rules are non-negotiable** (Section 14). Never log secrets, never return secrets to the browser, never commit `.env`.
7. **Use mock providers** (Section 8.5) so the whole system is testable without any real API keys.
8. If blocked on a human task, build everything that does not depend on it, then move on.

---

## 1. Product summary

A multi-user web app. A user signs in with Google, connects up to **2 Blogger blogs** (admin can raise the limit per user), configures three AI roles per blog (**research**, **writing**, **image**), picks an image host, sets a schedule, and the app researches topics, writes SEO articles, generates a featured image, uploads it to the image host, and publishes to Blogger — either automatically or after human review.

Replaces an existing n8n workflow (Webhook → LLM writer → image → imgbb → Blogger publish). Blogger has **no image-upload API**, hence the external image host.

### Business model

- Free: 2 blogs per user. Paid plans are a **future** feature — build only the hook: `users.blog_limit` override + `app_settings.default_blog_limit`. No billing code now.
- Users **bring their own** AI keys and image-host keys. The platform bears no AI cost.

### Non-goals (v1)

Billing/Stripe, teams/workspaces, non-Blogger platforms (WordPress etc.), in-app AI image editing, analytics/SEO rank tracking, mobile app.

---

## 2. Tech stack (defaults)

| Concern          | Choice                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Language         | TypeScript (strict) everywhere                                                                                       |
| Web framework    | Next.js (App Router)                                                                                                 |
| UI               | Tailwind CSS + shadcn/ui, lucide-react icons                                                                         |
| Auth (login)     | Auth.js (NextAuth v5) with Google provider, **database sessions**. If v5 blocks you, swap to Better Auth and log it. |
| DB               | PostgreSQL 16                                                                                                        |
| ORM / migrations | Drizzle ORM + drizzle-kit                                                                                            |
| Jobs / scheduler | **pg-boss** (Postgres-backed; no Redis). Check the installed major version's API before coding.                      |
| Time zones       | luxon                                                                                                                |
| Validation       | zod (all inputs, all provider responses, all env vars)                                                               |
| HTTP client      | undici (needed for SSRF-safe custom DNS lookup)                                                                      |
| HTML sanitizing  | sanitize-html                                                                                                        |
| Email            | nodemailer via `SMTP_URL` (optional)                                                                                 |
| Logging          | pino with secret redaction                                                                                           |
| Tests            | Vitest (unit/integration), Playwright (smoke e2e), undici MockAgent or msw for HTTP mocks                            |
| Deploy           | Docker Compose on owner's VPS: `caddy` (auto-HTTPS) + `app` + `worker` + `db`                                        |

One repo, one `package.json`. `app` and `worker` are the **same image** with different commands.

---

## 3. Repository layout

```
/
├─ PLAN.md  PROGRESS.md  DECISIONS.md  HUMAN_TASKS.md  README.md
├─ docker-compose.yml  Dockerfile  Caddyfile  .env.example
├─ drizzle/                      # generated migrations
├─ src/
│  ├─ app/                       # Next.js routes
│  │  ├─ (public)/               # landing, /privacy, /terms, /login
│  │  ├─ (app)/                  # authenticated user area
│  │  │  ├─ dashboard/  blogs/[id]/{overview,settings,topics,schedule,posts,runs}/
│  │  │  ├─ connections/  notifications/  account/
│  │  ├─ admin/                  # admin panel
│  │  └─ api/{auth,blogger,health,...}/
│  ├─ db/{schema.ts,index.ts,seed.ts}
│  ├─ lib/
│  │  ├─ crypto.ts               # AES-256-GCM
│  │  ├─ env.ts                  # zod-validated env
│  │  ├─ ssrf.ts                 # safe fetch
│  │  ├─ settings.ts             # app_settings access + cache
│  │  ├─ limits.ts               # blog limit / quota checks
│  │  ├─ audit.ts  notify.ts  mail.ts  logger.ts
│  │  ├─ providers/
│  │  │  ├─ types.ts  registry.ts  http.ts
│  │  │  ├─ text/{gemini,openai,openrouter,anthropic,custom,mock}.ts
│  │  │  └─ image/{gemini,openai,pollinations,fal,leonardo,custom,mock}.ts
│  │  ├─ imagehosts/{imgbb,cloudinary,mock}.ts
│  │  ├─ blogger/{oauth.ts,client.ts}
│  │  ├─ pipeline/{run.ts,research.ts,write.ts,image.ts,assemble.ts,deliver.ts,prompts/}
│  │  └─ schedule/{next.ts,tick.ts}
│  ├─ worker/index.ts            # pg-boss worker entrypoint
│  └─ components/
└─ tests/{unit,integration,e2e}/
```

---

## 4. Environment variables (`.env.example`)

Validate all in `src/lib/env.ts` with zod; crash on startup if invalid.

```
APP_NAME=AutoBlog
APP_URL=https://your-domain.com
DATABASE_URL=postgres://autoblog:password@db:5432/autoblog

AUTH_SECRET=                      # openssl rand -base64 32
AUTH_GOOGLE_ID=                   # same Google OAuth client for login + Blogger connect
AUTH_GOOGLE_SECRET=

MASTER_KEY=                       # base64, 32 bytes. Encrypts all stored secrets.
MASTER_KEY_ID=v1                  # for future rotation

ADMIN_EMAILS=owner@gmail.com      # comma-separated; these users get is_admin=true on login
SMTP_URL=                         # optional: smtp://user:pass@host:587
MAIL_FROM=AutoBlog <no-reply@your-domain.com>

ENABLE_MOCK_PROVIDERS=false       # true in dev/test only
WORKER_CONCURRENCY=3
LOG_LEVEL=info
```

---

## 5. Data model (Drizzle schema)

All IDs: UUID v7 or `uuid` default. All tables: `created_at`, `updated_at` where relevant. Index all foreign keys. Secrets columns end in `_enc` (encrypted with `crypto.ts`).

**Auth (from Auth.js adapter):** `accounts`, `sessions`, `verification_tokens`.

**users**: `id, email (unique), name, image, is_admin bool, status ('active'|'suspended'), blog_limit int NULL (override), max_posts_per_day int NULL (override), last_login_at, deleted_at NULL`

**blog_connections** — one Google authorization for Blogger (may be a different Google account than the login account): `id, user_id, google_sub, google_email, refresh_token_enc, scopes text, status ('active'|'needs_reconnect'|'revoked'), last_error, created_at`

**blogs**: `id, user_id, connection_id, blogger_blog_id, name, url, status ('active'|'paused'|'needs_reconnect'), publish_mode ('auto'|'review'|'draft') default 'review', review_expiry_hours int default 72, auto_publish_on_expiry bool default false, image_host_id NULL, profile jsonb` — unique `(user_id, blogger_blog_id)`.

`profile` jsonb (zod-typed): `{ niche, audience, tone, language, min_words, max_words, keywords: string[], default_labels: string[], ai_disclosure: bool, research_mode: 'manual'|'brainstorm'|'grounded', prompt_overrides: { research?, writer?, image? } }`

**ai_connections**: `id, user_id, provider ('gemini'|'openai'|'openrouter'|'anthropic'|'pollinations'|'fal'|'leonardo'|'custom_openai'|'mock'), label, base_url NULL (custom only), api_key_enc, extra_enc NULL, last_test_at, last_test_status, last_test_error`

**image_hosts**: `id, user_id, provider ('imgbb'|'cloudinary'|'mock'), label, config_enc, last_test_at, last_test_status`

**blog_roles**: PK `(blog_id, role)`, `role ('research'|'writing'|'image'), ai_connection_id, model text, params jsonb`

**schedules**: PK `blog_id`, `enabled, frequency_type ('interval_hours'|'daily'|'weekdays'), interval_hours int NULL, times text[] ('HH:MM'), weekdays int[] (1-7 ISO), timezone (IANA), posts_per_run int default 1 (max 3), next_run_at timestamptz, last_run_at`

**topics**: `id, blog_id, title, notes, source ('manual'|'brainstorm'|'grounded'), status ('queued'|'used'|'skipped'), used_at`

**runs**: `id, blog_id, trigger ('scheduled'|'manual'), scheduled_for NULL, status ('queued'|'running'|'succeeded'|'partial'|'failed'|'canceled'), started_at, finished_at, error` — unique `(blog_id, scheduled_for)` (idempotent scheduling).

**posts**: `id, blog_id, run_id, topic, title, meta_description, html, labels text[], image_prompt, image_alt, image_url, status, blogger_post_id NULL, blogger_url NULL, review_expires_at, rejected_reason, usage jsonb, published_at`
Post statuses: `generating | pending_review | approved | publishing | published | draft_on_blogger | rejected | expired | failed`

**run_steps**: `id, run_id, post_id NULL, step ('research'|'write'|'image'|'upload'|'assemble'|'deliver'), status ('pending'|'running'|'succeeded'|'failed'|'skipped'), attempt int, output jsonb, error, started_at, finished_at` — enables resuming from the failed step without redoing earlier steps.

**provider_catalog**: `id, provider, role ('text'|'image'), model_id, label, is_default bool, deprecated_at NULL, notes` — admin-editable; seeds suggestions only.

**app_settings**: `key (PK), value jsonb`. Keys: `default_blog_limit` (2), `signups_mode` ('open'|'invite_only'|'closed'), `maintenance_mode`, `global_pause`, `default_max_posts_per_day` (3), `blocklist_keywords` (string[]), `announcement` ({text, active}), `custom_endpoints_allowed` (true).

**invites**: `email (PK), created_by, used_at`
**notifications**: `id, user_id, type, title, body, link, read_at`
**audit_log**: `id, actor_id, action, target_type, target_id, meta jsonb, ip`

---

## 6. Authentication & Google OAuth (critical design)

Google's Blogger scope is **sensitive**. Testing-mode apps expire tokens after 7 days; unverified production apps are capped at 100 users until verified. Therefore:

### 6.1 Login (Auth.js)

- Scopes: **`openid email profile` only**. No Blogger scope here.
- On sign-in: apply `signups_mode` (reject if `closed`, or `invite_only` without an invite), reject `suspended` users, set `is_admin` if email ∈ `ADMIN_EMAILS`, update `last_login_at`.
- Maintenance mode: block non-admins with a friendly page.

### 6.2 Connect Blogger (custom flow, separate from login)

Routes: `GET /api/blogger/connect` and `GET /api/blogger/callback`.

1. `/connect` (authenticated): enforce blog limit **before** redirecting (Section 10). Generate `state` (random, bound to session user id, stored server-side with 10-min TTL) and PKCE verifier. Redirect to Google's authorization endpoint with:
   `scope=https://www.googleapis.com/auth/blogger`, `access_type=offline`, `prompt=consent select_account`, `response_type=code`, `redirect_uri=${APP_URL}/api/blogger/callback`.
2. `/callback`: validate `state` and user match; exchange the code; **require a refresh token** (else show error "please retry and approve all permissions"); encrypt and store in `blog_connections` (dedupe by `google_sub` per user — update instead of insert).
3. Call Blogger `GET https://www.googleapis.com/blogger/v3/users/self/blogs`. Show the user a picker of blogs not yet connected; on selection create a `blogs` row (re-check the limit inside a DB transaction).
4. Same redirect-URI base as login is fine, but the two callback paths differ; both must be listed in the Google Cloud client (see `HUMAN_TASKS.md`).

### 6.3 Token handling (`lib/blogger/client.ts`)

- Cache access tokens in memory (per connection) until ~60s before expiry; refresh via `https://oauth2.googleapis.com/token`.
- On `invalid_grant` / 401 after refresh: set `blog_connections.status='needs_reconnect'`, set all its blogs `status='needs_reconnect'`, **disable their schedules**, create a notification + email. The UI shows a prominent "Reconnect" button which re-runs the connect flow and, on success, restores `active` and re-enables schedules that were enabled before.
- Blogger API calls used:
  - List blogs: `GET /blogger/v3/users/self/blogs`
  - Recent titles (dedupe): `GET /blogger/v3/blogs/{id}/posts?fetchBodies=false&maxResults=50&orderBy=published`
  - Create: `POST /blogger/v3/blogs/{id}/posts?isDraft={true|false}` body `{kind:"blogger#post", title, content, labels}`
  - Publish a draft: `POST /blogger/v3/blogs/{id}/posts/{postId}/publish`
  - Handle 429/5xx with exponential backoff; surface 403 as "API not enabled / not permitted".

---

## 7. Roles, connections and the "use same for all" button

- A user creates **AI connections** once (provider + API key [+ base URL for custom]). Each has a **Test** button (Section 8.4).
- Per blog, three **roles** each select `(ai_connection, model, params)`:
  - `research` and `writing` → text-capable connections
  - `image` → image-capable connections
- **Capability matrix** (in `registry.ts`):

| Provider      | text                     | image                             | grounded search                                 |
| ------------- | ------------------------ | --------------------------------- | ----------------------------------------------- |
| gemini        | ✅                       | ✅ (Imagen / Gemini image models) | ✅ (Google Search grounding tool)               |
| openai        | ✅                       | ✅                                | optional                                        |
| openrouter    | ✅                       | ❌ (v1)                           | via search-capable models                       |
| anthropic     | ✅                       | ❌                                | ✅ (web search tool — verify current tool spec) |
| pollinations  | optional (skip in v1)    | ✅                                | ❌                                              |
| fal           | ❌                       | ✅                                | ❌                                              |
| leonardo      | ❌                       | ✅                                | ❌                                              |
| custom_openai | ✅ (`/chat/completions`) | ✅ (`/images/generations`)        | ❌                                              |

- **"Use same settings for all three" button:** user picks one connection → apply to all roles it supports; for roles it cannot serve (e.g. Anthropic → image) leave that role unset and show an inline warning. Model per role stays individually editable (a good text model is not an image model).
- The UI refuses to enable a schedule until all three roles + an image host are configured and have a passing recent test (or an explicit "skip test" confirmation).

---

## 8. Provider layer

### 8.1 Interfaces (`providers/types.ts`)

```ts
export type TextRequest = {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean; // request strict JSON output where supported
  grounded?: boolean; // enable web search/grounding where supported
  signal?: AbortSignal;
};
export type TextResult = {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  sources?: { title?: string; url: string }[];
};
export interface TextProvider {
  generate(req: TextRequest): Promise<TextResult>;
  listModels?(): Promise<string[]>;
  test(model: string): Promise<void>; // throws a typed ProviderError
}

export type ImageRequest = {
  model: string;
  prompt: string;
  aspect: '16:9' | '1:1' | '4:3'; // adapter maps to provider sizes
  signal?: AbortSignal;
};
export type ImageResult = {
  bytes: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  usage?: Record<string, number>;
};
export interface ImageProvider {
  generate(req: ImageRequest): Promise<ImageResult>; // hides URL/base64/async-polling differences
  listModels?(): Promise<string[]>;
  test(model: string): Promise<void>;
}
```

`ProviderError` has `kind: 'auth' | 'rate_limit' | 'quota' | 'bad_request' | 'not_found' | 'content_policy' | 'timeout' | 'server' | 'unsupported'` and a user-safe message. Map HTTP statuses to kinds; retry only `rate_limit`/`timeout`/`server`.

### 8.2 Adapters (verify each against current docs first)

**Text**

- `gemini` — `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`. Grounding via the Google Search tool.
- `openai` — chat completions or Responses API (use whichever current docs recommend).
- `openrouter` — `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible).
- `anthropic` — `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version`. Web-search tool for grounded research.
- `custom_openai` — user `base_url` + `/chat/completions`, `Authorization: Bearer`. **All requests go through `ssrf.ts`.**

**Image**

- `gemini` — Imagen `:predict` (base64 predictions) and Gemini image models via `generateContent` (inline image data). Support both by model family.
- `openai` — `POST /v1/images/generations` with the model from user config (default seeded to `gpt-image-2`); handle `b64_json`.
- `pollinations` — unified endpoint `https://gen.pollinations.ai/image/{prompt}`; **requires the user's API key** (anonymous requests from one VPS IP get throttled); supports model param; returns image bytes.
- `fal` — queue API: submit to the model ID endpoint, poll status, fetch result, download `images[0].url`. Auth header `Authorization: Key <key>`. One connection → many models (FLUX, Ideogram, Recraft, Seedream) by model ID.
- `leonardo` — async: create generation, poll until complete, download. Note in UI: _"Leonardo's API is billed separately from app subscriptions; the free app plan may not include API access."_
- `custom_openai` — `base_url` + `/images/generations`; handle `b64_json` or `url`.

Per-adapter timeouts: text 120s, image 180s. Max downloaded image size: 10 MB. Always validate the downloaded bytes are a real image (check magic bytes).

### 8.3 Registry

`registry.ts`: `getTextProvider(connection)` / `getImageProvider(connection)` decrypts the key, returns an adapter instance; enforces capability matrix; blocks `mock` unless `ENABLE_MOCK_PROVIDERS=true`.

### 8.4 Test buttons

- Text test: tiny prompt ("Reply with OK"), 20 tokens max. Image test: generate a small simple image with the cheapest settings; warn the user it may consume a little credit. Store `last_test_*`. Never echo the key in errors.

### 8.5 Mock providers

`mock` text returns deterministic valid JSON article; `mock` image returns a generated PNG (draw with a tiny pure-JS encoder, or ship a small fixture); `mock` image host returns a fake URL. These power all integration/e2e tests and local dev.

### 8.6 Model catalog UX

For each role the UI offers: a dropdown of `provider_catalog` suggestions for that provider (non-deprecated first), a **"Fetch models"** button where `listModels` is supported, and a **free-text model ID** field. Seed a few sensible defaults in `seed.ts`; label them "suggested — models change, verify with your provider".

---

## 9. Image hosts

```ts
export interface ImageHost {
  upload(img: { bytes: Buffer; mime: string; filename: string }): Promise<{ url: string }>;
  test(): Promise<void>;
}
```

- **imgbb** — `POST https://api.imgbb.com/1/upload?key=KEY` (multipart, `image` = base64). Use the `url`/`display_url` from the response. Config: `{ apiKey }`.
- **Cloudinary** — `POST https://api.cloudinary.com/v1_1/{cloud_name}/image/upload`; support **signed** uploads (`api_key`, `api_secret`, timestamp + SHA-1 signature) and **unsigned preset**. Config: `{ cloudName, apiKey?, apiSecret?, uploadPreset? }`. Request `f_auto,q_auto` delivery URL if possible.
- Return an HTTPS URL only. Retry transient failures twice.

---

## 10. Limits and quotas (`lib/limits.ts`)

- `effectiveBlogLimit(user) = user.blog_limit ?? settings.default_blog_limit`.
- `canConnectBlog(user)` counts `blogs` rows for the user. **Enforce server-side** at `/connect` and inside the transaction that creates the `blogs` row (race-safe). The UI shows "1 of 2 blogs used".
- `max_posts_per_day` (user override or default): the scheduler/manual-run code refuses to start a post generation if the user's posts created in the last 24h ≥ limit; record a skipped run with a clear reason.
- Deleting a blog frees a slot.

---

## 11. Pipeline (`lib/pipeline`)

A **run** is created per schedule slot or manual trigger; it produces `posts_per_run` posts **sequentially** (10–30s pause between them). Each post goes through steps stored in `run_steps` with outputs persisted. On retry, resume from the first non-succeeded step.

1. **research** → choose a topic:
   - If `topics` has `queued` items → take the oldest, mark `used`.
   - Else by `research_mode`:
     - `brainstorm`: text model proposes 10 candidate topics from niche, audience, keywords + last 50 titles (from our `posts` and Blogger's recent titles). Insert as `topics(source='brainstorm')`, then take the first non-duplicate.
     - `grounded`: same, with `grounded:true`; store `sources` in `output`.
   - **Dedupe:** normalize (lowercase, strip punctuation/stopwords) and reject topics with trigram-Jaccard similarity ≥ 0.6 vs existing titles.
2. **write** → one text call with `json:true`. Required JSON (validate with zod; on parse failure retry once with a repair instruction):
   ```json
   {
     "title": "",
     "meta_description": "<=160 chars",
     "html": "<article body, no <h1>, uses h2/h3, p, ul/ol, a, strong, em, table>",
     "labels": ["..."],
     "image_prompt": "",
     "image_alt": ""
   }
   ```
   Quality gates (fail the step → retry once → mark post `failed`): word count within `[min_words, max_words]` (±15%), contains ≥3 `h2`, no placeholder text (`[insert`, `lorem`, `TODO`), no blocklisted keywords, title not a near-duplicate.
3. **image** → build the image prompt from `image_prompt` + niche style; generate via role config; on `content_policy` error, retry once with a sanitized/simplified prompt; if still failing, continue **without image** if the blog setting `allow_no_image` is true (default true), else fail.
4. **upload** → send bytes to the image host; store URL in `posts.image_url`.
5. **assemble** → sanitize `html` (allowlist: `h2 h3 h4 p ul ol li a strong em blockquote table thead tbody tr th td img figure figcaption br`; strip scripts, styles, iframes, event handlers; force `rel="noopener noreferrer"` on links). Prepend `<figure><img src alt style="max-width:100%"><figcaption>`; append optional AI-disclosure line if `ai_disclosure`. Merge `labels` with `default_labels` (dedupe, max 20, each ≤ 50 chars).
6. **deliver** → by `publish_mode`:
   - `auto` → insert on Blogger `isDraft=false` → `published`.
   - `draft` → insert `isDraft=true` → `draft_on_blogger`.
   - `review` → status `pending_review`, set `review_expires_at`, notify the user (in-app + email).

**Idempotency:** before inserting to Blogger, if `posts.blogger_post_id` is set, skip. Set status `publishing` inside a transaction with a row lock so two workers can't double-post.

**Prompts** live in `pipeline/prompts/*.ts` as template strings with `{{variables}}`; per-blog `prompt_overrides` replace them. The default writer prompt must demand: original, specific, experience-led content; concrete examples; no filler intros; no invented statistics/quotes; honest uncertainty; target audience and tone from the profile; the exact JSON schema above. (Fully automated, unreviewed generic AI content can hurt a blog's search standing — specificity and the review mode are the mitigation.)

### Review flow (UI + actions)

Review queue per blog: list of `pending_review` posts → detail page with rendered preview and editable title/html/labels/image. Actions: **Approve & publish live**, **Send to Blogger as draft**, **Regenerate text**, **Regenerate image**, **Reject (with reason)**. A worker job `review.expire` runs hourly: posts past `review_expires_at` → `expired`, or auto-publish if `auto_publish_on_expiry`.

---

## 12. Scheduler (`lib/schedule`, `worker`)

- **Tick:** a pg-boss recurring job every minute selects `schedules` where `enabled AND next_run_at <= now()` joined to active blogs (and `global_pause = false`, user not suspended), using `FOR UPDATE SKIP LOCKED`. For each: insert `runs(trigger='scheduled', scheduled_for=next_run_at)` (unique constraint = idempotent), enqueue `run.execute`, then compute and store the next `next_run_at`.
- **`computeNext(schedule, from)`** (pure function, luxon, DST-safe, fully unit-tested):
  - `interval_hours`: `from + N hours`.
  - `daily`: next occurrence of any `times[]` in the schedule's timezone.
  - `weekdays`: same, restricted to `weekdays[]`.
- **Missed slots:** if `next_run_at` is more than 60 minutes in the past (downtime), do **not** burst-catch-up: skip to the next future slot and log a `missed` note on the schedule.
- **Concurrency:** worker concurrency from env; at most **one active run per user** (use a `singletonKey` of `user:<id>` or a DB check). Manual "Run now" is rejected if a run is active; rate-limit to 1 manual run per 5 minutes per blog.
- **Failure handling:** each step retries per provider-error kind (Section 8.1) with backoff; after exhaustion the post is `failed` with a readable error; the run is `partial` or `failed`. Three consecutive failed runs → pause the schedule and notify the user.
- Worker handles `SIGTERM` gracefully (finish current job, stop fetching).

---

## 13. UI specification (user area)

Design: clean, minimal, responsive, light/dark. Every form validated with zod + inline errors; destructive actions need confirmation.

- **/login** — "Continue with Google", links to privacy/terms. Show closed/invite-only messaging.
- **/dashboard** — blog cards (name, status badge, next run, last post, pending-review count), "Add blog (1 of 2 used)", announcement banner, needs-reconnect alerts.
- **/connections** — tabs: _AI connections_ and _Image hosts_. Add/edit/delete, Test button with status, never display saved keys (show `••••` + last 4 chars only if stored separately as `key_hint`).
- **/blogs/[id]/settings** — sections: Blog profile · AI roles (3 cards + **"Use same connection for all"** button) · Publish mode · Image host · Danger zone (disconnect/delete).
- **/blogs/[id]/topics** — queue: paste many (one per line), reorder, skip, history.
- **/blogs/[id]/schedule** — frequency, times, weekdays, timezone (default from browser), posts per run, enable toggle with readiness checklist, **Run now**, pause/resume, "next 5 run times" preview.
- **/blogs/[id]/posts** — table with status filters, links to Blogger, error details, Retry; **review queue** tab with the detail/editor view from Section 11.
- **/blogs/[id]/runs** — run list with step-by-step timeline and error messages.
- **/notifications**, **/account** (export my data, delete account).
- **Public:** `/privacy`, `/terms` (see Section 16), landing page with value prop.

---

## 14. Security requirements (acceptance-tested)

1. **Secrets at rest:** AES-256-GCM, random 12-byte IV per value, format `v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64). `MASTER_KEY` from env only. Unit tests: round-trip, tamper detection, wrong key fails.
2. **No secrets to the client:** API responses/serializers must never include `*_enc` fields. Add a test that scans serialized responses.
3. **SSRF guard (`ssrf.ts`)** for every user-influenced outbound URL (custom base URLs, image download URLs from providers):
   - `https` only in production (allow `http` only for explicit dev flag).
   - Resolve DNS yourself, reject if **any** resolved IP is loopback, private (RFC1918), link-local (incl. `169.254.169.254` metadata), CGNAT, multicast, unspecified, or IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped).
   - **Pin** the validated IP for the actual connection (prevents DNS rebinding); do not auto-follow redirects — re-validate each hop (max 3).
   - Timeouts and a max response size.
   - Unit tests with a table of hostile inputs (`localhost`, `127.1`, `0x7f000001`, decimal IPs, `[::1]`, metadata IP, rebinding fake resolver).
   - Admin setting `custom_endpoints_allowed` and per-user override can disable custom endpoints.
4. **Authorization:** every route/action loads the resource **scoped by `user_id`** (never trust ids from the client). Admin routes check `is_admin` in middleware **and** in each server action. Add tests for cross-user access attempts (IDOR).
5. **OAuth:** `state` + PKCE, single-use, short TTL; verify `redirect_uri`; request minimal scopes.
6. **Sessions/CSRF:** SameSite=Lax secure cookies; server actions/forms CSRF-protected (Next.js built-ins); JSON routes require same-origin checks.
7. **Rate limiting** (in-memory is fine for one VPS; abstract behind an interface): login attempts, connection Test, Run now, admin actions.
8. **HTML safety:** sanitize AI output before storing/publishing; preview rendered in a sandboxed iframe (`sandbox` without `allow-scripts`).
9. **Headers:** strict CSP, `X-Frame-Options`/frame-ancestors, `Referrer-Policy`, HSTS (via Caddy).
10. **Logging:** pino redaction for `authorization`, `apiKey`, `*_enc`, tokens; never log request bodies of provider calls.
11. **Account deletion:** hard-delete connections, keys, tokens, blogs, posts after a confirmation; revoke Google refresh tokens via `https://oauth2.googleapis.com/revoke`; keep only the audit log entry.
12. **Dependencies:** `npm audit` in CI; no unnecessary packages.

---

## 15. Admin panel (`/admin`, admin-only)

**v1 (build now):**

- **Users:** table with search/filter/pagination; detail page showing blogs, connections count (not keys), recent runs; actions: suspend/unsuspend, **set `blog_limit` override** (blank = default), set `max_posts_per_day` override, force-disconnect a blog, delete user. Every action → `audit_log`.
- **Global settings:** default blog limit; signups mode (open / invite-only / closed) with invite management; maintenance mode; global pause for all schedules; default posts/day; custom endpoints allowed toggle; announcement banner text.
- **Jobs & runs monitor:** all runs with status, user, blog, error; filter failed; retry a run; cancel queued runs; queue depth.
- **Health:** blogs/connections in `needs_reconnect`, failure rate by provider (last 24h/7d), recent errors, worker heartbeat (worker writes a heartbeat row every 30s; show "worker down" if stale).
- **Provider catalog:** CRUD for suggested models; mark deprecated.
- **Audit log:** searchable list.

**v1.1 (stub routes, build if time permits):** usage stats charts (posts/day, active users), keyword blocklist editor, default prompt template editor, view-as-user (read-only, audited), email template editor, data export. **Future:** plans + Stripe webhook updating `users.blog_limit`.

---

## 16. Legal & Google verification support

Build real pages (owner will review the text):

- `/privacy` must include: what data is collected; that Blogger data is used only to publish the user's own posts; storage/encryption of tokens and keys; deletion instructions; contact email; and the **Google API Services User Data Policy "Limited Use" statement**: _"[APP_NAME]'s use and transfer of information received from Google APIs to any other app will adhere to Google API Services User Data Policy, including the Limited Use requirements."_
- `/terms` with: acceptable use (no spam/illegal content), user responsibility for published content and AI keys, service-as-is, suspension rights.
- A home page that clearly explains the app and links to both pages (Google reviews it).
- `docs/VERIFICATION_CHECKLIST.md`: step list for the owner — verified domain in Search Console, consent-screen branding, scope justification text for `https://www.googleapis.com/auth/blogger`, demo-video script showing the full connect → publish flow, and a note that unverified apps cap at 100 users.

---

## 17. Phased work plan with acceptance criteria

### Phase 0 — Scaffold

**Tasks:** create repo; Next.js + TS strict + Tailwind + shadcn; ESLint/Prettier; Vitest; Dockerfile, `docker-compose.yml` (db, app, worker, caddy), `Caddyfile`; `env.ts`; pino logger; `/api/health`; the 4 living docs; CI script (`npm run check` = typecheck + lint + test).
**Accept:** `docker compose up` serves a placeholder page and `/api/health` returns 200 with DB status; `npm run check` passes.

### Phase 1 — Database, crypto, auth, settings

**Tasks:** full Drizzle schema + migrations + `seed.ts` (settings defaults, provider_catalog suggestions); `crypto.ts` + tests; Auth.js Google login (identity scopes only) with signup modes, suspension, admin bootstrap; app shell/layout, guards, maintenance page; `settings.ts` with caching; `audit.ts`.
**Accept:** can sign in with Google (when `HUMAN_TASKS` credentials exist; otherwise dev-only credentials provider behind `ENABLE_MOCK_PROVIDERS`); admin flag set from `ADMIN_EMAILS`; crypto tests green; IDOR test harness exists.

### Phase 2 — Connections and providers

**Tasks:** `ssrf.ts` + hostile-input tests; provider types/registry; all text adapters; all image adapters; mock adapters; image hosts (imgbb, Cloudinary, mock); Connections UI with add/edit/delete/**Test**; "Fetch models"; typed `ProviderError` mapping; adapter tests with HTTP mocks (success, 401, 429, malformed, timeout).
**Accept:** every adapter has passing mock-HTTP tests; Test buttons work end-to-end with mock providers; no secret ever appears in responses/logs (test); SSRF tests pass.

### Phase 3 — Blogger connect

**Tasks:** `/api/blogger/connect` + `/callback` with state/PKCE; token store/refresh; blog picker; limit enforcement (transactional); Blogger client (list blogs, list posts, insert, publish draft); `needs_reconnect` handling + notification; Blogger client unit tests with mocked HTTP.
**Accept:** (with real Google credentials, human-verified) a blog connects and a test draft can be created and deleted; limit of 2 enforced even under concurrent requests; invalid_grant flips status and disables schedule (tested with mocks).

### Phase 4 — Blog settings

**Tasks:** blog profile form; AI roles UI with capability matrix + **"Use same for all"**; publish mode + review settings; image-host selection; topics UI; readiness checklist.
**Accept:** a blog can be fully configured with mock providers; "use same for all" correctly leaves unsupported roles unset with a warning (e.g., Anthropic → image).

### Phase 5 — Pipeline, Run now, review queue

**Tasks:** prompts; research/write/image/upload/assemble/deliver steps with persistence + resume; quality gates; dedupe; worker job `run.execute`; "Run now"; posts list, run timeline; review queue UI (preview, edit, approve live / draft, regenerate, reject); `review.expire` job.
**Accept:** with all-mock providers, "Run now" yields a post in each publish mode (auto→published via mocked Blogger, draft, review→pending); a forced failure at the image step resumes without re-running the write step; double-click on Approve publishes once.

### Phase 6 — Scheduler, notifications, email

**Tasks:** `computeNext` with exhaustive tests (DST transitions, weekdays, intervals, multiple times); tick job with SKIP LOCKED + idempotent insert; missed-slot policy; per-user concurrency; schedule UI with next-5 preview; notifications (in-app + SMTP email, templates for: review pending, post published, run failed, reconnect needed, schedule auto-paused); worker heartbeat; graceful shutdown.
**Accept:** simulated clock tests show correct slots and no duplicate runs when two workers tick simultaneously; three consecutive failures auto-pause; emails sent via a fake SMTP in tests.

### Phase 7 — Admin panel

**Tasks:** admin guard; users table + detail + actions (incl. **blog limit override**); global settings + invites; jobs monitor; health view; provider catalog CRUD; audit log view.
**Accept:** setting a user's `blog_limit` to 4 immediately lets them connect 4 blogs; suspending a user blocks login and halts their schedules; non-admin gets 403 on every admin route/action (tested); all admin actions appear in audit log.

### Phase 8 — Hardening, legal, docs, release

**Tasks:** CSP/security headers; rate limits; account deletion + Google token revocation; privacy/terms/landing pages; Playwright smoke test (login stub → configure mock blog → Run now → review → approve); backup script (`pg_dump` cron + restore doc); `README.md` (local dev, env, deploy, upgrade); `docs/VERIFICATION_CHECKLIST.md`; `docs/ADDING_A_PROVIDER.md`; final dependency audit.
**Accept:** `docker compose up -d` on a clean VPS with a filled `.env` yields a working HTTPS site; full e2e smoke passes; Definition of Done (below) satisfied.

---

## 18. Testing strategy

- **Unit:** crypto, ssrf, computeNext, dedupe/similarity, HTML sanitizer, zod schemas, limit logic, provider response mappers.
- **Integration (real Postgres via docker/testcontainers):** limits under concurrency, scheduler tick idempotency, pipeline resume, publish-once guarantee, IDOR checks.
- **Adapters:** mocked HTTP for every provider (success + each `ProviderError` kind). Provide an optional `npm run test:live` that runs adapters against real keys from env (skipped by default) so the owner can validate real providers.
- **E2E (Playwright):** the happy path with mock providers.
- Coverage is not a target; the critical paths above are.

---

## 19. `HUMAN_TASKS.md` — to seed with these items

1. **DNS/HTTPS:** point the domain at the VPS; ensure ports 80/443 open; set `APP_URL`.
2. **Google Cloud project:** enable **Blogger API v3**; configure OAuth consent screen (app name, logo, support email, authorized domain, homepage, privacy and terms URLs); add scopes (`openid`, `email`, `profile`, and `https://www.googleapis.com/auth/blogger` under Data Access); create an OAuth **Web** client with redirect URIs `${APP_URL}/api/auth/callback/google` and `${APP_URL}/api/blogger/callback`; copy the ID/secret into `.env`.
3. **Publish the consent screen to "In production"** (not "Testing", which expires tokens after 7 days). Until verified, up to 100 users will see an "unverified app" warning — acceptable for early use.
4. **Verify the domain** in Google Search Console; **submit OAuth verification** once the demo works (use `docs/VERIFICATION_CHECKLIST.md`).
5. **Generate `MASTER_KEY`**, back it up securely (losing it makes stored keys unrecoverable).
6. **SMTP** credentials (optional but recommended for review/reconnect emails).
7. **Review legal text** in `/privacy` and `/terms`; add contact email.
8. **Live-provider validation:** with real keys, run `npm run test:live` and a real publish to a throwaway blog.

---

## 20. Definition of Done (whole project)

- [ ] All phase acceptance criteria met; `npm run check` green; Playwright smoke green.
- [ ] A new user can: log in → connect a Blogger blog → add AI connections → configure three roles (incl. "use same for all") → pick an image host → set a schedule → get a post in review → approve → see it live on Blogger.
- [ ] Blog limit of 2 enforced server-side; admin override works instantly.
- [ ] Review mode and auto-publish mode both work; draft mode works.
- [ ] Expired Google token → blog shows "Reconnect needed", schedule paused, user notified.
- [ ] No secret appears in any API response, log line, or client bundle.
- [ ] SSRF and IDOR tests pass.
- [ ] No hardcoded model IDs outside seed/config.
- [ ] README lets the owner deploy from scratch; backups documented.
- [ ] `PROGRESS.md`, `DECISIONS.md`, `HUMAN_TASKS.md` are current.
