# Operating Connectly

## What to monitor
- Container health: `docker compose -f deploy/docker-compose.yml ps` (api "healthy"). Add an external uptime check (UptimeRobot etc.) on the site URL.
- Disk: the `connectly-data` volume (DB + uploads) and the backup directory. Alert at 80%.
- Logs: `docker compose logs --tail 200 api` (Fastify JSON logs). Watch for repeated 5xx, "push disabled", and failed purge runs in `/var/log/connectly-purge.log`.
- Backups: newest file in the backup dir is under 26 hours old and non-zero size.
- Certificates (if not auto-renewed) and domain expiry.

## Daily admin routine
- Verification queue: review new submissions, approve or reject with a reason.
- Payment queue: match each proof to the UPI credit in your bank app before approving; reject mismatches.
- Reports and blocks: read new reports; act on harassment quickly.

## Weekly
- Skim logs for errors; check disk usage.
- Confirm a backup file exists off the server.
- Review deleted-account purge log.
- Upgrade the OS (`apt upgrade`) and plan a container rebuild for base-image patches.

## Incident basics
**Lost admin access.** Add a new email to `ADMIN_EMAILS` in `deploy/.env.production`, `up -d`, and sign up or log in with it. Remove the old one afterwards.

**Leaked token or secret.** Change `JWT_SECRET` (`openssl rand -base64 48`) and restart the api. This signs EVERYONE out; tokens are stateless so this is the only way to revoke them. If the VAPID private key leaked, regenerate it (this drops all push subscriptions). Rotate the server SSH key and any provider credentials involved.

**Restoring a backup.** Stop the stack, run `scripts/restore.sh <connectly-TS.db> <uploads-TS.tar.gz>` (it asks for confirmation and saves a safety copy of current data first), start the stack, run the smoke test. Messages and sign-ups since the backup are lost; tell affected members if needed.

**Server down or disk full.** Free space (old backups, `docker system prune` for unused images only, never the volume), restart with `up -d`.

## Data retention (owner decision needed)
The app stores selfie verification images, voice clips and payment proofs in the uploads volume. Nothing here decides how long you keep them. Decide and write down: how long selfies are kept after verification, how long voice clips are kept, and how long payment proofs are kept (tax/accounting rules may require a minimum). Then implement deletion (manual or scripted) and state it in your privacy policy. Backups contain these files too, so retention applies to old backups as well (KEEP=14 days by default). Deleted accounts are anonymised by the nightly purge after the 30-day grace period.

## Pre-launch checklist
- [ ] Trademark search done for the product name and logo.
- [ ] Terms, privacy policy and community guidelines reviewed by a qualified person and linked in the app.
- [ ] Real UPI ID and payee name configured; a real small payment verified end to end.
- [ ] Tested on real phones (iOS Safari, Android Chrome): sign-up, selfie, voice, install, push.
- [ ] HTTPS working; `TRUST_PROXY=true`; `RATE_LIMIT` unset; `JWT_SECRET` random and stored in a password manager.
- [ ] Backups run nightly, copied off-server, and RESTORED at least once into a test environment.
- [ ] Retention periods decided (above).
- [ ] Two people can reach the admin area; admin contact for reports is staffed.

## Not verified
The Docker, nginx, Caddy and CI pieces were written without being run (see the "Not verified" section of DEPLOY.md). `ADMIN_EMAILS`/purge behaviour is as documented in the API code, not re-tested here.
