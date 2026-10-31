import { isAuthed, getCookie, setCookie, saveConnection, redirect, appUrl } from "../../lib/core.js";
import { metaExchange, tiktokExchange, syncMeta, syncTikTok } from "../../lib/providers.js";

// La red regresa aquí después de que autorizas
export default async function handler(req, res) {
  const p = req.query.provider;
  const back = (msg, ok) => redirect(res, `${appUrl()}/#redes?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`);
  if (!isAuthed(req)) return redirect(res, `${appUrl()}/`);
  const expected = getCookie(req, `mm_oauth_${p}`);
  setCookie(res, `mm_oauth_${p}`, "", 0);
  if (req.query.error || req.query.error_description) return back(req.query.error_description || "Cancelaste la conexión");
  if (!req.query.code || !expected || req.query.state !== expected) return back("La conexión expiró. Intenta de nuevo.");
  try {
    if (p === "meta") {
      const data = await metaExchange(req.query.code);
      await saveConnection("meta", data);
      await syncMeta().catch(() => {});
      return back(data.ig ? `Conectado: ${data.page.name} + @${data.ig.username}` : `Conectado: ${data.page.name}. Esta página no tiene Instagram profesional vinculado.`, true);
    }
    if (p === "tiktok") {
      const data = await tiktokExchange(req.query.code);
      await saveConnection("tiktok", data);
      await syncTikTok().catch(() => {});
      return back(`TikTok conectado: ${data.user.name || ""}`, true);
    }
    res.status(404).end();
  } catch (e) {
    back(`No se pudo conectar: ${e.message}`);
  }
}
