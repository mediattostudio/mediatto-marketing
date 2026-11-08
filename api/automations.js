import { requireAuth, getConnection, redirect, appUrl } from "../lib/core.js";
import { stats, trackClick, subscribePage, createGuideUpload } from "../lib/automations.js";

// GET  /api/automations            → eventos de los últimos 30 días
// GET  /api/automations?r=ID&b=0   → registra el clic del botón del DM y redirige
// POST /api/automations?action=subscribe → (re)suscribe la página a los webhooks
export default async function handler(req, res) {
  try {
    if (req.query.r) {
      const url = await trackClick(String(req.query.r), req.query.b === "f" ? "f" : Number(req.query.b) || 0);
      return redirect(res, url || appUrl() || "/");
    }
    if (!requireAuth(req, res)) return;
    if (req.method === "POST" && req.query.action === "upload") return res.json(await createGuideUpload(req.body || {}));
    if (req.method === "POST" && req.query.action === "subscribe") {
      const c = await getConnection("meta");
      if (!c) return res.status(400).json({ error: "Conecta Instagram + Facebook primero" });
      await subscribePage(c);
      return res.json({ ok: true });
    }
    const events = await stats();
    res.json({ events, verifyConfigured: !!process.env.META_VERIFY_TOKEN });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
