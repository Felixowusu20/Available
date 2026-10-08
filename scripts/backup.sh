#!/usr/bin/env bash
# Daily PostgreSQL backup for the Docker Compose deployment.
#
#   ./scripts/backup.sh                 # writes backups/mdc-YYYY-MM-DD_HHMMSS.sql.gz
#   BACKUP_DIR=/mnt/backups KEEP_DAYS=30 ./scripts/backup.sh
#
# Cron example (every day at 02:30):
#   30 2 * * * cd /opt/mdc && ./scripts/backup.sh >> backups/backup.log 2>&1
#
# Copy the files OFF this server too (rsync, rclone, object storage): a backup on the same disk
# does not survive losing the server.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_USER="${DB_USER:-mdc}"
DB_NAME="${DB_NAME:-mdc}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y-%m-%d_%H%M%S)"
tmp="$BACKUP_DIR/.mdc-$stamp.partial"
out="$BACKUP_DIR/mdc-$stamp.sql.gz"

# --clean --if-exists lets the dump be restored over an existing database; --no-owner/--no-privileges
# keeps it restorable under a different database user (managed Postgres).
docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner --no-privileges | gzip -9 > "$tmp"

# A gzip of nothing is ~20 bytes: refuse to keep a backup that is obviously empty or damaged.
if ! gzip -t "$tmp" || [ "$(stat -c %s "$tmp" 2>/dev/null || stat -f %z "$tmp")" -lt 1000 ]; then
  rm -f "$tmp"
  echo "backup FAILED: output was empty or not a valid gzip" >&2
  exit 1
fi
mv "$tmp" "$out"
echo "backup ok: $out ($(du -h "$out" | cut -f1))"

# Delete backups older than KEEP_DAYS.
find "$BACKUP_DIR" -name 'mdc-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -print -delete | sed 's/^/pruned: /'
