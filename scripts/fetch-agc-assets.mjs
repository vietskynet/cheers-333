// Tải ảnh của game /agcCombat/ về public/agcCombat/ lúc Netlify build.
// Chỉ tải file nào repo chưa có. Lỗi tải không làm hỏng build: game sẽ tự lấy ảnh từ kho Higgsfield.
import { existsSync, writeFileSync } from "node:fs";
const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_2vybgglAYZMtuRPV18Aqg7zS5iW/";
const FILES = { "sprites.webp": "9cc8f3dc-4bbd-4edd-84f0-5cef4ffb854c.webp", "bg.png": "073e9582-2bbe-44d6-98ac-5cf73662bbb0.png", "posters.webp": "92f73c8b-8bc5-402e-b17b-5c4452fd557f.webp" };
for (const [name, src] of Object.entries(FILES)) {
  const out = "public/agcCombat/" + name;
  if (existsSync(out)) { console.log("có sẵn:", out); continue; }
  try { const r = await fetch(CDN + src); if (!r.ok) throw new Error("HTTP " + r.status); writeFileSync(out, Buffer.from(await r.arrayBuffer())); console.log("đã tải:", out); }
  catch (e) { console.log("KHÔNG tải được", name, "-", e.message); }
}
