#!/bin/bash
# Backup database booking lapangan ke file .dump
# Bisa dijalankan manual atau dijadwalkan via cron, misal setiap hari jam 2 pagi:
#   0 2 * * * /app/scripts/backup.sh >> /app/backups/backup.log 2>&1
set -e

# Muat variabel dari .env jika ada
if [ -f "$(dirname "$0")/../.env" ]; then
  export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILENAME="backup-booking-lapangan-${TIMESTAMP}.dump"

echo "[$(date)] Memulai backup ke ${BACKUP_DIR}/${FILENAME} ..."
pg_dump "$DATABASE_URL" -Fc -f "${BACKUP_DIR}/${FILENAME}"
echo "[$(date)] Backup selesai: ${FILENAME}"

# Hapus backup otomatis yang lebih tua dari 30 hari (backup manual tetap disimpan jika diberi nama lain)
find "$BACKUP_DIR" -name "backup-booking-lapangan-*.dump" -mtime +30 -delete
echo "[$(date)] Pembersihan backup lama (>30 hari) selesai."
