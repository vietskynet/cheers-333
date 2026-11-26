// Tải ảnh của game /agcCombat/ về public/agcCombat/ lúc Netlify build.
// Chỉ tải file nào repo chưa có. Lỗi tải không làm hỏng build: game sẽ tự lấy ảnh từ kho Higgsfield.
import { existsSync, writeFileSync } from "node:fs";
const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_2vybgglAYZMtuRPV18Aqg7zS5iW/";
const FILES = { "sprites.webp": "1ba1d300-6160-48a6-8bb5-5a1762aeb510.webp", "bg.png": "073e9582-2bbe-44d6-98ac-5cf73662bbb0.png", "posters.webp": "9f097731-2e1f-4564-8f36-17a0eb6afd5e.webp", "wall-p.webp": "bffc5291-85b3-4f8a-8c67-ba91cd40039b.webp", "wall-l.webp": "3090b201-3409-44bd-9ef2-228a26758936.webp", "story.webp": "141ba990-ce2e-4ce7-8edb-c94d402ec593.webp", "vox.mp3": "35b28890-6d39-4d57-85f6-de9431fe18de.mp3" };
for (const [name, src] of Object.entries(FILES)) {
  const out = "public/agcCombat/" + name;
  if (existsSync(out)) { console.log("có sẵn:", out); continue; }
  try { const r = await fetch(CDN + src); if (!r.ok) throw new Error("HTTP " + r.status); writeFileSync(out, Buffer.from(await r.arrayBuffer())); console.log("đã tải:", out); }
  catch (e) { console.log("KHÔNG tải được", name, "-", e.message); }
}
