import { isAuthed, randomState, setCookie, redirect, appUrl } from "../../lib/core.js";
import { metaAuthUrl, tiktokAuthUrl } from "../../lib/providers.js";

// GET /api/connect/meta  |  /api/connect/tiktok  → manda al login oficial de la red
export default function handler(req, res) {
  if (!isAuthed(req)) return redirect(res, `${appUrl()}/`);
  const p = req.query.provider;
  const state = randomState();
  setCookie(res, `mm_oauth_${p}`, state, 600);
  if (p === "meta") {
    if (!process.env.META_APP_ID) return redirect(res, `${appUrl()}/#redes?error=${encodeURIComponent("Falta META_APP_ID en Vercel")}`);
    return redirect(res, metaAuthUrl(state));
  }
  if (p === "tiktok") {
    if (!process.env.TIKTOK_CLIENT_KEY) return redirect(res, `${appUrl()}/#redes?error=${encodeURIComponent("Falta TIKTOK_CLIENT_KEY en Vercel")}`);
    return redirect(res, tiktokAuthUrl(state));
  }
  res.status(404).end();
}
