// Tiện ích dùng chung cho các Edge Function (chạy trên Deno ở Netlify)
export const env = k => (globalThis.Netlify?.env?.get(k) ?? globalThis.Deno?.env?.get?.(k) ?? "");

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// Nếu đặt APP_PASSCODE trong Netlify, mọi lời gọi API phải gửi kèm header x-passcode đúng mã đó
export function checkPass(req) {
  const need = env("APP_PASSCODE");
  if (!need) return null;
  return req.headers.get("x-passcode") === need ? null : json({ error: "passcode", message: "Sai hoặc thiếu mã truy cập" }, 401);
}

export const HF_BASE = "https://api.higgsfield.ai";
export function hfAuth() {
  const id = env("HIGGSFIELD_KEY_ID"), secret = env("HIGGSFIELD_KEY_SECRET");
  if (!id || !secret) throw new Error("Chưa cấu hình HIGGSFIELD_KEY_ID / HIGGSFIELD_KEY_SECRET trên Netlify");
  return `Key ${id}:${secret}`;
}
export async function hfFetch(path, init = {}) {
  const r = await fetch(HF_BASE + path, { ...init, headers: { authorization: hfAuth(), "content-type": "application/json", ...(init.headers || {}) } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) { const e = new Error(`Higgsfield ${r.status}: ${(body.detail || body.message || body.error || text).toString().slice(0, 300)}`); e.status = r.status; throw e; }
  return body;
}
