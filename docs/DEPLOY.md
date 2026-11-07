# Deploying Connectly on a small VPS

Plain-language runbook for one server (Hetzner, DigitalOcean, AWS Lightsail or similar; 1 vCPU / 2 GB RAM is plenty to start).

## What gets deployed
Two containers from `deploy/docker-compose.yml`: `api` (Node 24, SQLite on a named volume `connectly-data`) and `web` (nginx serving the built site and proxying `/v0`, including WebSockets, to the API). The API listens on 127.0.0.1 only, so nginx shares the API container's network namespace; this is why compose publishes port 80 on `api`. Do not "fix" that by changing the bind address without reading `api/src/server.ts`.

## 1. Provision
1. Create an Ubuntu 24.04 server. Add your SSH key; disable password login.
2. Firewall: allow 22, 80, 443 only.
3. Install Docker Engine and the compose plugin (https://docs.docker.com/engine/install/ubuntu/).
4. Clone the repo to `/opt/connectly`.

## 2. DNS
Point an A record (and AAAA if IPv6) for your domain, e.g. `app.example.com`, at the server IP. Wait for it to resolve.

## 3. Configure
```
cd /opt/connectly
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```
Edit it: generate `JWT_SECRET` with `openssl rand -base64 48`; set `WEB_ORIGIN=https://app.example.com`; set `TRUST_PROXY=true`; set `ADMIN_EMAILS`; fill the real `PAYMENT_UPI_ID` / `PAYMENT_PAYEE_NAME`; generate VAPID keys (`cd api && node src/scripts/generate-vapid-keys.ts`, needs Node 24.22.1+ and `npm ci` locally, or run it in the api container). Leave `RATE_LIMIT` unset.

## 4. Start
```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production up -d --build
docker compose -f deploy/docker-compose.yml ps        # api should become "healthy"

```
The `/health` endpoint is on the API only and is not proxied by nginx (only `/v0` is). Check it with `docker compose -f deploy/docker-compose.yml exec api node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.text()).then(console.log)"`.

## 5. HTTPS
The stack speaks plain HTTP on port 80. Terminate TLS in front of it. Simplest: Caddy on the host.
Because compose already uses host port 80, change the publish line in `deploy/docker-compose.yml` to `"127.0.0.1:8080:80"` and run Caddy on 80/443 with:
```
app.example.com {
  reverse_proxy 127.0.0.1:8080
}
```
Caddy gets and renews certificates automatically and handles WebSockets. Alternatives: Cloudflare proxy or a cloud load balancer. Microphone/camera, service worker and push all REQUIRE HTTPS.

## 6. First admin
Put your email in `ADMIN_EMAILS`, restart (`up -d`), then sign up with that email in the app and open the admin area. Confirm the admin queues load.

## 7. Smoke test checklist
- [ ] Site loads over https, no certificate warning.
- [ ] Sign up and log in; refresh stays logged in.
- [ ] Verification submission appears in the admin queue; approve it.
- [ ] Payment details shown are the real UPI details; a test payment proof appears in the admin queue.
- [ ] Two accounts: send request, accept, chat works live (WebSocket) and after reload.
- [ ] Voice clip records and plays (needs HTTPS + mic permission).
- [ ] Install as PWA; push notification arrives (if VAPID set).
- [ ] `docker compose ps` shows api healthy; restart the server and confirm data persists.
- [ ] A backup runs and the file is non-empty (see OPERATIONS.md).

## 8. Backups and cron
Install the entries from `scripts/crontab.example` (nightly backup and purge of deleted accounts). Copy backups off the server.

## 9. Upgrade
```
cd /opt/connectly
scripts/backup.sh          # with the DB_PATH/UPLOAD_DIR of your volume
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production up -d --build
```
Check `ps`, then the smoke test.

## 10. Rollback
Code only: `git checkout <previous-tag-or-commit>` and rebuild with the same command. If the new version changed the database and the old one misbehaves: stop the stack, run `scripts/restore.sh <backup.db> <uploads.tar.gz>` with the pre-upgrade backup, then start the old code.

## Not verified
Written without access to Docker. Not tested here: the image builds, container health, the shared-network-namespace setup, nginx config syntax/behaviour (WebSocket proxying, caching headers), the Caddy snippet, `npm ci -w api` in the API image, and the CI workflow on GitHub. `node:24-slim` is assumed to be at or above 24.22.1 (the repo requirement); check `docker run --rm node:24-slim node -v`. Only `backup.sh` and `restore.sh` were exercised, on macOS against the local dev database. Run `docker compose config` and a full build on the server before relying on this. SMTP: the API has no bundled mail sender, so the SMTP_* variables are not read yet.
