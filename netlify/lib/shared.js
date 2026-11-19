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
  // Key mới từ open.higgsfield.ai là MỘT chuỗi hoàn chỉnh: Authorization: Key <api-key>
  // Vẫn hỗ trợ kiểu cũ (Key ID + Key Secret) nếu bạn đã nhập 2 biến.
  const clean = v => String(v || "").trim().replace(/^Key\s+/i, "");
  const one = clean(env("HIGGSFIELD_API_KEY"));
  if (one) return `Key ${one}`;
  const id = clean(env("HIGGSFIELD_KEY_ID")), secret = clean(env("HIGGSFIELD_KEY_SECRET"));
  if (id && secret && !id.includes(":")) return `Key ${id}:${secret}`;
  if (id) return `Key ${id}`;
  throw new Error("Chưa cấu hình HIGGSFIELD_API_KEY trên Netlify");
}
export async function hfFetch(path, init = {}) {
  const r = await fetch(HF_BASE + path, { ...init, headers: { authorization: hfAuth(), "content-type": "application/json", ...(init.headers || {}) } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) { const e = new Error(`Higgsfield ${r.status}: ${(body.detail || body.message || body.error || text).toString().slice(0, 300)}`); e.status = r.status; throw e; }
  return body;
}
