#!/usr/bin/env bash
# ============================================================================
# 01-install.sh — Instala Supabase self-hosted (Docker) en el VPS de Contabo
# ----------------------------------------------------------------------------
# Uso:
#   DOMAIN=api.ayffica.com bash 01-install.sh
#
# Variables opcionales:
#   DOMAIN       Subdominio público del API (por defecto: api.ayffica.com)
#   SITE_URL     URL del portal (por defecto: https://portal.ayffica.com)
#   INSTALL_DIR  Carpeta del stack (por defecto: /opt/supabase)
#   PORTAL_DIR   Carpeta del repo del portal, para copiar las Edge Functions
#                (por defecto: /opt/portal)
# ============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-api.ayffica.com}"
SITE_URL="${SITE_URL:-https://portal.ayffica.com}"
INSTALL_DIR="${INSTALL_DIR:-/opt/supabase}"
SRC_DIR="${SRC_DIR:-/opt/supabase-src}"
PORTAL_DIR="${PORTAL_DIR:-/opt/portal}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 1. Docker --
log "1/7 · Verificando Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null

# ------------------------------------------------------- 2. Código oficial ---
log "2/7 · Descargando el stack oficial de Supabase"
if [ ! -d "$SRC_DIR/.git" ]; then
  git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/supabase/supabase.git "$SRC_DIR"
fi
(cd "$SRC_DIR" && git sparse-checkout set docker >/dev/null)

# ------------------------------------------------------------- 3. Copiar ----
log "3/7 · Copiando el stack a $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -rn "$SRC_DIR/docker/." "$INSTALL_DIR/"
cd "$INSTALL_DIR"

# ---------------------------------------------------------- 4. Secretos -----
log "4/7 · Generando secretos"
[ -f .env ] || cp .env.example .env
if grep -q '^JWT_SECRET=your-super-secret' .env; then
  sh utils/generate-keys.sh --update-env >/dev/null
  echo "    Secretos generados en .env"
else
  echo "    .env ya tenía secretos; no se modifican"
fi

# --------------------------------------------------------- 5. Configurar ----
log "5/7 · Configurando URLs y dominio"
set_kv() {
  key="$1"; val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '\n%s=%s\n' "$key" "$val" >> .env
  fi
}

set_kv SUPABASE_PUBLIC_URL      "https://${DOMAIN}"
set_kv API_EXTERNAL_URL         "https://${DOMAIN}/auth/v1"
set_kv SITE_URL                 "$SITE_URL"
set_kv ADDITIONAL_REDIRECT_URLS "$SITE_URL"
set_kv PROXY_DOMAIN             "$DOMAIN"
set_kv DISABLE_SIGNUP           "true"
set_kv ENABLE_EMAIL_SIGNUP      "false"
set_kv ENABLE_EMAIL_AUTOCONFIRM "true"
set_kv PGRST_DB_SCHEMAS         "public,graphql_public"

# --------------------------------------------------- 6. Edge Functions ------
log "6/7 · Copiando Edge Functions del portal"
mkdir -p volumes/functions
if [ -d "$PORTAL_DIR/supabase/functions" ]; then
  for fn in "$PORTAL_DIR"/supabase/functions/*/; do
    [ -d "$fn" ] || continue
    name="$(basename "$fn")"
    mkdir -p "volumes/functions/$name"
    cp -f "$fn/index.ts" "volumes/functions/$name/index.ts"
    echo "    + $name"
  done
else
  echo "    AVISO: no se encontró $PORTAL_DIR/supabase/functions"
  echo "    Copia las funciones a mano en $INSTALL_DIR/volumes/functions/"
fi

# ------------------------------------------------------------- 7. Levantar --
log "7/7 · Levantando contenedores (puede tardar varios minutos)"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.caddy.yml"
$COMPOSE pull
$COMPOSE up -d

sleep 5
$COMPOSE ps

cat <<EOF

============================================================================
 LISTO. Guarda estos datos para configurar el portal (js/supabase.js)
============================================================================
SUPABASE_URL=https://${DOMAIN}
EOF
grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=' .env || true
cat <<EOF

Panel (Studio):  https://${DOMAIN}
Usuario:         $(grep -E '^DASHBOARD_USERNAME=' .env | cut -d= -f2-)
Contraseña:      $(grep -E '^DASHBOARD_PASSWORD=' .env | cut -d= -f2-)

Antes de abrir el panel:
  1) El DNS de ${DOMAIN} debe apuntar a la IP del VPS.
  2) El firewall debe permitir los puertos 80 y 443.

Siguiente paso:  bash 02-restore.sh /ruta/al/backup.gz
============================================================================
EOF
