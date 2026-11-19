// GET /api/status?id=<request_id>  → {status, url}
import { json, checkPass, hfFetch } from "../lib/shared.js";

export default async (req) => {
  const denied = checkPass(req); if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad_request" }, 400);
  try {
    const s = await hfFetch(`/requests/${id}/status`);
    const url = s.images?.[0]?.url || s.image?.url || s.video?.url || null;
    return json({ status: s.status, url });
  } catch (e) { return json({ error: "higgsfield", message: String(e.message || e) }, 502); }
};

export const config = { path: "/api/status" };
