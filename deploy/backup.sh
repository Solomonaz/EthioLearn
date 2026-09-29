#!/usr/bin/env bash
# ── Nightly backup: database + uploads, copied off the server ───────────────
#
# Run from cron as the deploy user (see DEPLOY.md):
#   30 2 * * * /home/deploy/abugida/deploy/backup.sh >> /home/deploy/backup.log 2>&1
#
# Keeps KEEP_DAYS of backups on this server, and — when BACKUP_REMOTE is set in
# .env — mirrors them to off-server storage (e.g. a Hetzner Storage Box) over
# SSH. A backup that only lives on the server it protects is not a backup.
set -euo pipefail

cd "$(dirname "$0")/.."                       # the project directory
set -a; source .env; set +a                   # BACKUP_REMOTE, etc.

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"

echo "[$(date)] backup starting"

# Database: custom format, restorable with pg_restore (see restore.sh).
docker compose exec -T db pg_dump -U abugida -d abugida -Fc > "$BACKUP_DIR/db-$STAMP.dump"

# Uploads: textbooks and student submissions.
docker compose exec -T app tar czf - -C /data/uploads . > "$BACKUP_DIR/uploads-$STAMP.tar.gz"

# Refuse to keep (or copy) an empty dump — it would look like a backup and not be one.
if [ ! -s "$BACKUP_DIR/db-$STAMP.dump" ]; then
  echo "[$(date)] ERROR: database dump is empty" >&2
  exit 1
fi

# Local retention.
find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

# Off-server copy (Hetzner Storage Box: SSH on port 23).
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a --delete -e "ssh -p ${BACKUP_REMOTE_PORT:-23}" "$BACKUP_DIR/" "$BACKUP_REMOTE/"
  echo "[$(date)] copied to $BACKUP_REMOTE"
else
  echo "[$(date)] WARNING: BACKUP_REMOTE not set — backups exist only on this server"
fi

echo "[$(date)] backup done: db-$STAMP.dump ($(du -h "$BACKUP_DIR/db-$STAMP.dump" | cut -f1)), uploads-$STAMP.tar.gz"
