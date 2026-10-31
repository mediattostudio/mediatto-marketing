import { appUrl, fetchJSON, getConnection, saveConnection, sb } from "./core.js";

const GRAPH = "https://graph.facebook.com/v21.0";
export const META_SCOPES = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_manage_insights", "business_management"].join(",");
export const TIKTOK_SCOPES = ["user.info.basic", "user.info.stats", "video.list"].join(",");
export const metaRedirect = () => `${appUrl()}/api/callback/meta`;
export const tiktokRedirect = () => `${appUrl()}/api/callback/tiktok`;

/* ================= META ================= */
export function metaAuthUrl(state) {
  const p = new URLSearchParams({ client_id: process.env.META_APP_ID, redirect_uri: metaRedirect(), state, scope: META_SCOPES, response_type: "code" });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
}

export async function metaExchange(code) {
  const base = { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET };
  const short = await fetchJSON(`${GRAPH}/oauth/access_token?${new URLSearchParams({ ...base, redirect_uri: metaRedirect(), code })}`);
  const long = await fetchJSON(`${GRAPH}/oauth/access_token?${new URLSearchParams({ ...base, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token })}`);
  const userToken = long.access_token;
  const pages = await fetchJSON(`${GRAPH}/me/accounts?${new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url}", limit: "50", access_token: userToken,
  })}`);
  const list = (pages.data || []).map((p) => ({
    id: p.id, name: p.name, token: p.access_token,
    ig: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username, picture: p.instagram_business_account.profile_picture_url } : null,
  }));
  if (!list.length) throw new Error("Tu cuenta no tiene páginas de Facebook o no diste permiso a ninguna.");
  // Preferimos la página que tenga Instagram vinculado
  const page = list.find((p) => p.ig) || list[0];
  return {
    userToken,
    userTokenExpires: long.expires_in ? Date.now() + long.expires_in * 1000 : null,
    page: { id: page.id, name: page.name, token: page.token },
    ig: page.ig,
    pages: list.map(({ token, ...rest }) => rest),
    connectedAt: Date.now(),
  };
}

async function igMediaInsights(mediaId, token, productType) {
  const sets = productType === "STORY"
    ? ["reach,views,shares", "reach"]
    : ["reach,saved,shares,views,total_interactions", "reach,saved,shares", "reach,saved"];
  for (const metric of sets) {
    try {
      const r = await fetchJSON(`${GRAPH}/${mediaId}/insights?metric=${metric}&access_token=${token}`);
      const out = {};
      (r.data || []).forEach((m) => { out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0; });
      return out;
    } catch { /* probamos un set más chico */ }
  }
  return {};
}

export async function syncMeta() {
  const c = await getConnection("meta");
  if (!c) return { skipped: "meta no conectado" };
  const token = c.page.token;
  const result = { ig: 0, fb: 0 };
  const day = new Date().toISOString().slice(0, 10);

  // Página de Facebook
  try {
    const page = await fetchJSON(`${GRAPH}/${c.page.id}?fields=name,followers_count,fan_count&access_token=${token}`);
    await sb().from("account_snapshots").upsert({ provider: "fb", day, data: { name: page.name, followers: page.followers_count ?? page.fan_count ?? 0 } });
    const posts = await fetchJSON(`${GRAPH}/${c.page.id}/posts?${new URLSearchParams({
      fields: "id,message,created_time,permalink_url,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)", limit: "25", access_token: token,
    })}`);
    const rows = (posts.data || []).map((p) => ({
      id: `fb:${p.id}`, provider: "fb", posted_at: p.created_time,
      data: { caption: p.message || "", permalink: p.permalink_url, thumb: p.full_picture, type: "POST",
        likes: p.reactions?.summary?.total_count || 0, comments: p.comments?.summary?.total_count || 0, shares: p.shares?.count || 0 },
      updated_at: new Date().toISOString(),
    }));
    if (rows.length) { const { error } = await sb().from("social_posts").upsert(rows); if (error) throw error; }
    result.fb = rows.length;
  } catch (e) { result.fbError = e.message; }

  // Instagram
  if (c.ig) {
    try {
      const acc = await fetchJSON(`${GRAPH}/${c.ig.id}?fields=username,followers_count,media_count,profile_picture_url&access_token=${token}`);
      await sb().from("account_snapshots").upsert({ provider: "ig", day, data: { username: acc.username, followers: acc.followers_count, posts: acc.media_count, picture: acc.profile_picture_url } });
      const media = await fetchJSON(`${GRAPH}/${c.ig.id}/media?${new URLSearchParams({
        fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count", limit: "30", access_token: token,
      })}`);
      const rows = [];
      for (const m of media.data || []) {
        const ins = await igMediaInsights(m.id, token, m.media_product_type);
        rows.push({
          id: `ig:${m.id}`, provider: "ig", posted_at: m.timestamp,
          data: { caption: m.caption || "", permalink: m.permalink, thumb: m.thumbnail_url || (m.media_type === "VIDEO" ? null : m.media_url),
            type: m.media_product_type === "REELS" ? "REEL" : m.media_type === "CAROUSEL_ALBUM" ? "CARRUSEL" : m.media_type,
            likes: m.like_count || 0, comments: m.comments_count || 0,
            views: ins.views || 0, reach: ins.reach || 0, saves: ins.saved || 0, shares: ins.shares || 0 },
          updated_at: new Date().toISOString(),
        });
      }
      if (rows.length) { const { error } = await sb().from("social_posts").upsert(rows); if (error) throw error; }
      result.ig = rows.length;
    } catch (e) { result.igError = e.message; }
  }
  await saveConnection("meta", { ...c, lastSync: Date.now(), lastResult: result });
  return result;
}

/* ================= TIKTOK ================= */
export function tiktokAuthUrl(state) {
  const p = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, scope: TIKTOK_SCOPES, response_type: "code", redirect_uri: tiktokRedirect(), state });
  return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
}

async function tiktokToken(params) {
  const body = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, ...params });
  const t = await fetchJSON("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!t.access_token) throw new Error(t.error_description || "TikTok no devolvió token");
  return {
    accessToken: t.access_token, refreshToken: t.refresh_token, openId: t.open_id,
    expiresAt: Date.now() + (t.expires_in || 0) * 1000, refreshExpiresAt: Date.now() + (t.refresh_expires_in || 0) * 1000,
  };
}

export async function tiktokExchange(code) {
  const tok = await tiktokToken({ code, grant_type: "authorization_code", redirect_uri: tiktokRedirect() });
  const user = await tiktokUser(tok.accessToken);
  return { ...tok, user: { name: user.display_name, avatar: user.avatar_url }, connectedAt: Date.now() };
}

async function tiktokUser(token) {
  const r = await fetchJSON("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.data?.user || {};
}

export async function syncTikTok() {
  let c = await getConnection("tiktok");
  if (!c) return { skipped: "tiktok no conectado" };
  if (Date.now() > c.expiresAt - 5 * 60e3) {
    const fresh = await tiktokToken({ grant_type: "refresh_token", refresh_token: c.refreshToken });
    c = { ...c, ...fresh };
    await saveConnection("tiktok", c);
  }
  const result = {};
  try {
    const day = new Date().toISOString().slice(0, 10);
    const u = await tiktokUser(c.accessToken);
    await sb().from("account_snapshots").upsert({ provider: "tiktok", day, data: { username: u.display_name, followers: u.follower_count, likes: u.likes_count, posts: u.video_count, picture: u.avatar_url } });
    const fields = "id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count";
    const rows = [];
    let cursor, more = true, pages = 0;
    while (more && pages < 3) {
      const r = await fetchJSON(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
        method: "POST", headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
      });
      for (const v of r.data?.videos || []) {
        rows.push({
          id: `tiktok:${v.id}`, provider: "tiktok", posted_at: new Date(v.create_time * 1000).toISOString(),
          data: { caption: v.title || v.video_description || "", permalink: v.share_url, thumb: v.cover_image_url, type: "VIDEO",
            views: v.view_count || 0, likes: v.like_count || 0, comments: v.comment_count || 0, shares: v.share_count || 0 },
          updated_at: new Date().toISOString(),
        });
      }
      more = !!r.data?.has_more; cursor = r.data?.cursor; pages++;
    }
    if (rows.length) { const { error } = await sb().from("social_posts").upsert(rows); if (error) throw error; }
    result.tiktok = rows.length;
  } catch (e) { result.tiktokError = e.message; }
  await saveConnection("tiktok", { ...c, lastSync: Date.now(), lastResult: result });
  return result;
}
