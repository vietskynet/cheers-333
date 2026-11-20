// GET /api/ice  → danh sách máy chủ ICE (STUN/TURN) cho game Combat.
// Nếu đặt CF_TURN_KEY_ID + CF_TURN_API_TOKEN (Cloudflare Realtime TURN, miễn phí 1.000 GB/tháng) thì cấp thêm TURN riêng.
import { env, json } from "../lib/shared.js";

export default async () => {
  const servers = [];
  const id = env("CF_TURN_KEY_ID").trim(), token = env("CF_TURN_API_TOKEN").trim();
  if (id && token) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 86400 }),
      });
      const d = await r.json();
      if (Array.isArray(d.iceServers)) servers.push(...d.iceServers);
      else if (d.iceServers) servers.push(d.iceServers);
    } catch {}
  }
  return json({ iceServers: servers, turn: servers.length > 0 });
};

export const config = { path: "/api/ice" };
