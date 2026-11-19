// POST /api/analyze  {prompt, images:[{data(base64), media_type}]}
// Gọi Claude (Anthropic API) và stream nguyên văn câu trả lời (text) về trình duyệt.
import { env, json, checkPass } from "../lib/shared.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const denied = checkPass(req); if (denied) return denied;
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "config", message: "Chưa cấu hình ANTHROPIC_API_KEY trên Netlify" }, 500);
  let body; try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const images = (body.images || []).slice(0, 4).map(im => ({ type: "image", source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data } }));
  if (!body.prompt) return json({ error: "bad_request", message: "thiếu prompt" }, 400);

  const up = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
      max_tokens: 4000,
      stream: true,
      system: "Bạn trả lời bằng đúng MỘT đối tượng JSON hợp lệ, không thêm chữ nào khác, không dùng code fence.",
      messages: [{ role: "user", content: [...images, { type: "text", text: String(body.prompt) }] }],
    }),
  });
  if (!up.ok || !up.body) return json({ error: "anthropic", status: up.status, message: (await up.text()).slice(0, 400) }, 502);

  // Chuyển luồng SSE của Anthropic thành luồng text thuần (chỉ phần chữ Claude viết)
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = "";
  const stream = up.body.pipeThrough(new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const evt = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = evt.split("\n").find(l => l.startsWith("data:"));
        if (!line) continue;
        try {
          const d = JSON.parse(line.slice(5));
          if (d.type === "content_block_delta" && d.delta?.type === "text_delta") ctl.enqueue(enc.encode(d.delta.text));
          if (d.type === "error") ctl.enqueue(enc.encode("\n[[ERROR]] " + (d.error?.message || "")));
        } catch {}
      }
    },
  }));
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};

export const config = { path: "/api/analyze" };
