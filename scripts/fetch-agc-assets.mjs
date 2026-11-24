// Tải ảnh của game /agcCombat/ về public/agcCombat/ lúc Netlify build.
// Chỉ tải file nào repo chưa có. Lỗi tải không làm hỏng build: game sẽ tự lấy ảnh từ kho Higgsfield.
import { existsSync, writeFileSync } from "node:fs";
const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_2vybgglAYZMtuRPV18Aqg7zS5iW/";
const FILES = { "sprites.png": "ed7afe2e-87e1-4b89-9a4e-86b0b4085351.png", "bg.png": "073e9582-2bbe-44d6-98ac-5cf73662bbb0.png", "posters.png": "9305b57c-82a2-4938-ad3a-b647287f1407.png" };
for (const [name, src] of Object.entries(FILES)) {
  const out = "public/agcCombat/" + name;
  if (existsSync(out)) { console.log("có sẵn:", out); continue; }
  try { const r = await fetch(CDN + src); if (!r.ok) throw new Error("HTTP " + r.status); writeFileSync(out, Buffer.from(await r.arrayBuffer())); console.log("đã tải:", out); }
  catch (e) { console.log("KHÔNG tải được", name, "-", e.message); }
}
