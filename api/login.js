import { makeSession, sessionCookie, safeEqual } from "../lib/core.js";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.APP_PASSWORD) return res.status(500).json({ error: "Falta configurar APP_PASSWORD en Vercel" });
  const { password } = req.body || {};
  if (!safeEqual(password, process.env.APP_PASSWORD)) return res.status(401).json({ error: "Contraseña incorrecta" });
  sessionCookie(res, makeSession(60), 60 * 86400);
  res.json({ ok: true });
}
