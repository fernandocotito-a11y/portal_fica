#!/usr/bin/env bash
# ============================================================================
# 03-backup.sh — Respaldo diario de la base de datos
# ----------------------------------------------------------------------------
# Uso manual:   bash 03-backup.sh
# Cron diario:  0 3 * * * bash /opt/supabase/deploy/03-backup.sh
#
# Guarda /opt/backups/fica-AAAAMMDD-HHMMSS.sql.gz y borra los de más de 30 días.
# ============================================================================
set -euo pipefail

DEST="${DEST:-/opt/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
mkdir -p "$DEST"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/fica-$STAMP.sql.gz"

docker exec supabase-db pg_dumpall -U postgres | gzip > "$OUT"
echo "Respaldo creado: $OUT ($(du -h "$OUT" | cut -f1))"

find "$DEST" -name 'fica-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "Respaldos conservados: $(find "$DEST" -name 'fica-*.sql.gz' | wc -l)"
