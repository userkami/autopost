# HUMAN TASKS — AutoBlog

Only the owner can do these. Dependent work is marked **BLOCKED** in `PROGRESS.md`. **Never fake credentials or pretend an external call works.**

- [ ] 1. **DNS/HTTPS** — point the domain at the VPS; ensure ports 80/443 are open; set `APP_URL` in `.env`. _BLOCKS: Phase 8 deploy verification._
- [ ] 2. **Google Cloud project** — enable **Blogger API v3**; configure OAuth consent screen (app name, logo, support email, authorized domain, homepage, privacy + terms URLs); add scopes (`openid`, `email`, `profile`, and `https://www.googleapis.com/auth/blogger` under Data Access); create an OAuth **Web** client with redirect URIs `${APP_URL}/api/auth/callback/google` and `${APP_URL}/api/blogger/callback`; copy the ID/secret into `.env`. _BLOCKS: Phase 1 real Google login, Phase 3 real blog connect._
- [ ] 3. **Publish the consent screen to "In production"** — "Testing" mode expires tokens after 7 days. Until verified, up to 100 users see an "unverified app" warning (acceptable early on).
- [ ] 4. **Verify the domain** in Google Search Console; **submit OAuth verification** once the demo works (use `docs/VERIFICATION_CHECKLIST.md` from Phase 8).
- [ ] 5. **Generate `MASTER_KEY`** (`openssl rand -base64 32`, 32 bytes) and back it up securely — losing it makes all stored keys unrecoverable. _BLOCKS: storing real API keys in a deployed environment._
- [ ] 6. **SMTP credentials** (optional but recommended) — `smtp://user:pass@host:587` + `MAIL_FROM`. _BLOCKS: review/reconnect emails (in-app notifications work without it)._
- [ ] 7. **Review legal text** in `/privacy` and `/terms`; add the contact email. _BLOCKS: Phase 8 release + Google OAuth verification._
- [ ] 8. **Live-provider validation** — with real keys, run `npm run test:live` and a real publish to a throwaway blog.
