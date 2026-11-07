#!/usr/bin/env bash
# Restore a backup. STOP THE API FIRST (docker compose stop api web).
# Usage: scripts/restore.sh <connectly-TS.db> [uploads-TS.tar.gz]   Env: DB_PATH, UPLOAD_DIR
set -euo pipefail
DB_PATH="${DB_PATH:-$(dirname "$0")/../api/connectly.db}"
UPLOAD_DIR="${UPLOAD_DIR:-$(dirname "$0")/../api/uploads}"
DBFILE="${1:?usage: restore.sh <db-backup> [uploads-tar.gz]}"
TAR="${2:-}"
[ -f "$DBFILE" ] || { echo "no such file: $DBFILE" >&2; exit 1; }
echo "This will REPLACE: $DB_PATH${TAR:+ and the contents of $UPLOAD_DIR}"
echo "with: $DBFILE${TAR:+ and $TAR}"
echo "Make sure the API is stopped."
read -r -p "Type RESTORE to continue: " ans
[ "$ans" = "RESTORE" ] || { echo "aborted"; exit 1; }

SAFE="$(dirname "$DB_PATH")/pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$SAFE"
for f in "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"; do [ -f "$f" ] && cp -p "$f" "$SAFE"/; done
[ -d "$UPLOAD_DIR" ] && tar -czf "$SAFE/uploads.tar.gz" -C "$UPLOAD_DIR" . || true
echo "safety copy: $SAFE"

rm -f "$DB_PATH-wal" "$DB_PATH-shm"
cp "$DBFILE" "$DB_PATH"
if [ -n "$TAR" ]; then
  mkdir -p "$UPLOAD_DIR"
  find "$UPLOAD_DIR" -mindepth 1 -delete
  tar -xzf "$TAR" -C "$UPLOAD_DIR"
fi
echo "restored. Start the stack again and run the smoke test."
