# Mediatto Marketing

App web de marketing de Mediatto Studio: calendario de contenido, pipeline de producción, guiones con teleprompter, métricas por pieza, conexión directa con Instagram, Facebook y TikTok, y **publicación en las 3 redes desde un solo lugar** (ahora o programada).

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

**Permisos para publicar:** la app pide además `instagram_content_publish` y `pages_manage_posts`. Si ya estabas conectado antes de la pestaña Publicar, ve a **Redes → Reconectar** y acepta todo. En modo desarrollo funcionan sin revisión de Meta porque eres administrador de la app.

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

> En sandbox solo tu cuenta puede conectarse, que es justo lo que necesitas.

### Publicar en TikTok (cuando lo actives)

1. En tu app de TikTok agrega el producto **Content Posting API** y activa el scope `video.upload` (llega a tus borradores) y, si quieres publicar directo, `video.publish` con **Direct Post** activado.
2. En Vercel agrega `TIKTOK_PUBLISH=1`. Para publicación directa agrega también `TIKTOK_POST_MODE=direct` (si no, usa borradores).
3. **Redeploy** → **Redes → Reconectar** en TikTok.

- **Borradores (default):** el video llega a tu bandeja de TikTok y solo tocas Publicar en la app. Funciona sin auditoría.
- **Directo:** mientras TikTok no audite tu app, los videos salen **en privado**. Para que salgan públicos hay que pedir la auditoría en el portal de TikTok (piden un video demo de la app y la política de privacidad, que ya está en `/privacidad`).
- Por ahora en TikTok solo se publican videos (las fotos requieren otro flujo).

## 5. Publicar en redes — 5 min

1. En Supabase → **SQL Editor** abre `supabase/publicar.sql`, cambia `TU_CRON_SECRET` por tu valor de `CRON_SECRET` de Vercel y dale **Run**. Crea la tabla de publicaciones y un reloj cada 5 minutos que publica lo programado (Vercel gratis solo permite un cron al día).
2. **Redes → Reconectar** Instagram + Facebook para dar los permisos de publicar.
3. Listo: pestaña **Publicar**.

**Cómo funciona:** el archivo se sube directo del cel a Supabase Storage (bucket público `media`, se crea solo). Las redes lo descargan de ahí. A los 7 días de publicado se borra para no llenar el espacio gratis (1 GB).

**Formatos:**
- **Video (reel):** MP4 vertical 9:16, 1080×1920, de 3 s a 15 min, hasta 50 MB (límite de Supabase gratis). Se publica como Reel en Instagram, video en Facebook y video en TikTok.
- **Imágenes:** de 1 a 10. Se convierten solas a JPEG (Instagram no acepta PNG). Ideal 4:5 (1080×1350). Con 2 o más es carrusel en Instagram y post con varias fotos en Facebook.
- Instagram: máximo 2,200 caracteres, 30 hashtags y 25 publicaciones por API cada 24 h.

Cada red se publica por separado: si una falla, las demás salen igual y puedes darle **Reintentar** solo a la que falló.

---

## Cómo se usa

- **Inicio:** tu semana, avance del pipeline, lo que sigue y lo atrasado.
- **Calendario:** arrastra piezas entre días (lap). En cel toca un día para ver lo programado.
- **Pipeline:** Idea → Guion → Grabar → Editar → Listo → Publicado. Arrastra las tarjetas.
- **Guiones:** escribe hook, guion, CTA y keyword. Botón **Teleprompter** para grabar.
- **Métricas:** resultados de tus piezas publicadas. En cada pieza, el campo **Publicación vinculada** la conecta con su post real y los números se llenan solos. Leads y seguidores ganados los capturas tú.
- **Publicar:** sube un video o imágenes, elige redes, escribe el texto (uno general o distinto por red) y publica ahora o programa. Si eliges una pieza del calendario, se marca como publicada y se vincula sola. También desde cualquier pieza con el botón **Publicar**.
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
  publish                Subir archivos, publicar, programar y cola
lib/                     Supabase, sesión y lógica de cada red
lib/publish.js           Motor de publicación (Instagram, Facebook, TikTok)
supabase/schema.sql      Tablas
supabase/publicar.sql    Tabla de publicaciones + reloj de 5 min
vercel.json              Cron diario
```
