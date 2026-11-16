#!/usr/bin/env bash
# ============================================================================
# 02-restore.sh — Restaura el respaldo de Supabase Cloud en el stack local
# ----------------------------------------------------------------------------
# Uso:
#   bash 02-restore.sh /opt/portal/db_cluster-06-11-2026@23-16-00.backup.gz
#
# Qué hace:
#   1. Descomprime el volcado.
#   2. Filtra solo el esquema `public` + los usuarios de `auth`.
#   3. Lo carga en el contenedor `supabase-db`.
#   4. Reinicia Auth y REST para que tomen los datos nuevos.
# ============================================================================
set -euo pipefail

BACKUP="${1:-}"
if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
  echo "Uso: bash 02-restore.sh /ruta/al/backup.gz"
  exit 1
fi

INSTALL_DIR="${INSTALL_DIR:-/opt/supabase}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

cd "$INSTALL_DIR"

# ------------------------------------------------------ 1. Descomprimir -----
log "1/5 · Descomprimiendo respaldo"
gunzip -c "$BACKUP" > "$WORK/dump.sql"
echo "    $(wc -l < "$WORK/dump.sql") líneas"

# ---------------------------------------------------------- 2. Filtrar ------
log "2/5 · Filtrando (public + usuarios de Auth)"
python3 "$SCRIPT_DIR/filter-dump.py" "$WORK/dump.sql" "$WORK/restore.sql"

# ------------------------------------------------------- 3. Esperar a DB ----
log "3/5 · Esperando a que Postgres esté listo"
for i in $(seq 1 60); do
  if docker exec supabase-db pg_isready -U postgres >/dev/null 2>&1; then
    echo "    Postgres listo"
    break
  fi
  sleep 2
  [ "$i" -eq 60 ] && { echo "Postgres no respondió"; exit 1; }
done

# -------------------------------------------------------- 4. Restaurar ------
log "4/5 · Restaurando datos"
docker cp "$WORK/restore.sql" supabase-db:/tmp/restore.sql
set +e
docker exec -i supabase-db psql -U postgres -d postgres \
  -v ON_ERROR_STOP=0 -f /tmp/restore.sql 2>&1 | tail -n 40
STATUS=${PIPESTATUS[0]}
set -e
docker exec supabase-db rm -f /tmp/restore.sql >/dev/null 2>&1 || true

if [ "$STATUS" -ne 0 ]; then
  echo "    AVISO: psql terminó con código $STATUS (revisa los mensajes de arriba)."
fi

# --------------------------------------------------------- 5. Verificar -----
log "5/5 · Verificando y reiniciando servicios"
docker exec supabase-db psql -U postgres -d postgres -t -c \
  "select 'empresas: '||count(*) from public.companies
   union all select 'perfiles: '||count(*) from public.profiles
   union all select 'comprobantes: '||count(*) from public.tax_records
   union all select 'usuarios auth: '||count(*) from auth.users;"

docker restart supabase-auth supabase-rest >/dev/null
sleep 3

cat <<'EOF'

============================================================================
 Restauración finalizada.
 Comprueba en el panel (Studio -> Table Editor) que los datos aparecen.
 Si las contraseñas de los usuarios no funcionan, restablece cada una desde
 Studio -> Authentication -> Users -> (usuario) -> Reset password.
============================================================================
EOF
