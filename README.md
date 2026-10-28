# FICA Portal · A y F FICA Asociados S.A.C.

Portal / ERP empresarial de **A y F FICA Asociados S.A.C.** (consultoría contable,
tributaria, inventarios y software empresarial).

> **Arquitectura**: SPA estática (Vanilla JS / ES Modules) + **Supabase** como
> backend (autenticación por email, base de datos PostgreSQL y envío de correos
> de invitación / recuperación de contraseña). Desplegado en GitHub Pages.

---

## 1. Requisitos

- **Node.js 14+** (solo para el servidor local de desarrollo; sin dependencias npm).
- Una cuenta y proyecto de **Supabase** (para autenticación, datos y correos).

---

## 2. Puesta en marcha (desarrollo local)

Los módulos ES6 deben servirse mediante **HTTP**. Ejecuta desde la raíz:

```bash
node server.js
# o: npm start
# sin Node (Windows): powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 3000
```

Abre **http://localhost:3000**.

---

## 3. Configuración de Supabase (una sola vez)

1. Crea un proyecto en **supabase.com** y copia **Project URL** y **anon key**
   (las dejo en `js/supabase.js`).
2. En **SQL Editor**, ejecuta `supabase/schema.sql` (crea tablas, RLS, trigger y
   empresa inicial), luego `supabase/payroll_schema.sql` (tablas del módulo de
   **Planillas**, aisladas por empresa) y `supabase/compras_schema.sql` (Registro
   de **Compras y Ventas / SIRE**, también aislado por empresa). Si ya habías
   ejecutado `compras_schema.sql`, ejecuta además
   `supabase/compras_suppliers_schema.sql` para crear el directorio de
   proveedores, `supabase/compras_exchange_rates_schema.sql` para los tipos de
   cambio SUNAT por fecha y `supabase/compras_glosa_schema.sql` para el campo
   **glosa** de cada comprobante. Para el módulo **Agentes de Retención**,
   ejecuta `supabase/retencion_schema.sql`. Si ya habías ejecutado el primero,
   añade la columna `email`:

   ```sql
   alter table public.profiles add column if not exists email text;

   create or replace function public.handle_new_user()
   returns trigger language plpgsql security definer set search_path = public as $$
   begin
     insert into public.profiles (id, name, email, role)
     values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email, 'secondary')
     on conflict (id) do nothing;
     return new;
   end;
   $$;

   update public.profiles p set email = u.email from auth.users u where u.id = p.id;
   ```

3. **Authentication → Users → Add user** con `admin@ayffica.com` (Auto Confirm),
   y promuévelo a superadmin:

   ```sql
   update public.profiles
   set role = 'superadmin', active = true, name = 'Administrador Principal'
   where id = (select id from auth.users where email = 'admin@ayffica.com');
   ```

4. **Authentication → URL Configuration**:
   - Site URL: `https://portal.ayffica.com`
   - Redirect URLs: añade `https://portal.ayffica.com/#/set-password`

5. Despliega la Edge Function que envía las invitaciones:

   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref <tu-project-ref>
   supabase functions deploy invite-user --no-verify-jwt
   ```

---

## 4. Flujo de acceso

| Rol | Cómo accede |
|---|---|
| **Superadministrador** (`admin@ayffica.com`) | Define su contraseña con **"¿Olvidaste tu contraseña?"**; el enlace llega a su correo. |
| **Usuario secundario** | El superadmin escribe su correo (Gmail/Hotmail/etc.) en *Gestión de Usuarios*; recibe una **invitación** con enlace para crear su contraseña. |

Después de autenticarse, el usuario elige una **empresa** (solo las que le fueron
asignadas) y entra al panel.

---

## 5. Roles, permisos y empresas

- **Superadministrador**: acceso total. Crea empresas y usuarios, y asigna a cada
  usuario secundario qué **módulos** y qué **empresas** puede ver.
- **Usuario secundario**: solo accede a los módulos y empresas asignados.

---

## 6. Estructura de carpetas

```
Portal/
├── index.html              # Entrada de la SPA
├── server.js / serve.ps1   # Servidor local de desarrollo (sin producción)
├── package.json
├── README.md
│
├── assets/logo-ayf.png     # Logotipo corporativo
├── css/                    # variables, base, login, layout, components, responsive
│
├── js/                     # Núcleo
│   ├── app.js              # Bootstrap (restaura sesión y arranca el router)
│   ├── supabase.js         # Cliente de Supabase (URL + anon key)
│   ├── config.js           # Identidad, roles y registro de módulos
│   ├── router.js           # Enrutador hash con guards
│   ├── layout.js           # "Shell" (sidebar + header)
│   └── utils.js            # Helpers, íconos, toast, confirm…
│
├── services/               # Capa de datos sobre Supabase
│   ├── authService.js      # Sesión, RBAC y contexto de empresa
│   ├── userService.js      # Usuarios (invitación + perfiles)
│   └── companyService.js   # Empresas (CRUD + caché)
│
├── modules/                # Vistas (carga diferida)
│   ├── login/login.js      # Login + "olvidé mi contraseña"
│   ├── set-password/       # Crear contraseña (invitación / reset)
│   ├── select-company/     # Selector de empresa
│   ├── dashboard/          # Panel principal
│   ├── users/              # Gestión de usuarios
│   ├── companies/          # Gestión de empresas
│   ├── payroll/            # Planillas (RRHH)
│   ├── compras/            # Registro de compras/ventas e importación SIRE
│   ├── retencion/          # Agentes de Retención / Percepción (SUNAT)
│   ├── sire/               # SIRE: conexión en línea con SUNAT
│   ├── declaraciones/      # Liquidación IGV / Renta (FV 621)
│   └── placeholder/        # Maqueta de módulos futuros
│
└── supabase/
    ├── schema.sql          # Tablas, RLS y semilla
    ├── payroll_schema.sql  # Tablas de Planillas
    ├── compras_schema.sql  # Tablas de Compras y Ventas / SIRE
    ├── compras_suppliers_schema.sql # Migración: directorio de proveedores
    ├── compras_exchange_rates_schema.sql # Migración: tipos de cambio SUNAT
    ├── compras_glosa_schema.sql # Migración: glosa / observación por comprobante
    ├── retencion_schema.sql # Tablas de Agentes de Retención / Percepción
    ├── sire_credentials_schema.sql # Credenciales de API SUNAT (por empresa)
    ├── declaraciones_schema.sql # Liquidación IGV / Renta (saldos y ajustes)
    └── functions/           # Edge Functions
        ├── invite-user/    # Invitación de usuarios por correo
        ├── sbs-rates/      # Parámetros AFP desde la SBS
        └── sunat-sire/     # Conexión con el API SIRE de SUNAT
```

---

## 7. Arquitectura

```
Frontend (GitHub Pages)  ──▶  Supabase
   portal.ayffica.com         • Auth (email/contraseña, reset, invitación)
                              • PostgreSQL (profiles, companies) con RLS
                              • Edge Function "invite-user" (service role)
```

- Los **getters** de `authService`/`companyService` son síncronos (leen un caché
  cargado al iniciar sesión); las **mutaciones** (login, CRUD) son asíncronas.
- El control de acceso se aplica en dos capas: **RLS en la base de datos** y
  **guards en el router** (`#/login`, `#/set-password`, `#/select-company`,
  `#/dashboard`, `#/users`, `#/companies`, `#/module/:key`).

### Añadir un módulo nuevo

Registra la entrada en `js/config.js` (arreglo `MODULES`); aparecerá en el
sidebar, el dashboard y el selector de permisos. Para una vista propia, crea
`modules/<key>/<key>.js` y añade su ruta en `js/router.js`.

---

## 8. Módulos (estado)

| Módulo | Estado |
|---|---|
| Panel Principal, Gestión de Usuarios, Gestión de Empresas | ✅ Activo |
| **Planillas** (remuneraciones, asistencias, CTS/grati, Renta 5ta, liquidaciones) | ✅ Activo |
| **Compras y Ventas** (importación SIRE ZIP/CSV, registro SUNAT editable, resumen IGV) | ✅ Activo |
| **Agentes de Retención** (importación de retenciones/percepciones SUNAT y reporte ordenado) | ✅ Activo |
| **SIRE** (conexión en línea con SUNAT para actualizar compras y ventas) | ✅ Activo |
| **Declaraciones SUNAT** (liquidación mensual IGV / Renta RMT, matriz anual y Ficha 621) | ✅ Activo |
| Reportes Gerenciales | ⏳ Próximamente |

### Compras y Ventas / SIRE

- Acepta varios **ZIP de SIRE** (con CSV o TXT dentro), **CSV directo** o **TXT**
  directo, de compras y/o ventas, y detecta el tipo automáticamente. Muestra una
  vista previa antes de importar y omite duplicados por período, documento, serie
  y número.
- Los comprobantes quedan en formato SUNAT editable (alta, edición, detalle y
  eliminación) y se pueden exportar a CSV con los encabezados SIRE y BOM UTF-8.
- El formulario de alta/edición trabaja con **Base gravada** y **Base no
  gravada**. La base gravada es el importe afecto al IGV; la base no gravada
  incluye exoneradas, inafectas, exportación, valor no gravado, otras bases no
  afectas y además **ISC**, **ICBPER** y otros cargos/tributos. El IGV se calcula
  automáticamente al 18% sobre la base gravada y también se registran **IVAP** y
  otros cargos.
- Cada comprobante admite una **glosa / observación** libre (el SIRE no la trae),
  que se guarda por documento, se muestra en el detalle y es buscable. Requiere
  la migración `compras_glosa_schema.sql` para guardarse en Supabase.
- Incluye un **directorio de proveedores** por empresa: alta, edición,
  eliminación, búsqueda, descarga de modelo CSV, importación de CSV/TXT y carga
  masiva pegando texto desde Excel. Al escribir el RUC en una compra, se completa
  automáticamente la razón social. Las importaciones SIRE también alimentan el
  directorio con los proveedores de compras.
- Incluye una pestaña **Tipo de Cambio** para cargar los tipos de cambio SUNAT
  por fecha (CSV/TXT, pegado desde Excel, alta manual y CRUD), para cualquier año.
  Al registrar un comprobante en moneda extranjera o importar el SIRE, el tipo de
  cambio se asigna automáticamente por fecha; si no hay tasa exacta se usa la
  última publicada antes de esa fecha. También permite aplicar el TC a
  comprobantes ya guardados que estén sin tipo de cambio.
- El **Resumen** consolida compras, ventas, base gravada, base no gravada, IGV y
  saldo mensual en soles, con selector de año (incluye años anteriores y el año
  actual). Los comprobantes en moneda extranjera usan su tipo de cambio o el TC
  SUNAT cargado; si no existe, la interfaz lo advierte para completarlo.
- Los importes que vienen del **SIRE ya están solarizados** (SUNAT los convierte
  a soles, aunque la columna "Moneda" indique la divisa original). El portal los
  respeta y **no** los vuelve a convertir: la moneda se muestra solo como
  referencia. La conversión con tipo de cambio aplica únicamente a los registros
  creados manualmente en moneda extranjera.
- Si `supabase/compras_schema.sql` todavía no se ejecutó, el módulo funciona en
  **modo local** con `localStorage` y muestra un aviso. El directorio de
  proveedores y los tipos de cambio tienen su propio aviso si faltan
  `compras_suppliers_schema.sql` o `compras_exchange_rates_schema.sql`. Al
  aplicar los esquemas, recarga el portal para pasar a Supabase multiusuario con
  RLS; los proveedores y tipos de cambio creados en modo local se migran
  automáticamente.
- La carpeta `sire/` contiene archivos de prueba privados y está en `.gitignore`;
  no se publica en el repositorio.

### Agentes de Retención / Percepción

- Importa el **Excel de SUNAT** (“Consulta de Comprobantes Emitidos/Recibidos” de
  Agentes de Retención/Percepción, `.xls`/`.xlsx`) o un CSV/TXT exportado.
- Detecta automáticamente **retenciones** y **percepciones**, y genera un reporte
  ordenado con: comprobante, agente, tasa, estado, documento, total, pagado,
  monto retenido/percibido y neto.
- Al volver a importar el mismo período, **omite lo ya importado** y agrega solo
  los registros nuevos (deduplicación por comprobante + documento + pago).
- Incluye **resumen mensual** por tipo y exportación CSV del reporte y del resumen.
- Aislado por empresa con RLS (`supabase/retencion_schema.sql`); si la tabla no
  existe todavía, funciona en modo local con `localStorage`.
- La carpeta `retencion/` contiene archivos de prueba privados y está en
  `.gitignore`.

### SIRE · Conexión SUNAT

- Permite **actualizar en línea** el Registro de Compras y Ventas usando el
  **Servicio Web API oficial del SIRE** de SUNAT (descarga la propuesta del
  período y fusiona solo los comprobantes nuevos).
- El flujo oficial es: `GET` de la propuesta → ticket → consulta de estado
  (`consultaestadotickets`, estados `01/03/06/07/08/10`) → descarga del ZIP
  (`archivoreporte`). La propuesta se pide en formato TXT (`codTipoArchivo=0`),
  que el importador lee con separador `|` (también acepta CSV).
- La **Configuración SUNAT** guarda `client_id`, `client_secret`, RUC, Usuario SOL
  (opcional) y Clave SOL por empresa en `supabase/sire_credentials_schema.sql`.
  El usuario del API se arma como **RUC + Usuario SOL** (sin separador). La Clave
  SOL **nunca** llega al navegador: la Edge Function `sunat-sire` la usa solo en
  el servidor.
- Requiere: ejecutar `supabase/sire_credentials_schema.sql` y desplegar la Edge
  Function `sunat-sire` (`supabase functions deploy sunat-sire --no-verify-jwt`,
  requiere la CLI de Supabase y estar autenticado con `supabase login`).
- La importación manual de ZIP/CSV/TXT sigue disponible como respaldo.

### Declaraciones SUNAT · Liquidación IGV / Renta

- Consolida los módulos de **Compras/Ventas** y **Retenciones/Percepciones** para
  calcular la **liquidación mensual de IGV y Renta (Formulario Virtual 621)**.
- **IGV**: base gravada 18% (16% IGV + 2% IPM) y 10% (Ley 31556). El impuesto
  preliminar (débito − crédito) se compensa en cascada con el **saldo a favor
  anterior**, luego **percepciones** y finalmente **retenciones**; los excedentes
  no aplicados se arrastran al siguiente periodo (casillas 164/165).
- **Renta (RMT)**: ingresos netos acumulados vs **300 UIT**; tasa 1.00% hasta el
  límite y 1.50% por encima (o coeficiente si se define).
- Vistas (pestañas):
  1. **Matriz anual** (Enero→Diciembre con totales). El IGV de ventas/compras es
     clicable y muestra su composición por tasa (18% / 10% / otras).
  2. **PDT 621**: formulario mensual con casillas SUNAT, listo para **copiar** o
     **imprimir** y pasar los datos a SUNAT.
  3. **Control de declaraciones**: fecha de vencimiento según cronograma SUNAT
     (último dígito del RUC), fecha real de declaración y **interés moratorio
     automático** (TIM 0.04% diario por día de atraso; editable manualmente).
  4. **Saldos de créditos**: arrastre mes a mes del crédito fiscal IGV y de las
     percepciones/retenciones no aplicadas.
- Los importes se recalculan siempre desde los módulos fuente; solo se guardan
  los datos manuales. Requiere ejecutar `supabase/declaraciones_schema.sql`
  (tablas `declaraciones_balances` y `tax_declaration_periods`, con RLS); si no
  existe, funciona en modo local con `localStorage`.

---

## 9. Scripts

| Comando | Descripción |
|---|---|
| `npm start` | Servidor local en `:3000` |
| `npm run dev` | Alias de `npm start` |

---

## 10. Seguridad

- La **anon key** (pública) vive en `js/supabase.js`; es pública por diseño.
- La **service_role key** (secreta) **nunca** va en el frontend: solo la usa la
  Edge Function (la recibe automáticamente como variable de entorno).
- No compartas ni guardes en el repo la `service_role key`; rótala desde
  **Project Settings → API Keys → Rotate** si se ha expuesto.
