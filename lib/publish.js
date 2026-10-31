import crypto from "node:crypto";
import { sb, fetchJSON, getConnection, saveConnection } from "./core.js";
import { tiktokRefreshIfNeeded } from "./providers.js";

/*
  Publicación en Instagram, Facebook y TikTok.

  Cada publicación guarda un estado por red (targets.ig / targets.fb / targets.tiktok) y avanza
  como máquina de estados: pending → processing → done | error. Así una red puede tardar
  (Instagram procesa los reels) o fallar sin bloquear a las demás, y el cron retoma lo pendiente.
*/

const GRAPH = "https://graph.facebook.com/v21.0";
const TT = "https://open.tiktokapis.com/v2";
export const BUCKET = "media";
export const NETS = ["ig", "fb", "tiktok"];
const MAX_IMAGES = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

/* ---------------- almacenamiento ---------------- */
let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const st = sb().storage;
  const { error } = await st.getBucket(BUCKET);
  if (error) {
    const r = await st.createBucket(BUCKET, { public: true });
    if (r.error && !/already exists/i.test(r.error.message)) throw r.error;
  }
  bucketReady = true;
}

export async function createUpload({ name, mime }) {
  if (!/^(image|video)\//.test(mime || "")) throw new Error("Solo imágenes o videos");
  await ensureBucket();
  const d = new Date();
  const ext = (String(name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1] || (mime.startsWith("video") ? "mp4" : "jpg")).toLowerCase();
  const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const { data, error } = await sb().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  const publicUrl = sb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return { path, uploadUrl: data.signedUrl, publicUrl };
}

/* ---------------- validación ---------------- */
export function validate({ media, targets, captions }) {
  if (!Array.isArray(media) || !media.length) throw new Error("Agrega al menos un archivo");
  const videos = media.filter((m) => m.type === "video"), images = media.filter((m) => m.type === "image");
  if (videos.length > 1 || (videos.length && images.length)) throw new Error("Sube un solo video, o de 1 a 10 imágenes");
  if (images.length > MAX_IMAGES) throw new Error(`Máximo ${MAX_IMAGES} imágenes por carrusel`);
  for (const m of media) if (!m.url || !m.path) throw new Error("Archivo incompleto, vuelve a subirlo");
  const nets = (targets || []).filter((n) => NETS.includes(n));
  if (!nets.length) throw new Error("Elige al menos una red");
  if (nets.includes("tiktok") && !videos.length) throw new Error("En TikTok por ahora solo se publican videos");
  const cap = (n) => (captions?.[n] ?? captions?.all ?? "");
  if (nets.includes("ig")) {
    if (cap("ig").length > 2200) throw new Error("El texto de Instagram pasa de 2,200 caracteres");
    if ((cap("ig").match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) throw new Error("Instagram acepta máximo 30 hashtags");
  }
  if (nets.includes("tiktok") && cap("tiktok").length > 2200) throw new Error("El texto de TikTok pasa de 2,200 caracteres");
  return nets;
}
const captionFor = (p, n) => (p.captions?.[n] ?? p.captions?.all ?? "").trim();
const kind = (p) => (p.media[0].type === "video" ? "video" : p.media.length > 1 ? "carousel" : "image");

/* ---------------- base de datos ---------------- */
export function validateTikTok(tt) {
  if (tiktokMode() !== "direct") return null;
  const o = tt || {};
  const PRIV = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
  if (!PRIV.includes(o.privacy)) throw new Error("TikTok: elige quién puede ver el video");
  if (o.disclose && !o.yourBrand && !o.branded) throw new Error("TikTok: indica si el contenido promociona tu marca, a un tercero o ambos");
  if (o.branded && o.privacy === "SELF_ONLY") throw new Error("TikTok: el contenido de marca de terceros no puede ser privado");
  return {
    privacy: o.privacy, allowComment: !!o.allowComment, allowDuet: !!o.allowDuet, allowStitch: !!o.allowStitch,
    disclose: !!o.disclose, yourBrand: !!(o.disclose && o.yourBrand), branded: !!(o.disclose && o.branded),
  };
}

export async function tiktokCreatorInfo() {
  let c = await getConnection("tiktok");
  if (!c) throw new Error("TikTok no está conectado");
  c = await tiktokRefreshIfNeeded(c);
  const d = (await ttPost("/post/publish/creator_info/query/", c.accessToken, {})).data || {};
  return {
    nickname: d.creator_nickname || "", username: d.creator_username || "", avatar: d.creator_avatar_url || "",
    privacyOptions: d.privacy_level_options || [],
    commentDisabled: !!d.comment_disabled, duetDisabled: !!d.duet_disabled, stitchDisabled: !!d.stitch_disabled,
    maxDuration: d.max_video_post_duration_sec || null,
  };
}

export async function createPublication({ media, captions, targets, scheduledAt, itemId, tiktok }) {
  const nets = validate({ media, targets, captions });
  const ttSettings = nets.includes("tiktok") ? validateTikTok(tiktok) : null;
  const row = {
    id: `pub_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`,
    status: "scheduled",
    scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : now(),
    item_id: itemId || null,
    media: media.map(({ path, url, type, mime, size, width, height, duration }) => ({ path, url, type, mime, size, width, height, duration })),
    captions: captions || {},
    targets: Object.fromEntries(nets.map((n) => [n, n === "tiktok" && ttSettings ? { status: "pending", settings: ttSettings } : { status: "pending" }])),
    created_at: now(), updated_at: now(),
  };
  const { error } = await sb().from("publications").insert(row);
  if (error) throw error;
  return row;
}

export async function listPublications(limit = 40) {
  const { data, error } = await sb().from("publications").select("*").order("scheduled_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data.map(publicView);
}
export const publicView = (p) => ({
  id: p.id, status: p.status, scheduledAt: p.scheduled_at, itemId: p.item_id, createdAt: p.created_at,
  media: (p.media || []).map(({ url, type }) => ({ url, type })), purged: !!p.media_purged,
  captions: p.captions,
  targets: Object.fromEntries(Object.entries(p.targets || {}).map(([n, t]) => [n, { status: t.status, permalink: t.permalink || null, error: t.error || null, note: t.note || null, privacy: t.settings?.privacy || null }])),
});

async function lock(id) {
  const until = new Date(Date.now() + 75e3).toISOString();
  const { data, error } = await sb().from("publications").update({ locked_until: until })
    .eq("id", id).or(`locked_until.is.null,locked_until.lt.${now()}`).select("*");
  if (error) throw error;
  return data?.[0] || null;
}
async function save(p, extra = {}) {
  const { error } = await sb().from("publications").update({ targets: p.targets, status: p.status, updated_at: now(), ...extra }).eq("id", p.id);
  if (error) throw error;
}

function overall(p) {
  const st = Object.values(p.targets).map((t) => t.status);
  if (st.some((s) => s === "pending" || s === "processing")) return st.every((s) => s === "pending") && new Date(p.scheduled_at) > new Date() ? "scheduled" : "processing";
  if (st.every((s) => s === "done")) return "done";
  return st.some((s) => s === "done") ? "partial" : "error";
}

/* ---------------- motor ---------------- */
// Avanza una publicación todo lo posible dentro del tiempo dado. Devuelve la vista pública.
export async function processPublication(id, budgetMs = 45e3) {
  const p = await lock(id);
  if (!p) { const { data } = await sb().from("publications").select("*").eq("id", id).maybeSingle(); return data ? publicView(data) : null; }
  const deadline = Date.now() + budgetMs;
  const ctx = {};
  try {
    for (let round = 0; ; round++) {
      let waiting = false;
      for (const n of Object.keys(p.targets)) {
        const t = p.targets[n];
        if (t.status !== "pending" && t.status !== "processing") continue;
        try {
          const before = JSON.stringify(t);
          await STEP[n](p, t, ctx);
          if (t.status === "processing") waiting = true;
          if (JSON.stringify(t) !== before) { p.status = overall(p); await save(p); }
        } catch (e) {
          t.status = "error"; t.error = humanError(n, e); t.failedAt = now();
          p.status = overall(p); await save(p);
        }
      }
      if (!waiting || Date.now() + 4e3 > deadline) break;
      await sleep(round < 3 ? 3e3 : 5e3);
    }
    p.status = overall(p);
    await save(p, { locked_until: null });
    if (p.item_id) await linkItem(p).catch(() => {});
  } catch (e) {
    await sb().from("publications").update({ locked_until: null }).eq("id", id);
    throw e;
  }
  return publicView(p);
}

export async function processDue(budgetMs = 50e3) {
  const start = Date.now();
  const { data, error } = await sb().from("publications").select("id")
    .in("status", ["scheduled", "processing"]).lte("scheduled_at", now()).order("scheduled_at").limit(5);
  if (error) throw error;
  const done = [];
  for (const { id } of data) {
    const left = budgetMs - (Date.now() - start);
    if (left < 8e3) break;
    done.push(await processPublication(id, left - 3e3).catch((e) => ({ id, error: e.message })));
  }
  await purgeOldMedia().catch(() => {});
  return done;
}

export async function retry(id) {
  const { data: p, error } = await sb().from("publications").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!p) throw new Error("No existe");
  if (p.media_purged) throw new Error("Los archivos ya se borraron; crea la publicación de nuevo");
  for (const t of Object.values(p.targets)) if (t.status === "error") {
    // Si ya se había creado algo a medias, lo dejamos para no duplicar solo cuando ya está publicado
    for (const k of ["error", "failedAt", "containerId", "children", "publishId"]) delete t[k];
    t.status = "pending";
  }
  p.scheduled_at = now();
  p.status = "processing";
  await save(p, { scheduled_at: p.scheduled_at });
  return processPublication(id);
}

export async function cancel(id) {
  const { data: p } = await sb().from("publications").select("*").eq("id", id).maybeSingle();
  if (!p) throw new Error("No existe");
  if (Object.values(p.targets).some((t) => t.status === "processing" || t.status === "done") || p.status === "done")
    throw new Error("Ya se empezó a publicar; no se puede cancelar");
  await removeFiles(p);
  const { error } = await sb().from("publications").delete().eq("id", id);
  if (error) throw error;
}

export async function remove(id) {
  const { data: p } = await sb().from("publications").select("*").eq("id", id).maybeSingle();
  if (!p) return;
  if (p.locked_until && new Date(p.locked_until) > new Date()) throw new Error("Se está publicando en este momento");
  await removeFiles(p);
  const { error } = await sb().from("publications").delete().eq("id", id);
  if (error) throw error;
}

async function removeFiles(p) {
  const paths = (p.media || []).map((m) => m.path).filter(Boolean);
  if (paths.length && !p.media_purged) await sb().storage.from(BUCKET).remove(paths);
}

// Las redes ya descargaron los archivos: liberamos espacio de Supabase 7 días después.
async function purgeOldMedia() {
  const before = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data } = await sb().from("publications").select("id,media,media_purged").in("status", ["done", "partial", "error"])
    .lt("updated_at", before).is("media_purged", null).limit(20);
  for (const p of data || []) {
    await removeFiles(p).catch(() => {});
    await sb().from("publications").update({ media_purged: true }).eq("id", p.id);
  }
}

// Si la publicación viene de una pieza del calendario, la marcamos como publicada y la vinculamos.
async function linkItem(p) {
  const { data: it } = await sb().from("items").select("id,data").eq("id", p.item_id).maybeSingle();
  if (!it) return;
  const d = { ...it.data };
  const ig = p.targets.ig, fb = p.targets.fb, tt = p.targets.tiktok;
  const okAny = [ig, fb, tt].some((t) => t?.status === "done");
  let changed = false;
  if (okAny && d.stage !== "publicado") { d.stage = "publicado"; changed = true; }
  const link = ig?.status === "done" && ig.postId ? `ig:${ig.postId}` : fb?.status === "done" && fb.postId ? `fb:${fb.postId}` : null;
  if (link && !d.linkedPost) { d.linkedPost = link; changed = true; }
  if (okAny && !d.date) { d.date = new Date(Date.now() - 6 * 36e5).toISOString().slice(0, 10); changed = true; }
  const links = [ig, fb, tt].filter((t) => t?.permalink).map((t) => t.permalink);
  if (links.length && !String(d.notes || "").includes(links[0])) { d.notes = [d.notes, ...links].filter(Boolean).join("\n"); changed = true; }
  if (changed) { d.updatedAt = Date.now(); await sb().from("items").upsert({ id: it.id, data: d, updated_at: now() }); }
}

function humanError(n, e) {
  const raw = e?.body?.error?.error_user_msg || e?.body?.error?.message || e?.message || String(e);
  const code = e?.body?.error?.code;
  if (n !== "tiktok" && (code === 10 || code === 200 || /permission/i.test(raw))) return "Falta permiso de publicación: ve a Redes → Reconectar Instagram + Facebook y acepta todos los permisos.";
  if (n !== "tiktok" && code === 190) return "El acceso a Meta venció: ve a Redes → Reconectar.";
  if (n === "ig" && /aspect ratio/i.test(raw)) return "Instagram rechazó la proporción. Usa 9:16 para reels o entre 4:5 y 1.91:1 para imágenes.";
  if (n === "ig" && (code === 9 || /application request limit|25 posts/i.test(raw))) return "Instagram: llegaste al límite de publicaciones por API de las últimas 24 h.";
  return raw.slice(0, 300);
}

/* ---------------- META helpers ---------------- */
async function metaCtx(ctx) {
  if (ctx.meta) return ctx.meta;
  const c = await getConnection("meta");
  if (!c) throw new Error("Instagram + Facebook no está conectado (Redes → Conectar).");
  return (ctx.meta = c);
}
const gpost = (path, params) => fetchJSON(`${GRAPH}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
const gget = (path, params) => fetchJSON(`${GRAPH}/${path}?${new URLSearchParams(params)}`);

/* ---------------- INSTAGRAM ---------------- */
async function igStep(p, t, ctx) {
  const c = await metaCtx(ctx);
  if (!c.ig) throw new Error("Tu página de Facebook no tiene un Instagram profesional vinculado.");
  const token = c.page.token, ig = c.ig.id, k = kind(p);

  // 1. Crear contenedores
  if (!t.containerId) {
    if (k === "carousel") {
      if (!t.children) {
        t.children = [];
        for (const m of p.media) {
          const r = await gpost(`${ig}/media`, { image_url: m.url, is_carousel_item: "true", access_token: token });
          t.children.push(r.id);
        }
        t.status = "processing";
        return;
      }
      for (const id of t.children) {
        const s = await gget(id, { fields: "status_code,status", access_token: token });
        if (s.status_code === "ERROR") throw new Error(`Instagram no pudo procesar una imagen del carrusel: ${s.status || ""}`);
        if (s.status_code !== "FINISHED") { t.status = "processing"; return; }
      }
      const r = await gpost(`${ig}/media`, { media_type: "CAROUSEL", children: t.children.join(","), caption: captionFor(p, "ig"), access_token: token });
      t.containerId = r.id;
    } else if (k === "video") {
      const r = await gpost(`${ig}/media`, { media_type: "REELS", video_url: p.media[0].url, caption: captionFor(p, "ig"), share_to_feed: "true", access_token: token });
      t.containerId = r.id;
    } else {
      const r = await gpost(`${ig}/media`, { image_url: p.media[0].url, caption: captionFor(p, "ig"), access_token: token });
      t.containerId = r.id;
    }
    t.status = "processing";
  }

  // 2. Esperar a que Instagram termine de procesar
  const s = await gget(t.containerId, { fields: "status_code,status", access_token: token });
  if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram no pudo procesar el archivo${s.status ? `: ${s.status}` : ""}. Revisa formato (MP4 H.264, 9:16) y duración.`);
  if (s.status_code === "PUBLISHED") { t.status = "done"; return; }
  if (s.status_code !== "FINISHED") { t.status = "processing"; t.note = "Instagram está procesando el video"; return; }

  // 3. Publicar
  const pub = await gpost(`${ig}/media_publish`, { creation_id: t.containerId, access_token: token });
  t.postId = pub.id;
  t.status = "done"; t.publishedAt = now(); delete t.note;
  try { t.permalink = (await gget(pub.id, { fields: "permalink", access_token: token })).permalink; } catch {}
}

/* ---------------- FACEBOOK ---------------- */
async function fbStep(p, t, ctx) {
  const c = await metaCtx(ctx);
  const token = c.page.token, page = c.page.id, k = kind(p), msg = captionFor(p, "fb");
  if (k === "video") {
    const r = await gpost(`${page}/videos`, { file_url: p.media[0].url, description: msg, published: "true", access_token: token });
    t.postId = r.id; t.permalink = `https://www.facebook.com/${page}/videos/${r.id}`;
  } else if (k === "image") {
    const r = await gpost(`${page}/photos`, { url: p.media[0].url, message: msg, published: "true", access_token: token });
    t.postId = r.post_id || r.id; t.permalink = `https://www.facebook.com/${t.postId}`;
  } else {
    t.photoIds = t.photoIds || [];
    for (let i = t.photoIds.length; i < p.media.length; i++) {
      const r = await gpost(`${page}/photos`, { url: p.media[i].url, published: "false", access_token: token });
      t.photoIds.push(r.id);
    }
    const r = await gpost(`${page}/feed`, { message: msg, attached_media: JSON.stringify(t.photoIds.map((id) => ({ media_fbid: id }))), access_token: token });
    t.postId = r.id; t.permalink = `https://www.facebook.com/${r.id}`;
  }
  t.status = "done"; t.publishedAt = now();
}

/* ---------------- TIKTOK ---------------- */
export const tiktokMode = () => (process.env.TIKTOK_POST_MODE === "direct" ? "direct" : "inbox");
export const tiktokPublishEnabled = () => process.env.TIKTOK_PUBLISH === "1";

async function ttPost(path, token, body) {
  return fetchJSON(`${TT}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
}

async function tiktokStep(p, t, ctx) {
  if (!tiktokPublishEnabled()) throw new Error("La publicación en TikTok aún no está activada (ver README, sección TikTok).");
  let c = ctx.tiktok || await getConnection("tiktok");
  if (!c) throw new Error("TikTok no está conectado (Redes → Conectar).");
  c = ctx.tiktok = await tiktokRefreshIfNeeded(c);
  const scopes = String(c.scope || "");
  const mode = tiktokMode();
  const need = mode === "direct" ? "video.publish" : "video.upload";
  if (!scopes.includes(need)) throw new Error(`Falta el permiso ${need} de TikTok: actívalo en tu app de TikTok y reconecta en Redes.`);

  if (!t.publishId) {
    // Bajamos el video de Supabase y lo subimos a TikTok en una sola parte (Supabase gratis limita a 50 MB).
    const res = await fetch(p.media[0].url);
    if (!res.ok) throw new Error("No se pudo leer el video guardado");
    const buf = Buffer.from(await res.arrayBuffer());
    const size = buf.length;
    if (size > 64 * 1024 * 1024) throw new Error("El video pesa más de 64 MB");
    const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 };
    let init;
    if (mode === "direct") {
      const set = t.settings;
      if (!set?.privacy) throw new Error("TikTok: falta elegir la privacidad; crea la publicación de nuevo");
      const info = (await ttPost("/post/publish/creator_info/query/", c.accessToken, {})).data || {};
      const opts = info.privacy_level_options || [];
      if (opts.length && !opts.includes(set.privacy)) throw new Error("TikTok ya no permite esa privacidad para tu cuenta; elige otra");
      if (info.max_video_post_duration_sec && p.media[0].duration && p.media[0].duration > info.max_video_post_duration_sec)
        throw new Error(`TikTok: tu cuenta permite videos de hasta ${info.max_video_post_duration_sec} s`);
      t.privacy = set.privacy;
      init = await ttPost("/post/publish/video/init/", c.accessToken, {
        post_info: {
          title: captionFor(p, "tiktok").slice(0, 2200), privacy_level: set.privacy,
          disable_comment: info.comment_disabled ? true : !set.allowComment,
          disable_duet: info.duet_disabled ? true : !set.allowDuet,
          disable_stitch: info.stitch_disabled ? true : !set.allowStitch,
          brand_content_toggle: !!set.branded, brand_organic_toggle: !!set.yourBrand,
        },
        source_info,
      });
    } else {
      init = await ttPost("/post/publish/inbox/video/init/", c.accessToken, { source_info });
    }
    const { publish_id, upload_url } = init.data || {};
    if (!publish_id || !upload_url) throw new Error("TikTok no devolvió dónde subir el video");
    const up = await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": p.media[0].mime === "video/quicktime" ? "video/quicktime" : "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` },
      body: buf,
    });
    if (!up.ok) throw new Error(`TikTok rechazó la subida (HTTP ${up.status})`);
    t.publishId = publish_id; t.mode = mode; t.status = "processing";
    return;
  }

  const s = (await ttPost("/post/publish/status/fetch/", c.accessToken, { publish_id: t.publishId })).data || {};
  if (s.status === "FAILED") throw new Error(`TikTok: ${s.fail_reason || "falló la publicación"}`);
  if (s.status === "SEND_TO_USER_INBOX") {
    t.status = "done"; t.publishedAt = now();
    t.note = "Está en tus borradores/bandeja de TikTok: ábrelo en la app y toca Publicar.";
    return;
  }
  if (s.status === "PUBLISH_COMPLETE") {
    t.status = "done"; t.publishedAt = now();
    const vid = s.publicaly_available_post_id?.[0];
    if (vid) { t.postId = String(vid); t.permalink = `https://www.tiktok.com/video/${vid}`; }
    if (t.privacy === "SELF_ONLY") t.note = "Publicado en privado: TikTok solo permite público cuando aprueba la auditoría de la app.";
    return;
  }
  t.status = "processing"; t.note = "TikTok está procesando el video";
}

const STEP = { ig: igStep, fb: fbStep, tiktok: tiktokStep };
export const _test = { STEP, overall, validate, humanError };
