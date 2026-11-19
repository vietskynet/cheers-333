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

/* ---------- Nano Banana Pro qua Gemini API (khi có GEMINI_API_KEY) ----------
   Gemini trả ảnh ngay trong câu trả lời nhưng có thể mất 20–90 giây, nên server trả luồng
   ngay lập tức, gửi khoảng trắng giữ kết nối, rồi gửi JSON {image, mime, model} ở cuối. */
function geminiPaint(guide, prompt) {
  const key = env("GEMINI_API_KEY").trim();
  const model = env("GEMINI_IMAGE_MODEL").trim() || "gemini-3-pro-image";
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const ping = setInterval(() => { try { ctl.enqueue(enc.encode(" ")); } catch {} }, 5000);
      let out;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: guide } }, { text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: env("GEMINI_ASPECT") || "4:5", imageSize: env("GEMINI_IMAGE_SIZE") || "2K" } },
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) out = { error: "gemini", message: `Gemini ${r.status}: ${(d.error?.message || "").slice(0, 300)}` };
        else {
          const part = (d.candidates?.[0]?.content?.parts || []).find(p => p.inlineData || p.inline_data);
          const img = part?.inlineData || part?.inline_data;
          out = img ? { image: img.data, mime: img.mimeType || img.mime_type || "image/png", model }
                    : { error: "gemini", message: "Gemini không trả ảnh" + (d.candidates?.[0]?.finishReason ? ` (${d.candidates[0].finishReason})` : "") };
        }
      } catch (e) { out = { error: "gemini", message: String(e.message || e) }; }
      clearInterval(ping);
      ctl.enqueue(enc.encode(JSON.stringify(out))); ctl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const denied = checkPass(req); if (denied) return denied;
  try {
    const { guide, prompt } = await req.json();
    if (guide && prompt && env("GEMINI_API_KEY") && (env("IMAGE_PROVIDER") || "gemini") !== "higgsfield") return geminiPaint(guide, prompt);
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
