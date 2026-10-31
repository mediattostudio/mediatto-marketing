import { sb, requireAuth } from "../lib/core.js";

// GET /api/stats → publicaciones sincronizadas + historial de seguidores (90 días)
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const [posts, snaps] = await Promise.all([
      sb().from("social_posts").select("id,provider,posted_at,data").order("posted_at", { ascending: false }).limit(300),
      sb().from("account_snapshots").select("provider,day,data").gte("day", since).order("day", { ascending: true }),
    ]);
    if (posts.error) throw posts.error;
    if (snaps.error) throw snaps.error;
    res.json({
      posts: posts.data.map((p) => ({ id: p.id, provider: p.provider, postedAt: p.posted_at, ...p.data })),
      snapshots: snaps.data,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
