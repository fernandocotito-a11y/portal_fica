# Migración de Supabase Cloud → VPS propio (Contabo)

Runbook para sacar el portal de Supabase Cloud y dejarlo corriendo en el VPS
con **Supabase self-hosted** (Docker). La aplicación no cambia: solo se
actualiza la URL y la clave pública en `js/supabase.js`.

---

## 0. Diagnóstico del estado actual

| Comprobación | Resultado |
|---|---|
| DNS `kiogxgcrexgpgumfpgnq.supabase.co` | **NXDOMAIN** (Google DNS, Cloudflare DNS) |
| DNS `db.kiogxgcrexgpgumfpgnq.supabase.co` | **NXDOMAIN** |
| `portal.ayffica.com` | **HTTP 200** (GitHub Pages, funcionando) |
| Respaldo de la base | **`db_cluster-06-11-2026@23-16-00.backup.gz`** (388 KB, volcado completo) |

Un proyecto **pausado** de Supabase sigue resolviendo por DNS y devuelve error
HTTP. Que el nombre ya no exista significa que el proyecto fue **eliminado**.

> **Primero**: entra a <https://supabase.com/dashboard> y confirma si el
> proyecto aparece como *Paused* (se restaura con un clic) o ya no aparece.
> Si está pausado, restáuralo y no hace falta migrar de urgencia.

---

## 1. Inventario: qué usa el portal de Supabase

| Pieza | Detalle |
|---|---|
| **Auth** | email/contraseña, recuperación, invitaciones |
| **Tablas** | 23 en `public` (empresas, perfiles, compras, retenciones, planillas, declaraciones) |
| **Seguridad** | 30 políticas RLS + `is_superadmin()` + `email_registered()` |
| **Triggers** | `on_auth_user_created` (crea el perfil al dar de alta) |
| **Edge Functions** | `sunat-sire`, `invite-user`, `sbs-rates` |
| **Storage / Realtime** | **no se usan** ✅ |

Solo dos archivos tienen la URL escrita a mano:

- `js/supabase.js` → `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INVITE_FUNCTION_URL`
- `modules/payroll/afpRatesService.js` → `SBS_FUNCTION_URL`

---

## 2. Requisitos del VPS

Contabo **Cloud VPS 4**: 4 vCPU · **8 GB RAM** · 100 GB SSD · Ubuntu.
Es más que suficiente (el stack completo consume ~3–4 GB).

---

## 3. DNS

Crea un registro **A** en el proveedor de DNS de `ayffica.com`:

```
api.ayffica.com  →  A  →  169.58.41.70
```

Sin este paso Caddy no puede emitir el certificado TLS.

---

## 4. Instalación

Conéctate por SSH como `root` y ejecuta:

```bash
# 1) Trae el repo del portal (contiene este runbook y las Edge Functions)
mkdir -p /opt/portal && cd /opt/portal
git clone https://github.com/fernandocotito-a11y/portal_fica.git .

# 2) Instala Supabase self-hosted
DOMAIN=api.ayffica.com PORTAL_DIR=/opt/portal bash deploy/01-install.sh
```

Al terminar, el script imprime:

- `SUPABASE_URL` (p. ej. `https://api.ayffica.com`)
- `ANON_KEY`
- `SERVICE_ROLE_KEY`
- Usuario y contraseña del panel Studio

**Guarda esos valores.**

---

## 5. Restaurar los datos

```bash
cd /opt/portal
bash deploy/02-restore.sh "/opt/portal/db_cluster-06-11-2026@23-16-00.backup.gz"
```

El script:

1. Descomprime el volcado.
2. Filtra **solo** el esquema `public` + los usuarios de `auth`
   (`deploy/filter-dump.py`).
3. Lo carga en `supabase-db`.
4. Reinicia Auth y REST.
5. Muestra un resumen de filas restauradas.

Comprobación esperada (datos del 06/11/2026):

```
empresas: 8
perfiles: 4
comprobantes: 2619
usuarios auth: 4
```

---

## 6. Apuntar el portal al VPS

Edita `js/supabase.js`:

```js
export const SUPABASE_URL = 'https://api.ayffica.com';
export const SUPABASE_ANON_KEY = '<ANON_KEY del paso 4>';

export const INVITE_FUNCTION_URL =
  'https://api.ayffica.com/functions/v1/invite-user';
```

> De paso corrige el nombre de la función: el código apuntaba a
> `super-action`, que no existe. La función real es **`invite-user`**.

Luego:

```bash
git add js/supabase.js
git commit -m "Apuntar el portal al Supabase self-hosted del VPS"
git push origin main
```

GitHub Pages publica el cambio en 1–2 minutos.

---

## 7. Edge Functions

El script de instalación ya copia `sunat-sire`, `invite-user` y `sbs-rates` a
`/opt/supabase/volumes/functions/`. Para actualizarlas más adelante:

```bash
cd /opt/portal && git pull
cp -r supabase/functions/* /opt/supabase/volumes/functions/
docker restart supabase-edge-functions
```

Comprobación rápida:

```bash
curl -i https://api.ayffica.com/functions/v1/sbs-rates
```

Debe responder (no 404). Si devuelve JSON con `period` y `rows`, la lectura de
la SBS funciona.

---

## 8. Respaldos automáticos

```bash
chmod +x /opt/portal/deploy/03-backup.sh
mkdir -p /opt/backups

# Prueba manual
bash /opt/portal/deploy/03-backup.sh

# Cron diario a las 03:00
(crontab -l 2>/dev/null; echo "0 3 * * * bash /opt/portal/deploy/03-backup.sh >> /var/log/fica-backup.log 2>&1") | crontab -
```

Además, activa el **Auto Backup** de Contabo (complemento) para tener copia a
nivel de servidor.

---

## 9. Correo (invitaciones y recuperación de contraseña)

Supabase self-hosted no envía correos sin SMTP. Dos opciones:

**A. Sin SMTP (recomendada para 4 usuarios)**
El superadmin crea los usuarios y fija la contraseña desde
*Studio → Authentication → Users*. No se envían correos.

**B. Con SMTP** (Resend, Brevo o Gmail). En `/opt/supabase/.env`:

```env
SMTP_ADMIN_EMAIL=no-reply@ayffica.com
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<api-key>
SMTP_SENDER_NAME=A y F FICA
```

```bash
cd /opt/supabase && docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

---

## 10. Verificación final

1. Abre `https://api.ayffica.com` → panel Studio (pide usuario y contraseña) con datos.
2. Abre `https://portal.ayffica.com` → inicia sesión.
3. Revisa: Compras, Retenciones, Planillas, Declaraciones, Reportes.
4. Prueba *Planillas → Parámetros AFP → Actualizar desde la SBS*.
5. Prueba la exportación CSV y PDF de Reportes.

---

## Comandos útiles

```bash
cd /opt/supabase

# Estado
docker compose -f docker-compose.yml -f docker-compose.caddy.yml ps

# Logs de un servicio
docker logs -f --tail 100 supabase-auth

# Reiniciar todo
docker compose -f docker-compose.yml -f docker-compose.caddy.yml restart

# Actualizar imágenes (hacer respaldo antes)
bash /opt/portal/deploy/03-backup.sh
docker compose -f docker-compose.yml -f docker-compose.caddy.yml pull
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d

# Entrar a Postgres
docker exec -it supabase-db psql -U postgres -d postgres
```

---

## Plan de contingencia

Si algo falla durante la migración, el portal sigue publicado en GitHub Pages.
Basta con revertir `js/supabase.js` al commit anterior para dejarlo como estaba.

```bash
git revert --no-edit <commit>
git push origin main
```
