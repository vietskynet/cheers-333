// GET /api/diag?pass=<APP_PASSCODE>  Kiểm tra cấu hình mà KHÔNG lộ key
import { env, json, hfAuth, HF_BASE, hfPutUpload } from "../lib/shared.js";

const describe = v => {
  const s = String(v || "");
  if (!s) return "chưa có";
  const t = s.trim();
  return `có (${t.length} ký tự${t !== s ? ", CÓ khoảng trắng thừa ở đầu/cuối" : ""}${/^Key\s/i.test(t) ? ", bắt đầu bằng chữ 'Key' thừa" : ""}${t.includes(":") ? ", có dấu ':'" : ""}, bắt đầu '${t.slice(0, 3)}…')`;
};

export default async (req) => {
  const need = env("APP_PASSCODE");
  if (need && new URL(req.url).searchParams.get("pass") !== need) return json({ error: "Thêm ?pass=<mã truy cập> vào cuối link" }, 401);
  const out = {
    ANTHROPIC_API_KEY: describe(env("ANTHROPIC_API_KEY")),
    HIGGSFIELD_API_KEY: describe(env("HIGGSFIELD_API_KEY")),
    HIGGSFIELD_KEY_ID: describe(env("HIGGSFIELD_KEY_ID")),
    HIGGSFIELD_KEY_SECRET: describe(env("HIGGSFIELD_KEY_SECRET")),
    HIGGSFIELD_MODEL: env("HIGGSFIELD_MODEL") || "(mặc định) xai/grok-imagine-image-2.0",
    code_version: "2026-11-19c",
  };
  try {
    const auth = hfAuth();
    out.higgsfield_auth_dang_dung = auth.startsWith("Key ") ? `Key <${auth.length - 4} ký tự>` : "?";
    const r = await fetch(HF_BASE + "/files/generate-upload-url", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ content_type: "image/jpeg" }) });
    out.higgsfield_test = `HTTP ${r.status}` + (r.ok ? " – key HỢP LỆ ✓" : " – " + (await r.text()).slice(0, 200));
    if (r.ok) {
      const up = await r.json();
      out.upload_headers_higgsfield_yeu_cau = Object.keys(up.upload_headers || {});
      // ảnh JPEG 1×1 để thử tải lên
      const tiny = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="), c => c.charCodeAt(0));
      const put = await hfPutUpload(up, tiny);
      out.upload_test = put.ok ? `HTTP ${put.status} – tải ảnh lên OK ✓` : `HTTP ${put.status} – ${put.text}`;
      out.upload_headers_da_gui = put.sent;
    }
  } catch (e) { out.higgsfield_test = "Lỗi: " + e.message; }
  return json(out);
};

export const config = { path: "/api/diag" };
