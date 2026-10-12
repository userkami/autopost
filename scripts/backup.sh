#!/bin/bash
# Backup script for AutoBlog (PLAN.md §8)
# Runs via cron: 0 3 * * * /app/scripts/backup.sh
# Restore: psql -h db -U autoblog -d autoblog < backup_file.sql

set -euo pipefail

BACKUP_DIR="/backups"
DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-autoblog}"
DB_USER="${DB_USER:-autoblog}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/autoblog_$TIMESTAMP.sql.gz"

echo "[$(date)] Starting backup of $DB_NAME..."

# Create compressed backup
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date)] Backup completed: $BACKUP_FILE ($SIZE)"

  # Cleanup old backups
  find "$BACKUP_DIR" -name 'autoblog_*.sql.gz' -mtime +$RETENTION_DAYS -delete
  echo "[$(date)] Cleaned up backups older than $RETENTION_DAYS days"
else
  echo "[$(date)] Backup FAILED" >&2
  exit 1
fi