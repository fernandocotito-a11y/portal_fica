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
   empresa inicial). Si ya lo habías ejecutado, añade la columna `email`:

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
│   └── placeholder/        # Maqueta de módulos futuros
│
└── supabase/
    ├── schema.sql          # Tablas, RLS y semilla
    └── functions/invite-user/  # Edge Function de invitación por correo
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
| SIRE, Compras/Ventas, Retenciones, Declaraciones, Reportes | ⏳ Próximamente |

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
