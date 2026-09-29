#!/usr/bin/env bash
# ── Restore a backup made by backup.sh ──────────────────────────────────────
#
#   deploy/restore.sh ~/backups/db-2026-10-01_0230.dump [~/backups/uploads-2026-10-01_0230.tar.gz]
#
# REPLACES the current database (and uploads, if given) with the backup.
# Also the monthly test: restore last night's backup and check the site.
set -euo pipefail

cd "$(dirname "$0")/.."
DB_DUMP="${1:?Usage: restore.sh <db-dump> [uploads-tar.gz]}"
UPLOADS="${2:-}"

echo "This REPLACES the live database${UPLOADS:+ and uploads} with:"
echo "  $DB_DUMP"
[ -n "$UPLOADS" ] && echo "  $UPLOADS"
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

docker compose stop app

# --clean --if-exists drops what the backup contains before recreating it.
docker compose exec -T db pg_restore -U abugida -d abugida --clean --if-exists --no-owner < "$DB_DUMP"

if [ -n "$UPLOADS" ]; then
  docker compose run --rm --no-deps -T --entrypoint sh app -c \
    'find /data/uploads -mindepth 1 -delete && tar xzf - -C /data/uploads' < "$UPLOADS"
fi

docker compose start app
echo "Restored. Check the site."
