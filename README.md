# Mediatto Marketing

App web de marketing de Mediatto Studio: calendario de contenido, pipeline de producción, guiones con teleprompter, métricas por pieza y conexión directa con Instagram, Facebook y TikTok.

- **Hosting:** Vercel (gratis)
- **Base de datos:** Supabase (gratis)
- **Acceso:** una contraseña tuya
- **Estadísticas:** se actualizan solas cada día a las 6:00 am (hora Monterrey), o con el botón "Actualizar ahora"

---

## 1. Supabase (base de datos) — 5 min

1. Entra a [supabase.com](https://supabase.com) → **New project** → nómbralo `mediatto-marketing`.
2. Ve a **SQL Editor** → **New query**, pega todo el contenido de `supabase/schema.sql` y dale **Run**.
3. Ve a **Project Settings → API** y copia:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (la secreta) → `SUPABASE_SERVICE_KEY`

## 2. Vercel (publicar la app) — 5 min

1. Entra a [vercel.com](https://vercel.com) con tu GitHub → **Add New → Project** → elige el repo `mediatto-marketing`.
2. Framework: **Other**. No cambies nada más.
3. En **Environment Variables** agrega (ver `.env.example`):

| Variable | Valor |
|---|---|
| `APP_URL` | La URL que te dé Vercel, ej. `https://mediatto-marketing.vercel.app` |
| `APP_PASSWORD` | La contraseña para entrar a la app |
| `SESSION_SECRET` | Cualquier texto aleatorio largo (40+ caracteres) |
| `CRON_SECRET` | Otro texto aleatorio |
| `SUPABASE_URL` | Del paso 1 |
| `SUPABASE_SERVICE_KEY` | Del paso 1 |

4. **Deploy**. Ya puedes entrar con tu contraseña. Las variables de Meta y TikTok las agregas en los pasos 3 y 4 y luego haces **Redeploy**.

> En el cel: abre la URL en Safari → Compartir → **Agregar a inicio**. Queda como app.

## 3. Instagram + Facebook (Meta) — 10 min

**Antes:** tu Instagram debe ser cuenta **profesional** (empresa o creador) y estar **vinculada a tu página de Facebook** (Instagram → Configuración → Centro de cuentas, o desde la página de Facebook → Configuración → Cuentas vinculadas).

1. Entra a [developers.facebook.com](https://developers.facebook.com) → **Mis apps → Crear app**. Puedes reusar la app del CRM si quieres.
   - Caso de uso: **Otro** → tipo **Empresa**.
2. En la app agrega los productos **Inicio de sesión con Facebook para empresas** e **API de Instagram (con inicio de sesión con Facebook)**.
3. En **Inicio de sesión con Facebook → Configuración**, en **URI de redireccionamiento de OAuth válidos** pon:
   ```
   https://TU-URL.vercel.app/api/callback/meta
   ```
4. **Configuración → Básica:** copia el **Identificador de la app** → `META_APP_ID` y la **Clave secreta** → `META_APP_SECRET`. En **Dominios de la app** pon `TU-URL.vercel.app`.
5. Deja la app en **modo desarrollo**. Como eres administrador, puedes conectar tus propias cuentas sin revisión de Meta.
6. Agrega las variables en Vercel → **Redeploy** → en la app ve a **Redes → Conectar** en Instagram + Facebook. Acepta todas las páginas y permisos.

**Qué trae:** seguidores, publicaciones, reproducciones, alcance, likes, comentarios, guardados y compartidos de Instagram; seguidores, reacciones, comentarios y compartidos de Facebook.

**Permiso de 60 días:** Meta pide reconectar cada ~60 días. La app te avisa una semana antes en la pestaña Redes; solo tocas **Reconectar**.

## 4. TikTok — 10 min

1. Entra a [developers.tiktok.com](https://developers.tiktok.com) → **Manage apps → Connect an app**.
2. Llena el nombre (Mediatto Marketing), icono y categoría.
3. Agrega el producto **Login Kit** (plataforma **Web**). En **Redirect URI** pon:
   ```
   https://TU-URL.vercel.app/api/callback/tiktok
   ```
4. En **Scopes** activa: `user.info.basic`, `user.info.stats`, `video.list`.
5. Activa el modo **Sandbox**, y en **Sandbox settings → Target users** agrega tu cuenta de TikTok (@ de Mediatto).
6. Copia **Client key** → `TIKTOK_CLIENT_KEY` y **Client secret** → `TIKTOK_CLIENT_SECRET` (usa las del sandbox).
7. Agrega las variables en Vercel → **Redeploy** → **Redes → Conectar** en TikTok.

**Qué trae:** seguidores, likes totales, y por video: vistas, likes, comentarios y compartidos.

> En sandbox solo tu cuenta puede conectarse, que es justo lo que necesitas. Publicar o programar en TikTok desde la app sí requeriría revisión de TikTok.

---

## Cómo se usa

- **Inicio:** tu semana, avance del pipeline, lo que sigue y lo atrasado.
- **Calendario:** arrastra piezas entre días (lap). En cel toca un día para ver lo programado.
- **Pipeline:** Idea → Guion → Grabar → Editar → Listo → Publicado. Arrastra las tarjetas.
- **Guiones:** escribe hook, guion, CTA y keyword. Botón **Teleprompter** para grabar.
- **Métricas:** resultados de tus piezas publicadas. En cada pieza, el campo **Publicación vinculada** la conecta con su post real y los números se llenan solos. Leads y seguidores ganados los capturas tú.
- **Redes:** conexiones, seguidores con historial, mejores publicaciones y recientes por red.

## Estructura

```
public/index.html        App (interfaz)
api/                     Funciones del servidor (Vercel)
  login, logout, me      Acceso con contraseña
  items                  Piezas de contenido
  connect/[provider]     Inicia conexión con Meta o TikTok
  callback/[provider]    Regreso de Meta o TikTok
  connections            Estado de conexiones
  sync                   Descarga estadísticas (cron diario + botón)
  stats                  Publicaciones e historial para la app
lib/                     Supabase, sesión y lógica de cada red
supabase/schema.sql      Tablas
vercel.json              Cron diario
```
