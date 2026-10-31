import { sb, requireAuth } from "../lib/core.js";

// GET    /api/items          → lista de piezas
// POST   /api/items {item}   → crea o actualiza
// DELETE /api/items?id=xxx   → borra
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === "GET") {
      const { data, error } = await sb().from("items").select("id,data").limit(5000);
      if (error) throw error;
      return res.json({ items: data.map((r) => ({ ...r.data, id: r.id })) });
    }
    if (req.method === "POST") {
      const item = req.body?.item;
      if (!item || typeof item.id !== "string" || !item.id) return res.status(400).json({ error: "Falta la pieza" });
      const { id, ...data } = item;
      const { error } = await sb().from("items").upsert({ id, data, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.json({ ok: true });
    }
    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Falta id" });
      const { error } = await sb().from("items").delete().eq("id", id);
      if (error) throw error;
      return res.json({ ok: true });
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
