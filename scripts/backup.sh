#!/usr/bin/env bash
# Online backup of the SQLite DB + uploads. Safe while the server runs.
# Usage: scripts/backup.sh [backup_dir]   Env: DB_PATH, UPLOAD_DIR, KEEP (default 14)
# Docker: point DB_PATH/UPLOAD_DIR at the named volume path on the host, e.g.
#   DB_PATH=/var/lib/docker/volumes/deploy_connectly-data/_data/connectly.db UPLOAD_DIR=.../uploads scripts/backup.sh
set -euo pipefail
DB_PATH="${DB_PATH:-$(dirname "$0")/../api/connectly.db}"
UPLOAD_DIR="${UPLOAD_DIR:-$(dirname "$0")/../api/uploads}"
DEST="${1:-${BACKUP_DIR:-./backups}}"
KEEP="${KEEP:-14}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"
[ -f "$DB_PATH" ] || { echo "DB not found: $DB_PATH" >&2; exit 1; }
OUT="$DEST/connectly-$TS.db"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".timeout 10000" ".backup '$OUT'"
else
  DB_PATH="$DB_PATH" OUT="$OUT" node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.DB_PATH);
    db.exec('PRAGMA busy_timeout=10000');
    db.exec(\"VACUUM INTO '\" + process.env.OUT.replace(/'/g, \"''\") + \"'\");
    db.close();"
fi
[ -s "$OUT" ] || { echo "backup file empty" >&2; exit 1; }
command -v sqlite3 >/dev/null 2>&1 && sqlite3 "$OUT" 'PRAGMA journal_mode=DELETE' >/dev/null
rm -f "$OUT-wal" "$OUT-shm"
CHECK="$(sqlite3 "$OUT" 'PRAGMA integrity_check' 2>/dev/null || echo ok)"
[ "$CHECK" = "ok" ] || { echo "integrity check failed: $CHECK" >&2; exit 1; }

if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$DEST/uploads-$TS.tar.gz" -C "$UPLOAD_DIR" .
fi
chmod 600 "$DEST"/*"$TS"* 2>/dev/null || true

# Keep the newest KEEP of each kind.
for pat in 'connectly-*.db' 'uploads-*.tar.gz'; do
  ls -1t "$DEST"/$pat 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r f; do rm -f -- "$f"; done
done
echo "backup ok: $OUT"
