# Connectly

A verified-connection app: wall → like → match → chat. A clean-room reference implementation
inspired by the *behaviour* of similar apps; no third-party code or assets.

- `api/` — Fastify + TypeScript, `node:sqlite`, JWT auth, WebSocket push. REST under `/v0`.
- `web/` — Vite + React + Redux Toolkit (RTK Query) + Tailwind, installable PWA.

## Run
Requires Node >= 24.22.1.

```bash
npm install
npm run dev:api   # http://127.0.0.1:3001
npm run dev:web   # http://localhost:5173 (proxies /v0 and the WebSocket to the API)
npm test -w api   # full API suite
npm run typecheck
```

## Configuration (API environment)
| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Required in production (the server refuses to start without it). |
| `PORT`, `DB_PATH`, `UPLOAD_DIR` | Listen port, SQLite file, upload directory. |
| `WEB_ORIGIN` | Allowed CORS origin and base URL for emailed links. Required in production. |
| `TRUST_PROXY` | Set `true` only behind a reverse proxy you control, so rate limits see the real client IP. |
| `RATE_LIMIT` | `off` disables per-IP limits. For tests only. |
| `ADMIN_EMAILS` | Comma-separated; these accounts are admins and skip verification. |
| `PAYMENT_UPI_ID`, `PAYMENT_PAYEE_NAME` | Payee shown on the Membership page. Unset = "payment not set up". |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push. Unset = push disabled. Generate keys with `npm run vapid -w api`. |

Membership prices in `api/src/plans.ts` are **placeholders**; set your own.

## What's built
- **Auth & profiles:** signup/login, profile edit.
- **Auth hardening:** password policy (8–128 chars, common passwords refused); per-IP rate limits on sign-up, sign-in and reset endpoints; per-account sign-in lockout (5 failures → 15 min, keyed by email+IP so strangers can't lock you out); identical responses and one hash check for unknown emails; revocable sessions (every token carries a version that password change/reset and "sign out of all devices" bump, which also closes live sockets); forgot/reset password with 30-minute single-use links stored hashed; security headers. Email is pluggable: call `setMailer` (api/src/mailer.ts) with your provider; until then links are printed to the server log outside production and dropped in production.
- **Verification:** new accounts are `unverified` until they upload a selfie and voice clip and an admin approves (admin console at `/admin`). File types are detected from bytes; media is admin-only.
- **Matching:** wall of unseen verified profiles, like/skip, mutual like creates a connection.
- **Chat:** 1:1 text, image and voice messages with live WebSocket delivery. Reading is free; sending needs a membership (admins exempt).
- **Memberships & payments:** members pay out of band and upload a UTR + screenshot; admins approve or reject with a reason; approval adds days and renewals stack. Reused references/screenshots are refused.
- **Preferences:** age-range and interest filters on the wall.
- **Safety:** block (both directions), report with admin review queue, suspensions.
- **Account:** quiet mode, deactivate, delete with 30-day grace (`npm run purge-deleted -w api [-- --dry-run]` anonymises due accounts; schedule it).
- **PWA & push:** manifest, service worker (production build only), content-free push notifications when a member is offline.

## Known gaps / before real users
- **Not browser-tested:** voice recording (MediaRecorder, mic permission, 120 s auto-stop), the service worker and push toggle, and upload flows from a phone. Typechecks and API tests cover them, a real device has not.
- Not built: email verification at signup (OTP), Google sign-in, an email transport (SMTP/provider), a payment gateway (manual proof review only).
- Rate limits and the push/upload paths are in-process: fine for one API instance; use a shared store (Redis) before running several.
- Sessions last 30 days (revocable) and there are no refresh tokens or per-device session list yet.
- Sign-up still reveals whether an email is registered (409), which is inherent without email verification.
- Selfies, voice clips and payment proofs are retained after review for audit; define a retention rule.
- Serve `/sw.js` with `Cache-Control: no-cache` in production.
