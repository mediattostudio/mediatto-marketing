import { isAuthed, safeEqual } from "../lib/core.js";
import { syncMeta, syncTikTok } from "../lib/providers.js";

// POST desde la app (botón "Actualizar") o GET del cron diario de Vercel
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const cronOk = process.env.CRON_SECRET && safeEqual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`);
  if (!cronOk && !isAuthed(req)) return res.status(401).json({ error: "No autorizado" });
  const [meta, tiktok] = await Promise.all([
    syncMeta().catch((e) => ({ error: e.message })),
    syncTikTok().catch((e) => ({ error: e.message })),
  ]);
  res.json({ meta, tiktok, at: Date.now() });
}
