#!/bin/bash
# Pulihkan database dari file backup .dump
# PERINGATAN: perintah ini akan MENIMPA seluruh data yang ada saat ini di database.
#
# Pemakaian:
#   ./scripts/restore.sh /app/backups/backup-booking-lapangan-2026-07-20_02-00-00.dump
set -e

if [ -z "$1" ]; then
  echo "Pemakaian: ./scripts/restore.sh <path_file_backup.dump>"
  exit 1
fi

FILE="$1"
if [ ! -f "$FILE" ]; then
  echo "File backup tidak ditemukan: $FILE"
  exit 1
fi

if [ -f "$(dirname "$0")/../.env" ]; then
  export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

read -p "Ini akan MENIMPA seluruh data saat ini dengan isi backup. Lanjutkan? (ketik 'YAKIN' untuk melanjutkan): " KONFIRMASI
if [ "$KONFIRMASI" != "YAKIN" ]; then
  echo "Dibatalkan."
  exit 1
fi

echo "[$(date)] Memulihkan database dari $FILE ..."
pg_restore "$DATABASE_URL" --clean --if-exists "$FILE"
echo "[$(date)] Restore selesai."
