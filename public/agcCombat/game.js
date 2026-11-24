/* Đấu trường phép thuật Arcade – game.js (toàn bộ game nằm trong file này)
   Phần 1: kết nối 2 máy (dùng chung với các game khác của HandMagination). Phần 2: game. */
const $ = id => document.getElementById(id);
const show = id => document.querySelectorAll(".scr").forEach(s => s.classList.toggle("on", s.id === id));

/* ======================= MẠNG ======================= */
// Ưu tiên WebRTC P2P (PeerJS): kênh "state" không gửi lại cho vị trí, kênh "event" chắc chắn cho đòn đánh.
// Không nối thẳng được (NAT 4G…) → tự chuyển sang CHUYỂN TIẾP qua máy chủ MQTT công cộng (WebSocket).
const net = { peer: null, st: null, ev: null, host: false, code: "", rtt: 0, connected: false, local: null, mode: "", relay: null, relayUp: false };
const LOCAL = location.hash === "#local";   // chế độ test 2 cửa sổ trên cùng trình duyệt
const ID = c => "hmwiz-v1-" + c.toUpperCase();
const P2P_WAIT = 6500;
let ICE = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "turn:eu-0.turn.peerjs.com:3478", username: "peerjs", credential: "peerjsp" },
  { urls: "turn:us-0.turn.peerjs.com:3478", username: "peerjs", credential: "peerjsp" },
];
const iceReady = fetch("/api/ice").then(r => r.json()).then(d => { if (d.iceServers?.length) { ICE = [...d.iceServers, ...ICE]; diagSet("turn", "có TURN riêng ✓"); } }).catch(() => {});
const BROKERS = ["wss://broker.hivemq.com:8884/mqtt", "wss://broker.emqx.io:8084/mqtt", "wss://test.mosquitto.org:8081"];
const diagState = {};
function diagSet(k, v) {
  diagState[k] = v;
  const L = { sig: "Máy chủ ghép phòng", p2p: "Kết nối trực tiếp", ice: "Trạng thái ICE", relay: "Chuyển tiếp", turn: "TURN" };
  $("diag").innerHTML = Object.entries(diagState).map(([a, b]) => `${L[a] || a}: <b>${b}</b>`).join("<br>");
  $("diag").classList.add("on");
}
function newCode() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(""); }
function send(msg, reliable = true) {
  if (LOCAL) { net.local?.postMessage({ from: net.host ? "h" : "g", msg }); return; }
  if (net.mode === "relay") { relaySend(msg); return; }
  const c = reliable ? net.ev : net.st;
  if (c && c.open) { try { c.send(msg); } catch {} }
  else if (net.relayUp && msg.t !== "s") relaySend(msg);
}
function wire(c) {
  if (c.label === "state") net.st = c; else net.ev = c;
  c.on("data", m => { if (net.mode !== "relay") onMsg(m); });
  c.on("open", () => { if (net.st?.open && net.ev?.open && !net.connected) { net.mode = "p2p"; diagSet("p2p", "đã nối ✓"); onConnected(); } });
  c.on("close", () => { if (net.mode === "p2p") onDisconnect(); });
  c.on("error", e => console.warn("conn", e));
  const t = setInterval(() => { const st = c.peerConnection?.iceConnectionState; if (st) diagSet("ice", st); if (net.connected || st === "failed") clearInterval(t); }, 400);
}
/* ---- chuyển tiếp qua MQTT ---- */
const topic = dir => `hmwiz/v1/${net.code}/${dir}`;
function relayStart() {
  if (net.relay || typeof mqtt === "undefined") return Promise.resolve(false);
  return new Promise(res => {
    let i = 0, done = false;
    const tryNext = () => {
      if (i >= BROKERS.length) { diagSet("relay", "không vào được máy chủ chuyển tiếp ✗"); return res(false); }
      const url = BROKERS[i++];
      const cl = mqtt.connect(url, { clientId: "hmc_" + Math.random().toString(36).slice(2, 10), clean: true, connectTimeout: 5000, reconnectPeriod: 2000, keepalive: 30 });
      const fail = setTimeout(() => { if (!done) { cl.end(true); tryNext(); } }, 5500);
      cl.on("connect", () => {
        if (done) return; done = true; clearTimeout(fail);
        net.relay = cl; net.relayUp = true;
        cl.subscribe(topic(net.host ? "toHost" : "toGuest"), { qos: 0 });
        diagSet("relay", "sẵn sàng (" + new URL(url).hostname + ")");
        res(true);
      });
      cl.on("message", (tp, buf) => { let m; try { m = JSON.parse(buf.toString()); } catch { return; } onRelayMsg(m); });
      cl.on("error", () => {});
    };
    tryNext();
  });
}
function relaySend(msg) { if (net.relay && net.relayUp) net.relay.publish(topic(net.host ? "toGuest" : "toHost"), JSON.stringify(msg), { qos: 0 }); }
function onRelayMsg(m) {
  if (m.t === "rhello") {               // bên kia xin nối qua chuyển tiếp
    if (net.mode === "p2p" && net.connected) return;
    net.mode = "relay";
    if (net.host) relaySend({ t: "rhello" });
    diagSet("p2p", "không nối thẳng được → dùng chuyển tiếp"); onConnected(); return;
  }
  if (net.mode === "relay" || !net.connected) onMsg(m);
}
async function goRelay(reason) {
  if (net.connected) return;
  diagSet("p2p", reason);
  const ok = await relayStart();
  if (!ok) { $("roomErr").textContent = "Không kết nối được. Thử lại sau hoặc đổi mạng (wifi ↔ 4G)."; return; }
  relaySend({ t: "rhello" });
  const iv = setInterval(() => { if (net.connected) return clearInterval(iv); relaySend({ t: "rhello" }); }, 1500);
  setTimeout(() => { if (!net.connected) $("roomErr").textContent = "Chưa vào được phòng. Kiểm tra lại mã phòng, và để máy chủ phòng mở màn hình chờ."; }, 12000);
}
async function createRoom() {
  net.host = true; $("lobbyErr").textContent = ""; show("room");
  $("p1St").textContent = "Bạn (chủ phòng)"; $("p2St").textContent = "Đang chờ…";
  if (LOCAL) return localOpen(newCode());
  await iceReady;
  let ok = false;
  for (let tries = 0; tries < 4 && !ok; tries++) {
    const code = newCode();
    try { await openPeer(ID(code)); net.code = code; ok = true; }
    catch (e) { if (e?.type !== "unavailable-id") break; }
  }
  if (!ok) { net.code = newCode(); diagSet("sig", "lỗi – chỉ dùng chuyển tiếp"); }
  else { diagSet("sig", "đã kết nối ✓"); net.peer.on("connection", wire); }
  $("codeBig").textContent = net.code; $("roomStatus").textContent = "Phòng đã mở. Chờ đối thủ nhập mã…";
  relayStart();                        // chủ phòng luôn nghe cả kênh chuyển tiếp
}
function openPeer(id) {
  return new Promise((res, rej) => {
    const opt = { debug: 0, config: { iceServers: ICE } };
    const p = id ? new Peer(id, opt) : new Peer(opt);
    const to = setTimeout(() => { if (!net.peer) { p.destroy(); rej({ type: "timeout" }); } }, 8000);
    p.on("open", () => { clearTimeout(to); net.peer = p; res(p); });
    p.on("error", e => { if (!net.peer) { clearTimeout(to); p.destroy(); rej(e); } else onPeerError(e); });
    p.on("disconnected", () => { try { p.reconnect(); } catch {} });
  });
}
async function joinRoom(code) {
  code = code.toUpperCase().trim();
  if (!/^[A-Z0-9]{4}$/.test(code)) { $("lobbyErr").textContent = "Mã phòng gồm 4 ký tự."; return; }
  net.host = false; net.code = code; show("room");
  $("codeBig").textContent = code; $("roomStatus").textContent = "Đang kết nối…";
  $("p1St").textContent = "Chủ phòng"; $("p2St").textContent = "Bạn";
  if (LOCAL) return localOpen(code);
  await iceReady;
  relayStart();                        // chuẩn bị sẵn đường chuyển tiếp
  try { await openPeer(); diagSet("sig", "đã kết nối ✓"); }
  catch (e) { diagSet("sig", "lỗi (" + (e?.type || "?") + ")"); return goRelay("bỏ qua – máy chủ ghép phòng lỗi"); }
  diagSet("p2p", "đang thử…");
  const opts = { serialization: "json" };
  wire(net.peer.connect(ID(code), { ...opts, label: "state", reliable: false }));
  wire(net.peer.connect(ID(code), { ...opts, label: "event", reliable: true }));
  setTimeout(() => { if (!net.connected) goRelay("không nối thẳng được (NAT/4G) → chuyển tiếp"); }, P2P_WAIT);
}
function onPeerError(e) {
  if (e?.type === "peer-unavailable") { diagSet("p2p", "không thấy phòng qua P2P"); goRelay("không thấy phòng qua P2P → thử chuyển tiếp"); }
  else if (e?.type) console.warn("peer", e.type);
}
function localOpen(code) {
  net.code = code; $("codeBig").textContent = code; net.mode = "local";
  net.local = new BroadcastChannel("hmwiz-" + code);
  net.local.onmessage = e => { const { from, msg } = e.data; if ((from === "h") === net.host) return; onMsg(msg); };
  if (net.host) $("roomStatus").textContent = "Chế độ test 2 cửa sổ · chờ cửa sổ kia vào…";
  else send({ t: "hello" });
}
function onConnected() {
  if (net.connected) return;
  net.connected = true;
  $("roomErr").textContent = "";
  $("roomStatus").textContent = (net.mode === "relay" ? "Đã kết nối qua chuyển tiếp." : "Đã kết nối trực tiếp!") + " Cả hai bấm “Sẵn sàng”.";
  (net.host ? $("p2Card") : $("p1Card")).classList.add("ok");
  (net.host ? $("p2St") : $("p1St")).textContent = "Đã vào phòng";
  setInterval(() => send({ t: "ping", ts: performance.now() }), 1000);
  if (me.ready) send(readyMsg());
}
function onDisconnect() {
  if (!net.connected) return;
  net.connected = false;
  banner("MẤT KẾT NỐI", "Đối thủ đã rời phòng", 0);
  $("endBox").classList.add("on");
}



/* ======================= ĐẤU TRƯỜNG PHÉP THUẬT ARCADE ======================= */
const W = 480, H = 270, FLOOR = 248, HIGH = 94;
const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* Khung hình trong atlas.png: [x, y, rộng, cao, neoX] */
const ATLAS = {"you":[[0,272,125,132,58],[127,272,127,125,56],[256,272,108,131,46],[366,272,106,132,42],[474,272,116,131,59],[592,272,141,119,66],[735,272,115,133,57],[852,272,105,123,52],[0,407,116,80,58],[118,407,119,100,40],[239,407,120,123,72],[361,407,169,34,84]],
"knight":[[0,532,134,146,88],[136,532,137,129,90],[275,532,132,146,83],[409,532,117,181,52],[528,532,190,118,95],[720,532,106,109,54],[828,532,144,122,52],[0,715,162,60,81]],
"witch":[[0,777,118,138,70],[120,777,113,121,66],[235,777,132,135,72],[369,777,121,151,59],[492,777,160,122,80],[654,777,81,147,40],[737,777,115,132,54],[854,777,159,37,79]],
"lich":[[0,930,110,156,58],[112,930,113,141,60],[227,930,116,151,58],[345,930,131,176,72],[478,930,171,127,85],[651,930,122,131,67],[775,930,115,131,54],[0,1108,158,56,79]]};
const OPP = [
  { kind: "knight", name: "Giáp sắt yểm bùa", hp: 100, spd: 34, dist: 170, rest: [2.4, 3.3], wind: .6, types: ["hi"], dmg: 8, bolt: 190, shield: .12, col: "#7fd4ff" },
  { kind: "witch", name: "Đấu sĩ mặt nạ", hp: 150, spd: 58, dist: 215, rest: [1.5, 2.3], wind: .48, types: ["hi", "hi", "lo"], dmg: 11, bolt: 240, shield: .32, col: "#b06cff" },
  { kind: "lich", name: "Vua pháp sư", hp: 210, spd: 46, dist: 240, rest: [1.0, 1.7], wind: .4, types: ["hi", "lo", "th", "th"], dmg: 14, bolt: 290, shield: .5, col: "#ff5a3c" },
];
const TIER = { 1: { mp: 10, k: 1, n: "Cấp 1" }, 2: { mp: 20, k: 1.25, n: "Cấp 2" }, 3: { mp: 35, k: 1.6, n: "Cấp 3" }, 4: { mp: 55, k: 2, n: "Tối thượng" } };
/* 18 phép combo. Mỗi phép trả về danh sách "đòn" (đạn bay hoặc đòn hẹn giờ) – xem spawn() */
const SP = [
  { k: "FG", t: 1, n: "Expelliarmus", s: "Harry", b: 18, d: "Tia đỏ thắm, vũ khí đối thủ văng ra", mk: (c, D) => [{ p: 1, v: 330, dmg: D, col: "#ff2d55", on: { stun: .7, disarm: 1 } }] },
  { k: "GF", t: 1, n: "Petrificus Totalus", s: "Hermione", b: 20, d: "Đối thủ hoá cứng, đứng im ít giây", mk: (c, D) => [{ p: 1, v: 300, dmg: D, col: "#cfd8dc", on: { ctrl: ["stone", 1.8] } }] },
  { k: "FV", t: 1, n: "Avis + Oppugno", s: "Hermione", b: 9, m: 4, d: "Đàn chim vàng lượn quanh đũa rồi lao vào", mk: (c, D) => [0, 1, 2, 3].map(i => ({ p: 1, v: 250, dmg: D, col: "#ffd84a", shape: "bird", hom: 1, h: HIGH + 26 - i * 14, wait: .35 + i * .13 })) },
  { k: "GV", t: 1, n: "Dao găm bay", s: "McGonagall", b: 9, m: 4, d: "Đàn dao bạc phóng tới", mk: (c, D) => [0, 1, 2, 3].map(i => ({ p: 1, v: 420, dmg: D, col: "#e8eef5", shape: "dagger", h: HIGH + 18 - i * 12, wait: i * .1 })) },
  { k: "CV", t: 1, n: "Protego Maxima", s: "Flitwick", b: 0, d: "Vòm khiên lớn, chặn mọi đòn 3,2 giây", self: c => { c.big = 3.2; } },
  { k: "VC", t: 1, n: "Bay không chổi", s: "Voldemort", b: 16, d: "Hoá khói đen lao qua đối thủ, bất tử 2,7 giây", self: c => { c.smoke = 2.7; c.fly = .9; }, mk: (c, D) => [{ wait: .45, dmg: D, fx: "smoke" }] },
  { k: "BF", t: 1, n: "Expecto Patronum", s: "Dumbledore", b: 0, d: "Phượng hoàng bạc bay qua, xoá mọi đòn đang bay, hồi 15 HP", self: c => { c.hp = Math.min(c.max, c.hp + 15); clearAttacksOn(c.i); FX.push({ k: "phoenix", t: 0, d: 1.1, dir: c.dir, y: FLOOR - 120 }); } },
  { k: "FFV", t: 2, n: "Sectumsempra", s: "Snape", b: 13, m: 3, d: "Ba nhát chém trắng chéo qua đối thủ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .15 + i * .2, dmg: D, fx: "slash", n: i })) },
  { k: "GGF", t: 2, n: "Levicorpus", s: "Snape", b: 6, d: "Treo ngược đối thủ 2,6 giây rồi thả rơi (6 + 12)", mk: (c, D, K) => [{ wait: .1, dmg: D, on: { ctrl: ["lev", 2.6, 12 * K] } }] },
  { k: "VVC", t: 2, n: "Biến hình", s: "McGonagall", b: 25, d: "Đối thủ thành cốc vàng vài giây, không đánh được", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["cup", 2.5] } }] },
  { k: "BBF", t: 2, n: "Cầu nước", s: "Dumbledore", b: 0, d: "Nhốt đối thủ trong khối nước 2,3 giây rồi vỡ tung (30)", mk: (c, D, K) => [{ wait: .2, dmg: 0, on: { ctrl: ["water", 2.3, 30 * K] } }] },
  { k: "CCV", t: 2, n: "Piertotum Locomotor", s: "McGonagall", b: 18, m: 2, d: "Hai tượng đá từ mép sân bước tới chém", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "statue", n: 0 }, { wait: 1.4, dmg: D, fx: "statue", n: 1 }] },
  { k: "FFFV", t: 3, n: "Rắn lửa", s: "Voldemort", b: 45, d: "Mãng xà lửa uốn lượn lao tới, nổ lớn", mk: (c, D) => [{ p: 1, v: 210, dmg: D, col: "#ff7a1f", shape: "snake", h: 70, big: 1 }] },
  { k: "GGGF", t: 3, n: "Vòng lửa", s: "Dumbledore", b: 40, d: "Vòng lửa đỏ vàng lan từ chân ra hết sân", mk: (c, D, K, dist) => [{ wait: dist / 340, dmg: D, fx: "ring", col: "#ff8a1f" }] },
  { k: "VVVC", t: 3, n: "Protego Diabolica", s: "Grindelwald", b: 40, d: "Như Vòng lửa nhưng lửa xanh lam", mk: (c, D, K, dist) => [{ wait: dist / 340, dmg: D, fx: "ring", col: "#3aa0ff" }] },
  { k: "BBBF", t: 3, n: "Bão sét", s: "Grindelwald", b: 36, d: "Trời tối lại, sáu tia sét, tia cuối trúng đối thủ", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "storm" }] },
  { k: "FCGBV", t: 4, n: "Crucio", s: "Voldemort", b: 8, m: 6, d: "Tia đỏ giật liên tục nối hai bên, xuyên khiên", mk: (c, D) => [0, 1, 2, 3, 4, 5].map(i => ({ wait: .1 + i * .32, dmg: D, pierce: 1, fx: "crucio" })) },
  { k: "VBGCF", t: 4, n: "Avada Kedavra", s: "Voldemort", b: 90, fixed: 1, d: "Tia xanh lục lớn, chớp toàn màn hình, xuyên khiên", mk: (c, D) => [{ wait: .25, dmg: D, pierce: 1, fx: "avada" }] },
];
const me = { ready: false, name: "" }, readyMsg = () => ({ t: "ready", name: me.name });
const G = { mode: "", lvl: 0, phase: "menu", round: 1, score: [0, 0], ME: 0, t: 0, stop: 0, shake: 0, flash: 0, ko: 0, cine: null, hits: 0, hitT: 0, keys: [], sound: true, names: ["", ""] };
let F = [], ATK = [], FX = [], NUM = [], aid = [0, 0];
const KEY = { l: 0, r: 0, u: 0, d: 0 }, seq = { s: "", t: -9 };
const own = i => G.mode === "ai" || i === G.ME;        // máy này có quyền quyết định cho nhân vật i không
const isAI = i => G.mode === "ai" && i === 1;

function newF(i, kind) {
  const o = kind === "you" ? null : OPP[G.lvl];
  return { i, kind, dir: i ? -1 : 1, x: i ? 372 : 110, y: 0, vy: 0, hp: o ? o.hp : 100, max: o ? o.hp : 100, lag: 1, mp: 60, stun: 0, inv: 0, shield: 0, parry: 0, charge: 0, big: 0, smoke: 0, fly: 0, lock: 0, ctrl: null, crouch: false, walk: 0, moving: false, act: "", actT: 0, cd: {}, ko: false, q: [], ai: o ? { rest: rnd(...o.rest), wind: 0, type: "", fire: 0 } : null };
}
function startMatch(mode, lvl) {
  G.mode = mode; G.lvl = lvl || 0; G.round = 1; G.score = [0, 0]; G.ME = mode === "pvp" && !net.host ? 1 : 0;
  show("game"); $("oppPick").style.display = mode === "ai" ? "" : "none"; document.querySelectorAll("#oppPick button").forEach((b, i) => b.classList.toggle("on", i === G.lvl));
  newRound();
}
function newRound() {
  F = [newF(0, "you"), newF(1, G.mode === "ai" ? OPP[G.lvl].kind : "you")]; ATK = []; FX = []; NUM = []; aid = [0, 0];
  G.phase = "fight"; G.ko = 0; G.hits = 0; G.cine = null; seq.s = "";
  G.names = G.mode === "ai" ? [me.name || "Pháp sư", OPP[G.lvl].name] : (G.ME === 0 ? [me.name || "Pháp sư 1", G.oppName || "Đối thủ"] : [G.oppName || "Đối thủ", me.name || "Pháp sư 2"]);
  pop("ROUND " + G.round, W / 2, 120, "#fff", 1.2, 2);
}

/* ======================= ÂM THANH ======================= */
let AC = null;
function beep(f, d = .08, type = "square", vol = .06, slide = 0) { if (!G.sound) return; try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d + .02); } catch {} }

/* ======================= ĐIỀU KHIỂN ======================= */
const KMAP = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }, AMAP = { KeyF: "F", KeyG: "G", KeyC: "C", KeyV: "V", KeyB: "B" };
addEventListener("keydown", e => { if (!$("game").classList.contains("on")) return; if (KMAP[e.code] || AMAP[e.code]) e.preventDefault(); if (e.repeat) return; if (KMAP[e.code]) KEY[KMAP[e.code]] = 1; if (AMAP[e.code]) press(AMAP[e.code]); });
addEventListener("keyup", e => { if (KMAP[e.code]) KEY[KMAP[e.code]] = 0; });
const canAct = p => !p.ko && G.phase === "fight" && p.stun <= 0 && !p.ctrl && p.lock <= 0 && p.charge <= 0 && p.fly <= 0;
function press(k) {
  const p = F[G.ME]; if (!p || G.phase !== "fight" || p.ko) return;
  seq.s = G.t - seq.t < .5 ? (seq.s + k).slice(-6) : k; seq.t = G.t; G.keys.push({ k, t: G.t }); if (G.keys.length > 8) G.keys.shift();
  if (!canAct(p)) return;
  // tìm combo dài nhất khớp với phần cuối chuỗi phím
  let best = null; for (const s of SP) if (seq.s.endsWith(s.k) && (!best || s.k.length > best.k.length)) best = s;
  if (best) { if (p.mp >= TIER[best.t].mp) { seq.s = ""; return doCast(G.ME, SP.indexOf(best), true); } pop("NO MP", p.x, FLOOR - 150, "#7fd4ff", .8); beep(140, .12, "sawtooth"); }
  doBasic(G.ME, k, true);
}
function tapSpell(i) { const p = F[G.ME]; if (!p || !canAct(p)) return; if (p.mp < TIER[SP[i].t].mp) { pop("NO MP", p.x, FLOOR - 150, "#7fd4ff", .8); return; } doCast(G.ME, i, true); }

/* ======================= ĐÒN CƠ BẢN & PHÉP ======================= */
const CD = { F: .3, G: .65, C: .5, V: .9, B: .7 };
function doBasic(i, k, local) {
  const p = F[i]; if (local && (p.cd[k] || 0) > 0) return;
  if (local && G.mode === "pvp") send({ t: "b", k });
  p.cd[k] = CD[k];
  if (k === "F") { p.act = "cast"; p.actT = .18; spawn(i, { p: 1, v: 300, dmg: 6, col: "#ffe680", basic: 1 }); beep(880, .06); aiReact(i, .4); }
  if (k === "G") { p.act = "heavy"; p.actT = .3; p.lock = .22; spawn(i, { p: 1, v: 240, dmg: 13, col: "#ff9d3c", low: G.mode === "pvp", h: G.mode === "pvp" ? 14 : HIGH, basic: 1, fat: 1 }); beep(330, .12, "sawtooth"); aiReact(i, .7); }
  if (k === "C") { p.shield = .85; p.cd.C = .85 + CD.C; beep(520, .1, "triangle"); }
  if (k === "V") { p.parry = .38; beep(700, .05, "triangle"); }
  if (k === "B") { p.charge = .65; beep(260, .3, "sine", .05, 520); }
}
function doCast(i, si, local) {
  const p = F[i], s = SP[si], T = TIER[s.t], tg = F[1 - i];
  if (local) { p.mp -= T.mp; if (G.mode === "pvp") send({ t: "c", s: si }); }
  const wait = s.t >= 3 ? .6 : .42;
  p.lock = wait + .15; p.act = "wind"; p.actT = wait; G.cine = { n: s.n, t: 0, d: wait + .25, tier: s.t, i }; beep(200, wait, "sawtooth", .05, 900); aiReact(i, 1);
  p.q.push({ t: wait, fn: () => {
    p.act = s.t >= 3 ? "heavy" : "cast"; p.actT = .3; beep(1200, .15, "square", .07, 300);
    if (s.self) s.self(p);
    if (s.mk) { const D = s.fixed ? s.b : s.b * T.k; s.mk(p, D, T.k, Math.abs(tg.x - p.x)).forEach(a => spawn(i, { ...a, sp: 1, name: s.n })); }
  } });
}
/* tạo một "đòn": đạn bay (p:1) hoặc đòn hẹn giờ (wait). Hai máy tạo cùng thứ tự nên cùng mã id */
function spawn(i, a) {
  const c = F[i]; a.id = i + ":" + (aid[i]++); a.from = i; a.to = 1 - i; a.age = 0; a.wait = a.wait || 0;
  if (a.p) { a.x = c.x + c.dir * 46; a.h = a.h ?? HIGH; a.v = a.v * c.dir; a.h0 = a.h; }
  a.cx = c.x; a.dir = c.dir; ATK.push(a); return a;
}
function clearAttacksOn(i) { ATK = ATK.filter(a => a.to !== i); }
/* máy đấu thấy người chơi ra chiêu thì có thể dựng khiên */
function aiReact(i, k) { const o = F[1]; if (G.mode !== "ai" || i !== 0 || !o || o.ko || o.ctrl || o.stun > 0 || o.shield > 0) return; if (Math.random() < OPP[G.lvl].shield * k) { o.shield = 1.1; o.ai.wind = 0; } }

/* Người sở hữu mục tiêu quyết định đòn có trúng không */
function resolve(a, T) {
  const res = { id: a.id, r: "hit", dmg: 0, x: T.x, h: a.p ? a.h : 70 };
  if (T.ko) return null;
  if (a.cond && Math.abs(T.x - a.tx) > 30) res.r = "miss";
  else if (T.smoke > 0 || (T.inv > 0 && !a.sp)) res.r = "miss";
  else if (a.p && !a.low && T.crouch && !a.big) res.r = "miss";
  else if (a.p && a.low && T.y > 24) res.r = "miss";
  else if (T.big > 0 && !a.pierce) res.r = "block";
  else if (T.parry > 0 && !a.pierce) { res.r = "parry"; }
  else if (T.shield > 0 && !a.pierce) { if (T.ai) { res.r = "guard"; res.dmg = Math.max(1, Math.round(a.dmg * .2)); } else res.r = "block"; }
  else res.dmg = Math.round(a.dmg);
  if (res.r === "miss") { if (a.p) { a.passed = 1; return null; } return res; }
  if (res.dmg > 0) {
    T.hp = Math.max(0, T.hp - res.dmg);
    if (res.r === "hit") { if (!T.ctrl) { T.stun = T.ai ? .25 : .34; T.x = clamp(T.x - T.dir * 10, 36, 448); } if (!T.ai) T.inv = .55; T.charge = 0; if (T.ai) T.ai.wind = 0;
      if (a.on) { if (a.on.stun) T.stun = a.on.stun; if (a.on.ctrl) { T.ctrl = { k: a.on.ctrl[0], t: a.on.ctrl[1], end: a.on.ctrl[2] || 0 }; T.shield = 0; T.y = 0; T.vy = 0; } if (a.on.disarm) res.disarm = 1; } }
  } else if (res.r === "hit" && a.on?.ctrl) { T.ctrl = { k: a.on.ctrl[0], t: a.on.ctrl[1], end: a.on.ctrl[2] || 0 }; T.shield = 0; T.y = 0; T.vy = 0; }
  if (res.r === "parry") { T.parry = 0; spawn(T.i, { p: 1, v: 360, dmg: 15, col: "#fff", sp: 1 }); if (G.mode === "pvp") send({ t: "rf" }); }
  if (T.hp <= 0) res.ko = 1;
  return res;
}
/* hiển thị kết quả (cả hai máy) */
function showRes(res, a) {
  const T = F[a ? a.to : res.to], X = res.x, Y = FLOOR - res.h - (T ? T.y : 0), col = a?.col || "#fff";
  if (res.r === "hit" || res.r === "guard") {
    if (res.dmg > 0) { pop("-" + res.dmg, X + rnd(-8, 8), Y - 20, res.r === "guard" ? "#9fd8ff" : "#ffe14a", .9); G.stop = Math.max(G.stop, .06); G.shake = Math.max(G.shake, a?.sp ? 7 : 3.5); G.flash = Math.max(G.flash, a?.sp ? .35 : .15); burst(X, Y, col, a?.big || a?.fx ? 26 : 12); beep(res.r === "guard" ? 300 : 160, .1, "sawtooth", .08, 60);
      if ((a ? a.from : 1 - res.to) === G.ME) { G.hits++; G.hitT = 2.4; } }
    if (res.disarm) FX.push({ k: "wand", t: 0, d: .8, x: X, y: Y });
  } else if (res.r === "block") { pop("PROTEGO", X, Y - 24, "#7fd4ff", .7); burst(X, Y, "#7fd4ff", 8); beep(900, .06, "triangle"); }
  else if (res.r === "parry") { pop("PHẢN ĐÒN!", X, Y - 24, "#fff", .9); burst(X, Y, "#fff", 14); G.stop = .08; beep(1400, .1, "square"); }
  else if (res.r === "miss" && a && !a.p) pop("TRƯỢT", X, Y - 24, "#bbb", .6);
  if (res.ko) doKO(a ? a.to : res.to);
}
function doKO(loser) {
  if (G.phase !== "fight") return; G.phase = "ko"; G.ko = 2.8; G.stop = .28; G.shake = 10; G.flash = .6; F[loser].ko = true; F[loser].ctrl = null; ATK = [];
  G.loser = loser; G.score[1 - loser]++; beep(100, .6, "sawtooth", .1, 40);
  saveResult(loser !== G.ME);
}
/* ======================= CẬP NHẬT ======================= */
function stepFighter(p, dt) {
  for (let k in p.cd) p.cd[k] -= dt;
  ["stun", "inv", "shield", "parry", "big", "smoke", "lock", "actT", "fly"].forEach(k => { if (p[k] > 0) p[k] = Math.max(0, p[k] - dt); });
  for (let j = p.q.length - 1; j >= 0; j--) { p.q[j].t -= dt; if (p.q[j].t <= 0) { const e = p.q.splice(j, 1)[0]; if (!p.ko) e.fn(); } }
  if (p.charge > 0) { p.charge -= dt; p.mp = Math.min(100, p.mp + 48 * dt); if (Math.random() < .5) FX.push({ k: "mote", t: 0, d: .4, x: p.x + rnd(-30, 30), y: FLOOR - rnd(10, 110), tx: p.x + p.dir * 40, ty: FLOOR - HIGH, c: "#7fd4ff" }); }
  if (!p.ai) p.mp = Math.min(100, p.mp + 7 * dt);
  if (p.ctrl) { p.ctrl.t -= dt; if (p.ctrl.t <= 0) { const e = p.ctrl.end, k = p.ctrl.k; p.ctrl = null; if (e && own(p.i) && !p.ko) { p.hp = Math.max(0, p.hp - Math.round(e)); const res = { id: "c", to: p.i, r: "hit", dmg: Math.round(e), x: p.x, h: 60, ko: p.hp <= 0 ? 1 : 0, endc: k }; showRes(res, null); if (G.mode === "pvp") send({ t: "res", res }); } if (k === "water") burst(p.x, FLOOR - 70, "#5ad1ff", 40); p.stun = .3; } }
  p.vy -= 900 * dt; p.y += p.vy * dt; if (p.y <= 0) { p.y = 0; p.vy = 0; }
}
function stepLocal(p, dt) {
  const o = F[1 - p.i]; p.moving = false; p.crouch = false;
  if (G.phase !== "fight" || p.stun > 0 || p.ctrl || p.ko || p.charge > 0 || p.lock > 0 || p.fly > 0) return;
  if (KEY.d && p.y === 0) { p.crouch = true; return; }
  const mv = (KEY.r ? 1 : 0) - (KEY.l ? 1 : 0);
  if (mv) { p.x += mv * 125 * dt; p.moving = true; p.walk += dt; }
  p.x = p.i === 0 ? clamp(p.x, 36, o.x - 100) : clamp(p.x, o.x + 100, 444);
  if (KEY.u && p.y === 0) { p.vy = 340; beep(500, .08, "square", .04, 800); }
}
function stepAI(p, dt) {
  const o = OPP[G.lvl], a = p.ai, pl = F[0]; p.moving = false;
  if (p.ko || G.phase !== "fight" || p.ctrl || p.stun > 0) { a.wind = 0; return; }
  if (a.fire > 0) { a.fire -= dt; return; }
  if (a.wind > 0) { a.wind -= dt; p.act = "wind"; p.actT = .1; if (a.wind <= 0) { a.fire = .32; p.act = "cast"; p.actT = .32; a.rest = rnd(...o.rest); beep(240, .15, "sawtooth", .06, 120);
      if (a.type === "th") spawn(1, { wait: .8, dmg: o.dmg, cond: 1, tx: pl.x, fx: "thunder", col: o.col });
      else spawn(1, { p: 1, v: a.type === "lo" ? o.bolt * .85 : o.bolt, dmg: o.dmg, col: o.col, low: a.type === "lo", h: a.type === "lo" ? 10 : HIGH }); } return; }
  if (p.shield > 0) return;
  const want = pl.x + o.dist, dx = want - p.x;
  if (Math.abs(dx) > 14) { p.x += Math.sign(dx) * o.spd * dt; p.moving = true; p.walk += dt; }
  p.x = clamp(p.x, pl.x + 100, 448);
  a.rest -= dt; if (a.rest <= 0) { a.type = o.types[Math.floor(Math.random() * o.types.length)]; a.wind = o.wind; }
}
function stepAttacks(dt) {
  for (let j = ATK.length - 1; j >= 0; j--) {
    const a = ATK[j], T = F[a.to]; a.age += dt;
    if (a.age < a.wait) continue;
    if (a.p) {
      a.x += a.v * dt; const fl = a.age - a.wait;
      if (a.hom) a.h += (HIGH - 20 + T.y - a.h) * Math.min(1, dt * 3) + Math.sin(fl * 14 + a.h0) * 30 * dt;
      if (a.shape === "snake") a.h = a.h0 + Math.sin(fl * 7) * 26;
      if (Math.random() < .7) FX.push({ k: "spark", t: 0, d: .25, x: a.x, y: FLOOR - a.h, vx: rnd(-20, 20), vy: rnd(-20, 20), c: a.col });
      if (!a.passed && Math.abs(a.x - T.x) < (a.big ? 30 : 20) && own(a.to)) { const res = resolve(a, T); if (res) { showRes(res, a); if (G.mode === "pvp") send({ t: "res", res, aid: a.id }); ATK.splice(j, 1); continue; } }
      if (a.x < -40 || a.x > W + 40) ATK.splice(j, 1);
    } else if (!a.done) {
      a.done = 1; a.hitAt = a.age;
      if (own(a.to)) { const res = resolve(a, T); if (res) { showRes(res, a); if (G.mode === "pvp") send({ t: "res", res, aid: a.id }); } }
      if (a.fx === "avada" || a.fx === "storm" || a.fx === "thunder") { G.flash = Math.max(G.flash, a.fx === "avada" ? .9 : .5); G.shake = 8; }
    } else if (a.age - a.hitAt > .5) ATK.splice(j, 1);
  }
}
function update(dt) {
  G.t += dt;
  if (G.cine) { G.cine.t += dt; if (G.cine.t > G.cine.d) G.cine = null; }
  if (G.hitT > 0) { G.hitT -= dt; if (G.hitT <= 0) G.hits = 0; }
  F.forEach(p => { stepFighter(p, dt); if (p.ai) stepAI(p, dt); else if (p.i === G.ME) stepLocal(p, dt); });
  // bay khói: lao tới đối thủ rồi quay về
  F.forEach(p => { if (!own(p.i)) return; if (p.fly > 0) { const k = 1 - p.fly / .9, o = F[1 - p.i]; p.flyX = p.x + (o.x - p.x) * Math.sin(k * Math.PI); } else p.flyX = null; });
  stepAttacks(dt);
  F.forEach(p => { p.lag += ((p.hp / p.max) - p.lag) * Math.min(1, dt * 2.5); if (p.lag < p.hp / p.max) p.lag = p.hp / p.max; });
  if (G.phase === "ko") { G.ko -= dt; if (G.ko <= 0 && (G.mode === "ai" || net.host)) { G.round++; if (G.mode === "pvp") send({ t: "round", n: G.round, sc: G.score }); newRound(); } }
  for (let j = FX.length - 1; j >= 0; j--) { const f = FX[j]; f.t += dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; } if (f.t > f.d) FX.splice(j, 1); }
  for (let j = NUM.length - 1; j >= 0; j--) { NUM[j].t += dt; NUM[j].y -= 26 * dt; if (NUM[j].t > NUM[j].d) NUM.splice(j, 1); }
  if (FX.length > 500) FX.splice(0, FX.length - 500);
}
function pop(tx, x, y, c, d = .9, big = 1) { NUM.push({ tx, x, y, c, t: 0, d, big }); }
function burst(x, y, c, n) { for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), v = rnd(30, 170); FX.push({ k: "spark", t: 0, d: rnd(.2, .5), x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: i % 3 ? c : "#fff" }); } }

/* ======================= VẼ ======================= */
const cv = $("cv"), x = cv.getContext("2d"); x.imageSmoothingEnabled = false;
const atlas = new Image(); atlas.src = "./atlas.png";
const tmp = document.createElement("canvas"), tx = tmp.getContext("2d"); tmp.width = 200; tmp.height = 190;
function frameOf(p) {
  const you = p.kind === "you", t = G.t;
  if (p.ko) return you ? 11 : 7;
  if (p.stun > 0 && !p.ctrl) return you ? 10 : 6;
  if (p.shield > 0 || p.big > 0 || p.parry > 0) return you ? 7 : 5;
  if (p.actT > 0) return you ? (p.act === "wind" ? 4 : p.act === "heavy" ? 6 : 5) : (p.act === "wind" ? 3 : 4);
  if (p.charge > 0) return you ? 4 : 3;
  if (you && p.y > 0) return 9;
  if (you && p.crouch) return 8;
  if (p.moving) return you ? 2 + Math.floor(p.walk * 7) % 2 : (Math.floor(p.walk * 5) % 2 ? 2 : 0);
  return Math.floor(t * 2.2) % 2;
}
function drawFighter(p) {
  const fr = ATLAS[p.kind][p.rf ?? frameOf(p)], [sx, sy, w, h, ax] = fr, flip = p.kind === "you" && p.i === 1, px = Math.round(p.flyX ?? p.x), c = p.ctrl;
  let top = FLOOR - h - Math.round(p.y);
  if (p.smoke > 0) { x.save(); x.globalAlpha = .75; x.fillStyle = "#0a0a12"; for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(px + Math.sin(G.t * 9 + i * 2) * 16 - p.dir * i * 5, FLOOR - 30 - i * 10 + Math.cos(G.t * 7 + i) * 6, 14 - i * .8, 0, 6.283); x.fill(); } x.restore(); return; }
  if (c && c.k === "cup") { x.fillStyle = "#F2B705"; x.fillRect(px - 12, FLOOR - 34, 24, 22); x.fillRect(px - 4, FLOOR - 12, 8, 8); x.fillRect(px - 10, FLOOR - 4, 20, 4); x.fillStyle = "#fff3"; x.fillRect(px - 9, FLOOR - 32, 4, 16); x.strokeStyle = "#F2B705"; x.lineWidth = 3; x.strokeRect(px + 12, FLOOR - 30, 7, 12); return; }
  if (p.inv > 0 && Math.floor(G.t * 20) % 2) return;
  tx.clearRect(0, 0, 200, 190); tx.globalCompositeOperation = "source-over"; tx.drawImage(atlas, sx, sy, w, h, 0, 0, w, h);
  const tint = c?.k === "stone" ? "rgba(120,125,130,.85)" : flip ? "rgba(120,60,220,.38)" : null;
  if (tint) { tx.globalCompositeOperation = "source-atop"; tx.fillStyle = tint; tx.fillRect(0, 0, w, h); }
  x.save();
  if (c?.k === "lev") { const k = Math.min(1, (c.t0 = (c.t0 || 0) + .05)); x.translate(px, top - 46 * k + Math.sin(G.t * 5) * 3 + h / 2); x.scale(flip ? -1 : 1, -1); x.drawImage(tmp, 0, 0, w, h, -ax, -h / 2, w, h); }
  else { x.translate(px, 0); if (flip) x.scale(-1, 1); x.drawImage(tmp, 0, 0, w, h, -ax, top, w, h); }
  x.restore();
  if (c?.k === "water") { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = "rgba(60,160,255,.45)"; x.beginPath(); x.arc(px, FLOOR - 62, 52 + Math.sin(G.t * 6) * 2, 0, 6.283); x.fill(); x.fillStyle = "#cfefff"; for (let i = 0; i < 6; i++) x.fillRect(px + Math.sin(G.t * 3 + i * 2) * 36, FLOOR - 20 - ((G.t * 40 + i * 17) % 90), 2, 2); x.restore(); }
  const sh = p.big > 0 ? 62 : p.shield > 0 ? 44 : 0;
  if (sh) { x.save(); x.globalCompositeOperation = "lighter"; x.strokeStyle = p.big > 0 ? "#bfe6ff" : "#7fd4ff"; x.lineWidth = 2; x.globalAlpha = .6 + .3 * Math.sin(G.t * 20); x.beginPath(); if (p.big > 0) x.arc(px, FLOOR, sh, Math.PI, 0); else x.ellipse(px + p.dir * 30, FLOOR - 70, 9, 50, 0, 0, 6.283); x.stroke(); x.fillStyle = "rgba(127,212,255,.12)"; x.fill(); x.restore(); }
  if (p.parry > 0) { x.strokeStyle = "#fff"; x.lineWidth = 1; x.strokeRect(px + p.dir * 30 - 4, FLOOR - HIGH - 14, 8, 28); }
  if (p.ai && p.ai.wind > 0) { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = OPP[G.lvl].col; const r = 4 + (1 - p.ai.wind / OPP[G.lvl].wind) * 6; x.beginPath(); x.arc(px - 40, FLOOR - (p.ai.type === "lo" ? 12 : p.ai.type === "th" ? 150 : HIGH), r, 0, 6.283); x.fill(); x.restore(); }
}
function drawAttack(a) {
  if (a.age < a.wait && !a.fx) return;
  const T = F[a.to], C = F[a.from], col = a.col || "#fff"; x.save(); x.globalCompositeOperation = "lighter";
  if (a.p) { if (a.age < a.wait) { x.restore(); return; } const X = a.x, Y = FLOOR - a.h, d = Math.sign(a.v);
    if (a.shape === "bird") { x.strokeStyle = col; x.lineWidth = 2; const f = Math.sin(a.age * 30) * 4; x.beginPath(); x.moveTo(X - 6, Y - f); x.lineTo(X, Y); x.lineTo(X + 6, Y - f); x.stroke(); }
    else if (a.shape === "dagger") { x.fillStyle = col; x.beginPath(); x.moveTo(X + d * 12, Y); x.lineTo(X - d * 6, Y - 3); x.lineTo(X - d * 6, Y + 3); x.fill(); }
    else if (a.shape === "snake") { for (let i = 0; i < 12; i++) { const fl = a.age - a.wait - i * .035; x.fillStyle = i % 2 ? "#ffd84a" : col; x.beginPath(); x.arc(X - d * i * 9, FLOOR - (a.h0 + Math.sin(fl * 7) * 26), 9 - i * .55, 0, 6.283); x.fill(); } }
    else { const L = a.fat ? 14 : 20, R = a.fat ? 7 : 4; x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, L, R, 0, 0, 6.283); x.fill(); x.fillStyle = "#fff"; x.beginPath(); x.ellipse(X + d * 4, Y, L * .45, R * .5, 0, 0, 6.283); x.fill(); if (a.low) { x.fillStyle = col; for (let i = 0; i < 4; i++) x.fillRect(X - d * i * 8 - 2, FLOOR - 4 - ((G.t * 60 + i * 9) % 18), 4, 6); } }
    x.restore(); return; }
  const k = a.age / Math.max(.01, a.wait), post = a.done ? a.age - a.hitAt : -1, wx = C.x + C.dir * 46, wy = FLOOR - HIGH - C.y;
  if (a.fx === "thunder") { if (!a.done) { x.strokeStyle = col; x.lineWidth = 2; x.globalAlpha = .5 + .5 * Math.sin(G.t * 30); x.beginPath(); x.ellipse(a.tx, FLOOR, 30 * (1.4 - k * .4), 6, 0, 0, 6.283); x.stroke(); } else if (post < .25) bolt(a.tx, 0, a.tx, FLOOR, col, 5); }
  if (a.fx === "slash" && post >= 0 && post < .2) { x.strokeStyle = "#fff"; x.lineWidth = 3; const o = (a.n - 1) * 14; x.beginPath(); x.moveTo(T.x - 34 + o, FLOOR - 120); x.lineTo(T.x + 34 + o, FLOOR - 20); x.stroke(); }
  if (a.fx === "ring") { const r = Math.min(a.age, a.wait + .4) * 340; x.strokeStyle = col; x.lineWidth = 6; x.globalAlpha = a.done ? Math.max(0, 1 - post * 2.5) : 1; x.beginPath(); x.ellipse(a.cx, FLOOR, r, r * .16, 0, 0, 6.283); x.stroke(); for (let i = 0; i < 14; i++) { const an = i / 14 * 6.283 + G.t * 2; x.fillStyle = i % 2 ? "#fff3a0" : col; x.fillRect(a.cx + Math.cos(an) * r - 2, FLOOR + Math.sin(an) * r * .16 - 10 - (G.t * 50 + i * 7) % 14, 4, 10); } }
  if (a.fx === "storm") { x.globalCompositeOperation = "source-over"; x.fillStyle = `rgba(0,0,20,${a.done ? Math.max(0, .5 - post) : .5})`; x.fillRect(0, 0, W, H); x.globalCompositeOperation = "lighter"; const n = Math.floor(a.age / .2); if (!a.done && a.age % .2 < .09) bolt(60 + (n * 97) % 360, 0, 60 + (n * 97) % 360 + 20, FLOOR, "#bfe6ff", 3); if (post >= 0 && post < .3) bolt(T.x, 0, T.x, FLOOR, "#fff", 7); }
  if (a.fx === "statue") { const sx0 = a.dir > 0 ? -20 : W + 20, gx = a.done ? T.x - a.dir * (34 + a.n * 16) : sx0 + (T.x - a.dir * (34 + a.n * 16) - sx0) * Math.min(1, k); x.globalCompositeOperation = "source-over"; x.globalAlpha = a.done ? Math.max(0, 1 - post * 2) : 1; x.fillStyle = "#8d949c"; x.fillRect(gx - 9, FLOOR - 58 + Math.abs(Math.sin(a.age * 9)) * 3, 18, 44); x.fillRect(gx - 7, FLOOR - 74, 14, 16); x.fillRect(gx - 10, FLOOR - 14, 8, 14); x.fillRect(gx + 2, FLOOR - 14, 8, 14); x.fillStyle = "#c9d1d9"; x.save(); x.translate(gx + a.dir * 8, FLOOR - 50); x.rotate(a.done ? a.dir * 1.2 : -a.dir * .6); x.fillRect(-2, -34, 4, 34); x.restore(); }
  if (a.fx === "crucio" && a.age > a.wait - .3 && post < .1) bolt(wx, wy, T.x, FLOOR - 70, "#ff2030", 3);
  if (a.fx === "avada" && post >= -0.2 && post < .35) { x.fillStyle = "#39ff6a"; x.globalAlpha = .9; const y0 = wy; x.fillRect(Math.min(wx, T.x), y0 - 9, Math.abs(T.x - wx), 18); x.fillStyle = "#eaffea"; x.fillRect(Math.min(wx, T.x), y0 - 3, Math.abs(T.x - wx), 6); }
  x.restore();
}
function bolt(x0, y0, x1, y1, c, w) { x.strokeStyle = c; x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); for (let i = 1; i < 8; i++) x.lineTo(x0 + (x1 - x0) * i / 8 + rnd(-9, 9), y0 + (y1 - y0) * i / 8 + rnd(-5, 5)); x.lineTo(x1, y1); x.stroke(); x.strokeStyle = "#fff"; x.lineWidth = Math.max(1, w / 3); x.stroke(); }
const FONT = n => `${n}px VT323, "Courier New", monospace`;
function text(s, X, Y, c, size = 16, al = "left") { x.font = FONT(size); x.textAlign = al; x.fillStyle = "#000"; x.fillText(s, X + 1, Y + 1); x.fillStyle = c; x.fillText(s, X, Y); }
function hud() {
  [0, 1].forEach(i => { const p = F[i], bw = 190, bx = i ? W - 14 - bw : 14, r = p.hp / p.max;
    x.fillStyle = "#000"; x.fillRect(bx - 2, 12, bw + 4, 12); x.fillStyle = "#3a0d0d"; x.fillRect(bx, 14, bw, 8);
    const lw = bw * p.lag, hw = bw * r; x.fillStyle = "#fff"; x.fillRect(i ? bx : bx + bw - lw, 14, lw, 8); x.fillStyle = r < .3 ? "#ff3b30" : "#ffd21f"; x.fillRect(i ? bx : bx + bw - hw, 14, hw, 8);
    text(G.names[i].toUpperCase().slice(0, 18) + (i === G.ME && G.mode === "pvp" ? " (BẠN)" : ""), i ? W - 14 : 14, 35, i === G.ME ? "#ffe680" : "#fff", 14, i ? "right" : "left");
    if (!p.ai) { x.fillStyle = "#000"; x.fillRect(i ? W - 14 - 122 : 12, 39, 124, 7); x.fillStyle = "#0d2440"; x.fillRect(i ? W - 14 - 120 : 14, 41, 120, 3); x.fillStyle = "#3aa0ff"; const mw = 120 * p.mp / 100; x.fillRect(i ? W - 14 - mw : 14, 41, mw, 3); if (i === G.ME) text("MP " + Math.floor(p.mp), i ? W - 14 : 14, 56, "#7fd4ff", 12, i ? "right" : "left"); } });
  x.fillStyle = "#000"; x.fillRect(W / 2 - 17, 9, 34, 18); x.fillStyle = "#c81e1e"; x.fillRect(W / 2 - 15, 11, 30, 14); text("KO", W / 2, 23, "#fff", 16, "center");
  text(`HIỆP ${G.round}   ${G.score[0]} - ${G.score[1]}`, W / 2, 40, "#fff", 13, "center");
  if (G.hits > 1) text(G.hits + " HIT", G.ME ? W - 20 : 20, 70, "#ffe14a", 22, G.ME ? "right" : "left");
  const ks = G.keys.filter(k => G.t - k.t < 1.6).map(k => k.k).join(" › "); if (ks) text(ks, 10, H - 6, "#9fd8ff", 14);
}
function render() {
  x.setTransform(1, 0, 0, 1, 0, 0); x.imageSmoothingEnabled = false;
  const sh = G.shake > .3 ? [rnd(-G.shake, G.shake), rnd(-G.shake, G.shake) * .6] : [0, 0]; G.shake *= .85;
  x.translate(Math.round(sh[0]), Math.round(sh[1]));
  if (atlas.complete && atlas.naturalWidth) x.drawImage(atlas, 0, 0, 480, 270, 0, 0, 480, 270); else { x.fillStyle = "#223"; x.fillRect(0, 0, W, H); }
  if (!F.length) return;
  if (G.cine) { const c = G.cine, k = c.t / c.d; x.fillStyle = `rgba(0,0,12,${.55 * Math.sin(Math.min(1, k * 1.2) * Math.PI)})`; x.fillRect(-10, -10, W + 20, H + 20); x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 1; for (let i = 0; i < 22; i++) { const yy = (i * 53 + G.t * 900) % H, xx = (i * 131) % W; x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx + 46, yy); x.stroke(); }
    const p = F[c.i]; if (Math.random() < .9) FX.push({ k: "mote", t: 0, d: .3, x: p.x + rnd(-60, 60), y: FLOOR - rnd(20, 150), tx: p.x + p.dir * 46, ty: FLOOR - HIGH, c: ["#fff", "#ffd84a", "#ff7a1f", "#39ff6a"][c.tier - 1] }); }
  F.slice().sort((a, b) => (a.ko ? 0 : 1) - (b.ko ? 0 : 1)).forEach(drawFighter);
  ATK.forEach(drawAttack);
  x.save(); x.globalCompositeOperation = "lighter";
  FX.forEach(f => { const k = f.t / f.d;
    if (f.k === "spark") { x.globalAlpha = 1 - k; x.fillStyle = f.c; x.fillRect(Math.round(f.x), Math.round(f.y), 2, 2); }
    else if (f.k === "mote") { x.globalAlpha = 1; x.fillStyle = f.c; x.fillRect(Math.round(f.x + (f.tx - f.x) * k), Math.round(f.y + (f.ty - f.y) * k), 2, 2); }
    else if (f.k === "phoenix") { const px = f.dir > 0 ? -40 + k * (W + 80) : W + 40 - k * (W + 80), fl = Math.sin(f.t * 18) * 14; x.globalAlpha = .9; x.strokeStyle = "#dff3ff"; x.lineWidth = 4; x.beginPath(); x.moveTo(px - 34, f.y - fl); x.quadraticCurveTo(px - 12, f.y - 6, px, f.y); x.quadraticCurveTo(px + 12, f.y - 6, px + 34, f.y - fl); x.stroke(); x.fillStyle = "#fff"; x.fillRect(px - 3, f.y - 3, 8, 6); for (let i = 1; i < 6; i++) x.fillRect(px - f.dir * i * 12, f.y + Math.sin(f.t * 12 + i) * 5, 3, 3); }
    else if (f.k === "wand") { x.globalAlpha = 1 - k; x.save(); x.translate(f.x + k * 30, f.y - 40 * Math.sin(k * Math.PI)); x.rotate(k * 12); x.fillStyle = "#e9c88a"; x.fillRect(-9, -1, 18, 2); x.restore(); } });
  x.restore();
  NUM.forEach(n => { x.globalAlpha = Math.min(1, (n.d - n.t) * 4); text(n.tx, n.x, n.y, n.c, 16 * n.big + (n.big > 1 ? 8 : 0), "center"); x.globalAlpha = 1; });
  x.setTransform(1, 0, 0, 1, 0, 0);
  hud();
  if (G.cine) { const c = G.cine, k = c.t / c.d, X = W + 80 - k * (W + 160) * 1.0, col = ["#fff", "#ffd84a", "#ff9d3c", "#39ff6a"][c.tier - 1]; x.fillStyle = "rgba(0,0,0,.6)"; x.fillRect(0, 96, W, 30); text(c.n.toUpperCase(), clamp(X, 70, W - 70), 119, col, 30, "center"); }
  if (G.phase === "ko") { const win = G.loser !== G.ME; if (G.ko < 2.5) { text("K.O.", W / 2, 128, "#ff3b30", 64, "center"); text(win ? "YOU WIN" : "YOU LOSE", W / 2, 158, win ? "#ffe14a" : "#9fd8ff", 30, "center"); } }
  if (G.flash > .02) { x.fillStyle = `rgba(255,255,255,${G.flash})`; x.fillRect(0, 0, W, H); G.flash *= .8; }
}
let prev = performance.now(), lastSend = 0;
function loop(now) {
  requestAnimationFrame(loop); let dt = Math.min(.05, (now - prev) / 1000); prev = now;
  if (!$("game").classList.contains("on") || !F.length) return;
  if (G.stop > 0) { G.stop -= dt; dt = 0; }
  if (dt > 0) update(dt);
  if (G.mode === "pvp" && now - lastSend > 33) { lastSend = now; const p = F[G.ME]; send({ t: "s", x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, mp: Math.round(p.mp), f: frameOf(p), sh: +p.shield.toFixed(2), bg: +p.big.toFixed(2), sm: +p.smoke.toFixed(2), fx: p.flyX == null ? null : Math.round(p.flyX), iv: p.inv > 0 ? 1 : 0, cr: p.crouch ? 1 : 0, c: p.ctrl ? [p.ctrl.k, +p.ctrl.t.toFixed(2)] : null, ko: p.ko ? 1 : 0 }, false); }
  render();
}
requestAnimationFrame(loop);

/* ======================= MẠNG: 2 NGƯỜI CHƠI ======================= */
function onMsg(m) {
  if (!m || !m.t) return;
  if (m.t === "hello") { if (net.host) send({ t: "hello" }); onConnected(); return; }
  if (m.t === "ping") return send({ t: "pong", ts: m.ts });
  if (m.t === "pong") { const r = performance.now() - m.ts; net.rtt = net.rtt ? net.rtt * .7 + r * .3 : r; $("pingTx").textContent = (net.mode === "relay" ? "RELAY " : "P2P ") + Math.round(net.rtt) + " ms"; return; }
  if (m.t === "ready") { G.oppReady = true; if (m.name) G.oppName = String(m.name).slice(0, 12); (net.host ? $("p2St") : $("p1St")).textContent = "Sẵn sàng ✓"; return maybeStart(); }
  if (m.t === "go") return startMatch("pvp");
  const o = F[1 - G.ME]; if (!o || G.mode !== "pvp") return;
  if (m.t === "s") { o.x += (m.x - o.x) * .6; o.y = m.y; o.hp = m.hp; o.mp = m.mp; o.rf = m.f; o.shield = m.sh; o.big = m.bg; o.smoke = m.sm; o.flyX = m.fx; o.fly = m.fx == null ? 0 : .1; o.inv = m.iv ? .1 : 0; o.crouch = !!m.cr; o.ctrl = m.c ? { k: m.c[0], t: m.c[1], end: 0, t0: o.ctrl?.t0 } : null; return; }
  if (m.t === "b") return doBasic(1 - G.ME, m.k, false);
  if (m.t === "c") return doCast(1 - G.ME, m.s, false);
  if (m.t === "rf") { spawn(1 - G.ME, { p: 1, v: 360, dmg: 15, col: "#fff", sp: 1 }); return; }
  if (m.t === "res") { const j = ATK.findIndex(a => a.id === m.aid), a = j >= 0 ? ATK[j] : null; if (a && a.p) ATK.splice(j, 1); if (m.res.to === undefined) m.res.to = 1 - G.ME; showRes(m.res, a); return; }
  if (m.t === "round") { G.round = m.n; G.score = m.sc; return newRound(); }
}
function setReady() { me.ready = true; $("bReady").disabled = true; $("bReady").textContent = "Đã sẵn sàng – chờ đối thủ…"; (net.host ? $("p1St") : $("p2St")).textContent = "Sẵn sàng ✓"; send(readyMsg()); maybeStart(); }
function maybeStart() { if (me.ready && G.oppReady && net.host) { send({ t: "go" }); startMatch("pvp"); } }
function banner(t, sub) { $("lobbyErr").textContent = t + (sub ? " – " + sub : ""); if (t === "MẤT KẾT NỐI") { alertBar("Mất kết nối với đối thủ"); } }
function alertBar(t) { $("netBar").textContent = t; $("netBar").style.display = "block"; }

/* ======================= LƯU KẾT QUẢ (trên máy này) ======================= */
function saveResult(win) { try { const k = "hmwiz-stats", s = JSON.parse(localStorage.getItem(k) || "{}"), key = G.mode === "ai" ? "lv" + (G.lvl + 1) : "pvp"; s[key] = s[key] || { w: 0, l: 0 }; s[key][win ? "w" : "l"]++; localStorage.setItem(k, JSON.stringify(s)); } catch {} }
function statLine() { try { const s = JSON.parse(localStorage.getItem("hmwiz-stats") || "{}"); const f = k => s[k] ? `${s[k].w} thắng / ${s[k].l} thua` : "chưa đấu"; return `LV1: ${f("lv1")} · LV2: ${f("lv2")} · LV3: ${f("lv3")} · Đấu người: ${f("pvp")}`; } catch { return ""; } }

/* ======================= GIAO DIỆN ======================= */
try { me.name = localStorage.getItem("hmwiz-name") || ""; } catch {}
$("inName").value = me.name; $("inName").oninput = () => { me.name = $("inName").value.trim().slice(0, 12); try { localStorage.setItem("hmwiz-name", me.name); } catch {} };
$("homeStats").textContent = statLine();
$("bAI").onclick = () => { $("lvPick").classList.toggle("on"); };
$("lvPick").innerHTML = OPP.map((o, i) => `<button data-i="${i}"><b>LV${i + 1}</b> ${o.name}<small>HP ${o.hp} · ${o.dmg} sát thương/đòn</small></button>`).join("");
document.querySelectorAll("#lvPick button").forEach(b => b.onclick = () => startMatch("ai", +b.dataset.i));
$("oppPick").innerHTML = OPP.map((o, i) => `<button data-i="${i}">LV${i + 1} · ${o.name}<small>HP ${o.hp} · ${o.dmg}/đòn</small></button>`).join("");
document.querySelectorAll("#oppPick button").forEach(b => b.onclick = () => startMatch("ai", +b.dataset.i));
$("bCreate").onclick = createRoom; $("bJoin").onclick = () => joinRoom($("inCode").value); $("inCode").onkeydown = e => { if (e.key === "Enter") joinRoom($("inCode").value); };
$("bReady").onclick = setReady;
document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { if (b.dataset.go === "home" && (G.mode === "pvp" || net.connected)) return location.reload(); show(b.dataset.go); if (b.dataset.go === "home") { G.mode = ""; F = []; $("homeStats").textContent = statLine(); } });
$("bSound").onclick = () => { G.sound = !G.sound; $("bSound").textContent = G.sound ? "🔊 Âm thanh" : "🔇 Tắt tiếng"; };
// nút cảm ứng: giữ được
document.querySelectorAll("[data-k]").forEach(b => { const k = b.dataset.k, down = e => { e.preventDefault(); b.classList.add("on"); if (KEY[k] !== undefined) KEY[k] = 1; else press(k); }, up = e => { e.preventDefault(); b.classList.remove("on"); if (KEY[k] !== undefined) KEY[k] = 0; }; b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up); b.addEventListener("contextmenu", e => e.preventDefault()); });
// bảng 18 phép (trang chơi: chạm để ra phép; trang hướng dẫn: để tra)
const spellHTML = tap => [1, 2, 3, 4].map(t => `<h4>${TIER[t].n} · ${t + 1} phím · ${TIER[t].mp} MP · sát thương ×${String(TIER[t].k).replace(".", ",")}</h4><div class="spg">` + SP.map((s, i) => s.t !== t ? "" : `<button class="sp t${t}" ${tap ? `data-sp="${i}"` : "disabled"}><span class="ks">${s.k.split("").join(" › ")}</span><b>${s.n}</b><small>${s.b ? (s.fixed ? s.b + " cố định" : s.m ? s.m + " × " + s.b : s.b) + " · " : ""}${s.d}</small></button>`).join("") + "</div>").join("");
$("spells").innerHTML = spellHTML(true); $("guideSpells").innerHTML = spellHTML(false);
document.querySelectorAll("[data-sp]").forEach(b => b.onclick = () => tapSpell(+b.dataset.sp));
// bảng thông số (ước lượng của người hâm mộ)
const WZ = [["Albus Dumbledore", 99, 98, 60, 97, 99, 99], ["Lord Voldemort", 98, 97, 100, 85, 92, 93], ["Gellert Grindelwald", 96, 96, 95, 88, 90, 90], ["Severus Snape", 86, 88, 90, 90, 84, 92], ["Minerva McGonagall", 84, 85, 20, 88, 95, 90], ["Bellatrix Lestrange", 88, 93, 94, 74, 68, 72], ["Filius Flitwick", 75, 85, 10, 84, 84, 84], ["Alastor Moody", 80, 87, 55, 86, 72, 78], ["Hermione Granger", 72, 68, 15, 82, 90, 94], ["Harry Potter", 78, 80, 30, 88, 60, 62]].map(r => [...r, Math.round(r[1] * .3 + r[2] * .25 + r[4] * .15 + r[5] * .15 + r[6] * .15)]);
let wzSort = 7, wzDir = -1;
function drawWZ() { const hd = ["Phù thuỷ", "Phép lực", "Đấu tay đôi", "Hắc ám", "Phòng vệ", "Đa dụng", "Tri thức", "Tổng lực"], rows = WZ.slice().sort((a, b) => (typeof a[wzSort] === "string" ? a[wzSort].localeCompare(b[wzSort]) : a[wzSort] - b[wzSort]) * wzDir);
  $("wz").innerHTML = "<tr>" + hd.map((h, i) => `<th data-c="${i}">${h}${i === wzSort ? (wzDir < 0 ? " ▼" : " ▲") : ""}</th>`).join("") + "</tr>" + rows.map(r => "<tr>" + r.map((v, i) => `<td>${v}</td>`).join("") + "</tr>").join("");
  document.querySelectorAll("#wz th").forEach(th => th.onclick = () => { const c = +th.dataset.c; if (c === wzSort) wzDir = -wzDir; else { wzSort = c; wzDir = c ? -1 : 1; } drawWZ(); }); }
drawWZ();
window.__wz = { G, get F() { return F; }, get ATK() { return ATK; }, SP, press, tapSpell, startMatch, net, setReady, KEY };
