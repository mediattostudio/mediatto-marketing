import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

let _sb;
export function sb() {
  if (!_sb) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY");
    _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  }
  return _sb;
}

export const appUrl = () => (process.env.APP_URL || "").replace(/\/$/, "");

/* ---------- sesión (una sola persona, contraseña) ---------- */
const COOKIE = "mm_session";
const sign = (v) => crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev").update(v).digest("base64url");

export function makeSession(days = 60) {
  const exp = Date.now() + days * 864e5;
  const v = `ok.${exp}`;
  return `${v}.${sign(v)}`;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function getCookie(req, name) { return parseCookies(req)[name]; }

export function isAuthed(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const v = `${parts[0]}.${parts[1]}`;
  const good = sign(v);
  if (good.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(parts[2]))) return false;
  return Number(parts[1]) > Date.now();
}

export function setCookie(res, name, value, maxAgeSec) {
  const prev = res.getHeader("Set-Cookie");
  const c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
  res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : c);
}
export const sessionCookie = (res, value, maxAge) => setCookie(res, COOKIE, value, maxAge);

export function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  res.status(401).json({ error: "No has iniciado sesión" });
  return false;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const randomState = () => crypto.randomBytes(16).toString("hex");

/* ---------- conexiones ---------- */
export async function getConnection(provider) {
  const { data, error } = await sb().from("connections").select("data").eq("provider", provider).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}
export async function saveConnection(provider, data) {
  const { error } = await sb().from("connections").upsert({ provider, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}
export async function deleteConnection(provider) {
  const { error } = await sb().from("connections").delete().eq("provider", provider);
  if (error) throw error;
}

export async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok || body.error && (body.error.message || body.error.code && body.error.code !== "ok")) {
    let msg = body.error?.message || body.error_description || body.error?.code || `HTTP ${r.status}`;
    const code = typeof body.error?.code === "string" ? body.error.code : "";
    if (code === "unaudited_client_can_only_post_to_private_accounts") msg = "TikTok: mientras la app no esté aprobada solo puede publicar en cuentas privadas. Pon tu cuenta de TikTok como privada y reintenta.";
    else if (code && !msg.includes(code)) msg = `${msg} [${code}]`;
    const e = new Error(msg); e.status = r.status; e.body = body; throw e;
  }
  return body;
}

export function redirect(res, to) { res.statusCode = 302; res.setHeader("Location", to); res.end(); }
