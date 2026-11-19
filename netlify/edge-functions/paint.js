// POST /api/paint  {guide: base64 JPEG của shape guide, prompt}
// Tải shape guide lên kho của Higgsfield rồi gửi yêu cầu vẽ tranh. Trả về request_id.
import { env, json, checkPass, hfFetch, hfPutUpload } from "../lib/shared.js";

// Model mặc định có nhận ảnh tham chiếu. Đổi bằng biến HIGGSFIELD_MODEL trên Netlify.
const DEFAULT_MODEL = "xai/grok-imagine-image-2.0";

function bodyFor(model, prompt, imageUrl) {
  if (model.startsWith("ideogram/")) return { prompt: prompt.slice(0, 2048), image_url: imageUrl, aspect_ratio: "4:5", rendering_speed: "QUALITY" };
  if (model.startsWith("xai/")) return { prompt, image_urls: [imageUrl], aspect_ratio: "3:4", resolution: "2k" };
  // model khác: gửi các trường phổ biến
  return { prompt, image_url: imageUrl, image_urls: [imageUrl], aspect_ratio: "4:5" };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const denied = checkPass(req); if (denied) return denied;
  try {
    const { guide, prompt } = await req.json();
    if (!guide || !prompt) return json({ error: "bad_request", message: "thiếu guide hoặc prompt" }, 400);
    const bytes = Uint8Array.from(atob(guide), c => c.charCodeAt(0));
    if (bytes.length > 4_000_000) return json({ error: "too_large" }, 413);

    // 1) xin link tải lên + 2) PUT ảnh (không gửi key Higgsfield tới link này)
    const up = await hfFetch("/files/generate-upload-url", { method: "POST", body: JSON.stringify({ content_type: "image/jpeg" }) });
    const put = await hfPutUpload(up, bytes);
    if (!put.ok) return json({ error: "upload", message: `Tải shape guide lên thất bại (${put.status}) ${put.text}` }, 502);

    // 3) gửi yêu cầu vẽ
    const model = env("HIGGSFIELD_MODEL") || DEFAULT_MODEL;
    const sub = await hfFetch("/" + model, { method: "POST", body: JSON.stringify(bodyFor(model, prompt, up.public_url)) });
    return json({ request_id: sub.request_id, model });
  } catch (e) {
    return json({ error: "higgsfield", message: String(e.message || e) }, e.status && e.status < 500 ? e.status : 502);
  }
};

export const config = { path: "/api/paint" };
