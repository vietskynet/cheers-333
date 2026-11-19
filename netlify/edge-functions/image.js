// GET /api/image?url=...  Lấy tranh từ CDN của Higgsfield về cùng tên miền để trang ghép poster được.
import { checkPass } from "../lib/shared.js";

const ALLOWED = [/\.cloudfront\.net$/i, /(^|\.)higgsfield\.ai$/i];

export default async (req) => {
  const denied = checkPass(req); if (denied) return denied;
  let u; try { u = new URL(new URL(req.url).searchParams.get("url") || ""); } catch { return new Response("bad url", { status: 400 }); }
  if (u.protocol !== "https:" || !ALLOWED.some(r => r.test(u.hostname))) return new Response("host not allowed", { status: 403 });
  const r = await fetch(u.toString());
  if (!r.ok || !r.body) return new Response("fetch failed", { status: 502 });
  return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/png", "cache-control": "private, max-age=3600" } });
};

export const config = { path: "/api/image" };
