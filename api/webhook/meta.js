import { validSignature, handleComment } from "../../lib/automations.js";

// Meta manda aquí los comentarios nuevos (Instagram y página de Facebook)
async function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method === "GET") {
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] && q["hub.verify_token"] === process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(q["hub.challenge"]);
    }
    return res.status(403).send("forbidden");
  }
  if (req.method !== "POST") return res.status(405).end();
  const raw = await rawBody(req);
  if (!validSignature(raw, req.headers["x-hub-signature-256"])) return res.status(401).send("bad signature");
  let body; try { body = JSON.parse(raw); } catch { return res.status(400).end(); }
  const jobs = [];
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      if (body.object === "instagram" && ch.field === "comments" && v.id && v.media?.id) {
        jobs.push(handleComment({ provider: "ig", commentId: v.id, mediaId: v.media.id, text: v.text, fromId: v.from?.id, fromName: v.from?.username }));
      }
      if (body.object === "page" && ch.field === "feed" && v.item === "comment" && v.verb === "add" && v.comment_id && v.post_id) {
        jobs.push(handleComment({ provider: "fb", commentId: v.comment_id, mediaId: v.post_id, text: v.message, fromId: v.from?.id, fromName: v.from?.name }));
      }
    }
  }
  const results = await Promise.allSettled(jobs);
  res.status(200).json({ ok: true, n: results.length });
}
