# IBIZA studio

CRM de peluquería/barbería + agenda de turnos online, conectados a Supabase en tiempo real.

## Páginas

- `index.html` — agenda pública para que los clientes reserven turnos (servicio → barbero → día/hora → datos → confirmación).
- `crm.html` — panel de gestión: login de administrador y de barberos, panel general con KPIs, pipeline del día, clientes, calendario, marketing (cumpleaños, riesgo de fuga, puntos) y configuración (servicios, precios, equipo, horario).

## Cómo funciona el login

No usa Supabase Auth: es un login simple guardado en la base de datos.

- **Administrador**: la primera vez que alguien entra con usuario `admin` y una contraseña, esa contraseña queda guardada para siempre. Login siguientes la comparan.
- **Barberos**: mismo esquema con PIN, por barbero.
- El administrador puede resetear el PIN de cualquier barbero desde *Configuración* (pide su propia contraseña para confirmar).
- Las contraseñas/PIN se guardan hasheados (pgcrypto) en tablas separadas sin acceso público — solo se puede verificar/cambiar a través de funciones de la base de datos.

⚠️ **Importante sobre seguridad**: como no hay un sistema de sesiones real (Supabase Auth), la clave de API pública (anon key) que usa el sitio tiene permiso de lectura/escritura sobre los datos de negocio (clientes, turnos, servicios, barberos, config) protegidos solo por RLS abierta — el login de la app es una puerta de uso, no una cerradura de la base de datos. Es un esquema razonable para una peluquería chica, pero no subas ahí información más sensible que la de un CRM de turnos.

## Supabase

Proyecto: `abyjxmdiifbvhhwezyuy` (https://abyjxmdiifbvhhwezyuy.supabase.co). El esquema completo (tablas, RLS, funciones de login, realtime) está aplicado como migración `ibiza_crm_schema`.

Tablas: `servicios`, `barberos`, `clientes`, `turnos`, `config` (públicas, con RLS), `admin_auth` y `barbero_auth` (privadas, sin acceso directo).

## Deploy

Sitio estático (sin build). En Netlify: publish directory = raíz del repo, sin build command.
