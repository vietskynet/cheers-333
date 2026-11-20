// Tiện ích dùng chung cho các Edge Function (chạy trên Deno ở Netlify)
export const env = k => (globalThis.Netlify?.env?.get(k) ?? globalThis.Deno?.env?.get?.(k) ?? "");

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// App mở công khai, không dùng mã truy cập (giữ hàm để các endpoint không phải sửa)
export function checkPass() { return null; }

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

// PUT ảnh lên link tải lên có chữ ký của Higgsfield: gửi ĐÚNG các header Higgsfield trả về,
// chỉ thêm content-type nếu Higgsfield không đưa (tránh nhân đôi header làm sai chữ ký → 403)
export async function hfPutUpload(up, bytes, contentType = "image/jpeg") {
  const headers = new Headers();
  for (const [k, v] of Object.entries(up.upload_headers || {})) headers.set(k, String(v));
  if (!headers.has("content-type")) headers.set("content-type", up.content_type || contentType);
  const r = await fetch(up.upload_url, { method: "PUT", headers, body: bytes });
  return { ok: r.ok, status: r.status, text: r.ok ? "" : (await r.text()).slice(0, 300), sent: [...headers.keys()] };
}
