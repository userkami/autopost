# Google OAuth Verification Checklist

This document tracks the steps to verify the AutoBlog OAuth consent screen with Google.

## Prerequisites

- [ ] Google Cloud project created
- [ ] Blogger API v3 enabled
- [ ] Domain verified in Google Search Console
- [ ] Privacy Policy and Terms of Service URLs accessible (HTTPS)
- [ ] `APP_URL` configured and accessible via HTTPS

## OAuth Consent Screen Configuration

### Branding
- [ ] App name: **AutoBlog**
- [ ] User support email: (your email)
- [ ] App logo: (upload logo, 120x120 to 1200x1200)
- [ ] App domain: (your verified domain)
- [ ] Authorized domains: (your domain)
- [ ] Homepage URL: `https://your-domain.com`
- [ ] Privacy Policy URL: `https://your-domain.com/privacy`
- [ ] Terms of Service URL: `https://your-domain.com/terms`

### Scopes
- [ ] `openid` (OpenID Connect)
- [ ] `email` (user's email address)
- [ ] `profile` (user's name and profile picture)
- [ ] `https://www.googleapis.com/auth/blogger` (Blogger API - **sensitive scope**)

### Test Users (if in Testing mode)
- [ ] Add test user emails (up to 100)
- [ ] Note: Testing mode expires refresh tokens after 7 days

## OAuth Client (Web Application)

- [ ] Client type: Web application
- [ ] Name: AutoBlog Web Client
- [ ] Authorized JavaScript origins:
  - `https://your-domain.com`
- [ ] Authorized redirect URIs:
  - `https://your-domain.com/api/auth/callback/google` (Auth.js login)
  - `https://your-domain.com/api/blogger/callback` (Blogger connect)
- [ ] Copy Client ID and Client Secret to `.env`:
  - `AUTH_GOOGLE_ID`
  - `AUTH_GOOGLE_SECRET`

## Verification Submission

### Prepare Demo Video
- [ ] Record screen showing full flow:
  1. Sign in with Google
  2. Go to /connect, connect a Blogger blog
  3. Configure AI roles, image host, schedule
  4. Run now → post appears in review
  5. Approve → post published to Blogger
- [ ] Video length: 2-5 minutes
- [ ] Upload to YouTube (unlisted) or Google Drive

### Prepare Scope Justification
- [ ] Document why `https://www.googleapis.com/auth/blogger` is needed:
  > "AutoBlog allows users to connect their Blogger blogs and publish AI-generated articles. The scope is required to list blogs, create posts, and publish/draft on the user's behalf. No other Google APIs are accessed."

### Submit for Verification
- [ ] Go to Google Cloud Console → APIs & Services → OAuth consent screen
- [ ] Click "Publish App" → "In production"
- [ ] Fill verification form:
  - App description
  - Demo video link
  - Scope justification
  - Contact email
- [ ] Submit for review

## Post-Verification

- [ ] Verification approved (can take days to weeks)
- [ ] Update consent screen status to "In production"
- [ ] Remove test users (no longer needed)
- [ ] Verify refresh tokens work beyond 7 days
- [ ] Test full flow with production credentials

## Maintenance

- [ ] Re-verify annually (Google requires annual re-verification)
- [ ] Update privacy/terms URLs if they change
- [ ] Monitor OAuth quotas in Google Cloud Console
- [ ] Keep `MASTER_KEY` backed up securely

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Unverified app" warning | Complete verification process above |
| Refresh token expires in 7 days | App is in "Testing" mode; publish to production |
| "Access blocked" error | Check authorized domains and redirect URIs |
| Blogger API not enabled | Enable "Blogger API v3" in Google Cloud Console |
| 403 on Blogger API | User hasn't granted Blogger scope; re-run connect flow |

## References

- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Blogger API v3 Documentation](https://developers.google.com/blogger/docs/3.0/getting_started)