// /agcCombat/ – bảng xếp hạng Tournament trên Netlify Database (Postgres).
//   POST /api/agc/scores               lưu điểm một lượt chơi giải
//   GET  /api/agc/leaderboard?pid=...  50 người điểm cao nhất (mỗi người lấy lượt cao nhất); pid chỉ để đánh dấu dòng của chính mình
import { getDatabase } from "@netlify/database";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
const txt = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>&]/g, "").trim().slice(0, max);
const PID = /^[a-z0-9-]{8,40}$/i;
const MAXW = 40;                                             // số trận tối đa của một giải
export const maxScore = w => 50 * w * (w + 1) + 100 * w;     // thắng trận thứ N: N × 100 điểm + tối đa 100 máu

export async function handle(req, sql) {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const pid = url.searchParams.get("pid") || "";
    const rows = await sql`
      SELECT name, ch, score, wins, champ, created_at, (player_id = ${PID.test(pid) ? pid : ""}) AS me
      FROM (SELECT DISTINCT ON (player_id) * FROM agc_scores WHERE score > 0 ORDER BY player_id, score DESC, created_at ASC) t
      ORDER BY score DESC, created_at ASC LIMIT 50`;
    return json({ ok: true, rows });
  }
  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > 1000) return json({ ok: false, error: "dữ liệu quá lớn" }, 413);
    let b; try { b = JSON.parse(raw); } catch { return json({ ok: false, error: "JSON không hợp lệ" }, 400); }
    const pid = String(b.pid || "");
    if (!PID.test(pid)) return json({ ok: false, error: "pid không hợp lệ" }, 400);
    const wins = int(b.wins, 0, MAXW), score = int(b.score, 0, 1e6);
    if (score > maxScore(wins)) return json({ ok: false, error: "điểm không khớp số trận thắng" }, 400);
    // chống gửi dồn dập: mỗi người chơi tối đa 1 lượt / 5 giây
    const recent = await sql`SELECT 1 FROM agc_scores WHERE player_id = ${pid} AND created_at > now() - interval '5 seconds' LIMIT 1`;
    if (recent.length) return json({ ok: false, error: "gửi quá nhanh" }, 429);
    await sql`
      INSERT INTO agc_scores (player_id, name, ch, score, wins, champ, dur)
      VALUES (${pid}, ${txt(b.n, 12) || "Vô danh"}, ${int(b.c, 0, 99)}, ${score}, ${wins}, ${b.champ ? 1 : 0}, ${int(b.dur, 0, 36000)})`;
    return json({ ok: true });
  }
  return json({ ok: false, error: "method" }, 405);
}

export default async req => {
  try { const { sql } = getDatabase(); return await handle(req, sql); }
  catch (e) { return json({ ok: false, error: "Database chưa sẵn sàng: " + (e?.message || e) }, 503); }
};
export const config = { path: ["/api/agc/scores", "/api/agc/leaderboard"] };
