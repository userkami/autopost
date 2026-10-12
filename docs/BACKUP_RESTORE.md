# Backup and Restore Documentation

## Backup

The backup script (`scripts/backup.sh`) creates a compressed SQL dump of the PostgreSQL database.

### Cron Schedule
```bash
# Runs daily at 3 AM UTC
0 3 * * * /app/scripts/backup.sh
```

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `db` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `autoblog` | Database name |
| `DB_USER` | `autoblog` | Database user |
| `BACKUP_RETENTION_DAYS` | `7` | Days to keep backups |

### Manual Backup
```bash
docker compose exec app /app/scripts/backup.sh
```

## Restore

### From Backup File
```bash
# 1. Stop the app and worker to prevent new writes
docker compose stop app worker

# 2. Restore from backup
gunzip -c /backups/autoblog_20260115_030000.sql.gz | docker compose exec -T db psql -U autoblog -d autoblog

# 3. Run migrations (in case schema changed since backup)
docker compose exec app npm run db:migrate

# 4. Restart services
docker compose start app worker
```

### Point-in-Time Recovery (if using WAL)
If PostgreSQL is configured with WAL archiving:
```bash
# Use pg_basebackup + WAL replay for point-in-time recovery
```

## Verify Backup Integrity
```bash
# Test restore to a temporary database
docker compose exec db createdb -U autoblog test_restore
gunzip -c /backups/autoblog_20260115_030000.sql.gz | docker compose exec -T db psql -U autoblog -d test_restore
docker compose exec db psql -U autoblog -d test_restore -c "SELECT count(*) FROM users;"
docker compose exec db dropdb -U autoblog test_restore
```

## Monitoring
- Check backup logs: `docker compose logs app | grep backup`
- Verify backup size is reasonable (not 0 bytes)
- Set up alerting if backup cron fails