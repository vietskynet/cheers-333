/* AGENCY COMBAT – game.js (toàn bộ game nằm trong file này)
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

/* ======================= AGC COMBAT – ĐẤU TRƯỜNG MA PHÁP VML ======================= */
const W = 480, H = 270, FLOOR = 248, HIGH = 94, CW = 190, CHH = 150;
const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* Hình: sprites.png = 4 nhân vật × 12 khung (ô 190×150, chân ở đáy ô, tâm ở x=95) + 32 đạo cụ (ô 96×72, từ y=600). bg.png = nền 480×270.
   Nếu site chưa có file thì lấy tạm từ kho ảnh Higgsfield. */
const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_2vybgglAYZMtuRPV18Aqg7zS5iW/";
function loadImg(local, cdn) { const im = new Image(); im.onerror = () => { if (!im._f) { im._f = 1; im.src = CDN + cdn; } }; im.onload = () => document.documentElement.style.setProperty(local === "./sprites.png" ? "--spr" : "--bg", `url("${im.src}")`); im.src = local; return im; }
const SPR = loadImg("./sprites.png", "e71bceab-9f7c-4465-baa1-90c7e884ff3e.png"), BG = loadImg("./bg.png", "073e9582-2bbe-44d6-98ac-5cf73662bbb0.png");
const POST = new Image(); POST.onload = () => { document.documentElement.style.setProperty("--post", `url("${POST.src}")`); document.body.classList.add("hasPost"); }; POST.onerror = () => { if (!POST._f) { POST._f = 1; POST.src = CDN + "922a4a6c-9867-4f2d-817d-12c2e9d625ef.png"; } }; POST.src = "./posters.png";
const ok = im => im.complete && im.naturalWidth > 0;
const IC = { phone: 0, mail: 1, folder: 2, chat: 3, car: 4, table: 5, coin: 6, cal: 7, bulb: 8, marker: 9, cat1: 10, cat2: 11, dumb: 12, frame: 13, easel: 14, wind: 15, splat: 16, brush: 17, scis: 18, cig: 19, smoke: 20, shrimp: 21, layers: 22, pen: 23, mag: 24, report: 25, funnel: 26, book: 27, trophy: 28, chart: 29, venn: 30, stamp: 31, paw: 32, wig: 33, buffet: 34, menu: 35, pho: 36, banhmi: 37, roll: 38, cake: 39, tea: 40, chicken: 41, redpen: 42, hand: 43, news: 44, sushi: 45, pizza: 46, quote: 47, mega: 48, vali: 49, plane: 50, ticket: 51, passport: 52, pencil: 53, ghost: 54, bat: 55, moon: 56, shand: 57, fire: 58, globe: 59, photo: 60, world: 61, shades: 62, scrib: 63, bike: 64, phin: 65, cdrop: 66, rose: 67, spark: 68, heart: 69, cloud: 70, note: 71, crown: 72, mirror: 73, zap: 74, bean: 75, clock: 76, laurel: 77, warn: 78, callbtn: 79, tee: 80, jeans: 81, egg: 82, chick: 83, plate: 84, duck: 85, barbell: 86, shaker: 87, glasses: 88, tmirror: 89, matcha: 90, tote: 91, vinyl: 92, earph: 93, camera: 94, obook: 95 };
/* Ba cấp máy */
const LVL = [
  { n: "Thực tập sinh", hp: 100, spd: 34, dist: 170, rest: [2.4, 3.3], wind: .6, types: ["hi"], dmg: 8, bolt: 190, shield: .12, cast: 0, maxT: 0 },
  { n: "Senior", hp: 150, spd: 58, dist: 215, rest: [1.5, 2.3], wind: .48, types: ["hi", "hi", "lo"], dmg: 11, bolt: 240, shield: .32, cast: .25, maxT: 2 },
  { n: "Sếp tổng", hp: 210, spd: 46, dist: 240, rest: [1.0, 1.7], wind: .4, types: ["hi", "lo", "th", "th"], dmg: 14, bolt: 290, shield: .5, cast: .4, maxT: 4 },
];
/* 8 ô skill dùng chung phím cho cả 4 nhân vật */
const KEYS = ["FG", "GF", "BF", "FFV", "GGF", "FFFV", "BBBF", "VBGCF"], TOF = [1, 1, 1, 2, 2, 3, 3, 4];
const TIER = { 1: { mp: 10, k: 1, n: "Cấp 1" }, 2: { mp: 20, k: 1.25, n: "Cấp 2" }, 3: { mp: 35, k: 1.6, n: "Cấp 3" }, 4: { mp: 55, k: 2, n: "Tối thượng" } };
function healClear(c, ic) { c.hp = Math.min(c.max, c.hp + 15); clearAttacksOn(c.i); for (let i = 0; i < 26; i++) FX.push({ k: "icon", ic, t: -i * .03, d: 1.1, x: rnd(10, W - 10), y: rnd(-80, -10), vx: rnd(-10, 10), vy: rnd(150, 260), sc: rnd(.3, .5) }); pop("+15 HP", c.x, FLOOR - 150, "#7CFC8A", 1); }
const four = (o, says) => [0, 1, 2, 3].map(i => ({ p: 1, v: 265, hom: 1, h: HIGH + 24 - i * 15, wait: .3 + i * .13, sc: .48, ...o, ic: Array.isArray(o.ic) ? o.ic[i % o.ic.length] : o.ic, say: says[i % says.length] }));
/* Mỗi skill: n tên, b sát thương gốc, m số đòn, d mô tả, self(c) tác dụng lên mình, mk(c, D, K, dist) trả về danh sách đòn */
const CH = [
  { id: "duc", name: "Đức Phan", role: "Business Director", col: "#ff4d3d", tag: "Deadline, tốc độ và họp gấp",
    F: { n: "Email", ic: IC.mail }, G: { n: "Brief gấp", ic: IC.folder }, th: { n: "Lịch họp rơi", ic: IC.cal },
    sp: [
      { n: "Cuộc Gọi Deadline", b: 18, d: "Màn hình cuộc gọi đến chiếm trọn sân đấu, rung bần bật, đối thủ đứng hình", mk: (c, D) => [{ wait: 1.3, dmg: D, fx: "call", on: { stun: 1.2 }, say: "NGHE MÁY ĐI!" }] },
      { n: "Follow-up Dồn Dập", b: 9, m: 4, d: "Bốn tin nhắn hối việc tự tìm tới đối thủ", mk: (c, D) => four({ ic: IC.chat, dmg: D, col: "#ffffff" }, ["Em ơi?", "Update chưa?", "Gấp nha!", "ASAP!"]) },
      { n: "Duyệt Ngân Sách", b: 0, d: "Mưa xu vàng: xoá mọi đòn đang bay, hồi 15 HP", self: c => healClear(c, IC.coin) },
      { n: "The Magic Framework", b: 25, d: "Nhốt đối thủ vào ma trận 2×2, không đánh được", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["frame", 2.5, 0, "THE MAGIC FRAMEWORK"] } }] },
      { n: "Timeline Dí", b: 13, m: 3, d: "Ba thanh Gantt đỏ rực nện xuống đầu", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .25 + i * .22, dmg: D, fx: "gantt", n: i, say: ["TRỄ 1 NGÀY", "TRỄ 2 NGÀY", "TRỄ 3 NGÀY"][i] })) },
      { n: "Ferrari Speed", b: 45, d: "Hoá siêu xe đỏ lao xuyên qua đối thủ", self: c => { c.smoke = 1.1; c.fly = .9; c.ride = IC.car; }, mk: (c, D) => [{ wait: .45, dmg: D, fx: "boom", col: "#ff4d3d", say: "VROOOM!" }] },
      { n: "Mưa KPI", b: 36, d: "Trời tối sầm, báo cáo KPI rơi như mưa", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "rain", ic: IC.report, say: "KPI Q4!" }] },
      { n: "Meeting Gấp", b: 90, fixed: 1, d: "Bàn họp rơi từ trần xuống, kẹt họp tới tối. Xuyên khiên", mk: (c, D) => [{ wait: .75, dmg: D, pierce: 1, fx: "drop", ic: IC.table, sc: 1.7, on: { ctrl: ["meet", 2.2, 0, "HỌP GẤP · 5PM THỨ SÁU"] }, say: "MEETING GẤP!" }] },
    ] },
  { id: "viet", name: "Việt Đinh", role: "Creative Director", col: "#ffd84a", tag: "Cà phê phin, ảo ảnh, bão ý tưởng và đẹp trai",
    F: { n: "Giọt cà phê", ic: IC.cdrop }, G: { n: "Phin bay", ic: IC.phin }, th: { n: "Khung tranh rơi", ic: IC.frame },
    sp: [
      { n: "Chém Gió", b: 18, d: "Lốc xoáy thuyết trình thổi bay đối thủ", mk: (c, D) => [{ p: 1, v: 300, ic: IC.wind, sc: .95, wob: 1, dmg: D, col: "#dfe9f5", on: { stun: .7, push: 36 }, say: "VÙ VÙ~" }] },
      { n: "Thả Bầy Mèo", b: 9, m: 4, d: "Bốn con mèo lao tới cào tới tấp", mk: (c, D) => four({ ic: [IC.cat1, IC.cat2], sc: .58, dmg: D, col: "#ffb347" }, ["MÉO!", "NGAO!", "KHÈ!", "MEO~"]) },
      { n: "Nhân Bản", b: 0, d: "Hai bản sao đứng chắn, chặn mọi đòn 3,2 giây", self: c => { c.big = 3.2; c.bigK = 1; } },
      { n: "Ảo Ảnh", b: 25, d: "Đối thủ hoa mắt, thấy ba cái bóng của chính mình", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["dizzy", 2.5, 0, "ẢO ẢNH"] } }] },
      { n: "Book Grab", b: 13, m: 3, d: "Đặt xe ôm: xe chạy vòng quanh rồi tông đối thủ từ tứ phía", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .4 + i * .32, dmg: D, fx: "bike", n: i, say: ["BÍP BÍP!", "TỚI RỒI!", "5 SAO NHA!"][i] })) },
      { n: "Big Idea", b: 45, d: "Quả tạ BIG IDEA khổng lồ rơi từ trên trời", mk: (c, D) => [{ wait: .85, dmg: D, fx: "drop", ic: IC.dumb, sc: 2, lb: "BIG IDEA", say: "BIG IDEA!" }] },
      { n: "Handsome Power", b: 36, d: "Phóng to lên, hào quang đẹp trai toả ra làm đối thủ gục ngã", self: c => { c.giant = 2; }, mk: (c, D) => [{ wait: 1.1, dmg: D, fx: "aura", on: { ctrl: ["swoon", 2, 0, "ĐẸP TRAI QUÁ…"] }, say: "♥ ♥ ♥" }] },
      { n: "Brainstorm", b: 90, fixed: 1, d: "Cơn bão ý tưởng cuốn bay đối thủ lên trời. Xuyên khiên", mk: (c, D) => [{ wait: 1.0, dmg: D, pierce: 1, fx: "tornado", on: { ctrl: ["spin", 2.2, 0, "BRAINSTORM!"] }, say: "CUỐN BAY!" }] },
    ] },
  { id: "nhan", name: "Nhân Ziku", role: "Head of Art", col: "#2dd4bf", tag: "Màu, cắt ghép, khói và lưng tôm",
    F: { n: "Giọt màu", ic: IC.splat }, G: { n: "Quét cọ", ic: IC.brush }, th: { n: "Layer rơi", ic: IC.layers },
    sp: [
      { n: "Tạt Màu", b: 18, d: "Tạt nguyên xô màu, đối thủ dính màu và choáng", mk: (c, D) => [{ p: 1, v: 300, ic: IC.splat, sc: .95, wob: 1, dmg: D, col: "#2dd4bf", on: { stun: .7, paint: 3.5 }, say: "OẠCH!" }] },
      { n: "Mất Màu", b: 20, d: "Rút hết màu: đối thủ hoá trắng đen, đứng im", mk: (c, D) => [{ p: 1, v: 300, dmg: D, col: "#cfd8dc", on: { ctrl: ["gray", 1.8, 0, "SATURATION -100"] } }] },
      { n: "Giải Lao Một Điếu", b: 0, d: "Khói mù mịt: xoá mọi đòn đang bay, hồi 15 HP", self: c => healClear(c, IC.smoke) },
      { n: "Cắt Ghép Không Gian", b: 25, d: "Cắt đối thủ ra khỏi nền rồi dán lệch chỗ", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["cut", 2.5, 0, "CTRL+X · CTRL+V", IC.scis] } }] },
      { n: "Cuốn Hút", b: 8, m: 4, d: "Rít một hơi thuốc: hút đối thủ về phía mình, mất máu liên tục", mk: (c, D) => [0, 1, 2, 3].map(i => ({ wait: .3 + i * .3, dmg: D, fx: "suck", n: i, on: { push: -24 }, say: i === 3 ? "KHỤ KHỤ!" : "" })) },
      { n: "Xả Khói Tối Đa", b: 40, d: "Vòng khói thuốc lan từ chân ra hết sân", mk: (c, D, K, dist) => [{ wait: dist / 340, dmg: D, fx: "ring", col: "#b8c0c8", ic: IC.smoke, say: "KHỤ KHỤ!" }] },
      { n: "Tách Nền", b: 36, d: "Xoá sạch nền văn phòng thành ô caro trong suốt, đối thủ lơ lửng giữa file PNG", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "nobg", say: "PNG!" }] },
      { n: "Cong Lưng Tôm", b: 90, fixed: 1, d: "Đối thủ còng lưng như tôm vì ngồi máy quá lâu. Xuyên khiên", mk: (c, D) => [{ wait: .75, dmg: D, pierce: 1, fx: "drop", ic: IC.shrimp, sc: 1.8, on: { ctrl: ["shrimp", 2.2, 0, "CONG LƯNG TÔM"] }, say: "RẮC!" }] },
    ] },
  { id: "hieu", name: "Hiếu Thứ 3", role: "Strategy", col: "#60a5fa", tag: "Framework, insight, research, 5 WIN",
    F: { n: "Gạch đầu dòng", ic: -1 }, G: { n: "Deck 100 trang", ic: IC.report }, th: { n: "Con dấu rơi", ic: IC.stamp },
    sp: [
      { n: "Research Kính Lúp", b: 18, d: "Kính lúp khổng lồ zoom thẳng vào đối thủ, soi ra insight", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "zoom", on: { stun: 1 }, say: "INSIGHT!" }] },
      { n: "Khảo Sát 1000 Mẫu", b: 9, m: 4, d: "Bốn bản khảo sát tự tìm tới đối thủ", mk: (c, D) => four({ ic: IC.report, dmg: D, col: "#bfdbfe" }, ["n=1000", "p<0.05", "Top 2 box", "Quali!"]) },
      { n: "Khiên SWOT", b: 0, d: "Vòm khiên 4 ô S-W-O-T, chặn mọi đòn 3,2 giây", self: c => { c.big = 3.2; c.bigK = 2; } },
      { n: "Framework", b: 25, d: "Nhốt đối thủ vào giữa hai vòng tròn giao nhau", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["frame", 2.5, 0, "FRAMEWORK", IC.venn] } }] },
      { n: "Phễu Insight", b: 6, d: "Hút đối thủ lên phễu 2,6 giây rồi thả rơi (6 + 12)", mk: (c, D, K) => [{ wait: .1, dmg: D, on: { ctrl: ["lev", 2.6, 12 * K, "AWARENESS → LOYALTY", IC.funnel] } }] },
      { n: "Mô Hình Tăng Trưởng", b: 45, d: "Mũi tên tăng trưởng phóng xuyên qua đối thủ", mk: (c, D) => [{ wait: .5, dmg: D, fx: "dash", ic: IC.chart, sc: 1.5, say: "+300% YoY" }] },
      { n: "Bible Strategy", b: 36, d: "Cuốn kinh chiến lược giáng xuống trong ánh hào quang", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "drop", ic: IC.book, sc: 1.8, holy: 1, lb: "BIBLE STRATEGY", say: "AMEN!" }] },
      { n: "5 WIN Strategy", b: 18, m: 5, fixed: 1, d: "Năm con dấu WIN đóng liên tiếp, chốt bằng cúp vàng. Xuyên khiên", mk: (c, D) => [0, 1, 2, 3, 4].map(i => ({ wait: .35 + i * .3, dmg: D, pierce: 1, fx: "drop", ic: i < 4 ? IC.stamp : IC.trophy, sc: i < 4 ? .9 : 1.7, quick: 1, n: i, say: "WIN " + (i + 1) })) },
    ] },
  { id: "ngan", name: "Phương Ngân", role: "Creative Copy-based", col: "#f472b6", tag: "Chơi chữ, set menu, mèo khổng lồ và mái tóc trùm",
    F: { n: "Chữ cái", ic: -2 }, G: { n: "Bút đỏ", ic: IC.redpen }, th: { n: "Ngoặc kép rơi", ic: IC.quote },
    sp: [
      { n: "Giật Tít", b: 18, d: "Một dòng tít giật gân bay thẳng vào mặt, đối thủ đứng hình", mk: (c, D) => [{ p: 1, v: 320, ic: IC.news, sc: .75, wob: 1, dmg: D, col: "#f472b6", on: { stun: .9 }, say: "SỐC!" }] },
      { n: "Chơi Chữ", b: 9, m: 4, d: "Chữ bay tứ tung rồi tự tìm tới đối thủ", mk: (c, D) => four({ ic: -3, dmg: D, col: "#f9a8d4" }, ["CHỮ", "NGHĨA", "VẦN", "ĐIỆU"]) },
      { n: "Trà Sữa Giải Lao", b: 0, d: "Mưa trà sữa: xoá mọi đòn đang bay, hồi 15 HP", self: c => healClear(c, IC.tea) },
      { n: "Mái Tóc Trùm", b: 25, d: "Trùm nguyên mái tóc lên đầu đối thủ: hoảng loạn, mất máu thêm khi thoát ra", mk: (c, D, K) => [{ wait: .25, dmg: D, on: { ctrl: ["hair", 2.6, 10 * K, "Á Á Á! TỐI QUÁ!"] } }] },
      { n: "Bút Đỏ Sửa Bài", b: 13, m: 3, d: "Ba nét bút đỏ gạch chéo qua đối thủ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .15 + i * .2, dmg: D, fx: "slash", red: 1, n: i, say: ["SỬA LẦN 1", "SỬA LẦN 2", "SỬA LẦN 9"][i] })) },
      { n: "Set Menu", b: 45, d: "Gọi một món, cả bàn buffet được mang ra; các món xoay quanh rồi lao vào đối thủ", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "orbit", say: "MỜI CẢ NHÀ!" }] },
      { n: "Giơ Tay Ý Kiến", b: 36, d: "Giơ tay phát biểu, bão comment đổ xuống đè đối thủ", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "rain", ic: IC.chat, top: IC.hand, say: "EM CÓ Ý KIẾN!" }] },
      { n: "Mèo Khổng Lồ", b: 90, fixed: 1, d: "Bàn chân mèo xám trắng mũm mĩm khổng lồ đập xuống. Xuyên khiên", mk: (c, D) => [{ wait: .8, dmg: D, pierce: 1, fx: "drop", ic: IC.paw, sc: 2.6, gnd: 1, on: { ctrl: ["flat", 1.8, 0, "BẸP!"] }, say: "MEOOO!" }] },
    ] },
  { id: "khoa", name: "Khoa Đặng", role: "Sr Art Director", col: "#8b5cf6", tag: "Bóng tối, nói nhiều, bịa chuyện, đi du lịch, vẽ chuyện",
    F: { n: "Bla bla", ic: -4 }, G: { n: "Vali kéo", ic: IC.vali }, th: { n: "Quà lưu niệm rơi", ic: IC.globe },
    sp: [
      { n: "Nói Nhiều", b: 18, d: "Bắc loa nói không ngừng, đối thủ ù tai đứng hình", mk: (c, D) => [{ p: 1, v: 300, ic: IC.mega, sc: .8, wave: 1, dmg: D, col: "#c4b5fd", on: { stun: 1 }, say: "BLA BLA BLA!" }] },
      { n: "Bịa Chuyện", b: 9, m: 4, d: "Bốn câu chuyện không có thật tự tìm tới đối thủ", mk: (c, D) => four({ ic: -3, bub: 1, dmg: D, col: "#c4b5fd" }, ["Hồi đó anh…", "Thiệt luôn!", "Tin anh đi", "100% real"]) },
      { n: "Xin Nghỉ Đi Du Lịch", b: 0, d: "Vé máy bay rơi như mưa: xoá mọi đòn đang bay, hồi 15 HP", self: c => healClear(c, IC.ticket) },
      { n: "Tắt Đèn", b: 25, d: "Cả văn phòng tối thui, đối thủ chỉ còn hai con mắt và đứng im", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["dark", 2.6, 0, "AI TẮT ĐÈN VẬY?"] } }] },
      { n: "Vẽ Chuyện", b: 13, m: 3, d: "Vẽ thêm ba nét bút chì nguệch ngoạc lên người đối thủ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .15 + i * .2, dmg: D, fx: "slash", pcl: 1, n: i, say: ["VẼ THÊM!", "VẼ NỮA!", "VẼ HOÀI!"][i] })) },
      { n: "Chuyến Bay Giá Rẻ", b: 45, d: "Máy bay giá rẻ lao xuyên qua đối thủ", mk: (c, D) => [{ wait: .55, dmg: D, fx: "dash", ic: IC.plane, sc: 1.7, col: "#c4b5fd", say: "DELAY 3 TIẾNG!" }] },
      { n: "Kể Chuyện Ma", b: 36, d: "Trời tối sầm, ma và dơi bay ra từ câu chuyện", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "rain", ic: IC.ghost, ic2: IC.bat, top: IC.fire, say: "HÙUU!" }] },
      { n: "Bóng Tối Nuốt Chửng", b: 90, fixed: 1, d: "Bàn tay bóng tối trồi lên từ sàn kéo đối thủ xuống. Xuyên khiên", mk: (c, D) => [{ wait: 1.0, dmg: D, pierce: 1, fx: "rise", ic: IC.shand, sc: 2.2, on: { ctrl: ["dark", 1.8, 0, "TỐI THUI!"] }, say: "ỰC!" }] },
    ] },
  { id: "bao", name: "Bao Tu", role: "The Performative", col: "#2563eb", tag: "Đẹp trai, gương vô cực, hai trứng, squat và trình diễn",
    F: { n: "Áo thun trắng", ic: IC.tee }, G: { n: "Quần jean", ic: IC.jeans }, th: { n: "Trứng luộc rơi", ic: IC.egg },
    sp: [
      { n: "Kính Loé Sáng", b: 18, d: "Chỉnh gọng kính, ánh loé bay thẳng vào mắt đối thủ", mk: (c, D) => [{ p: 1, v: 330, ic: IC.glasses, sc: .7, dmg: D, col: "#fff", on: { stun: .9 }, say: "CHÓI QUÁ!" }] },
      { n: "Hai Trứng", b: 9, m: 4, d: "Hai quả trứng luộc nở ra hai con gà, mỗi con mổ hai phát", mk: (c, D) => four({ ic: IC.chick, egg: 1, sc: .55, dmg: D, col: "#fde68a" }, ["CỤC TÁC!", "CHÍP!", "Ò Ó O!", "MỔ!"]) },
      { n: "Protein Shake", b: 0, d: "Mưa bình lắc protein: xoá mọi đòn đang bay, hồi 15 HP", self: c => healClear(c, IC.shaker) },
      { n: "Con Vịt", b: 25, d: "Một đĩa đồ ăn thừa hiện ra và đối thủ hoá thành con vịt", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["duck", 2.6, 0, "QUẠC QUẠC!", IC.plate] } }] },
      { n: "Sức Mạnh Đẹp Trai", b: 13, m: 3, d: "Gương vô cực mọc quanh đối thủ, tia đẹp trai bắn ra bất ngờ từ từng tấm", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .5 + i * .28, dmg: D, fx: "mirror", n: i, say: ["HỚP HỒN!", "ĐẸP!", "QUÁ ĐẸP!"][i] })) },
      { n: "Powerful Squat", b: 45, d: "Gánh tạ nặng, nhảy lên, ngồi xuống đè mông lên đối thủ", self: c => { c.smoke = 1.3; c.ride = -9; }, mk: (c, D) => [{ wait: .95, dmg: D, fx: "butt", on: { ctrl: ["flat", 1.4, 0, "BẸP!"] }, say: "ĐỦ 100 KÝ!" }] },
      { n: "Muscle Man", b: 20, d: "Cởi áo khoe cơ ngực và 6 múi, bay tới ôm chặt đối thủ gây ngạt (20 + 16)", self: c => { c.smoke = 3.3; c.ride = -9; }, mk: (c, D, K) => [{ wait: 1.1, dmg: D, fx: "hug", on: { ctrl: ["hug", 2.2, 16 * K, "NGẠT… THẢ RA…"] }, say: "ÔM CÁI NÀO!" }] },
      { n: "Performative", b: 90, fixed: 1, d: "Năm bản thể đẹp trai cùng trình diễn, đối thủ choáng ngợp. Xuyên khiên", mk: (c, D) => [{ wait: 1.5, dmg: D, pierce: 1, fx: "perf", on: { ctrl: ["dizzy", 2.2, 0, "CHOÁNG NGỢP…"] }, say: "PERFORMATIVE!" }] },
    ] },
];
const SR = CH.length;          // hàng khung hình đặc biệt: 0 = Bao Tu cởi áo khoe cơ, 1 = Bao Tu dang tay ôm
const PY = (CH.length + 1) * CHH;   // đạo cụ nằm ngay dưới các hàng nhân vật
CH.forEach(c => c.sp.forEach((s, i) => { s.k = KEYS[i]; s.t = TOF[i]; }));
const me = { ready: false, name: "", ch: 0 }, readyMsg = () => ({ t: "ready", name: me.name, ch: me.ch });
const G = { mode: "", lvl: 0, phase: "menu", round: 1, score: [0, 0], ME: 0, t: 0, stop: 0, shake: 0, flash: 0, ko: 0, cine: null, hits: 0, hitT: 0, keys: [], sound: true, names: ["", ""], chars: [0, 1], oppCh: 1 };
let F = [], ATK = [], FX = [], NUM = [], aid = [0, 0];
const KEY = { l: 0, r: 0, u: 0, d: 0 }, seq = { s: "", t: -9 };
const own = i => G.mode === "ai" || i === G.ME;        // máy này có quyền quyết định cho nhân vật i không
const chOf = i => CH[G.chars[i]];

function newF(i) {
  const o = G.mode === "ai" && i === 1 ? LVL[G.lvl] : null;
  return { i, dir: i ? -1 : 1, x: i ? 372 : 110, y: 0, vy: 0, hp: o ? o.hp : 100, max: o ? o.hp : 100, lag: 1, mp: 60, stun: 0, inv: 0, shield: 0, parry: 0, charge: 0, big: 0, bigK: 0, giant: 0, smoke: 0, fly: 0, ride: null, paint: 0, lock: 0, ctrl: null, crouch: false, walk: 0, moving: false, act: "", actT: 0, cd: {}, ko: false, q: [], ai: o ? { rest: rnd(...o.rest), wind: 0, type: "", fire: 0 } : null };
}
function startMatch(mode, lvl, chars) {
  G.mode = mode; G.lvl = lvl || 0; G.round = 1; G.score = [0, 0]; G.ME = mode === "pvp" && !net.host ? 1 : 0; G.chars = chars;
  show("game"); $("oppPick").style.display = mode === "ai" ? "" : "none"; document.querySelectorAll("#oppPick button").forEach((b, i) => b.classList.toggle("on", i === G.lvl));
  $("spells").innerHTML = spellHTML(G.chars[G.ME], true); document.querySelectorAll("[data-sp]").forEach(b => b.onclick = () => tapSpell(+b.dataset.sp));
  $("spTitle").textContent = `8 skill của ${chOf(G.ME).name} (chạm vào ô để ra chiêu)`;
  newRound();
}
function newRound() {
  F = [newF(0), newF(1)]; ATK = []; FX = []; NUM = []; aid = [0, 0];
  G.phase = "fight"; G.ko = 0; G.hits = 0; G.cine = null; seq.s = "";
  const mine = me.name ? me.name + " · " + chOf(G.ME).name : chOf(G.ME).name, other = G.mode === "ai" ? chOf(1).name + " (" + LVL[G.lvl].n + ")" : (G.oppName ? G.oppName + " · " : "") + chOf(1 - G.ME).name;
  G.names = G.ME === 0 ? [mine, other] : [other, mine];
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
  const SP = chOf(G.ME).sp; let best = null;                       // combo dài nhất khớp với phần cuối chuỗi phím
  for (const s of SP) if (seq.s.endsWith(s.k) && (!best || s.k.length > best.k.length)) best = s;
  if (best) { if (p.mp >= TIER[best.t].mp) { seq.s = ""; return doCast(G.ME, SP.indexOf(best), true); } pop("NO MP", p.x, FLOOR - 150, "#7fd4ff", .8); beep(140, .12, "sawtooth"); }
  doBasic(G.ME, k, true);
}
function tapSpell(i) { const p = F[G.ME]; if (!p || !canAct(p)) return; if (p.mp < TIER[TOF[i]].mp) { pop("NO MP", p.x, FLOOR - 150, "#7fd4ff", .8); return; } doCast(G.ME, i, true); }

/* ======================= ĐÒN CƠ BẢN & SKILL ======================= */
const CD = { F: .3, G: .65, C: .5, V: .9, B: .7 };
function doBasic(i, k, local) {
  const p = F[i], c = chOf(i); if (local && (p.cd[k] || 0) > 0) return;
  if (local && G.mode === "pvp") send({ t: "b", k });
  p.cd[k] = CD[k];
  if (k === "F") { p.act = "cast"; p.actT = .18; spawn(i, { p: 1, v: 300, dmg: 6, col: c.col, ic: c.F.ic, sc: .4, basic: 1 }); beep(880, .06); aiReact(i, .4); }
  if (k === "G") { p.act = "heavy"; p.actT = .3; p.lock = .22; const low = G.mode === "pvp"; spawn(i, { p: 1, v: 240, dmg: 13, col: c.col, ic: c.G.ic, sc: .6, wob: 1, low, h: low ? 16 : HIGH, basic: 1 }); beep(330, .12, "sawtooth"); aiReact(i, .7); }
  if (k === "C") { p.shield = .85; p.cd.C = .85 + CD.C; beep(520, .1, "triangle"); }
  if (k === "V") { p.parry = .38; beep(700, .05, "triangle"); }
  if (k === "B") { p.charge = .65; beep(260, .3, "sine", .05, 520); }
}
function doCast(i, si, local) {
  const p = F[i], s = chOf(i).sp[si], T = TIER[s.t], tg = F[1 - i];
  if (local) { p.mp -= T.mp; if (G.mode === "pvp") send({ t: "c", s: si }); }
  const wait = s.t >= 3 ? .6 : .42, weak = p.ai ? .55 : 1;                 // máy ra skill yếu hơn người
  p.lock = wait + .15; p.act = "wind"; p.actT = wait; G.cine = { n: s.n, t: 0, d: wait + .25, tier: s.t, i }; beep(200, wait, "sawtooth", .05, 900); aiReact(i, 1);
  p.q.push({ t: wait, fn: () => {
    p.act = s.t >= 3 ? "heavy" : "cast"; p.actT = .3; beep(1200, .15, "square", .07, 300);
    if (s.self) s.self(p);
    if (s.mk) { const D = (s.fixed ? s.b : s.b * T.k) * weak; s.mk(p, D, T.k * weak, Math.abs(tg.x - p.x)).forEach(a => spawn(i, { ...a, sp: 1 })); }
  } });
}
/* tạo một "đòn": đạn bay (p:1) hoặc đòn hẹn giờ (wait). Hai máy tạo cùng thứ tự nên cùng mã id */
function spawn(i, a) {
  const c = F[i]; a.id = i + ":" + (aid[i]++); a.from = i; a.to = 1 - i; a.age = 0; a.wait = a.wait || 0;
  if (a.p) { a.x = c.x + c.dir * 46; a.h = a.h ?? HIGH; a.v = a.v * c.dir; a.h0 = a.h; }
  a.cx = c.x; a.dir = c.dir; ATK.push(a); return a;
}
function clearAttacksOn(i) { ATK = ATK.filter(a => a.to !== i); }
/* máy thấy người chơi ra chiêu thì có thể dựng khiên */
function aiReact(i, k) { const o = F[1]; if (G.mode !== "ai" || i !== 0 || !o || o.ko || o.ctrl || o.stun > 0 || o.shield > 0 || o.lock > 0) return; if (Math.random() < LVL[G.lvl].shield * k) { o.shield = 1.1; o.ai.wind = 0; } }
const mkCtrl = c => ({ k: c[0], t: c[1], end: c[2] || 0, lb: c[3] || "", ic: c[4] ?? null });

/* Người sở hữu mục tiêu quyết định đòn có trúng không */
function resolve(a, T) {
  const res = { id: a.id, r: "hit", dmg: 0, x: a.cond ? a.tx : T.x, h: a.p ? a.h : 70 };
  if (T.ko) return null;
  if (a.cond && Math.abs(T.x - a.tx) > 30) res.r = "miss";
  else if (T.smoke > 0 || (T.inv > 0 && !a.sp)) res.r = "miss";
  else if (a.p && !a.low && T.crouch && !a.sp) res.r = "miss";
  else if (a.p && a.low && T.y > 24) res.r = "miss";
  else if (T.big > 0 && !a.pierce) res.r = "block";
  else if (T.parry > 0 && !a.pierce) res.r = "parry";
  else if (T.shield > 0 && !a.pierce) { if (T.ai) { res.r = "guard"; res.dmg = Math.max(1, Math.round(a.dmg * .2)); } else res.r = "block"; }
  else res.dmg = Math.round(a.dmg);
  if (res.r === "miss") { if (a.p) { a.passed = 1; return null; } return res; }
  if (res.r === "hit") {
    const on = a.on || {};
    if (res.dmg > 0) { if (!T.ctrl) { T.stun = T.ai ? .25 : .34; T.x = clamp(T.x - T.dir * 10, 36, 448); } if (!T.ai) T.inv = .55; T.charge = 0; if (T.ai) T.ai.wind = 0; }
    if (on.stun) T.stun = on.stun; if (on.push) T.x = clamp(T.x - T.dir * on.push, 36, 448); if (on.paint) res.paint = on.paint;
    if (on.ctrl) { T.ctrl = mkCtrl(on.ctrl); T.shield = 0; T.y = 0; T.vy = 0; }
  }
  T.hp = Math.max(0, T.hp - res.dmg);
  if (res.r === "parry") { T.parry = 0; spawn(T.i, { p: 1, v: 360, dmg: 15, col: "#fff", sp: 1 }); if (G.mode === "pvp") send({ t: "rf" }); }
  if (T.hp <= 0) res.ko = 1;
  return res;
}
/* hiển thị kết quả (cả hai máy) */
function showRes(res, a) {
  const to = a ? a.to : res.to, T = F[to], X = res.x, Y = FLOOR - res.h - (T ? T.y : 0), col = a?.col || chOf(1 - to).col;
  if (res.r === "hit" || res.r === "guard") {
    if (res.dmg > 0) { pop("-" + res.dmg, X + rnd(-8, 8), Y - 20, res.r === "guard" ? "#9fd8ff" : "#ffe14a", .9); G.stop = Math.max(G.stop, .06); G.shake = Math.max(G.shake, a?.sp ? 7 : 3.5); G.flash = Math.max(G.flash, a?.sp ? .3 : .12); burst(X, Y, col, a?.sp ? 24 : 12); beep(res.r === "guard" ? 300 : 160, .1, "sawtooth", .08, 60);
      if ((a ? a.from : 1 - res.to) === G.ME) { G.hits++; G.hitT = 2.4; } }
    if (res.r === "hit" && a?.say) pop(a.say, clamp(X, 50, W - 50), Y - 42, "#fff", 1.1, 1.25);
    if (res.paint && T) T.paint = res.paint;
  } else if (res.r === "block") { pop("CHẶN!", X, Y - 24, "#7fd4ff", .7); burst(X, Y, "#7fd4ff", 8); beep(900, .06, "triangle"); }
  else if (res.r === "parry") { pop("PHẢN ĐÒN!", X, Y - 24, "#fff", .9); burst(X, Y, "#fff", 14); G.stop = .08; beep(1400, .1, "square"); }
  else if (res.r === "miss" && a && !a.p) pop("TRƯỢT", X, Y - 24, "#bbb", .6);
  if (res.ko) doKO(to);
}
function doKO(loser) {
  if (G.phase !== "fight") return; G.phase = "ko"; G.ko = 2.8; G.stop = .28; G.shake = 10; G.flash = .6; F[loser].ko = true; F[loser].ctrl = null; ATK = [];
  G.loser = loser; G.score[1 - loser]++; beep(100, .6, "sawtooth", .1, 40); saveResult(loser !== G.ME);
}
/* ======================= CẬP NHẬT ======================= */
function stepFighter(p, dt) {
  for (let k in p.cd) p.cd[k] -= dt;
  ["stun", "inv", "shield", "parry", "big", "smoke", "lock", "actT", "fly", "paint", "giant"].forEach(k => { if (p[k] > 0) p[k] = Math.max(0, p[k] - dt); });
  if (p.smoke <= 0 && own(p.i)) p.ride = null;
  for (let j = p.q.length - 1; j >= 0; j--) { p.q[j].t -= dt; if (p.q[j].t <= 0) { const e = p.q.splice(j, 1)[0]; if (!p.ko) e.fn(); } }
  if (p.charge > 0) { p.charge -= dt; p.mp = Math.min(100, p.mp + 48 * dt); if (Math.random() < .5) FX.push({ k: "mote", t: 0, d: .4, x: p.x + rnd(-30, 30), y: FLOOR - rnd(10, 110), tx: p.x + p.dir * 40, ty: FLOOR - HIGH, c: "#7fd4ff" }); }
  if (!p.ai) p.mp = Math.min(100, p.mp + 7 * dt);
  if (p.ctrl) { p.ctrl.t -= dt; if (p.ctrl.t <= 0) { const e = p.ctrl.end; p.ctrl = null; if (e && own(p.i) && !p.ko) { p.hp = Math.max(0, p.hp - Math.round(e)); const res = { id: "c", to: p.i, r: "hit", dmg: Math.round(e), x: p.x, h: 60, ko: p.hp <= 0 ? 1 : 0 }; showRes(res, null); if (G.mode === "pvp") send({ t: "res", res }); } p.stun = .3; } }
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
  const o = LVL[G.lvl], a = p.ai, pl = F[0], c = chOf(1); p.moving = false;
  if (p.ko || G.phase !== "fight" || p.ctrl || p.stun > 0) { a.wind = 0; return; }
  if (p.lock > 0 || p.fly > 0) return;
  if (a.fire > 0) { a.fire -= dt; return; }
  if (a.wind > 0) { a.wind -= dt; p.act = "wind"; p.actT = .1; if (a.wind <= 0) { a.fire = .32; p.act = "cast"; p.actT = .32; a.rest = rnd(...o.rest); beep(240, .15, "sawtooth", .06, 120);
      if (a.type === "th") spawn(1, { wait: .8, dmg: o.dmg, cond: 1, tx: pl.x, fx: "drop", ic: c.th.ic, sc: .9, quick: 1, col: c.col });
      else if (a.type === "lo") spawn(1, { p: 1, v: o.bolt * .85, dmg: o.dmg, col: c.col, ic: c.G.ic, sc: .55, wob: 1, low: 1, h: 16 });
      else spawn(1, { p: 1, v: o.bolt, dmg: o.dmg, col: c.col, ic: c.F.ic, sc: .45 }); } return; }
  if (p.shield > 0) return;
  const want = pl.x + o.dist, dx = want - p.x;
  if (Math.abs(dx) > 14) { p.x += Math.sign(dx) * o.spd * dt; p.moving = true; p.walk += dt; }
  p.x = clamp(p.x, pl.x + 100, 448);
  a.rest -= dt;
  if (a.rest <= 0) {
    if (Math.random() < o.cast) { const okSp = c.sp.map((s, i) => i).filter(i => TOF[i] <= o.maxT && (TOF[i] < 4 || Math.random() < .35)); a.rest = rnd(...o.rest) + 1.2; return doCast(1, okSp[Math.floor(Math.random() * okSp.length)], false); }
    a.type = o.types[Math.floor(Math.random() * o.types.length)]; a.wind = o.wind;
  }
}
function stepAttacks(dt) {
  for (let j = ATK.length - 1; j >= 0; j--) {
    const a = ATK[j], T = F[a.to]; a.age += dt;
    if (a.age < a.wait) continue;
    if (a.p) {
      a.x += a.v * dt; const fl = a.age - a.wait;
      if (a.hom) a.h += (HIGH - 20 + T.y - a.h) * Math.min(1, dt * 3) + Math.sin(fl * 14 + a.h0) * 30 * dt;
      if (Math.random() < .6) FX.push({ k: "spark", t: 0, d: .25, x: a.x, y: FLOOR - a.h, vx: rnd(-20, 20), vy: rnd(-20, 20), c: a.col });
      if (!a.passed && Math.abs(a.x - T.x) < 22 && own(a.to)) { const res = resolve(a, T); if (res) { showRes(res, a); if (G.mode === "pvp") send({ t: "res", res, aid: a.id }); ATK.splice(j, 1); continue; } }
      if (a.x < -40 || a.x > W + 40) ATK.splice(j, 1);
    } else if (!a.done) {
      a.done = 1; a.hitAt = a.age; a.hx = a.cond ? a.tx : T.x;
      if (own(a.to)) { const res = resolve(a, T); if (res) { showRes(res, a); if (G.mode === "pvp") send({ t: "res", res, aid: a.id }); } }
      if (a.fx === "world" || a.fx === "rain" || a.fx === "nobg" || a.fx === "orbit" || a.fx === "rise" || a.fx === "tornado" || a.fx === "aura" || a.fx === "zoom" || a.fx === "call" || a.fx === "butt" || a.fx === "perf" || (a.fx === "drop" && a.sc > 1.2)) { G.flash = Math.max(G.flash, .5); G.shake = Math.max(G.shake, 9); beep(70, .35, "sawtooth", .1, 35); }
    } else if (a.age - a.hitAt > .6) ATK.splice(j, 1);
  }
}
function update(dt) {
  G.t += dt;
  if (G.cine) { G.cine.t += dt; if (G.cine.t > G.cine.d) G.cine = null; }
  if (G.hitT > 0) { G.hitT -= dt; if (G.hitT <= 0) G.hits = 0; }
  F.forEach(p => { stepFighter(p, dt); if (p.ai) stepAI(p, dt); else if (p.i === G.ME) stepLocal(p, dt); });
  F.forEach(p => { if (!own(p.i)) return; if (p.fly > 0) { const k = 1 - p.fly / .9, o = F[1 - p.i]; p.flyX = p.x + (o.x + p.dir * 50 - p.x) * Math.sin(k * Math.PI); } else p.flyX = null; });
  stepAttacks(dt);
  F.forEach(p => { p.lag += ((p.hp / p.max) - p.lag) * Math.min(1, dt * 2.5); if (p.lag < p.hp / p.max) p.lag = p.hp / p.max; });
  if (G.phase === "ko") { G.ko -= dt; if (G.ko <= 0 && (G.mode === "ai" || net.host)) { G.round++; if (G.mode === "pvp") send({ t: "round", n: G.round, sc: G.score }); newRound(); } }
  for (let j = FX.length - 1; j >= 0; j--) { const f = FX[j]; f.t += dt; if (f.t > 0 && f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; } if (f.t > f.d) FX.splice(j, 1); }
  for (let j = NUM.length - 1; j >= 0; j--) { NUM[j].t += dt; NUM[j].y -= 26 * dt; if (NUM[j].t > NUM[j].d) NUM.splice(j, 1); }
  if (FX.length > 500) FX.splice(0, FX.length - 500);
}
function pop(tx, x, y, c, d = .9, big = 1) { NUM.push({ tx, x, y, c, t: 0, d, big }); }
function burst(x, y, c, n) { for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), v = rnd(30, 170); FX.push({ k: "spark", t: 0, d: rnd(.2, .5), x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: i % 3 ? c : "#fff" }); } }

/* ======================= VẼ ======================= */
const cv = $("cv"), x = cv.getContext("2d"); x.imageSmoothingEnabled = false;
const tmp = document.createElement("canvas"), tx = tmp.getContext("2d"); tmp.width = CW; tmp.height = CHH;
function frameOf(p) {
  if (p.ko) return 11;
  if (p.ctrl) return p.ctrl.k === "swoon" ? 11 : p.ctrl.k === "shrimp" || p.ctrl.k === "meet" ? 8 : 10;
  if (p.stun > 0) return 10;
  if (p.shield > 0 || p.big > 0 || p.parry > 0) return 7;
  if (p.actT > 0) return p.act === "wind" ? 4 : p.act === "heavy" ? 6 : 5;
  if (p.charge > 0) return 4;
  if (p.y > 0) return 9;
  if (p.crouch) return 8;
  if (p.moving) return 2 + Math.floor(p.walk * 7) % 2;
  return Math.floor(G.t * 2.2) % 2;
}
/* vẽ một khung hình nhân vật: chân đặt tại (px, bot). o: a độ trong, tint màu phủ, gray trắng đen, rot xoay, vf lật dọc */
function spr(ci, f, px, bot, flip, o = {}) {
  if (!ok(SPR)) { x.save(); x.globalAlpha = o.a ?? 1; x.fillStyle = (CH[ci] || CH[0]).col; x.fillRect(px - 16, bot - (f === 11 ? 20 : f === 8 ? 70 : 118), f === 11 ? 90 : 32, f === 11 ? 20 : f === 8 ? 70 : 118); x.restore(); return; }
  let src = SPR, sx = f * CW, sy = ci * CHH;
  if (o.tint || o.gray) {
    tx.globalCompositeOperation = "source-over"; tx.clearRect(0, 0, CW, CHH); tx.drawImage(SPR, sx, sy, CW, CHH, 0, 0, CW, CHH);
    if (o.gray) { tx.globalCompositeOperation = "color"; tx.fillStyle = "#8a8a8a"; tx.fillRect(0, 0, CW, CHH); tx.globalCompositeOperation = "destination-in"; tx.drawImage(SPR, sx, sy, CW, CHH, 0, 0, CW, CHH); }
    if (o.tint) { tx.globalCompositeOperation = "source-atop"; tx.fillStyle = o.tint; tx.fillRect(0, 0, CW, CHH); }
    tx.globalCompositeOperation = "source-over"; src = tmp; sx = 0; sy = 0;
  }
  x.save(); x.translate(px, bot); if (o.rot) { x.translate(0, -55); x.rotate(o.rot); x.translate(0, 55); }
  x.scale((flip ? -1 : 1) * (o.s || 1), (o.vf ? -1 : 1) * (o.sy || 1) * (o.s || 1)); if (o.a != null) x.globalAlpha = o.a;
  x.drawImage(src, sx, sy, CW, CHH, -95, o.vf ? 0 : -CHH, CW, CHH); x.restore();
}
/* vẽ một đạo cụ, tâm tại (cx, cy) */
function prop(ic, cx, cy, sc = 1, flip = false, a = 1, rot = 0) {
  x.save(); x.translate(Math.round(cx), Math.round(cy)); if (rot) x.rotate(rot); x.scale(flip ? -sc : sc, sc); x.globalAlpha = a;
  if (ok(SPR) && ic >= 0) x.drawImage(SPR, (ic % 16) * 96, PY + Math.floor(ic / 16) * 72, 96, 72, -48, -36, 96, 72); else { x.fillStyle = "#fff"; x.fillRect(-10, -10, 20, 20); }
  x.restore();
}
const FONT = n => `${n}px VT323, "Courier New", monospace`;
function text(s, X, Y, c, size = 16, al = "left") { x.font = FONT(size); x.textAlign = al; x.fillStyle = "#000"; x.fillText(s, X + 1, Y + 1); x.fillText(s, X - 1, Y + 1); x.fillStyle = c; x.fillText(s, X, Y); }
function drawFighter(p) {
  const ci = G.chars[p.i], flip = p.i === 1, px = Math.round(p.flyX ?? p.x), c = p.ctrl, bot = FLOOR - Math.round(p.y), f = p.rf ?? frameOf(p), t = G.t;
  if (p.smoke > 0) {
    if (p.ride === -9) return;
    if (p.ride != null) { x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = 0; i < 7; i++) { const yy = FLOOR - 8 - i * 7; x.beginPath(); x.moveTo(px - p.dir * (50 + (i * 37 + t * 600) % 60), yy); x.lineTo(px - p.dir * (90 + (i * 37 + t * 600) % 60), yy); x.stroke(); } prop(p.ride, px, FLOOR - 30, 1.5, p.dir < 0); }
    else { x.save(); x.globalAlpha = .75; x.fillStyle = "#0a0a12"; for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(px + Math.sin(t * 9 + i * 2) * 16 - p.dir * i * 5, FLOOR - 30 - i * 10 + Math.cos(t * 7 + i) * 6, 14 - i * .8, 0, 6.283); x.fill(); } x.restore(); }
    return;
  }
  if (p.inv > 0 && Math.floor(t * 20) % 2) return;
  const tint = p.paint > 0 ? "rgba(45,212,191,.6)" : G.chars[0] === G.chars[1] && p.i === 1 ? "rgba(120,60,220,.32)" : null;
  // bóng đổ
  x.fillStyle = "rgba(0,0,0,.28)"; x.beginPath(); x.ellipse(px, FLOOR + 1, 26, 5, 0, 0, 6.283); x.fill();
  if (p.big > 0 && p.bigK === 1) [34, 62].forEach((d, i) => spr(ci, Math.floor(t * 4 + i) % 2, px + p.dir * d, bot, flip, { a: .5 + .2 * Math.sin(t * 12 + i), tint: "rgba(255,216,74,.45)" }));
  if (p.giant > 0 && !c) { const s = 1 + .85 * clamp((2 - p.giant) / .35, 0, 1) * clamp(p.giant / .3, 0, 1), cy = FLOOR - 70 * s; x.save(); x.globalCompositeOperation = "lighter"; for (let i = 0; i < 14; i++) { const an = i / 14 * 6.283 + t * 1.5; x.fillStyle = i % 2 ? "rgba(255,216,74,.5)" : "rgba(255,255,255,.35)"; x.beginPath(); x.moveTo(px, cy); x.arc(px, cy, 70 * s, an, an + .2); x.fill(); } x.restore();
    spr(ci, 0, px, bot, flip, { s, tint }); for (let i = 0; i < 6; i++) { const an = t * 3 + i * 1.05; prop(i % 3 ? IC.spark : IC.rose, px + Math.cos(an) * 46 * s, cy + Math.sin(an) * 50 * s, .35 + .1 * Math.sin(t * 9 + i)); } prop(IC.crown, px, FLOOR - 136 * s, .5 * s); }
  else if (!c) spr(ci, f, px, bot, flip, { tint });
  else if (c.k === "swoon") { spr(ci, f, px, bot, flip, { tint }); for (let i = 0; i < 4; i++) prop(IC.heart, px - 30 + i * 20 + Math.sin(t * 5 + i) * 4, FLOOR - 40 - ((t * 30 + i * 13) % 50), .3); }
  else if (c.k === "spin") { prop(IC.wind, px, FLOOR - 62, 1.9, false, .95, Math.sin(t * 20) * .1); spr(ci, f, px + Math.sin(t * 9) * 22, bot - 58 - Math.abs(Math.sin(t * 6)) * 34, flip, { rot: t * 13, tint }); for (let i = 0; i < 6; i++) prop(i % 2 ? IC.note : IC.bulb, px + Math.cos(t * 8 + i) * (30 + i * 5), FLOOR - 20 - i * 20, .3, false, 1, t * 6 + i); }
  else if (c.k === "gray") spr(ci, f, px, bot, flip, { gray: 1 });
  else if (c.k === "lev") spr(ci, f, px, bot - 62 + Math.sin(t * 5) * 3, flip, { vf: 1, tint });
  else if (c.k === "dizzy") { [-1, 1].forEach(s => spr(ci, f, px + s * (18 + Math.sin(t * 6) * 10), bot, flip, { a: .35, tint: "rgba(255,216,74,.5)" })); spr(ci, f, px + Math.sin(t * 14) * 3, bot, flip, { tint }); for (let i = 0; i < 4; i++) text("★", px + Math.cos(t * 6 + i * 1.57) * 20, FLOOR - 128 + Math.sin(t * 6 + i * 1.57) * 5, "#ffd84a", 14, "center"); }
  else if (c.k === "cut") {
    for (let yy = 0; yy < 120; yy += 8) for (let xx = -28; xx < 28; xx += 8) { x.fillStyle = (xx + yy) / 8 % 2 ? "#c9c9c9" : "#fff"; x.fillRect(px + xx, FLOOR - 124 + yy, 8, 8); }
    x.save(); x.strokeStyle = "#000"; x.lineWidth = 1; x.setLineDash([4, 4]); x.lineDashOffset = -t * 20; x.strokeRect(px - 28.5, FLOOR - 124.5, 56, 120); x.restore();
    spr(ci, f, px - p.dir * 30, bot - 46 + Math.sin(t * 4) * 3, flip, { rot: p.dir * .3, tint });
  }
  else if (c.k === "shrimp") { spr(ci, f, px, bot + 14, flip, { rot: -p.dir * (.75 + Math.sin(t * 10) * .04), tint }); prop(IC.shrimp, px - p.dir * 6, FLOOR - 104 + Math.sin(t * 6) * 3, 1, p.dir < 0); }
  else if (c.k === "hug") { const jx = Math.sin(t * 45) * 2; spr(ci, f, px + jx, bot, flip, { tint: `rgba(120,80,255,${.25 + .2 * Math.sin(t * 6)})` }); spr(SR, 1, px + p.dir * 26 - jx, bot, !flip, {}); for (let i = 0; i < 3; i++) text("♥", px + p.dir * 10 - 14 + i * 14, FLOOR - 128 - ((t * 24 + i * 9) % 22), "#ff7ab6", 14, "center"); }
  else if (c.k === "duck") { prop(IC.duck, px, FLOOR - 30 - Math.abs(Math.sin(t * 8)) * 6, 1.25, p.dir < 0); }
  else if (c.k === "flat") spr(ci, f, px, bot, flip, { sy: .22, tint });
  else if (c.k === "hair") { const sx = Math.sin(t * 40) * 3; spr(ci, f, px + sx, bot, flip, { tint }); prop(IC.wig, px + sx, FLOOR - 108, 1.05); if (Math.floor(t * 4) % 2) text("!?", px + 26, FLOOR - 120, "#ffe14a", 18); }
  else if (c.k === "meet") { spr(ci, f, px, bot, flip, { tint }); prop(IC.table, px + p.dir * 14, FLOOR - 30, 1.5, p.dir < 0); text("z", px + 10, FLOOR - 96 - (t * 20 % 16), "#fff", 14); text("Z", px + 18, FLOOR - 108 - (t * 20 % 16), "#fff", 18); }
  else { spr(ci, f, px, bot, flip, { tint });
    if (c.k === "frame") { x.save(); const bx = px - 34, by = FLOOR - 132; ["rgba(255,77,61,.28)", "rgba(255,216,74,.28)", "rgba(96,165,250,.28)", "rgba(45,212,191,.28)"].forEach((cl, i) => { x.fillStyle = cl; x.fillRect(bx + (i % 2) * 34, by + (i >> 1) * 64, 34, 64); }); x.strokeStyle = "#fff"; x.lineWidth = 2; x.strokeRect(bx, by, 68, 128); x.beginPath(); x.moveTo(px, by); x.lineTo(px, by + 128); x.moveTo(bx, by + 64); x.lineTo(bx + 68, by + 64); x.stroke(); x.restore(); } }
  if (c) { if (c.ic != null) prop(c.ic, px, FLOOR - 152 + Math.sin(t * 6) * 3, c.k === "lev" ? .9 : .6); if (c.lb) text(c.lb, clamp(px, 70, W - 70), FLOOR - (c.ic != null ? 176 : 142), "#fff", 14, "center"); }
  if (p.big > 0 && p.bigK !== 1) { x.save(); x.strokeStyle = "#bfe6ff"; x.lineWidth = 2; x.globalAlpha = .6 + .3 * Math.sin(t * 20); x.beginPath(); x.arc(px, FLOOR, 66, Math.PI, 0); x.stroke(); x.fillStyle = "rgba(127,212,255,.14)"; x.fill();
    if (p.bigK === 2) { x.beginPath(); x.moveTo(px, FLOOR); x.lineTo(px, FLOOR - 66); x.moveTo(px - 57, FLOOR - 33); x.lineTo(px + 57, FLOOR - 33); x.stroke(); x.globalAlpha = 1; "SWOT".split("").forEach((l, i) => text(l, px + (i % 2 ? 22 : -22), FLOOR - (i < 2 ? 40 : 10), "#fff", 20, "center")); } x.restore(); }
  else if (p.shield > 0) { x.save(); x.globalCompositeOperation = "lighter"; x.strokeStyle = "#7fd4ff"; x.lineWidth = 2; x.globalAlpha = .6 + .3 * Math.sin(t * 20); x.beginPath(); x.ellipse(px + p.dir * 30, FLOOR - 70, 9, 50, 0, 0, 6.283); x.stroke(); x.fillStyle = "rgba(127,212,255,.15)"; x.fill(); x.restore(); }
  if (p.parry > 0) { x.strokeStyle = "#fff"; x.lineWidth = 1; x.strokeRect(px + p.dir * 30 - 4, FLOOR - HIGH - 14, 8, 28); }
  if (p.ai && p.ai.wind > 0) { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = chOf(1).col; const r = 4 + (1 - p.ai.wind / LVL[G.lvl].wind) * 6; x.beginPath(); x.arc(px - 44, FLOOR - (p.ai.type === "lo" ? 14 : p.ai.type === "th" ? 150 : HIGH), r, 0, 6.283); x.fill(); x.restore(); }
}
function bolt(x0, y0, x1, y1, c, w) { x.strokeStyle = c; x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); for (let i = 1; i < 8; i++) x.lineTo(x0 + (x1 - x0) * i / 8 + rnd(-9, 9), y0 + (y1 - y0) * i / 8 + rnd(-5, 5)); x.lineTo(x1, y1); x.stroke(); }
function drawAttack(a) {
  const T = F[a.to], C = F[a.from], col = a.col || chOf(a.from).col, t = G.t;
  if (a.p) {
    if (a.age < a.wait) return; const X = a.x, Y = FLOOR - a.h, d = Math.sign(a.v);
    if (a.ic >= 0) { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = col; x.globalAlpha = .35; x.beginPath(); x.ellipse(X - d * 10, Y, 20 * (a.sc || .5) * 2, 7, 0, 0, 6.283); x.fill(); x.restore(); prop(a.egg && a.age - a.wait < .3 ? IC.egg : a.ic, X, Y, a.sc || .5, d < 0, 1, a.wob ? Math.sin(a.age * 22) * .25 : 0); if (a.wave) { x.strokeStyle = col; x.lineWidth = 2; for (let i = 1; i < 4; i++) { x.beginPath(); x.arc(X + d * 18, Y, 10 + i * 9 + (a.age * 40 % 9), -0.7 + (d < 0 ? Math.PI : 0), .7 + (d < 0 ? Math.PI : 0)); x.stroke(); } } }
    else if (a.ic === -2) text("ABCĐÊÔƠƯ"[(+a.id.split(":")[1]) % 8], X, Y + 7, col, 22, "center");
    else if (a.ic === -3) { if (a.bub) { x.font = FONT(15); const w = x.measureText(a.say).width + 10; x.fillStyle = "#000"; x.fillRect(X - w / 2 - 1, Y - 11, w + 2, 20); x.fillStyle = "#fff"; x.fillRect(X - w / 2, Y - 10, w, 18); x.textAlign = "center"; x.fillStyle = "#1f1147"; x.fillText(a.say, X, Y + 4); } else text(a.say, X, Y + 6, "#fff", 18, "center"); }
    else if (a.ic === -4) text(["bla", "BLA", "bla~"][(+a.id.split(":")[1]) % 3], X, Y + 6, col, 18, "center");
    else if (a.ic === -1) { x.fillStyle = col; for (let i = 0; i < 3; i++) { x.fillRect(X - d * i * 11 - 3, Y - 3, 6, 6); x.fillStyle = "#fff"; } }
    else { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, 20, 4, 0, 0, 6.283); x.fill(); x.fillStyle = "#fff"; x.beginPath(); x.ellipse(X + d * 4, Y, 9, 2, 0, 0, 6.283); x.fill(); x.restore(); }
    if (a.low) { x.fillStyle = col; for (let i = 0; i < 4; i++) x.fillRect(X - d * i * 8 - 2, FLOOR - 4 - ((t * 60 + i * 9) % 14), 4, 5); }
    return;
  }
  const k = clamp(a.age / Math.max(.01, a.wait), 0, 1), post = a.done ? a.age - a.hitAt : -1, TX = a.done ? a.hx : a.cond ? a.tx : T.x;
  x.save();
  if (a.fx === "drop") {
    const top = a.gnd ? FLOOR - 36 * a.sc + 8 : FLOOR - 96 - 14 * (a.sc || 1), t0 = a.quick ? Math.max(0, a.wait - .32) : 0, kk = clamp((a.age - t0) / Math.max(.01, a.wait - t0), 0, 1), y = a.done ? top + Math.min(1, post * 6) * 26 : -70 + (top + 70) * kk * kk;
    if (a.cond && !a.done) { x.strokeStyle = col; x.lineWidth = 2; x.globalAlpha = .5 + .5 * Math.sin(t * 30); x.beginPath(); x.ellipse(TX, FLOOR, 30 * (1.4 - k * .4), 6, 0, 0, 6.283); x.stroke(); x.globalAlpha = 1; }
    x.fillStyle = "rgba(0,0,0,.35)"; x.beginPath(); x.ellipse(TX, FLOOR + 1, 10 + 22 * (a.sc || 1) * kk, 3 + 3 * kk, 0, 0, 6.283); x.fill();
    if (a.holy) { x.globalCompositeOperation = "lighter"; x.fillStyle = `rgba(255,236,150,${a.done ? Math.max(0, .5 - post) : .15 + .3 * k})`; x.beginPath(); x.moveTo(TX - 14, 0); x.lineTo(TX + 14, 0); x.lineTo(TX + 60, FLOOR); x.lineTo(TX - 60, FLOOR); x.fill(); x.globalCompositeOperation = "source-over"; }
    if (kk > 0) { prop(a.ic, TX + (a.n ? (a.n % 2 ? 12 : -12) : 0), y, a.sc || 1, false, a.done ? Math.max(0, 1 - post * 1.8) : 1, a.done ? 0 : Math.sin(a.age * 9) * .08); if (a.lb && (!a.done || post < .45)) text(a.lb, clamp(TX, 60, W - 60), y - 36 * (a.sc || 1) - 2, "#ffe14a", 16, "center"); }
  }
  else if (a.fx === "gantt") { const cs = ["#ff4d3d", "#ffb020", "#ff7ab6"], y = FLOOR - 128 + a.n * 22, w = 150, x0 = a.done ? TX - w / 2 : (a.dir > 0 ? -w : W) + (TX - w / 2 - (a.dir > 0 ? -w : W)) * k * k; x.globalAlpha = a.done ? Math.max(0, 1 - post * 2) : 1; x.fillStyle = "#000"; x.fillRect(x0 - 2, y - 2, w + 4, 16); x.fillStyle = cs[a.n]; x.fillRect(x0, y, w, 12); x.fillStyle = "rgba(255,255,255,.5)"; x.fillRect(x0, y, w * .45, 4); text(["BRIEF", "IDEA", "DEADLINE"][a.n], x0 + 6, y + 10, "#fff", 12); }
  else if (a.fx === "rain") { x.fillStyle = `rgba(0,0,24,${a.done ? Math.max(0, .5 - post) : .5 * Math.min(1, k * 4)})`; x.fillRect(-10, -10, W + 20, H + 20); if (a.top != null && !a.done) prop(a.top, a.cx, FLOOR - 150 + Math.sin(t * 12) * 3, .9); if (!a.done) for (let i = 0; i < 14; i++) prop(a.ic2 != null && i % 2 ? a.ic2 : a.ic, (i * 97 + 30) % W, ((i * 53 + a.age * 300) % (FLOOR + 40)) - 20, .4, false, .9, i); else if (post < .4) { prop(a.ic, TX, FLOOR - 80, 1.6 - post, false, 1 - post * 2); x.globalCompositeOperation = "lighter"; bolt(TX, 0, TX, FLOOR, "#fff", 5); } }
  else if (a.fx === "clones") { const ci = G.chars[a.from], span = (TX + a.dir * 90) - a.cx; for (let i = 0; i < 5; i++) { const kk = clamp(a.age / (a.wait + .35) * 1.5 - i * .1, 0, 1); if (kk > 0 && kk < 1) spr(ci, 2 + Math.floor(a.age * 10 + i) % 2, a.cx + span * kk, FLOOR, a.dir < 0, { a: .7, tint: "rgba(255,216,74,.4)" }); } }
  else if (a.fx === "dash") { const X = a.cx + (TX + a.dir * 80 - a.cx) * (a.done ? 1 : k * k), al = a.done ? Math.max(0, 1 - post * 3) : 1; x.globalCompositeOperation = "lighter"; x.strokeStyle = col; x.lineWidth = 6; x.globalAlpha = .5 * al; x.beginPath(); x.moveTo(a.cx, FLOOR - 70); x.lineTo(X, FLOOR - 70); x.stroke(); x.globalCompositeOperation = "source-over"; prop(a.ic, X, FLOOR - 74, a.sc || 1, a.dir < 0, al); }
  else if (a.fx === "ring") { const r = Math.min(a.age, a.wait + .4) * 340; x.globalAlpha = a.done ? Math.max(0, 1 - post * 2.5) : 1; if (a.ic != null) for (let i = 0; i < 12; i++) { const an = i / 12 * 6.283 + t; prop(a.ic, a.cx + Math.cos(an) * r, FLOOR - 16 + Math.sin(an) * r * .14 - Math.abs(Math.sin(t * 5 + i)) * 8, .7, false, x.globalAlpha); } else { x.globalCompositeOperation = "lighter"; x.strokeStyle = col; x.lineWidth = 6; x.beginPath(); x.ellipse(a.cx, FLOOR, r, r * .16, 0, 0, 6.283); x.stroke(); } }
  else if (a.fx === "orbit") { const foods = [IC.pho, IC.banhmi, IC.roll, IC.cake, IC.sushi, IC.pizza, IC.chicken, IC.tea], R = a.done ? 70 * .3 * Math.max(0, 1 - post * 4) : 78 * (1 - k * .7), al = a.done ? Math.max(0, 1 - post * 3) : Math.min(1, k * 5);
    prop(IC.menu, a.cx + a.dir * 30, FLOOR - 120 - Math.min(1, k * 4) * 14, .6, false, a.done ? al : 1); prop(IC.buffet, TX - a.dir * 78, FLOOR - 30, 1.25 * Math.min(1, k * 4), false, al);
    foods.forEach((ic, i) => { const an = i / foods.length * 6.283 + a.age * (4 + k * 8); prop(ic, TX + Math.cos(an) * R * 1.25, FLOOR - 66 + Math.sin(an) * R * .75, .5, false, al, an); }); }
  else if (a.fx === "rise") { const al = a.done ? Math.max(0, 1 - post * 2) : 1, kk = a.done ? 1 : k * k; x.fillStyle = `rgba(0,0,0,${(a.done ? .6 : .6 * k) * al})`; x.fillRect(-10, -10, W + 20, H + 20); x.fillStyle = `rgba(10,0,25,${al})`; x.beginPath(); x.ellipse(TX, FLOOR + 2, 20 + 60 * kk, 4 + 9 * kk, 0, 0, 6.283); x.fill();
    x.save(); x.beginPath(); x.rect(0, 0, W, FLOOR + 6); x.clip(); prop(a.ic, TX, FLOOR + 80 - kk * (80 + 36 * a.sc - 8) + (a.done ? post * 120 : Math.sin(t * 30) * 2), a.sc, false, al); x.restore(); }
  else if (a.fx === "bike") { const dn = a.n % 2 ? -1 : 1, X = TX + dn * (a.age - a.wait) * 520; if (Math.abs(a.age - a.wait) < .55) { x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(X - dn * (40 + i * 9), FLOOR - 8 - i * 9); x.lineTo(X - dn * (80 + i * 9), FLOOR - 8 - i * 9); x.stroke(); } prop(IC.bike, X, FLOOR - 34, 1.25, dn < 0); } }
  else if (a.fx === "tornado") { const X = a.done ? TX : a.cx + (TX - a.cx) * k, al = a.done ? Math.max(0, 1 - post * 3) : 1; x.fillStyle = `rgba(10,14,40,${.45 * (a.done ? al : Math.min(1, k * 3))})`; x.fillRect(-10, -10, W + 20, H + 20); prop(IC.cloud, X, 34, 2.2, false, al); prop(IC.wind, X, FLOOR - 70, 2.1, false, al, Math.sin(t * 18) * .12); for (let i = 0; i < 8; i++) prop([IC.note, IC.bulb, IC.zap][i % 3], X + Math.cos(t * 9 + i) * (24 + i * 7), FLOOR - 16 - i * 17, .32, false, al, t * 5 + i); }
  else if (a.fx === "aura") { const r = a.age * 230, al = a.done ? Math.max(0, 1 - post * 2) : 1; x.globalCompositeOperation = "lighter"; x.strokeStyle = `rgba(255,216,74,${.8 * al})`; x.lineWidth = 8; x.beginPath(); x.arc(a.cx, FLOOR - 90, r, 0, 6.283); x.stroke(); x.strokeStyle = `rgba(255,255,255,${.6 * al})`; x.lineWidth = 3; x.beginPath(); x.arc(a.cx, FLOOR - 90, r * .8, 0, 6.283); x.stroke(); x.globalCompositeOperation = "source-over"; for (let i = 0; i < 8; i++) prop(i % 2 ? IC.heart : IC.spark, a.cx + Math.cos(i * .785 + t) * r, FLOOR - 90 + Math.sin(i * .785 + t) * r * .6, .4, false, al); }
  else if (a.fx === "zoom") { const R = a.done ? 62 : 16 + 46 * k * k, cy = FLOOR - 72, al = a.done ? Math.max(0, 1 - post * 2.5) : 1; x.globalAlpha = al; x.strokeStyle = "#5b3a1e"; x.lineWidth = 9; x.beginPath(); x.moveTo(TX + a.dir * -R * .7, cy + R * .7); x.lineTo(TX - a.dir * (R * .7 + 46), cy + R * .7 + 46); x.stroke();
    x.save(); x.beginPath(); x.arc(TX, cy, R, 0, 6.283); x.clip(); x.fillStyle = "#cfe8ff"; x.fillRect(TX - R, cy - R, R * 2, R * 2); spr(G.chars[a.to], frameOf(T), TX, FLOOR + 62, a.to === 1, { s: 2 }); x.fillStyle = "rgba(255,255,255,.25)"; x.beginPath(); x.ellipse(TX - R * .3, cy - R * .4, R * .35, R * .18, -.6, 0, 6.283); x.fill(); if (!a.done) { x.fillStyle = "rgba(255,40,40,.5)"; x.fillRect(TX - R, cy - R + ((a.age * 160) % (R * 2)), R * 2, 2); } x.restore();
    x.strokeStyle = "#111"; x.lineWidth = 5; x.beginPath(); x.arc(TX, cy, R, 0, 6.283); x.stroke(); x.strokeStyle = "#9ca3af"; x.lineWidth = 2; x.stroke(); if (!a.done) text("ZOOM " + Math.round(100 + k * 300) + "%", clamp(TX, 60, W - 60), cy - R - 6, "#fff", 14, "center"); }
  else if (a.fx === "suck") { if (a.n === 3) { const mx = a.cx + a.dir * 34, my = FLOOR - 98; prop(IC.cig, mx, my, .55, a.dir > 0); for (let j = 0; j < 12; j++) { const u = (a.age * 1.6 + j / 12) % 1, X = TX + (mx - TX) * u, Y = FLOOR - 70 + (my - FLOOR + 70) * u + Math.sin(u * 12 + j) * 10 * (1 - u); prop(IC.smoke, X, Y, .5 * (1 - u * .7), false, .8); } x.strokeStyle = "rgba(255,255,255,.5)"; x.lineWidth = 1; for (let j = 0; j < 4; j++) { const u = (a.age * 2.5 + j / 4) % 1; x.beginPath(); x.arc(mx, my, 12 + (1 - u) * 60, a.dir > 0 ? -.5 : Math.PI - .5, a.dir > 0 ? .5 : Math.PI + .5); x.stroke(); } } }
  else if (a.fx === "mirror") { const P = [[-66, -52], [64, -70], [-30, -128], [70, -8]], al = a.done ? Math.max(0, 1 - post * 2) : Math.min(1, a.age * 4), ci = G.chars[a.from]; (a.n === 2 ? [2, 3] : [a.n]).forEach(j => { const mx = TX + P[j][0], my = FLOOR + P[j][1] - 30; prop(IC.tmirror, mx, my, .95, false, al); x.save(); x.globalAlpha = al * .9; x.beginPath(); x.rect(mx - 9, my - 22, 18, 30); x.clip(); if (ok(SPR)) x.drawImage(SPR, 72, ci * CHH + 18, 46, 46, mx - 14, my - 22, 28, 28); x.restore(); });
    if (post >= 0 && post < .22) { const mx = TX + P[a.n][0], my = FLOOR + P[a.n][1] - 30; x.globalCompositeOperation = "lighter"; x.strokeStyle = "#fff"; x.lineWidth = 6; x.beginPath(); x.moveTo(mx, my); x.lineTo(TX, FLOOR - 70); x.stroke(); x.strokeStyle = "#93c5fd"; x.lineWidth = 12; x.globalAlpha = .4; x.stroke(); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; prop(IC.spark, TX, FLOOR - 70, .8); } }
  else if (a.fx === "hug") { if (!a.done) { const fl = a.from === 1; if (k < .5) { const kk = k * 2; x.save(); x.globalCompositeOperation = "lighter"; for (let i = 0; i < 12; i++) { const an = i / 12 * 6.283 + t * 2; x.fillStyle = "rgba(255,216,74,.4)"; x.beginPath(); x.moveTo(a.cx, FLOOR - 70); x.arc(a.cx, FLOOR - 70, 80, an, an + .2); x.fill(); } x.restore(); spr(SR, 0, a.cx, FLOOR, fl, {}); prop(IC.tee, a.cx - a.dir * (20 + kk * 70), FLOOR - 110 - kk * 60, .7, false, 1 - kk, kk * 5); prop(IC.spark, a.cx + 20, FLOOR - 100 + Math.sin(t * 20) * 3, .5); if (kk > .3) text("6 MÚI!", a.cx, FLOOR - 140, "#ffe14a", 20, "center"); }
      else { const kk = (k - .5) * 2, X = a.cx + (TX - a.dir * 26 - a.cx) * kk * kk; x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(X - a.dir * 30, FLOOR - 30 - i * 14); x.lineTo(X - a.dir * (60 + i * 5), FLOOR - 30 - i * 14); x.stroke(); } spr(SR, 1, X, FLOOR - Math.sin(kk * Math.PI) * 30, fl, {}); } } }
  else if (a.fx === "butt") { const ci = G.chars[a.from], up = k < .5, kk = up ? k * 2 : (k - .5) * 2, X = a.done ? TX : up ? a.cx + (TX - a.cx) * kk : TX, bot = a.done ? FLOOR - 34 : up ? FLOOR - (FLOOR + 30) * (1 - (1 - kk) * (1 - kk)) : -30 + (FLOOR - 34 + 30) * kk * kk; if (!a.done || post < .4) { x.fillStyle = "rgba(0,0,0,.35)"; x.beginPath(); x.ellipse(TX, FLOOR + 1, 34, 6, 0, 0, 6.283); x.fill(); spr(ci, 8, X, bot, a.from === 1, {}); prop(IC.barbell, X, bot - 72, 1.35); if (!a.done && !up) { x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = -2; i < 3; i++) { x.beginPath(); x.moveTo(X + i * 14, bot - 110); x.lineTo(X + i * 14, bot - 150); x.stroke(); } } } }
  else if (a.fx === "perf") { const ci = G.chars[a.from], al = a.done ? Math.max(0, 1 - post * 2) : 1, items = [IC.matcha, IC.tote, IC.vinyl, IC.obook, IC.camera], fr = [0, 5, 6, 4, 9]; x.fillStyle = `rgba(4,6,30,${.7 * (a.done ? al : Math.min(1, a.age * 4))})`; x.fillRect(-10, -10, W + 20, H + 20);
    for (let i = 0; i < 5; i++) { const ap = clamp((a.age - i * .2) * 5, 0, 1); if (ap <= 0) continue; const X = 60 + i * 90; x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = `rgba(147,197,253,${.28 * ap * al})`; x.beginPath(); x.moveTo(X - 8, 0); x.lineTo(X + 8, 0); x.lineTo(X + 40, FLOOR); x.lineTo(X - 40, FLOOR); x.fill(); x.restore(); spr(ci, fr[i], X, FLOOR + (1 - ap) * 30, i % 2 === 1, { s: 1.15, a: ap * al }); prop(items[i], X + 22, FLOOR - 150 + Math.sin(t * 5 + i) * 4, .5, false, ap * al); prop(IC.spark, X - 24 + Math.sin(t * 7 + i) * 6, FLOOR - 120 + Math.cos(t * 6 + i) * 10, .35 + .1 * Math.sin(t * 12 + i), false, ap * al); }
    if (a.age > .9 && (!a.done || post < .4)) text("✦ PERFORMATIVE ✦", W / 2, 84 + Math.sin(t * 10) * 2, "#fff", 34, "center"); }
  else if (a.fx === "nobg") { x.strokeStyle = "#000"; x.lineWidth = 1; x.setLineDash([4, 4]); x.lineDashOffset = -t * 24; x.strokeRect(TX - 34.5, FLOOR - 134.5, 68, 136); x.setLineDash([]); if (!a.done || post < .5) { x.fillStyle = "#1f2937"; x.fillRect(W / 2 - 78, 62, 156, 18); text("REMOVE BACKGROUND " + Math.round(k * 100) + "%", W / 2, 76, "#fff", 14, "center"); } }
  else if (a.fx === "slash" && post >= 0 && post < .28) { const o = (a.n - 1) * 16, x0 = TX - 40 + o, y0 = FLOOR - 126, x1 = TX + 40 + o, y1 = FLOOR - 14, cx1 = TX + 50 + o, cy1 = FLOOR - 120; x.strokeStyle = "#000"; x.lineWidth = 5; x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo(cx1, cy1, x1, y1); x.stroke(); x.strokeStyle = a.red ? "#ff3b30" : "#fff"; x.lineWidth = a.red ? 3 : 2; x.stroke(); if (a.red) prop(IC.redpen, x1 + 8, y1 - 8, .45); if (a.pcl) { x.strokeStyle = "#111"; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 12; i++) x.lineTo(x0 + (x1 - x0) * i / 12 + Math.sin(i * 2.1 + a.n) * 12, y0 + (y1 - y0) * i / 12 + Math.cos(i * 1.7) * 8); x.stroke(); prop(IC.pencil, x1 + 8, y1 - 8, .5); } if (a.pen) { x.strokeStyle = "#38bdf8"; x.lineWidth = 1; x.beginPath(); x.moveTo(x0, y0); x.lineTo(cx1, cy1); x.stroke(); [[x0, y0], [x1, y1], [cx1, cy1]].forEach(q => { x.fillStyle = "#fff"; x.fillRect(q[0] - 3, q[1] - 3, 6, 6); x.strokeRect(q[0] - 3.5, q[1] - 3.5, 7, 7); }); prop(IC.pen, x1 + 8, y1 - 6, .4); } }
  x.restore();
}
function hud() {
  [0, 1].forEach(i => { const p = F[i], bw = 190, bx = i ? W - 14 - bw : 14, r = p.hp / p.max;
    x.fillStyle = "#000"; x.fillRect(bx - 2, 12, bw + 4, 12); x.fillStyle = "#3a0d0d"; x.fillRect(bx, 14, bw, 8);
    const lw = bw * p.lag, hw = bw * r; x.fillStyle = "#fff"; x.fillRect(i ? bx : bx + bw - lw, 14, lw, 8); x.fillStyle = r < .3 ? "#ff3b30" : "#ffd21f"; x.fillRect(i ? bx : bx + bw - hw, 14, hw, 8);
    text(G.names[i].toUpperCase().slice(0, 26), i ? W - 14 : 14, 35, i === G.ME ? "#ffe680" : "#fff", 14, i ? "right" : "left");
    if (!p.ai) { x.fillStyle = "#000"; x.fillRect(i ? W - 14 - 122 : 12, 39, 124, 7); x.fillStyle = "#0d2440"; x.fillRect(i ? W - 14 - 120 : 14, 41, 120, 3); x.fillStyle = "#3aa0ff"; const mw = 120 * p.mp / 100; x.fillRect(i ? W - 14 - mw : 14, 41, mw, 3); if (i === G.ME) text("MP " + Math.floor(p.mp), i ? W - 14 : 14, 56, "#7fd4ff", 12, i ? "right" : "left"); } });
  x.fillStyle = "#000"; x.fillRect(W / 2 - 17, 9, 34, 18); x.fillStyle = "#c81e1e"; x.fillRect(W / 2 - 15, 11, 30, 14); text("KO", W / 2, 23, "#fff", 16, "center");
  text(`HIỆP ${G.round}  ${G.score[0]}-${G.score[1]}`, W / 2, 50, "#fff", 13, "center");
  if (G.hits > 1) text(G.hits + " HIT", G.ME ? W - 20 : 20, 78, "#ffe14a", 22, G.ME ? "right" : "left");
  const ks = G.keys.filter(k => G.t - k.t < 1.6).map(k => k.k).join(" › "); if (ks) text(ks, 10, H - 6, "#9fd8ff", 14);
}
function render() {
  x.setTransform(1, 0, 0, 1, 0, 0); x.imageSmoothingEnabled = false; x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
  x.fillStyle = "#0b0a14"; x.fillRect(0, 0, W, H);
  const sh = G.shake > .3 ? [rnd(-G.shake, G.shake), rnd(-G.shake, G.shake) * .6] : [0, 0]; G.shake *= .85;
  x.translate(Math.round(sh[0]), Math.round(sh[1]));
  const wa = ATK.find(a => a.fx === "world"), wk = wa ? (wa.done ? 0 : Math.sin(clamp(wa.age / wa.wait, 0, 1) * Math.PI)) : 0;   // "Tái tạo thế giới": xoay lật cả sân
  if (wk > 0) { x.translate(W / 2, H / 2); x.rotate(wk * Math.PI); x.scale(1 - wk * .35, 1 - wk * .35); x.translate(-W / 2, -H / 2); }
  if (ok(BG)) x.drawImage(BG, 0, 0, W, H); else { x.fillStyle = "#2b2f3a"; x.fillRect(0, 0, W, H); x.fillStyle = "#8a5a2b"; x.fillRect(0, 190, W, 80); }
  if (!F.length) return;
  const nb = ATK.find(a => a.fx === "nobg");                       // "Tách nền": nền thành ô caro trong suốt, lan từ phía người ra chiêu
  if (nb) { const k = nb.done ? 1 : clamp(nb.age / nb.wait * 1.4, 0, 1), al = nb.done ? Math.max(0, 1 - (nb.age - nb.hitAt) / .6) : 1, w = Math.ceil((W + 20) * k), x0 = nb.dir > 0 ? -10 : W + 10 - w; x.save(); x.globalAlpha = al; x.beginPath(); x.rect(x0, -10, w, H + 20); x.clip(); x.fillStyle = "#fff"; x.fillRect(-10, -10, W + 20, H + 20); x.fillStyle = "#cfcfcf"; for (let yy = 0; yy < H; yy += 12) for (let xx = (yy / 12 % 2) * 12; xx < W; xx += 24) x.fillRect(xx, yy, 12, 12); x.restore(); if (!nb.done) { x.fillStyle = "#38bdf8"; x.fillRect(nb.dir > 0 ? x0 + w - 2 : x0, 0, 2, H); } }
  if (G.cine) { const c = G.cine, k = c.t / c.d; x.fillStyle = `rgba(0,0,12,${.55 * Math.sin(Math.min(1, k * 1.2) * Math.PI)})`; x.fillRect(-10, -10, W + 20, H + 20); x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 1; for (let i = 0; i < 22; i++) { const yy = (i * 53 + G.t * 900) % H, xx = (i * 131) % W; x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx + 46, yy); x.stroke(); }
    const p = F[c.i]; if (Math.random() < .9) FX.push({ k: "mote", t: 0, d: .3, x: p.x + rnd(-60, 60), y: FLOOR - rnd(20, 150), tx: p.x + p.dir * 46, ty: FLOOR - HIGH, c: chOf(c.i).col }); }
  F.slice().sort((a, b) => (a.ko ? 0 : 1) - (b.ko ? 0 : 1)).forEach(drawFighter);
  ATK.forEach(drawAttack);
  FX.forEach(f => { if (f.t < 0) return; const k = f.t / f.d;
    if (f.k === "icon") prop(f.ic, f.x, f.y, f.sc, false, 1 - k * k);
    else { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = f.c;
      if (f.k === "spark") { x.globalAlpha = 1 - k; x.fillRect(Math.round(f.x), Math.round(f.y), 2, 2); } else x.fillRect(Math.round(f.x + (f.tx - f.x) * k), Math.round(f.y + (f.ty - f.y) * k), 2, 2);
      x.restore(); } });
  const dk = F.find(p => p.ctrl && p.ctrl.k === "dark");
  if (dk) { const o = F[1 - dk.i], al = Math.min(.93, dk.ctrl.t * 3); x.save(); x.fillStyle = `rgba(4,0,14,${al})`; x.beginPath(); x.rect(-20, -20, W + 40, H + 40); x.arc(o.x, FLOOR - 70, 46 + Math.sin(G.t * 5) * 3, 0, 6.283, true); x.fill("evenodd"); x.restore();
    const ex = dk.x + dk.dir * 6, ey = FLOOR - 112, bl = Math.floor(G.t * 3) % 5 ? 4 : 1; x.fillStyle = "#fff"; x.fillRect(ex - 8, ey, 6, bl); x.fillRect(ex + 3, ey, 6, bl); x.fillStyle = "#000"; x.fillRect(ex - 6 + Math.round(Math.sin(G.t * 7) * 2), ey + 1, 2, 2); x.fillRect(ex + 5 + Math.round(Math.sin(G.t * 7) * 2), ey + 1, 2, 2);
    if (dk.ctrl.lb) text(dk.ctrl.lb, clamp(dk.x, 70, W - 70), FLOOR - 142, "#fff", 14, "center"); text("?", dk.x + 22, FLOOR - 124 - (G.t * 16 % 10), "#ffe14a", 16, "center"); }
  if (wk > 0) { x.globalCompositeOperation = "difference"; x.fillStyle = `rgba(255,255,255,${wk})`; x.fillRect(-200, -200, W + 400, H + 400); x.globalCompositeOperation = "source-over"; }
  NUM.forEach(n => { x.globalAlpha = Math.min(1, (n.d - n.t) * 4); text(n.tx, n.x, n.y, n.c, 16 * n.big + (n.big > 1.5 ? 8 : 0), "center"); x.globalAlpha = 1; });
  x.setTransform(1, 0, 0, 1, 0, 0);
  hud();
  if (G.cine) { const c = G.cine, k = c.t / c.d, X = W + 80 - k * (W + 160), col = ["#fff", "#ffd84a", "#ff9d3c", "#39ff6a"][c.tier - 1]; x.fillStyle = "rgba(0,0,0,.6)"; x.fillRect(0, 96, W, 30); text(c.n.toUpperCase(), clamp(X, 110, W - 110), 119, col, 30, "center"); }
  const cl = ATK.find(a => a.fx === "call");
  if (cl) { const al = cl.done ? Math.max(0, 1 - (cl.age - cl.hitAt) * 3) : Math.min(1, cl.age * 6), c = chOf(cl.from), ci = G.chars[cl.from], jx = cl.done ? 0 : Math.round(Math.sin(G.t * 70) * 3), jy = cl.done ? 0 : Math.round(Math.cos(G.t * 55) * 2); if (!cl.done) { G.shake = Math.max(G.shake, 3); if (Math.floor(G.t * 8) % 2 === 0 && Math.random() < .2) beep(1300, .05, "square", .05); }
    x.save(); x.globalAlpha = al; x.translate(jx, jy); const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#0f2027"); gr.addColorStop(1, "#16321f"); x.fillStyle = gr; x.fillRect(-6, -6, W + 12, H + 12);
    text("CUỘC GỌI ĐẾN", W / 2, 34, "#9ca3af", 16, "center"); for (let i = 0; i < 3; i++) { x.strokeStyle = `rgba(57,255,106,${.5 - i * .15})`; x.lineWidth = 2; x.beginPath(); x.arc(W / 2, 96, 40 + i * 12 + (G.t * 30 % 12), 0, 6.283); x.stroke(); }
    x.save(); x.beginPath(); x.arc(W / 2, 96, 38, 0, 6.283); x.clip(); x.fillStyle = c.col; x.fillRect(W / 2 - 40, 56, 80, 80); if (ok(SPR)) x.drawImage(SPR, 68, ci * CHH + 16, 54, 54, W / 2 - 40, 56, 80, 80); x.restore(); x.strokeStyle = "#fff"; x.lineWidth = 3; x.beginPath(); x.arc(W / 2, 96, 38, 0, 6.283); x.stroke();
    text("SẾP " + c.name.toUpperCase(), W / 2, 162, "#fff", 30, "center"); text("Deadline: HÔM QUA · đã gọi nhỡ 27 lần", W / 2, 180, "#ff9d3c", 15, "center");
    x.fillStyle = "#e11d48"; x.beginPath(); x.arc(W / 2 - 80, 226, 20, 0, 6.283); x.fill(); text("✕", W / 2 - 80, 233, "#fff", 24, "center"); prop(IC.callbtn, W / 2 + 80, 226, .62 + .08 * Math.sin(G.t * 20)); text("Từ chối (không được)", W / 2 - 80, 260, "#9ca3af", 12, "center"); text("Nghe máy", W / 2 + 80, 260, "#9ca3af", 12, "center"); x.restore(); }
  if (G.phase === "ko") { const win = G.loser !== G.ME; if (G.ko < 2.5) { text("K.O.", W / 2, 128, "#ff3b30", 64, "center"); text(win ? "YOU WIN" : "YOU LOSE", W / 2, 158, win ? "#ffe14a" : "#9fd8ff", 30, "center"); } }
  if (G.flash > .02) { x.fillStyle = `rgba(255,255,255,${G.flash})`; x.fillRect(0, 0, W, H); G.flash *= .8; }
}
let prev = performance.now(), lastSend = 0;
function loop(now) {
  requestAnimationFrame(loop); let dt = Math.min(.05, (now - prev) / 1000); prev = now;
  if (!$("game").classList.contains("on") || !F.length) return;
  if (G.stop > 0) { G.stop -= dt; dt = 0; }
  if (dt > 0) update(dt);
  if (G.mode === "pvp" && now - lastSend > 33) { lastSend = now; const p = F[G.ME]; send({ t: "s", x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, mp: Math.round(p.mp), f: frameOf(p), sh: +p.shield.toFixed(2), bg: +p.big.toFixed(2), bk: p.bigK, gi: +p.giant.toFixed(2), sm: +p.smoke.toFixed(2), rd: p.ride, fx: p.flyX == null ? null : Math.round(p.flyX), iv: p.inv > 0 ? 1 : 0, cr: p.crouch ? 1 : 0, c: p.ctrl ? [p.ctrl.k, +p.ctrl.t.toFixed(2), 0, p.ctrl.lb, p.ctrl.ic] : null, ko: p.ko ? 1 : 0 }, false); }
  render();
}
requestAnimationFrame(loop);

/* ======================= MẠNG: 2 NGƯỜI CHƠI ======================= */
function onMsg(m) {
  if (!m || !m.t) return;
  if (m.t === "hello") { if (net.host) send({ t: "hello" }); onConnected(); return; }
  if (m.t === "ping") return send({ t: "pong", ts: m.ts });
  if (m.t === "pong") { const r = performance.now() - m.ts; net.rtt = net.rtt ? net.rtt * .7 + r * .3 : r; $("pingTx").textContent = (net.mode === "relay" ? "RELAY " : "P2P ") + Math.round(net.rtt) + " ms"; return; }
  if (m.t === "ready") { G.oppReady = true; if (m.name) G.oppName = String(m.name).slice(0, 12); G.oppCh = clamp(m.ch | 0, 0, CH.length - 1); (net.host ? $("p2St") : $("p1St")).textContent = "Sẵn sàng ✓ · " + CH[G.oppCh].name; return maybeStart(); }
  if (m.t === "go") return startMatch("pvp", 0, m.ch);
  const o = F[1 - G.ME]; if (!o || G.mode !== "pvp") return;
  if (m.t === "s") { o.x += (m.x - o.x) * .6; o.y = m.y; o.hp = m.hp; o.mp = m.mp; o.rf = m.f; o.shield = m.sh; o.big = m.bg; o.bigK = m.bk; o.giant = m.gi || 0; o.smoke = m.sm; o.ride = m.rd; o.flyX = m.fx; o.fly = m.fx == null ? 0 : .1; o.inv = m.iv ? .1 : 0; o.crouch = !!m.cr; o.ctrl = m.c ? mkCtrl(m.c) : null; return; }
  if (m.t === "b") return doBasic(1 - G.ME, m.k, false);
  if (m.t === "c") return doCast(1 - G.ME, m.s, false);
  if (m.t === "rf") { spawn(1 - G.ME, { p: 1, v: 360, dmg: 15, col: "#fff", sp: 1 }); return; }
  if (m.t === "res") { const j = ATK.findIndex(a => a.id === m.aid), a = j >= 0 ? ATK[j] : null; if (a && a.p) ATK.splice(j, 1); if (m.res.to === undefined) m.res.to = 1 - G.ME; showRes(m.res, a); return; }
  if (m.t === "reset") { if (net.host) resetMatch(); return; }
  if (m.t === "round") { G.round = m.n; G.score = m.sc; return newRound(); }
}
function resetMatch() {                                   // đấu lại từ hiệp 1, tỉ số 0-0
  if (G.mode === "ai") return startMatch("ai", G.lvl, G.chars);
  if (G.mode !== "pvp") return;
  if (!net.host) return send({ t: "reset" });
  G.round = 1; G.score = [0, 0]; send({ t: "round", n: 1, sc: [0, 0] }); newRound();
}
function setReady() { me.ready = true; $("bReady").disabled = true; $("bReady").textContent = "Đã sẵn sàng – chờ đối thủ…"; (net.host ? $("p1St") : $("p2St")).textContent = "Sẵn sàng ✓ · " + CH[me.ch].name; send(readyMsg()); maybeStart(); }
function maybeStart() { if (me.ready && G.oppReady && net.host) { const ch = [me.ch, G.oppCh]; send({ t: "go", ch }); startMatch("pvp", 0, ch); } }
function banner(t, sub) { $("lobbyErr").textContent = t + (sub ? " – " + sub : ""); if (t === "MẤT KẾT NỐI") { $("netBar").textContent = "Mất kết nối với đối thủ"; $("netBar").style.display = "block"; } }

/* ======================= LƯU KẾT QUẢ (trên máy này) ======================= */
function saveResult(win) { try { const k = "hmwiz-stats", s = JSON.parse(localStorage.getItem(k) || "{}"), key = G.mode === "ai" ? "lv" + (G.lvl + 1) : "pvp"; s[key] = s[key] || { w: 0, l: 0 }; s[key][win ? "w" : "l"]++; localStorage.setItem(k, JSON.stringify(s)); } catch {} }
function statLine() { try { const s = JSON.parse(localStorage.getItem("hmwiz-stats") || "{}"); const f = k => s[k] ? `${s[k].w} thắng / ${s[k].l} thua` : "chưa đấu"; return `LV1: ${f("lv1")} · LV2: ${f("lv2")} · LV3: ${f("lv3")} · Đấu người: ${f("pvp")}`; } catch { return ""; } }

/* ======================= GIAO DIỆN ======================= */
try { me.name = localStorage.getItem("hmwiz-name") || ""; me.ch = clamp(+localStorage.getItem("hmwiz-ch") || 0, 0, CH.length - 1); } catch {}
$("inName").value = me.name; $("inName").oninput = () => { me.name = $("inName").value.trim().slice(0, 12); try { localStorage.setItem("hmwiz-name", me.name); } catch {} };
$("homeStats").textContent = statLine();
const card = (c, i) => `<button class="chr" data-c="${i}" style="--c:${c.col}"><i style="background-position:-162px ${-(i * 150 + 20) * 2}px"></i><b>${c.name.split(" ")[0]}</b><em></em></button>`;
/* chọn nhân vật đấu máy: chạm lần 1 = bạn, lần 2 = máy */
const pick = { a: -1, b: -1, lvl: 0 };
$("pickGrid").innerHTML = CH.map(card).join("") + `<button class="chr rnd" data-c="-1"><i></i><b>Ngẫu nhiên</b><em></em></button>`;
function drawPick() {
  document.querySelectorAll("#pickGrid .chr").forEach((b, i) => { b.classList.toggle("p1", i === pick.a); b.classList.toggle("p2", i === pick.b); b.querySelector("em").textContent = (i === pick.a ? "BẠN" : "") + (i === pick.a && i === pick.b ? " + " : "") + (i === pick.b ? "MÁY" : ""); });
  [["postA", pick.a], ["postB", pick.b]].forEach(([id, ci]) => { const el = $(id); el.classList.toggle("empty", ci < 0); el.style.setProperty("--c", ci < 0 ? "#555" : CH[ci].col); el.querySelector("i").style.backgroundPosition = ci < 0 ? "0 9999px" : `-40px ${-ci * 150}px`; el.querySelector("u").style.backgroundPosition = ci < 0 ? "0 9999px" : `${ci * 100 / (CH.length - 1)}% 0`; el.querySelector("b").textContent = ci < 0 ? "?" : CH[ci].name.toUpperCase(); el.querySelector("small").textContent = ci < 0 ? "" : CH[ci].role; });
  $("pickTip").textContent = pick.a < 0 ? "Chạm để chọn nhân vật của BẠN" : pick.b < 0 ? `Bạn là ${CH[pick.a].name}. Giờ chọn nhân vật cho MÁY` : `${CH[pick.a].name} đấu ${CH[pick.b].name}. Chạm nhân vật bất kỳ để chọn lại`;
  $("pickInfo").innerHTML = pick.a < 0 ? "" : `<b style="color:${CH[pick.a].col}">${CH[pick.a].name}</b> · ${CH[pick.a].tag}<br>F: ${CH[pick.a].F.n} · G: ${CH[pick.a].G.n} · Tối thượng: ${CH[pick.a].sp[7].n}`;
  $("bFight").disabled = pick.a < 0 || pick.b < 0; document.querySelectorAll("#lvPick button").forEach((b, i) => b.classList.toggle("on", i === pick.lvl));
}
document.querySelectorAll("#pickGrid .chr").forEach(b => b.onclick = () => { const i = +b.dataset.c < 0 ? Math.floor(Math.random() * CH.length) : +b.dataset.c; if (pick.a < 0 || pick.b >= 0) { pick.a = i; pick.b = -1; } else pick.b = i; drawPick(); });
$("lvPick").innerHTML = LVL.map((o, i) => `<button data-i="${i}"><b>LV${i + 1}</b> ${o.n}<small>${o.hp} HP</small></button>`).join("");
document.querySelectorAll("#lvPick button").forEach(b => b.onclick = () => { pick.lvl = +b.dataset.i; drawPick(); });
$("bAI").onclick = () => { pick.a = -1; pick.b = -1; drawPick(); show("pick"); };
$("bFight").onclick = () => { me.ch = pick.a; try { localStorage.setItem("hmwiz-ch", me.ch); } catch {} startMatch("ai", pick.lvl, [pick.a, pick.b]); };
$("oppPick").innerHTML = LVL.map((o, i) => `<button data-i="${i}">LV${i + 1}</button>`).join("");
document.querySelectorAll("#oppPick button").forEach(b => b.onclick = () => startMatch("ai", +b.dataset.i, G.chars));
/* chọn nhân vật trong phòng 2 người */
$("roomGrid").innerHTML = CH.map(card).join("");
const drawRoomPick = () => document.querySelectorAll("#roomGrid .chr").forEach((b, i) => { b.classList.toggle("p1", i === me.ch); b.querySelector("em").textContent = i === me.ch ? "BẠN" : ""; });
document.querySelectorAll("#roomGrid .chr").forEach(b => b.onclick = () => { if (me.ready) return; me.ch = +b.dataset.c; try { localStorage.setItem("hmwiz-ch", me.ch); } catch {} drawRoomPick(); });
drawRoomPick();
$("bCreate").onclick = createRoom; $("bJoin").onclick = () => joinRoom($("inCode").value); $("inCode").onkeydown = e => { if (e.key === "Enter") joinRoom($("inCode").value); };
$("bReady").onclick = setReady;
document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { if (b.dataset.go === "home" && (G.mode === "pvp" || net.connected)) return location.reload(); show(b.dataset.go); if (b.dataset.go === "home") { G.mode = ""; F = []; $("homeStats").textContent = statLine(); } });
$("bReset").onclick = resetMatch;
// màn mở đầu: dải nhân vật chạy ngang
$("roster").innerHTML = [0, 1].map(() => CH.map((c, i) => `<div class="rost" style="--c:${c.col}"><u style="background-position:${i * 100 / (CH.length - 1)}% 0"></u><i style="background-position:-40px ${-i * 150}px"></i><b>${c.name.toUpperCase()}</b><small>${c.role}</small></div>`).join("")).join("");
$("bSound").onclick = () => { G.sound = !G.sound; $("bSound").textContent = G.sound ? "🔊 Âm thanh" : "🔇 Tắt tiếng"; };
// nút cảm ứng: giữ được
document.querySelectorAll("[data-k]").forEach(b => { const k = b.dataset.k, down = e => { e.preventDefault(); b.classList.add("on"); if (KEY[k] !== undefined) KEY[k] = 1; else press(k); }, up = e => { e.preventDefault(); b.classList.remove("on"); if (KEY[k] !== undefined) KEY[k] = 0; }; b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up); b.addEventListener("contextmenu", e => e.preventDefault()); });
// bảng 8 skill của một nhân vật (trang chơi: chạm để ra chiêu; trang hướng dẫn: để tra)
function spellHTML(ci, tap) { return `<div class="spg">` + CH[ci].sp.map((s, i) => `<button class="sp t${s.t}" ${tap ? `data-sp="${i}"` : "disabled"}><span class="ks">${s.k.split("").join(" › ")} · ${TIER[s.t].mp} MP</span><b>${s.n}</b><small>${s.b ? (s.m ? s.m + " × " : "") + Math.round(s.fixed ? s.b : s.b * TIER[s.t].k) + " sát thương · " : ""}${s.d}</small></button>`).join("") + "</div>"; }
$("guideSpells").innerHTML = CH.map((c, i) => `<h3 style="color:${c.col}">${c.name} · ${c.role}</h3><p>${c.tag}. Đòn F: ${c.F.n}. Đòn G: ${c.G.n}.</p>` + spellHTML(i, false)).join("");
window.__wz = { G, CH, get F() { return F; }, get ATK() { return ATK; }, press, tapSpell, startMatch, net, setReady, KEY, pick };
