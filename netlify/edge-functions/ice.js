// GET /api/ice  → danh sách máy chủ ICE (STUN/TURN) cho game Combat.
// Nếu đặt CF_TURN_KEY_ID + CF_TURN_API_TOKEN (Cloudflare Realtime TURN, miễn phí 1.000 GB/tháng) thì cấp thêm TURN riêng.
import { env, json } from "../lib/shared.js";

export default async () => {
  const servers = []; let note = "";
  const id = env("CF_TURN_KEY_ID").trim(), token = env("CF_TURN_API_TOKEN").trim();
  if (id && token) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 86400 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) note = `Cloudflare ${r.status}: ` + (d.errors?.[0]?.message || d.error || "sai Key ID hoặc API Token");
      if (Array.isArray(d.iceServers)) servers.push(...d.iceServers);
      else if (d.iceServers) servers.push(d.iceServers);
    } catch (e) { note = "Không gọi được Cloudflare: " + (e.message || e); }
  } else note = id || token ? "Thiếu một trong hai biến CF_TURN_KEY_ID / CF_TURN_API_TOKEN" : "Chưa đặt biến CF_TURN_KEY_ID / CF_TURN_API_TOKEN";
  const urls = servers.flatMap(s => [].concat(s.urls || [])).filter(u => /^turns?:/.test(u));
  return json({ iceServers: servers, turn: urls.length > 0, turn_urls: urls.length, note: urls.length ? "Cloudflare TURN OK" : note || "Cloudflare không trả về máy chủ TURN" });
};

export const config = { path: "/api/ice" };
