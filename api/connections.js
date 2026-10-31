import { sb, requireAuth, deleteConnection } from "../lib/core.js";
import { META_PUBLISH_SCOPES } from "../lib/providers.js";
import { tiktokMode, tiktokPublishEnabled } from "../lib/publish.js";

// GET    /api/connections               → estado de cada red (sin tokens)
// DELETE /api/connections?provider=meta → desconectar
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === "DELETE") {
      const p = req.query.provider;
      if (!["meta", "tiktok"].includes(p)) return res.status(400).json({ error: "Red desconocida" });
      await deleteConnection(p);
      return res.json({ ok: true });
    }
    const { data, error } = await sb().from("connections").select("provider,data");
    if (error) throw error;
    const out = {
      configured: { meta: !!process.env.META_APP_ID, tiktok: !!process.env.TIKTOK_CLIENT_KEY },
      tiktokPublish: tiktokPublishEnabled() ? tiktokMode() : null,
      meta: null, tiktok: null,
    };
    for (const r of data) {
      const d = r.data;
      if (r.provider === "meta") out.meta = { page: d.page?.name, ig: d.ig?.username || null, igPicture: d.ig?.picture || null, connectedAt: d.connectedAt, lastSync: d.lastSync || null, lastResult: d.lastResult || null, userTokenExpires: d.userTokenExpires || null,
        canPublish: Array.isArray(d.scopes) ? META_PUBLISH_SCOPES.every((x) => d.scopes.includes(x)) : false };
      if (r.provider === "tiktok") out.tiktok = { name: d.user?.name, avatar: d.user?.avatar, connectedAt: d.connectedAt, lastSync: d.lastSync || null, lastResult: d.lastResult || null, refreshExpiresAt: d.refreshExpiresAt || null,
        canPublish: tiktokPublishEnabled() && String(d.scope || "").includes(tiktokMode() === "direct" ? "video.publish" : "video.upload") };
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
