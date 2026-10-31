import { sessionCookie } from "../lib/core.js";

export default function handler(req, res) {
  sessionCookie(res, "", 0);
  res.json({ ok: true });
}
