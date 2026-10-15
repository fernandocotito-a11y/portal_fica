# FICA Portal · A y F FICA Asociados S.A.C.

Portal / ERP empresarial de **A y F FICA Asociados S.A.C.** (consultoría contable,
tributaria, inventarios y software empresarial).

> **Fase 1 — Core y Administración**: autenticación, control de roles y permisos
> (RBAC), panel administrativo con gestión de usuarios y estructura modular lista
> para conectar los futuros módulos (Planillas PLAME, SIRE, Compras/Ventas,
> Agentes de Retención, Declaraciones SUNAT y Reportes Gerenciales).

---

## 1. Requisitos

- **Node.js 14+** (solo para el servidor local de desarrollo; no hay dependencias npm).

No requiere instalación de paquetes: todo el frontend es **JavaScript estándar
(ES6+ / ES Modules) sin frameworks ni build step**.

---

## 2. Puesta en marcha

Los módulos ES6 deben servirse mediante **HTTP** (el navegador bloquea los
`import`/`export` con protocolo `file://`). Ejecuta desde la raíz del proyecto:

```bash
node server.js
# o bien
npm start
```

Abre **http://localhost:3000** en tu navegador.

> **Sin Node instalado (Windows)**: se incluye un servidor alternativo en PowerShell:
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 3000
> ```

> Si abres `index.html` con doble clic, se mostrará una pantalla con las
> instrucciones para iniciar el servidor (en lugar de errores de consola).

---

## 3. Credenciales por defecto

| Rol              | Correo              | Contraseña   |
| ---------------- | ------------------- | ------------ |
| Superadministrador | `admin@ayffica.com` | `Admin123*`  |

Estas credenciales se **siembran automáticamente** la primera vez que se carga la
aplicación y se almacenan en `LocalStorage`. Puedes restablecerlas borrando la
clave `fica.users.v1` desde las DevTools o limpiando el almacenamiento del sitio.

---

## 4. Roles y permisos (RBAC)

| Rol                | Descripción                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| **Superadministrador** | Acceso total: crea, lista, activa/desactiva y asigna módulos a usuarios secundarios. |
| **Usuario Secundario** | Acceso restringido únicamente a los módulos que el Superadministrador le habilite. |

- El **Panel Principal** siempre está disponible para cualquier usuario autenticado.
- **Gestión de Usuarios** es exclusivo del Superadministrador.
- El resto de módulos (Planillas, SIRE, Compras/Ventas, Retenciones, Declaraciones,
  Reportes) se asignan individualmente a cada usuario secundario.

---

## 5. Estructura de carpetas

```
Portal/
├── index.html              # Entrada de la SPA (carga el bundle y detecta file://)
├── server.js               # Servidor HTTP estático sin dependencias
├── package.json            # Scripts (npm start)
├── README.md
│
├── assets/
│   └── logo-ayf.png        # Logotipo corporativo (copia de la carpeta raíz)
│
├── css/                    # Sistema de diseño (paleta corporativa en :root)
│   ├── variables.css       # Tokens de color, tipografía, espaciado, sombras…
│   ├── base.css            # Reset y utilidades globales
│   ├── login.css           # Pantalla de autenticación
│   ├── layout.css          # Sidebar + header + área de contenido
│   ├── components.css      # Botones, formularios, tablas, badges, modales, toast
│   └── responsive.css      # Adaptación móvil / tablet
│
├── js/                     # Núcleo de la aplicación
│   ├── app.js              # Punto de entrada (bootstrap)
│   ├── config.js           # Identidad, roles, semilla y registro de módulos
│   ├── router.js           # Enrutador hash con protección de rutas (guards)
│   ├── layout.js           # "Shell" del panel (sidebar/header reutilizable)
│   └── utils.js            # Helpers: DOM, escape, validación, toast, íconos…
│
├── services/               # Capa de datos/servicios (sustituible por API real)
│   ├── storageService.js   # Abstracción de LocalStorage/SessionStorage
│   ├── userService.js      # CRUD de usuarios + semilla del superadmin
│   └── authService.js      # Sesión, login/logout y control de acceso (RBAC)
│
└── modules/                # Módulos de vista (carga diferida por el router)
    ├── login/login.js      # Autenticación
    ├── dashboard/dashboard.js  # Panel principal (métricas + accesos directos)
    ├── users/users.js      # Gestión de usuarios (CRUD + asignación de módulos)
    └── placeholder/module.js   # Maqueta de módulos futuros ("Próximamente")
```

---

## 6. Arquitectura

La aplicación es una **SPA modular desacoplada** en tres capas:

1. **Vista (`/modules`)** — Cada pantalla es un módulo ES6 que el enrutador carga
   de forma **diferida** (`import()` dinámico). Un módulo exporta
   `{ title, render(container, ctx) }`.
2. **Servicios (`/services`)** — Lógica de negocio y persistencia aislada. El
   resto del código solo habla con estos servicios, por lo que **migrar a una
   API/BD real** (backend REST + JWT) requiere reemplazar únicamente su
   implementación interna, sin tocar las vistas ni el router.
3. **Núcleo (`/js`)** — Enrutador con guards, layout compartido y utilidades.

### Flujo de autenticación y rutas

```
#/login       -> Solo invitados (si ya hay sesión, redirige a /dashboard)
#/dashboard   -> Requiere sesión
#/users       -> Requiere sesión + rol Superadministrador
#/module/:key -> Requiere sesión + permiso específico sobre el módulo
```

- La sesión se guarda en `sessionStorage` o `localStorage` según la opción
  **"Recordar sesión"**.
- Las contraseñas se almacenan con un **hash de demostración** (no criptográfico)
  para no guardarlas en texto plano; en producción debe usarse autenticación real
  en el backend (bcrypt/argon2 + JWT).

### Cómo añadir un módulo nuevo

Registra el módulo en `js/config.js` dentro del arreglo `MODULES`:

```js
{
  key: 'facturacion',
  name: 'Facturación',
  description: 'Módulo de facturación electrónica.',
  icon: ic('<path d="..."/>'),   // ícono SVG
  status: 'soon',                 // 'active' | 'config' | 'soon'
  adminOnly: false,
  group: 'operations',
}
```

Aparecerá automáticamente en el sidebar, el dashboard y el selector de permisos.
Para darle una vista propia, crea `modules/facturacion/facturacion.js` (o
`modules/<key>/<key>.js`) y añade su ruta en `js/router.js`.

---

## 7. Módulos (Fase 1)

| Módulo              | Estado                         |
| ------------------- | ------------------------------ |
| Panel Principal     | ✅ Activo                       |
| Gestión de Usuarios | ✅ Activo (CRUD + RBAC)         |
| Planillas (PLAME / T-Registro) | 🟡 Listo para configurar |
| SIRE (SUNAT)        | ⏳ Próximamente                 |
| Compras y Ventas    | ⏳ Próximamente                 |
| Agentes de Retención | ⏳ Próximamente                |
| Declaraciones SUNAT | ⏳ Próximamente                 |
| Reportes Gerenciales | ⏳ Próximamente                |

---

## 8. Tecnologías y decisiones

- **Vanilla JavaScript (ES6+)** con ES Modules: sin frameworks ni build step,
  mantiene el proyecto ligero y fácil de auditar.
- **HTML5 `<dialog>`** para modales (crear/editar usuario y confirmaciones).
- **CSS personalizado** con variables en `:root` que reflejan la identidad
  corporativa (marrones, crema, dorado, grafito).
- **Sin errores de consola** y diseño **responsive** (sidebar off-canvas en móvil).

---

## 9. Persistencia (Mock)

Toda la información se guarda en el navegador mediante `LocalStorage`:

| Clave              | Contenido                              |
| ------------------ | -------------------------------------- |
| `fica.users.v1`    | Colección de usuarios                  |
| `fica.session.v1`  | Sesión activa (o en `sessionStorage`)  |
| `fica.sidebar.collapsed` | Estado colapsado del sidebar     |

Esta capa está encapsulada en `services/storageService.js`, de modo que conectar
un backend real no afecta al resto del código.

---

## 10. Scripts

| Comando      | Descripción                                   |
| ------------ | --------------------------------------------- |
| `npm start`  | Inicia el servidor local en `:3000`           |
| `npm run dev`| Alias de `npm start`                          |
