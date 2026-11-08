import crypto from "node:crypto";
import { sb, fetchJSON, getConnection, appUrl } from "./core.js";

const GRAPH = "https://graph.facebook.com/v21.0";

// "Plafón 👇" → "plafon"
export const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
export function matches(text, keyword) {
  const k = norm(keyword); if (!k) return false;
  const t = ` ${norm(text)} `;
  return t.includes(` ${k} `);
}

export function validSignature(raw, header) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header) return false;
  const want = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(want), b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Suscribe la página para que Meta nos mande comentarios (Facebook) y eventos de Instagram
export async function subscribePage(conn) {
  const token = conn.page.token;
  return fetchJSON(`${GRAPH}/${conn.page.id}/subscribed_apps?subscribed_fields=feed,messages&access_token=${token}`, { method: "POST" });
}

async function loadAutomatedItems() {
  const { data, error } = await sb().from("items").select("id,data");
  if (error) throw error;
  return data.map((r) => ({ ...r.data, id: r.id })).filter((i) => i.automation?.on && i.keyword);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function dmPayload(auto, eventId) {
  const buttons = (auto.buttons || []).filter((b) => b.label && b.url).slice(0, 3).map((b, k) => ({
    type: "web_url", title: b.label.slice(0, 20),
    url: `${appUrl()}/api/automations?r=${encodeURIComponent(eventId)}&b=${k}`,
  }));
  const text = (auto.dm || "").slice(0, 640);
  if (!buttons.length) return { text };
  return { attachment: { type: "template", payload: { template_type: "button", text, buttons } } };
}

async function sendPrivateReply(conn, commentId, payload) {
  const token = conn.page.token;
  const body = JSON.stringify({ recipient: { comment_id: commentId }, message: payload });
  return fetchJSON(`${GRAPH}/${conn.page.id}/messages?access_token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
}

async function publicReply(conn, provider, commentId, text) {
  const token = conn.page.token;
  const path = provider === "ig" ? `${commentId}/replies` : `${commentId}/comments`;
  return fetchJSON(`${GRAPH}/${path}?${new URLSearchParams({ message: text, access_token: token })}`, { method: "POST" });
}

// Procesa un comentario nuevo de Instagram o Facebook
export async function handleComment({ provider, commentId, mediaId, text, fromId, fromName }) {
  const conn = await getConnection("meta");
  if (!conn) return { skip: "sin conexión" };
  if (fromId && (fromId === conn.ig?.id || fromId === conn.page.id)) return { skip: "comentario propio" };
  const items = await loadAutomatedItems();
  const linkId = `${provider}:${mediaId}`;
  const item = items.find((i) => i.links?.[provider] === linkId && (i.automation.nets || ["ig", "fb"]).includes(provider) && matches(text, i.keyword));
  if (!item) return { skip: "sin automatización para este comentario" };

  const id = `${provider}:${commentId}`;
  const base = { id, provider, item_id: item.id, comment_id: commentId, user_id: fromId || null, user_name: fromName || null, text, created_at: new Date().toISOString() };
  // Un DM por comentario, y uno por persona en cada pieza
  const { data: dup } = await sb().from("automation_events").select("id,status").or(`id.eq.${id},and(item_id.eq.${item.id},user_id.eq.${fromId || "_"},status.eq.sent)`).limit(1);
  if (dup && dup.length) {
    if (dup[0].id !== id) await sb().from("automation_events").upsert({ ...base, status: "repeat" });
    return { skip: "repetido" };
  }
  await sb().from("automation_events").upsert({ ...base, status: "pending" });

  const auto = item.automation;
  let status = "sent", error = null;
  try { await sendPrivateReply(conn, commentId, dmPayload(auto, id)); }
  catch (e) {
    // Si la plantilla con botones falla, mandamos solo texto con los links
    try {
      const links = (auto.buttons || []).filter((b) => b.label && b.url).map((b, k) => `${b.label}: ${appUrl()}/api/automations?r=${encodeURIComponent(id)}&b=${k}`).join("\n");
      await sendPrivateReply(conn, commentId, { text: [auto.dm, links].filter(Boolean).join("\n\n").slice(0, 1000) });
    } catch (e2) { status = "error"; error = e2.message || e.message; }
  }
  const replies = String(auto.replies || "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (status === "sent" && replies.length) { try { await publicReply(conn, provider, commentId, pick(replies)); } catch { /* el DM ya salió */ } }
  await sb().from("automation_events").upsert({ ...base, status, error });
  return { status, error };
}

export async function stats() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data, error } = await sb().from("automation_events").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(1000);
  if (error) throw error;
  return data;
}

export async function trackClick(eventId, k) {
  const { data } = await sb().from("automation_events").select("*").eq("id", eventId).maybeSingle();
  if (!data) return null;
  const { data: it } = await sb().from("items").select("data").eq("id", data.item_id).maybeSingle();
  const url = it?.data?.automation?.buttons?.[k]?.url;
  if (!url) return null;
  const clicks = { ...(data.clicks || {}) }; clicks[k] = (clicks[k] || 0) + 1;
  await sb().from("automation_events").update({ clicks }).eq("id", eventId);
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}
