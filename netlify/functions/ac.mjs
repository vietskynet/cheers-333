// AGENCY COMBAT – lưu lịch sử lượt chơi và bảng xếp hạng trên Netlify Database (Postgres).
//   POST /api/ac/matches            lưu 1 trận
//   GET  /api/ac/matches?pid=...    100 trận gần nhất của 1 người chơi
//   GET  /api/ac/leaderboard        bảng xếp hạng (ai cũng xem được)
import { getDatabase } from "@netlify/database";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
const txt = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const PID = /^[a-z0-9-]{8,40}$/i;

export async function handle(req, sql) {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/leaderboard")) {
    const rows = await sql`
      SELECT player_id,
             (array_agg(player_name ORDER BY created_at DESC))[1] AS name,
             (array_agg(player_ch ORDER BY created_at DESC))[1]   AS ch,
             count(*)::int                                        AS games,
             count(*) FILTER (WHERE result = 'w')::int            AS wins,
             count(*) FILTER (WHERE result = 'w' AND mode = 'ai2')::int AS hard_wins,
             max(combo)::int                                      AS combo
      FROM ac_matches GROUP BY player_id
      ORDER BY wins DESC, games ASC LIMIT 30`;
    return json({ ok: true, rows });
  }
  if (req.method === "GET") {
    const pid = url.searchParams.get("pid") || "";
    if (!PID.test(pid)) return json({ ok: false, error: "pid không hợp lệ" }, 400);
    const rows = await sql`
      SELECT created_at, player_name, player_ch, opp_name, opp_ch, mode, result, dur, hp_me, hp_op, hits, dealt, taken, blocks, skills, ults, combo
      FROM ac_matches WHERE player_id = ${pid} ORDER BY created_at DESC LIMIT 100`;
    return json({ ok: true, rows });
  }
  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > 2000) return json({ ok: false, error: "dữ liệu quá lớn" }, 413);
    let b; try { b = JSON.parse(raw); } catch { return json({ ok: false, error: "JSON không hợp lệ" }, 400); }
    const pid = String(b.pid || "");
    if (!PID.test(pid)) return json({ ok: false, error: "pid không hợp lệ" }, 400);
    const mode = ["ai0", "ai1", "ai2", "pvp"].includes(b.mode) ? b.mode : null, result = ["w", "l", "d"].includes(b.res) ? b.res : null;
    if (!mode || !result) return json({ ok: false, error: "thiếu mode / res" }, 400);
    const m = b.me || {}, o = b.op || {};
    // chống gửi dồn dập: mỗi người chơi tối đa 1 trận / 5 giây
    const recent = await sql`SELECT 1 FROM ac_matches WHERE player_id = ${pid} AND created_at > now() - interval '5 seconds' LIMIT 1`;
    if (recent.length) return json({ ok: false, error: "gửi quá nhanh" }, 429);
    await sql`
      INSERT INTO ac_matches (player_id, player_name, player_ch, opp_name, opp_ch, mode, result, dur, hp_me, hp_op, hits, dealt, taken, blocks, skills, ults, combo)
      VALUES (${pid}, ${txt(m.n, 12) || "Vô danh"}, ${int(m.c, 0, 7)}, ${txt(o.n, 40) || "?"}, ${int(o.c, 0, 7)}, ${mode}, ${result}, ${int(b.dur, 0, 600)}, ${int(m.hp, 0, 100)}, ${int(o.hp, 0, 100)},
              ${int(b.hits, 0, 999)}, ${int(b.dealt, 0, 9999)}, ${int(b.taken, 0, 9999)}, ${int(b.blocks, 0, 999)}, ${int(b.skills, 0, 999)}, ${int(b.ults, 0, 99)}, ${int(b.combo, 0, 999)})`;
    return json({ ok: true });
  }
  return json({ ok: false, error: "method" }, 405);
}

export default async req => {
  try { const { sql } = getDatabase(); return await handle(req, sql); }
  catch (e) { return json({ ok: false, error: "Database chưa sẵn sàng: " + (e?.message || e) }, 503); }
};
export const config = { path: ["/api/ac/matches", "/api/ac/leaderboard"] };
