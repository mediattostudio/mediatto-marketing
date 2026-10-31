import { isAuthed, requireAuth, safeEqual } from "../lib/core.js";
import { createUpload, createPublication, listPublications, processPublication, processDue, retry, cancel, remove, publicView, tiktokCreatorInfo } from "../lib/publish.js";

// GET    /api/publish                       → cola de publicaciones
// GET    /api/publish?action=tick           → procesa lo programado (cron de Supabase cada 5 min, o la app)
// POST   /api/publish {action:"upload"}     → URL firmada para subir el archivo directo a Supabase
// POST   /api/publish {action:"create"}     → crea; si es "ahora", publica en el momento
// POST   /api/publish {action:"retry"|"cancel", id}
// DELETE /api/publish?id=…                  → quita de la cola (y borra sus archivos)
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET" && req.query.action === "tick") {
      const cronOk = process.env.CRON_SECRET && safeEqual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`);
      if (!cronOk && !isAuthed(req)) return res.status(401).json({ error: "No autorizado" });
      const processed = await processDue(cronOk ? 50e3 : 20e3);
      return res.json({ processed, at: Date.now() });
    }
    if (!requireAuth(req, res)) return;

    if (req.method === "GET" && req.query.action === "tiktok-creator") return res.json(await tiktokCreatorInfo());
    if (req.method === "GET") return res.json({ publications: await listPublications() });

    if (req.method === "DELETE") {
      if (!req.query.id) return res.status(400).json({ error: "Falta id" });
      await remove(req.query.id);
      return res.json({ ok: true });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      if (b.action === "upload") return res.json(await createUpload(b));
      if (b.action === "create") {
        const row = await createPublication(b);
        const later = b.scheduledAt && new Date(b.scheduledAt) > new Date(Date.now() + 60e3);
        const pub = later ? publicView(row) : await processPublication(row.id, 45e3);
        return res.json({ publication: pub });
      }
      if (b.action === "retry") return res.json({ publication: await retry(b.id) });
      if (b.action === "cancel") { await cancel(b.id); return res.json({ ok: true }); }
      return res.status(400).json({ error: "Acción desconocida" });
    }
    res.status(405).end();
  } catch (e) {
    res.status(e.status && e.status < 500 ? 400 : 500).json({ error: e.message });
  }
}
