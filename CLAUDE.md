# AutoBlog — Agent Instructions

**Read `PLAN.md` first — it is the single source of truth** (stack, repo layout, data model, security rules, phases, acceptance criteria). Working name: **AutoBlog** (`APP_NAME`).

## Working rules (from PLAN.md §0)

1. **Work phase by phase** (PLAN.md §17). Do not start a phase until the previous phase's acceptance criteria pass.
2. **Keep three living files current** in the repo root:
   - `PROGRESS.md` — task checklist, status, what's next.
   - `DECISIONS.md` — every deviation from the plan, with a reason.
   - `HUMAN_TASKS.md` — owner-only tasks; mark dependent work BLOCKED; never fake credentials.
3. **Verify external facts.** Before writing each provider adapter, read the provider's current official documentation. If docs differ from the plan, the docs win; log it in `DECISIONS.md`.
4. **Model names are data, never code.** Model IDs live only in the seeded `provider_catalog` table and user config — never hardcoded in adapter logic.
5. **After every task:** `npm run check` (typecheck + lint + test); fix failures; small commits with conventional messages (`feat:`, `fix:`, `chore:`).
6. **Security rules are non-negotiable** (PLAN.md §14): never log secrets, never return secrets to the browser, never commit `.env`.
7. **Use mock providers** (PLAN.md §8.5) so the whole system is testable without any real API keys.
8. If blocked on a human task, build everything that does not depend on it, then move on.
