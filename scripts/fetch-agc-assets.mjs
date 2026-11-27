// Tải ảnh của game /agcCombat/ về public/agcCombat/ lúc Netlify build.
// Chỉ tải file nào repo chưa có. Lỗi tải không làm hỏng build: game sẽ tự lấy ảnh từ kho Higgsfield.
import { existsSync, writeFileSync } from "node:fs";
const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_2vybgglAYZMtuRPV18Aqg7zS5iW/";
const FILES = { "sprites.webp": "a47a73f6-de35-45a9-9f6f-6606496b5304.webp", "bg.png": "073e9582-2bbe-44d6-98ac-5cf73662bbb0.png", "posters.webp": "db81c393-357a-4ac4-893a-82af23fad456.webp", "wall-p.webp": "bffc5291-85b3-4f8a-8c67-ba91cd40039b.webp", "wall-l.webp": "3090b201-3409-44bd-9ef2-228a26758936.webp", "story.webp": "2bc89ebd-dca5-4c9b-b3a1-b368f1d86b2c.webp", "vox.mp3": "9a9f74f8-e5b5-46ca-a1d8-8446d3eaa410.mp3" };
for (const [name, src] of Object.entries(FILES)) {
  const out = "public/agcCombat/" + name;
  if (existsSync(out)) { console.log("có sẵn:", out); continue; }
  try { const r = await fetch(CDN + src); if (!r.ok) throw new Error("HTTP " + r.status); writeFileSync(out, Buffer.from(await r.arrayBuffer())); console.log("đã tải:", out); }
  catch (e) { console.log("KHÔNG tải được", name, "-", e.message); }
}
