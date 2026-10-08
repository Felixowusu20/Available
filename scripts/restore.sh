#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh into the Docker Compose database.
#
#   ./scripts/restore.sh backups/mdc-2026-10-08_023000.sql.gz
#
# THIS REPLACES THE CURRENT DATABASE CONTENTS. The script asks you to type the database name to
# confirm, and stops the app first so nothing writes while it restores.
#
# To rehearse a restore without touching live data, restore into a scratch database:
#   DB_NAME=mdc_restore_test ./scripts/restore.sh <file>     (create it first, see DEPLOYMENT.md)
set -euo pipefail

cd "$(dirname "$0")/.."
file="${1:-}"
[ -n "$file" ] && [ -f "$file" ] || { echo "usage: $0 <backup.sql.gz>" >&2; exit 2; }
gzip -t "$file" || { echo "that file is not a valid gzip backup" >&2; exit 1; }

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_USER="${DB_USER:-mdc}"
DB_NAME="${DB_NAME:-mdc}"

echo "About to restore '$file' into database '$DB_NAME', REPLACING its current contents."
if [ "${ASSUME_YES:-}" != "1" ]; then
  read -r -p "Type the database name ($DB_NAME) to continue: " answer
  [ "$answer" = "$DB_NAME" ] || { echo "cancelled"; exit 1; }
fi

echo "stopping the app..."
docker compose -f "$COMPOSE_FILE" stop app 2>/dev/null || true

echo "restoring..."
gunzip -c "$file" | docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --single-transaction -q

echo "restore finished; starting the app..."
docker compose -f "$COMPOSE_FILE" start app 2>/dev/null || true
echo "done. Check https://<your-domain>/api/health"
