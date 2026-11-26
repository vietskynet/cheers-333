/* AGENCY COMBAT – game.js (toàn bộ game nằm trong file này)
   Phần 1: kết nối 2 máy (dùng chung với các game khác của HandMagination). Phần 2: game. */
const $ = id => document.getElementById(id);
const show = id => { document.querySelectorAll(".scr").forEach(s => s.classList.toggle("on", s.id === id)); document.documentElement.classList.toggle("playing", id === "game"); document.documentElement.classList.toggle("athome", id === "home"); keepAwake(id === "game"); };
/* Điện thoại: trong trận khoá cuộn, khoá zoom, không bôi đen chữ, không hiện menu giữ-lâu, giữ màn hình luôn sáng */
let wakeLock = null;
function keepAwake(on) { try { if (on && !wakeLock && navigator.wakeLock) navigator.wakeLock.request("screen").then(l => { wakeLock = l; l.addEventListener("release", () => { wakeLock = null; }); }).catch(() => {}); else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; } } catch {} }
document.addEventListener("visibilitychange", () => { if (!document.hidden && document.documentElement.classList.contains("playing")) keepAwake(true); });
const inPlay = e => document.documentElement.classList.contains("playing") && !(e.target.closest && e.target.closest(".topbar, #tourBox"));
["touchstart", "touchmove", "touchend"].forEach(t => document.addEventListener(t, e => { if (inPlay(e) && e.cancelable) e.preventDefault(); }, { passive: false }));   // chặn zoom chạm đôi, cuộn và kính lúp; nút trong trận dùng pointer event nên vẫn nhận
["gesturestart", "gesturechange", "dblclick", "contextmenu", "selectstart"].forEach(t => document.addEventListener(t, e => { if (document.documentElement.classList.contains("playing")) e.preventDefault(); }));

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
/* Hình: sprites.webp = mỗi nhân vật một hàng 12 khung (ô 190×150, chân ở đáy ô, tâm ở x=95), rồi hàng khung đặc biệt, rồi đạo cụ (ô 96×72). bg.png = nền 480×270. posters.webp = poster xếp ngang.
   Nếu site chưa có file thì lấy tạm từ kho ảnh Higgsfield. */
const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_2vybgglAYZMtuRPV18Aqg7zS5iW/";
function loadImg(local, cdn) { const im = new Image(); im.onerror = () => { if (!im._f) { im._f = 1; im.src = CDN + cdn; } }; im.onload = () => document.documentElement.style.setProperty(local === "./sprites.webp" ? "--spr" : "--bg", `url("${im.src}")`); im.src = local; return im; }
const SPR = loadImg("./sprites.webp", "1ba1d300-6160-48a6-8bb5-5a1762aeb510.webp"), BG = loadImg("./bg.png", "073e9582-2bbe-44d6-98ac-5cf73662bbb0.png");
/* Ảnh nền màn mở đầu: poster nhóm 13 nhân vật, một bản dọc cho điện thoại và một bản ngang cho laptop */
const WALL = { p: ["./wall-p.webp", "bffc5291-85b3-4f8a-8c67-ba91cd40039b.webp"], l: ["./wall-l.webp", "3090b201-3409-44bd-9ef2-228a26758936.webp"] };
function loadWall() { const k = innerWidth > innerHeight ? "l" : "p", w = WALL[k]; if (w.done) return; w.done = 1; const im = new Image(); im.onerror = () => { if (!im._f) { im._f = 1; im.src = CDN + w[1]; } }; im.onload = () => document.documentElement.style.setProperty("--wall" + k, `url("${im.src}")`); im.src = w[0]; }
loadWall(); addEventListener("resize", loadWall);
const POST = new Image(); POST.onload = () => { document.documentElement.style.setProperty("--post", `url("${POST.src}")`); document.body.classList.add("hasPost"); }; POST.onerror = () => { if (!POST._f) { POST._f = 1; POST.src = CDN + "9f097731-2e1f-4564-8f36-17a0eb6afd5e.webp"; } }; POST.src = "./posters.webp";
const ok = im => im.complete && im.naturalWidth > 0;
const IC = { phone: 0, mail: 1, folder: 2, chat: 3, car: 4, table: 5, coin: 6, cal: 7, bulb: 8, marker: 9, cat1: 10, cat2: 11, dumb: 12, frame: 13, easel: 14, wind: 15, splat: 16, brush: 17, scis: 18, cig: 19, smoke: 20, shrimp: 21, layers: 22, pen: 23, mag: 24, report: 25, funnel: 26, book: 27, trophy: 28, chart: 29, venn: 30, stamp: 31, paw: 32, wig: 33, buffet: 34, menu: 35, pho: 36, banhmi: 37, roll: 38, cake: 39, tea: 40, chicken: 41, redpen: 42, hand: 43, news: 44, sushi: 45, pizza: 46, quote: 47, mega: 48, vali: 49, plane: 50, ticket: 51, passport: 52, pencil: 53, ghost: 54, bat: 55, moon: 56, shand: 57, fire: 58, globe: 59, photo: 60, world: 61, shades: 62, scrib: 63, bike: 64, phin: 65, cdrop: 66, rose: 67, spark: 68, heart: 69, cloud: 70, note: 71, crown: 72, mirror: 73, zap: 74, bean: 75, clock: 76, laurel: 77, warn: 78, callbtn: 79, tee: 80, jeans: 81, egg: 82, chick: 83, plate: 84, duck: 85, barbell: 86, shaker: 87, glasses: 88, tmirror: 89, matcha: 90, tote: 91, vinyl: 92, earph: 93, camera: 94, obook: 95, hand7: 96, robot: 97, bheart: 98, fheart: 99, tear: 100, mic: 101, speaker: 102, arch: 103, melon: 104, crow: 105, cricket: 106, popper: 107, note2: 108, aistar: 109, rings: 110, tissue: 111, tabi: 112, bag: 113, hanger: 114, glove: 115, gframe: 116, rope: 117, phonecam: 118, bandaid: 119, goat: 120, anger: 121, fshades: 122, beret: 123, scarf: 124, sring: 125, manne: 126, papcam: 127, ringlight: 128, eye: 129, polaroid: 130, tripod: 131, easel2: 132, palette: 133, puddle: 134, lipstick: 135, compact: 136, halo: 137, column: 138, petals: 139, pearls: 140, perfume: 141, pedestal: 142, fan: 143, lowbat: 144, sneaker: 145, vacuum: 146, bus: 147, tomboy: 148, shplate: 149, clipper: 150, hair: 151, pine: 152, sign: 153, dust: 154, palm: 155, chomp: 156, bandana: 157, berry: 158, fog: 159, isle1: 160, isle2: 161, spike: 162, rscarf: 163, beanie: 164, yarn: 165, tank: 166, flag: 167, lstick: 168, truss: 169, nonla: 170, gstar: 171, drum: 172, firework: 173, lotus: 174, trumpet: 175, xoi: 176, thaitea: 177, net: 178, fish: 179, elephant: 180, tuktuk: 181, mglove: 182, chili: 183, durian: 184, inhaler: 185, vapor: 186, fans: 187, hi: 188, temple: 189, tomyum: 190, coconut: 191, racket: 192, shuttle: 193, pot: 194, xoi: 195, steam: 196, sketch: 197, scrap: 198, gpen: 199, karaoke: 200, ochair: 201, zticket: 202, blush: 203, angel: 204, halo: 205, fist: 206, sandal: 207, icecube: 208, snow: 209, coldwind: 210, ffish: 211, beef: 212, fshrimp: 213, coil: 214, padlock: 215, wheel: 216, thermo: 217, ecoleaf: 218, iceblock: 219, hotpot: 220, tap: 221, freezer: 222, fishball: 223, balut: 224, saltdish: 225, pepper: 226, rauram: 227, rotegg: 228, stink: 229, corncup: 230, kernel: 231, wok: 232, quail: 233, quailme: 234, wegg: 235, gegg: 236, swan: 237, duckling: 238, xui: 239 };
/* Ba cấp máy */
const LVL = [
  { n: "Thực tập sinh", hp: 100, spd: 34, dist: 170, rest: [2.4, 3.3], wind: .6, types: ["hi"], dmg: 5, bolt: 190, shield: .12, cast: 0, maxT: 0 },
  { n: "Senior", hp: 150, spd: 58, dist: 215, rest: [1.5, 2.3], wind: .48, types: ["hi", "hi", "lo"], dmg: 7, bolt: 240, shield: .32, cast: .25, maxT: 2 },
  { n: "Sếp tổng", hp: 210, spd: 46, dist: 240, rest: [1.0, 1.7], wind: .4, types: ["hi", "lo", "th", "th"], dmg: 9, bolt: 290, shield: .5, cast: .4, maxT: 4 },
];
const BOSSLV = { boss: 1, n: "Boss cuối", hp: 340, spd: 95, dist: 230, rest: [.55, .95], wind: .3, types: ["hi", "lo", "lo", "th"], dmg: 12, bolt: 340, shield: .55, cast: .5, maxT: 4, sk: 1, roam: 1, dodge: .5, ward: .75, burst: .75, punish: true };
const DUMMY = { ...LVL[0], n: "Bao cát", hp: 300, spd: 0, rest: [1e9, 1e9], shield: 0 };
/* Tournament: trận s trong n trận, máy mạnh dần đều từ dễ tới khó */
function tourLv(s, n) {
  const k = n > 1 ? s / (n - 1) : 1, d = 1 - (1 - k) * (1 - k);          // tăng nhanh ở nửa đầu: tới trận 6 đã ở khoảng 70% độ khó tối đa
  return { n: "Trận " + (s + 1), hp: Math.round(100 + 150 * d), spd: 40 + 60 * d, dist: 230, rest: [2.2 - 1.6 * d, 3 - 2 * d], wind: .55 - .25 * d,
    types: d < .2 ? ["hi"] : d < .5 ? ["hi", "hi", "lo"] : ["hi", "lo", "lo", "th"], dmg: Math.round(5 + 6 * d), bolt: 200 + 140 * d, shield: .1 + .45 * d,
    cast: d < .15 ? 0 : .15 + .35 * d, maxT: d < .15 ? 0 : d < .4 ? 2 : d < .65 ? 3 : 4, sk: .5 + .4 * d,
    roam: Math.max(.25, d), dodge: d < .15 ? 0 : .15 + .6 * d, ward: d < .5 ? 0 : .2 + .5 * d, burst: .1 + .6 * d, punish: d > .3 };
}
const lv = () => G.lvo || LVL[G.lvl];
/* 8 ô skill dùng chung phím cho cả 4 nhân vật */
/* Ra chiêu kiểu arcade: hướng + nút. d = ↓, f = tới (phía đối thủ), b = lui; F G V = nút S D E */
const KEYS = ["dfF", "dbF", "ddG", "fdfF", "bdbG", "bfG", "fbfF", "dfdfV"], TOF = [1, 1, 1, 2, 2, 3, 3, 4];
const TIER = { 1: { mp: 10, k: 1, n: "Cấp 1" }, 2: { mp: 20, k: 1.25, n: "Cấp 2" }, 3: { mp: 35, k: 1.6, n: "Cấp 3" }, 4: { mp: 55, k: 2, n: "Tối thượng" } };
/* Hệ số giảm sát thương skill theo bậc (trận đấu dài hơn; tối thượng giảm mạnh nhất). Đòn thường: F 4, G 8. */
const FULL_HOLD = 3, FULL_DROP = 40;
const SRANGE = [165, 165, 165, 205];   // tầm với (px) của 4 skill đầu; các skill sau đánh được toàn sân
const REC = { 1: .3, 2: .5, 3: .75, 4: 1 };   // đứng hình sau khi ra skill (giây): chiêu càng mạnh càng hở lâu
const CUT = { 1: .6, 2: .55, 3: .5, 4: .4 }, BASIC = { F: 4, G: 8 };
function healClear(c, ic) { c.hp = Math.min(c.max, c.hp + 15); clearAttacksOn(c.i); for (let i = 0; i < 26; i++) FX.push({ k: "icon", ic, t: -i * .03, d: 1.1, x: rnd(10, W - 10), y: rnd(-80, -10), vx: rnd(-10, 10), vy: rnd(150, 260), sc: rnd(.3, .5) }); pop("+15 HP", c.x, FLOOR - 150, "#7CFC8A", 1); }
const four = (o, says) => [0, 1, 2, 3].map(i => ({ p: 1, v: 265, hom: 1, h: HIGH + 24 - i * 15, wait: .3 + i * .13, sc: .48, ...o, ic: Array.isArray(o.ic) ? o.ic[i % o.ic.length] : o.ic, say: says[i % says.length] }));
/* Mỗi skill: n tên, b sát thương gốc, m số đòn, d mô tả, self(c) tác dụng lên mình, mk(c, D, K, dist) trả về danh sách đòn */
const CH = [
  { id: "duc", name: "Đức Phan", role: "Business Director", col: "#ff4d3d", tag: "Deadline, tốc độ và họp gấp",
    F: { n: "Email", ic: IC.mail }, G: { n: "Brief gấp", ic: IC.folder }, th: { n: "Lịch họp rơi", ic: IC.cal },
    sp: [
      { n: "Meeting Gấp", b: 18, d: "Bàn họp rơi từ trần xuống, đối thủ kẹt họp một lúc", mk: (c, D) => [{ wait: .75, dmg: D, fx: "drop", ic: IC.table, sc: 1.2, on: { stun: .9 }, say: "MEETING GẤP!" }] },
      { n: "Follow-up Dồn Dập", b: 9, m: 4, d: "Bốn tin nhắn hối việc tự tìm tới đối thủ", mk: (c, D) => four({ ic: IC.chat, dmg: D, col: "#ffffff" }, ["Em ơi?", "Update chưa?", "Gấp nha!", "ASAP!"]) },
      { n: "Duyệt Ngân Sách", b: 0, d: "Mưa xu vàng: xoá mọi đòn đang bay, hồi 15 HP", self: c => healClear(c, IC.coin) },
      { n: "The Magic Framework", b: 25, d: "Nhốt đối thủ vào ma trận 2×2, không đánh được", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["frame", 2.5, 0, "THE MAGIC FRAMEWORK"] } }] },
      { n: "Timeline Dí", b: 13, m: 3, d: "Ba thanh Gantt đỏ rực nện xuống đầu", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .25 + i * .22, dmg: D, fx: "gantt", n: i, say: ["TRỄ 1 NGÀY", "TRỄ 2 NGÀY", "TRỄ 3 NGÀY"][i] })) },
      { n: "Ferrari Speed", b: 45, d: "Hoá siêu xe đỏ lao xuyên qua đối thủ", self: c => { c.smoke = 1.1; c.fly = .9; c.ride = IC.car; }, mk: (c, D) => [{ wait: .45, dmg: D, fx: "boom", col: "#ff4d3d", say: "VROOOM!" }] },
      { n: "Mưa KPI", b: 36, d: "Trời tối sầm, báo cáo KPI rơi như mưa", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "rain", ic: IC.report, say: "KPI Q4!" }] },
      { n: "Cuộc Gọi Tử Thần", b: 90, fixed: 1, d: "Màn hình cuộc gọi đến chiếm trọn sân đấu, rung bần bật, đối thủ đứng hình. Xuyên khiên", mk: (c, D) => [{ wait: 1.3, dmg: D, pierce: 1, fx: "call", on: { stun: 2.2 }, say: "NGHE MÁY ĐI!" }] },
    ] },
  { id: "viet", name: "Việt Đinh", role: "CD Đẹp Trai Thứ 3", col: "#ffd84a", tag: "Chém gió, cà phê phin, freelance, nhân bản và đẹp trai",
    F: { n: "Giọt cà phê", ic: IC.cdrop }, G: { n: "Phin bay", ic: IC.phin }, th: { n: "Khung tranh rơi", ic: IC.frame },
    sp: [
      { n: "Chém Gió", b: 18, d: "Vung tay chém một luồng gió mạnh về phía trước, thổi lùi đối thủ", self: c => { for (let i = 0; i < 10; i++) FX.push({ k: "spark", t: 0, d: .3, x: c.x + c.dir * 30, y: FLOOR - 60 - i * 6, vx: c.dir * rnd(160, 300), vy: rnd(-30, 30), c: "#dfe9f5" }); },
        mk: (c, D) => [{ p: 1, v: 420, ic: IC.wind, sc: 1.15, wob: 1, wave: 1, dmg: D, col: "#dfe9f5", on: { stun: .7, push: 54 }, say: "CHÉM!" }] },
      { n: "Seen Tin Nhắn", b: 12, d: "Đã xem, không trả lời: đối thủ chưng hửng đứng nhìn điện thoại", mk: (c, D) => [{ wait: .3, dmg: D, on: { ctrl: ["seen", 1.9, 0, ""] }, say: "SEEN!" }] },
      { n: "Cà Cà Phê", b: 18, d: "Bay tới cà cái phin lên đầu đối thủ, thơm quá nên choáng váng", self: c => { c.smoke = 1.15; c.ride = -9; }, mk: (c, D) => [{ wait: .5, dmg: D, fx: "cafe", on: { ctrl: ["dizzy", 1.4, 0, "THƠM QUÁ…"] }, say: "CÀ CÀ CÀ!" }] },
      { n: "Delay Timeline", b: 26, d: "Bật đồng hồ cát: cát lấp đầy, giam đối thủ 1 giây rồi nổ", mk: (c, D) => [{ wait: .3, dmg: D * .3, on: { ctrl: ["sand", 2.2, D * .7, ""] }, say: "DELAY!" }] },
      { n: "Book Grab", b: 13, m: 3, d: "Đặt xe ôm: xe chạy vòng quanh rồi tông đối thủ từ tứ phía", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .4 + i * .32, dmg: D, fx: "bike", n: i, say: ["BÍP BÍP!", "TỚI RỒI!", "5 SAO NHA!"][i] })) },
      { n: "Freelance", b: 6, m: 6, d: "Kêu gọi bầy freelance art và copy ùa tới tấn công", mk: (c, D) => [IC.brush, IC.pen, IC.pencil, IC.marker, IC.redpen, IC.layers].map((ic, i) => ({ p: 1, v: 280, hom: 1, h: HIGH + 40 - i * 14, wait: .3 + i * .11, sc: .5, ic, dmg: D, col: i % 2 ? "#93c5fd" : "#fca5a5", say: ["ART ĐÂY!", "COPY ĐÂY!", "Xin brief!", "Báo giá nha", "Gửi file rồi!", "Chốt chưa anh?"][i] })) },
      { n: "Nhân Bản Vô Cực", b: 45, d: "Chín ảo ảnh vây quanh đối thủ, không biết ai thật; một ảo ảnh bất kỳ bay ra tung hoa hồng", self: c => { c.smoke = 1.7; c.ride = -9; }, mk: (c, D) => [{ wait: 1.35, dmg: D, fx: "nine", on: { stun: .6 }, say: "LÀ ANH ĐÂY!" }] },
      { n: "Sức Mạnh Đẹp Trai", b: 90, fixed: 1, d: "Phóng to lên, hào quang đẹp trai toả ra làm đối thủ gục ngã. Xuyên khiên", self: c => { c.giant = 2; }, mk: (c, D) => [{ wait: 1.1, dmg: D, pierce: 1, fx: "aura", on: { ctrl: ["swoon", 2.2, 0, "ĐẸP TRAI QUÁ…"] }, say: "♥ ♥ ♥" }] },
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
      { n: "Framework", b: 25, d: "Thả nguyên ngôi nhà chiến lược Vision – Mission – Trụ Cột xuống, bắt đối thủ gồng làm trụ thứ 7", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["house", 2.6, 0, ""] }, say: "SLIDE 47!" }] },
      { n: "Phễu Insight", b: 6, d: "Hút đối thủ lên phễu 2,6 giây rồi thả rơi (4 + 8)", mk: (c, D, K) => [{ wait: .1, dmg: D, on: { ctrl: ["lev", 2.6, 12 * K, "AWARENESS → LOYALTY", IC.funnel] } }] },
      { n: "Mô Hình Tăng Trưởng", b: 45, d: "Mũi tên tăng trưởng phóng xuyên qua đối thủ", mk: (c, D) => [{ wait: .5, dmg: D, fx: "dash", ic: IC.chart, sc: 1.5, say: "+300% YoY" }] },
      { n: "Bible Strategy", b: 36, d: "Cuốn kinh chiến lược giáng xuống trong ánh hào quang", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "drop", ic: IC.book, sc: 1.8, holy: 1, lb: "BIBLE STRATEGY", say: "AMEN!" }] },
      { n: "5 WIN Strategy", b: 18, m: 5, fixed: 1, d: "Năm con dấu WIN đóng liên tiếp, chốt bằng cúp vàng. Xuyên khiên", mk: (c, D) => [0, 1, 2, 3, 4].map(i => ({ wait: .35 + i * .3, dmg: D, pierce: 1, fx: "drop", ic: i < 4 ? IC.stamp : IC.trophy, sc: i < 4 ? .9 : 1.7, quick: 1, n: i, say: "WIN " + (i + 1) })) },
    ] },
  { id: "ngan", name: "Phương Ngân", role: "Taste Maker", col: "#f472b6", tag: "Chơi chữ, set menu, mèo khổng lồ và mái tóc trùm",
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
  { id: "khoa", name: "Khoa Đặng", role: "Ông Hoàng Bóng Đêm", col: "#8b5cf6", tag: "Nói nhiều, cầu lông, karaoke, vé 0 đồng, thần vẽ và bịa chuyện",
    F: { n: "Nói nhiều", ic: -4 }, G: { n: "Nói to hơn", ic: IC.mega }, th: { n: "Quà lưu niệm rơi", ic: IC.globe },
    sp: [
      { n: "Book Vé 0 Đồng", b: 9, m: 4, d: "Bốn tấm vé 0 đồng tự tìm tới, đối thủ đỏ mặt xấu hổ", mk: (c, D) => four({ ic: IC.zticket, sc: .5, dmg: D, col: "#fde68a", on: { ctrl: ["blush", .7, 0, "XẤU HỔ QUÁ…"] } }, ["0 ĐỒNG!", "Chưa thuế phí", "Bay 2 giờ sáng", "Không hành lý"]) },
      { n: "Bão Cầu Lông", b: 2, m: 10, d: "Nhảy lên, vung vợt đập mười quả cầu vào đối thủ", self: c => { if (c.y === 0) c.vy = 330; FX.push({ k: "icon", ic: IC.racket, t: 0, d: .9, x: c.x + c.dir * 22, y: FLOOR - 150, vx: c.dir * 30, vy: -20, sc: .8 }); },
        mk: (c, D) => Array.from({ length: 10 }, (u, i) => ({ p: 1, v: 400, hom: 1, h: 190 - (i % 5) * 14, wait: .2 + i * .07, ic: IC.shuttle, sc: .32, spin: 1, dmg: D, col: "#ffffff", say: i % 3 ? "" : "BỐP!" })) },
      { n: "Tắt Đèn", b: 18, d: "Cả văn phòng tối thui, đối thủ chỉ còn hai con mắt và đứng im", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["dark", 2, 0, "AI TẮT ĐÈN VẬY?"] } }] },
      { n: "Cầu Nguyện", b: 9, m: 3, d: "Quỳ xuống cầu nguyện, ba thiên thần từ trời bay xuống bắn tên", self: c => { c.smoke = 1.25; c.ride = -9; }, mk: (c, D) => [0, 1, 2].map(i => ({ wait: .7 + i * .22, dmg: D, fx: "pray", n: i, say: ["AMEN!", "PHẬP!", "PHẬP!"][i] })) },
      { n: "Nấu Xói", b: 28, d: "Bỏ đối thủ vào nồi rồi Nấu Xói bằng Nói Xấu, chín từ từ", mk: (c, D) => [{ wait: .3, dmg: D * .4, on: { ctrl: ["cook", 2.4, D * .6, "NẤU XÓI = NÓI XẤU"] }, say: "VÔ NỒI!" }] },
      { n: "Đụng Là Hát", b: 45, d: "Lao tới, kéo ghế ngồi, lôi dàn karaoke ra hát tới khi đối thủ kiệt sức", self: c => { c.smoke = 2.9; c.ride = -9; },
        mk: (c, D) => [{ wait: .5, dmg: D * .4, on: { ctrl: ["kara", 2.2, 0, "TẮT GIÙM ĐI…"] }, say: "MỘT HAI BA!" }, { wait: 2.7, dmg: D * .6, fx: "kara", say: "KIỆT SỨC!" }] },
      { n: "Thần Vẽ", b: 40, d: "Hoá vị thần cầm bút, sketch đối thủ lên một trang giấy rồi xé tan", self: c => { c.smoke = 1.6; c.ride = -9; }, mk: (c, D) => [{ wait: 1.4, dmg: D, fx: "sketch", say: "XOẸT!" }] },
      { n: "Bịa Chuyện", b: 90, fixed: 1, d: "Vẽ ra drama đánh ghen, đám đông ập vào đánh hội đồng. Xuyên khiên", mk: (c, D) => [{ wait: 1.2, dmg: D, pierce: 1, fx: "mob", on: { ctrl: ["mob", 2, 0, "KHÔNG PHẢI EM!"] }, say: "CHÍNH NÓ ĐÓ!" }] },
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
      { n: "Muscle Man", b: 20, d: "Cởi áo khoe cơ ngực và 6 múi, bay tới ôm chặt đối thủ gây ngạt (16 + 13)", self: c => { c.smoke = 3.3; c.ride = -9; }, mk: (c, D, K) => [{ wait: 1.1, dmg: D, fx: "hug", on: { ctrl: ["hug", 2.2, 16 * K, "NGẠT… THẢ RA…"] }, say: "ÔM CÁI NÀO!" }] },
      { n: "Performative", b: 90, fixed: 1, d: "Năm bản thể đẹp trai cùng trình diễn, đối thủ choáng ngợp. Xuyên khiên", mk: (c, D) => [{ wait: 1.5, dmg: D, pierce: 1, fx: "perf", on: { ctrl: ["dizzy", 2.2, 0, "CHOÁNG NGỢP…"] }, say: "PERFORMATIVE!" }] },
    ] },
  { id: "nguyen", name: "Nguyên Cô Đơn", role: "Đang tìm người yêu", col: "#fb7185", tag: "Trái tim, yêu thầm, nhiệt huyết và prompt",
    F: { n: "Nói nhiều", ic: -4, words: ["ê nè", "kể nghe", "rồi sao?"] }, G: { n: "Voice 5 phút", ic: IC.chat }, th: { n: "Tim vỡ rơi", ic: IC.bheart },
    sp: [
      { n: "Thánh AI", b: 18, d: "Gõ prompt, AI sinh ra bàn tay 7 ngón đập xuống đối thủ", mk: (c, D) => [{ wait: 1.1, dmg: D, fx: "prompt", on: { stun: .9 }, say: "7 NGÓN?!" }] },
      { n: "Đơn Phương Crush", b: 9, m: 4, d: "Bốn tin nhắn gửi crush tự tìm tới đối thủ", mk: (c, D) => four({ ic: -3, bub: 1, dmg: D, col: "#fda4af" }, ["Ăn cơm chưa?", "Ngủ ngon nha", "Seen ✓✓", "Ừ."]) },
      { n: "Ngồi Ngủ", b: 0, d: "Ngồi ghế văn phòng, đeo gối cổ ngủ 3 giây: không dính đòn nào. Đối thủ buồn ngủ theo, ngủ 5 giây (bị đánh thì tỉnh)", self: c => { c.nap = 3; }, mk: () => [{ wait: .3, dmg: 0, on: { ctrl: ["sleep", 5, 0, ""] }, say: "NGỦ ĐI…" }] },
      { n: "Chúa Rớt Miếng", b: 25, d: "Tung một miếng hài, miếng rơi cái bịch, cả sân im lặng, quạ bay ngang", mk: (c, D) => [{ wait: .7, dmg: D, fx: "drop", ic: IC.melon, sc: 1.5, lb: "MIẾNG", on: { ctrl: ["awk", 2.5, 0, "… (im lặng) …"] }, say: "BỊCH!" }] },
      { n: "Lạc Tone", b: 13, m: 3, d: "Cầm mic hát lệch tông, ba đợt sóng âm méo mó quật đối thủ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .35 + i * .3, dmg: D, fx: "tone", n: i, say: ["É É É!", "LỆCH TÔNG!", "PHÔ!"][i] })) },
      { n: "Ông Hoàng Tiệc Cưới", b: 45, d: "Dựng cổng hoa, bật loa hết cỡ, pháo giấy nổ tung, đối thủ bị thổi bay", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "wedding", on: { push: 40 }, say: "MỜI HAI HỌ!" }] },
      { n: "Nhiệt Huyết", b: 36, d: "Trái tim bốc cháy lao xuyên qua đối thủ", mk: (c, D) => [{ wait: .55, dmg: D, fx: "dash", ic: IC.fheart, sc: 1.7, col: "#ff5a3c", on: { paint: 0 }, say: "CHÁY HẾT MÌNH!" }] },
      { n: "Yêu Đơn Phương", b: 90, fixed: 1, d: "Ngồi xuống khóc, nước mắt và trái tim vỡ rơi khắp sân, đối thủ gục ngã. Xuyên khiên", self: c => { c.smoke = 2; c.ride = -9; }, mk: (c, D) => [{ wait: 1.6, dmg: D, pierce: 1, fx: "cry", on: { ctrl: ["swoon", 2.2, 0, "ĐAU LÒNG QUÁ…"] }, say: "HU HU HU!" }] },
    ] },
  { id: "thang", name: "Thẳng Tính", role: "Fashionista", col: "#d4d4d8", tag: "Ném đồ hiệu, tạo dáng, chọc cho đối thủ tự thua",
    F: { n: "Ném phụ kiện", ic: IC.fshades }, G: { n: "Túi hiệu bay", ic: IC.bag }, th: { n: "Móc áo rơi", ic: IC.hanger },
    sp: [
      { n: "Giày Móng Ngựa", b: 18, d: "Ném chiếc giày móng ngựa xoay tít vào đầu đối thủ", mk: (c, D) => [{ p: 1, v: 320, ic: IC.tabi, sc: .8, spin: 1, dmg: D, col: "#e5e5e5", on: { stun: .9 }, say: "CỘP!" }] },
      { n: "Ăn Cắp", b: 9, m: 4, d: "Bốn bàn tay găng trắng tự tìm tới đối thủ, mỗi tay chôm 8 MP về cho mình", mk: (c, D) => four({ ic: IC.glove, sc: .55, dmg: D, col: "#fff", on: { steal: 8 } }, ["CỦA TUI!", "XIN NHA!", "MƯỢN XÍU!", "CẢM ƠN!"]) },
      { n: "Giấu Đồ", b: 0, d: "Giấu hết đồ nghề của đối thủ: xoá mọi đòn đang bay, đối thủ không ra được skill trong 5 giây", self: c => { clearAttacksOn(c.i); }, mk: () => [{ wait: .3, dmg: 0, fx: "hide", on: { mute: 5 }, say: "ĐỒ ĐÂU RỒI?" }] },
      { n: "Đi Triển Lãm", b: 25, d: "Treo đối thủ lên tường thành một bức tranh, có dây chắn và bảng tên", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["art", 2.6, 0, ""] }, say: "TÁC PHẨM!" }] },
      { n: "Chọc Chửi", b: 13, m: 3, d: "Tạo dáng trêu ngươi; đối thủ tức quá chửi ba tràng, hụt hơi rồi ngất", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .5 + i * .45, dmg: D, fx: "curse", n: i, on: i === 2 ? { stun: 1.4 } : {}, say: ["HỤT HƠI!", "TỨC NGỰC!", "XỈU…"][i] })) },
      { n: "Chọc Bạo Hành", b: 45, d: "Lăn ra ăn vạ, dán băng cá nhân, cả văn phòng giơ điện thoại quay; đối thủ xấu hổ mất máu", self: c => { c.smoke = 1.9; c.ride = -9; }, mk: (c, D) => [{ wait: 1.4, dmg: D, fx: "shame", on: { stun: 1 }, say: "XẤU HỔ QUÁ!" }] },
      { n: "Sàn Diễn", b: 36, d: "Sải bước catwalk xuyên qua đối thủ giữa ánh đèn flash", self: c => { c.smoke = 1.2; c.ride = -9; }, mk: (c, D) => [{ wait: .8, dmg: D, fx: "runway", say: "SLAY!" }] },
      { n: "Dê Xồm", b: 50, fixed: 1, d: "Cưỡi con dê xồm lao tới ôm chặt đối thủ không buông (20 + 16). Xuyên khiên", self: c => { c.smoke = 3.4; c.ride = -9; }, mk: (c, D, K) => [{ wait: 1.0, dmg: D, pierce: 1, fx: "goat", on: { ctrl: ["cling", 2.3, 40, "BUÔNG RA!"] }, say: "BE BE!" }] },
    ] },
  { id: "nhu", name: "Lê Như", role: "The Perfect Woman", col: "#f43f5e", tag: "Tạo dáng, góc mặt đẹp, sống ảo và sự hoàn hảo",
    F: { n: "Dáng pose bay", ic: -6 }, G: { n: "Dáng pose lớn", ic: -6 }, th: { n: "Đèn ring light rơi", ic: IC.ringlight },
    sp: [
      { n: "Ánh Mắt Sắc Lẹm", b: 18, d: "Một cú liếc, hai tia sắc như dao cắt ngang đối thủ", mk: (c, D) => [{ wait: .35, dmg: D, fx: "glare", on: { stun: .9 }, say: "LIẾC!" }] },
      { n: "Đẹp Không Góc Chết", b: 9, m: 4, d: "Bốn tấm ảnh góc mặt đẹp tự tìm tới đối thủ", mk: (c, D) => four({ ic: -7, dmg: D, col: "#fda4af" }, ["GÓC TRÁI!", "GÓC PHẢI!", "GÓC NGHIÊNG!", "GÓC 3/4!"]) },
      { n: "Pose Dáng Điệu Đà", b: 0, d: "Tạo dáng lấp lánh: xoá mọi đòn đang bay, hồi 15 HP", self: c => { healClear(c, IC.petals); c.act = "heavy"; c.actT = .6; } },
      { n: "Quay TikTok", b: 25, d: "Bắt đối thủ cầm điện thoại quay TikTok cho mình, quay đi quay lại tới gục", mk: (c, D) => [{ wait: .25, dmg: D, on: { ctrl: ["film", 2.6, 0, "QUAY LẠI! CHƯA ĐẸP!"] }, say: "ACTION!" }] },
      { n: "Snap Snap Pose Pose", b: 13, m: 3, d: "Chớp tắt đổi dáng liên tục, áp sát rồi đóng khung đối thủ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .3 + i * .28, dmg: D, fx: "snap", n: i, say: ["SNAP!", "SNAP!", "POSE!"][i] })) },
      { n: "Vẽ Tranh Sống Ảo", b: 45, d: "Dựng giá vẽ, bắt đối thủ đứng làm mẫu rồi chảy thành màu", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "paint", on: { ctrl: ["melt", 2.2, 0, "ĐỨNG YÊN!"] }, say: "CHẢY MÀU!" }] },
      { n: "Filter Làm Đẹp", b: 36, d: "Bật filter mịn da 100%, đối thủ mất nét, vỡ thành ô vuông", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "filter", on: { stun: 1 }, say: "MẤT NÉT!" }] },
      { n: "Thật Hoàn Hảo", b: 90, fixed: 1, d: "Hoá thành tượng nữ thần không tì vết; đối thủ quỳ lạy và mất máu. Xuyên khiên", self: c => { c.smoke = 2.3; c.ride = -9; }, mk: (c, D) => [{ wait: 1.7, dmg: D, pierce: 1, fx: "goddess", on: { ctrl: ["bow", 2.4, 0, "HOÀN HẢO QUÁ…"] }, say: "QUỲ XUỐNG!" }] },
    ] },
  { id: "hang", name: "Thanh Hằng", role: "Art Director · Siêu Mẫu", col: "#84cc16", tag: "Cá tính, vỗ vai, hút bụi, xe đi Đà Lạt và tông đơ",
    F: { n: "Khăn bandana", ic: IC.bandana }, G: { n: "Giày sneaker", ic: IC.sneaker }, th: { n: "Cục pin rơi", ic: IC.lowbat },
    sp: [
      { n: "10% Pin", b: 18, d: "Kéo pin đối thủ xuống 10%: đứng hình, không nhúc nhích được 3 giây", mk: (c, D) => [{ p: 1, v: 320, ic: IC.lowbat, sc: .7, wob: 1, dmg: D, col: "#ef4444", on: { ctrl: ["lowbat", 3, 0, "PIN 10% · SẮP SẬP NGUỒN"] }, say: "TÍT TÍT!" }] },
      { n: "Đánh Dập Bờ Vai", b: 9, m: 4, d: "Áp sát rồi vỗ bốp bốp bốp bốp vô vai đối thủ", self: c => { c.smoke = 1.7; c.ride = -9; }, mk: (c, D) => [0, 1, 2, 3].map(i => ({ wait: .45 + i * .26, dmg: D, fx: "pat", n: i, say: "BỐP!" })) },
      { n: "Tôm Boy", b: 18, d: "Gọi một bạn tôm tomboy bưng đĩa tôm lao vào đối thủ", mk: (c, D) => [{ wait: .7, dmg: D, fx: "dash", ic: IC.tomboy, sc: 1.6, col: "#fb923c", trail: IC.shplate, say: "TÔM NÈ!" }] },
      { n: "Nhăm Nhăm", b: 25, d: "Đầu phóng to bay lên cao, há miệng thả mưa chữ NHĂM NHĂM xuống đầu đối thủ", mk: (c, D) => [{ wait: .6, dmg: D, fx: "bighead", on: { ctrl: ["chew", 2.2, 0, ""] }, say: "NHĂM!" }] },
      { n: "Hút Bụi Liên Hồi", b: 13, m: 3, d: "Kéo máy hút bụi khổng lồ ra, hút đối thủ về phía mình, cuối cùng choáng", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .4 + i * .35, dmg: D, fx: "vacuum", n: i, on: i === 2 ? { push: -30, stun: 1.2 } : { push: -30 }, say: i === 2 ? "CHÓNG MẶT!" : "" })) },
      { n: "Tình Yêu Đà Lạt", b: 45, d: "Xe khách cam chạy tới chở đối thủ lên Đà Lạt rồi bỏ lại giữa đường", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "bus", on: { ctrl: ["dalat", 2.6, 0, "ĐÀ LẠT CÒN 120 KM…"] }, say: "LÊN XE!" }] },
      { n: "Căn Lề Từng Pixel", b: 36, d: "Bốn đường guide xanh ép lại, căn đối thủ cho thẳng hàng", mk: (c, D) => [{ wait: 1.0, dmg: D, fx: "guides", on: { stun: 1 }, say: "LỆCH 1 PIXEL!" }] },
      { n: "Cạo Đầu", b: 90, fixed: 1, d: "Tông đơ rè rè, tóc bay tứ tung, đối thủ thành trọc lóc. Xuyên khiên", mk: (c, D) => [{ wait: 1.1, dmg: D, pierce: 1, fx: "shave", on: { ctrl: ["bald", 2.4, 0, "TRỌC LÓC!"] }, say: "RÈ RÈ RÈ!" }] },
    ] },
  { id: "jen", name: "Jen Smiler", role: "Copywriter · Người Yêu Nước", col: "#ef4444", tag: "Lòng yêu nước bao la, concert, đan len và diễu binh",
    F: { n: "Sao vàng", ic: IC.gstar }, G: { n: "Loa phường", ic: IC.mega }, th: { n: "Nón len rơi", ic: IC.beanie },
    sp: [
      { n: "Yêu Biển Đảo", b: 9, m: 2, d: "Bắn hai hòn đảo Hoàng Sa và Trường Sa về phía đối thủ", mk: (c, D) => [{ p: 1, v: 300, ic: IC.isle1, sc: .85, dmg: D, col: "#38bdf8", lbl: "HOÀNG SA", h: HIGH + 8, on: { stun: .5 } }, { p: 1, v: 300, ic: IC.isle2, sc: .85, dmg: D, col: "#38bdf8", lbl: "TRƯỜNG SA", h: HIGH - 14, wait: .28, on: { stun: .7 }, say: "CỦA TA!" }] },
      { n: "Chông Gai Anh Quen Rồi", b: 9, m: 4, d: "Tung khăn choàng, bốn mũi chông tự tìm tới đối thủ", self: c => FX.push({ k: "icon", ic: IC.rscarf, t: 0, d: .8, x: c.x + c.dir * 30, y: FLOOR - 110, vx: c.dir * 40, vy: -30, sc: 1 }), mk: (c, D) => four({ ic: IC.spike, sc: .6, dmg: D, col: "#fde68a" }, ["QUEN RỒI!", "CHÔNG!", "GAI!", "VƯỢT!"]) },
      { n: "Quốc Ca", b: 10, d: "Đứng nghiêm hát quốc ca; lòng yêu nước đè nặng, đối thủ phải đứng nghiêm 2,5 giây", mk: (c, D) => [{ wait: .5, dmg: D, fx: "anthem", on: { ctrl: ["salute", 2.5, 0, "NGHIÊM!"] }, say: "♪ ♪ ♪" }] },
      { n: "Vũ Điệu Đan Len", b: 25, d: "Bung điệu múa đan len, quấn đối thủ trong chiếc nón len chết chóc", mk: (c, D) => [{ wait: .5, dmg: D, fx: "knit", on: { ctrl: ["beanie", 2.6, 0, "NÓNG QUÁ!"] }, say: "ĐAN!" }] },
      { n: "Triệu Hồi Concert", b: 13, m: 3, d: "Biến sân đấu thành concert rồi dập ba cái loa vào đối thủ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .7 + i * .3, dmg: D, fx: "concert", n: i, say: ["BÙM!", "CHÁT!", "ENCORE!"][i] })) },
      { n: "Tự Hào Quá", b: 45, d: "Lá cờ khổng lồ phất ngang sân, cuốn bay đối thủ", mk: (c, D) => [{ wait: .6, dmg: D, fx: "dash", ic: IC.flag, sc: 2.4, col: "#facc15", trail: IC.gstar, on: { push: 40 }, say: "TỰ HÀO!" }] },
      { n: "Caption Triệu Like", b: 36, d: "Viết một caption chạm tim, mưa tim và pháo hoa đổ xuống đối thủ", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "rain", ic: IC.heart, ic2: IC.firework, top: IC.lotus, say: "1 TRIỆU LIKE!" }] },
      { n: "Diễu Binh", b: 90, fixed: 1, d: "Đứng nghiêm tự hào; dàn xe tăng tiến qua sân và tông đối thủ. Xuyên khiên", mk: (c, D) => [{ wait: 1.7, dmg: D, pierce: 1, fx: "parade", on: { ctrl: ["flat", 1.6, 0, "BẸP!"] }, say: "ĐỀU BƯỚC!" }] },
    ] },
  { id: "tuan", name: "Tuấn Huỳnh", role: "Người Việt Gốc Thái", col: "#f59e0b", tag: "Yêu Thái Lan vô điều kiện: Muay Thái, voi, trà sữa và ống hít",
    F: { n: "Ớt hiểm", ic: IC.chili }, G: { n: "Găng Muay Thái", ic: IC.mglove }, th: { n: "Sầu riêng rơi", ic: IC.durian },
    sp: [
      { n: "Quăng Xôi Xoài", b: 18, d: "Đĩa xôi xoài bay thẳng vào mặt đối thủ, dính và choáng", mk: (c, D) => [{ p: 1, v: 320, ic: IC.xoi, sc: .8, spin: 1, dmg: D, col: "#facc15", on: { stun: .9 }, say: "A-ROI!" }] },
      { n: "Muay Thái Thần Công", b: 9, m: 4, d: "Bay lên lên gối bốn phát liên tiếp", self: c => { c.smoke = 1.7; c.ride = -9; }, mk: (c, D) => [0, 1, 2, 3].map(i => ({ wait: .4 + i * .27, dmg: D, fx: "knee", n: i, say: ["ƠI!", "ƠI!", "ƠI!", "KHAP!"][i] })) },
      { n: "Vòi Phun Trà Sữa Thái", b: 18, d: "Vòi trà sữa Thái màu cam phun thẳng, đẩy lùi đối thủ", mk: (c, D) => [{ wait: .45, dmg: D, fx: "tea", on: { push: 34, stun: .5 }, say: "NGỌT QUÁ!" }] },
      { n: "Gã Săn Cá", b: 25, d: "Hoá thành gã săn cá, quăng lưới trùm kín đối thủ", mk: (c, D) => [{ wait: .6, dmg: D, fx: "netthrow", on: { ctrl: ["net", 2.6, 0, "MẮC LƯỚI RỒI!"] }, say: "DÍNH!" }] },
      { n: "Triệu Hồi Voi Thái", b: 13, m: 3, d: "Ba con voi lần lượt xông qua giẫm đối thủ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .5 + i * .34, dmg: D, fx: "bike", ic: IC.elephant, big: 1, n: i, say: ["RẦM!", "RẦM!", "TU TUUU!"][i] })) },
      { n: "Đi Bangkok Liên Tục", b: 45, d: "Bay qua bay lại Bangkok liên tục, đối thủ nhìn theo tới chóng mặt", self: c => { c.smoke = 1.7; c.ride = -9; }, mk: (c, D) => [{ wait: 1.3, dmg: D, fx: "bkk", on: { ctrl: ["dizzy", 2, 0, "LẠI ĐI NỮA HẢ?!"] }, say: "SAWADEE!" }] },
      { n: "Say Hi", b: 36, d: "Giơ hai ngón tay say hi; fan kéo tới đông nghịt đè bẹp đối thủ", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "fans", on: { ctrl: ["flat", 1.4, 0, "NGỘP THỞ!"] }, say: "AAAAA!" }] },
      { n: "Hít Dầu Thái", b: 90, fixed: 1, d: "Triệu hồi ống hít thông mũi khổng lồ; đối thủ hít bạc hà quá liều, mất máu. Xuyên khiên", mk: (c, D) => [{ wait: 1.2, dmg: D, pierce: 1, fx: "inhale", on: { ctrl: ["minty", 2.4, 0, "THÔNG MŨI QUÁ MỨC!"] }, say: "HÍTTTT!" }] },
    ] },
  /* Nhân vật sản phẩm: chiếc tủ đông. Skill lấy từ tính năng thật của dòng tủ (đông lạnh 360 độ, 3 chế độ đông lạnh, dàn lạnh đồng, Inverter, khoá an toàn, bánh xe, van xả nước, đông sâu −18°C) */
  { id: "tudong", name: "Tủ Đông Sanaky", role: "Giữ Chuẩn Tươi Ngon", col: "#2563eb", tag: "Đông lạnh 360 độ, 3 chế độ đông lạnh, dàn lạnh đồng bền bỉ",
    F: { n: "Viên đá", ic: IC.icecube }, G: { n: "Tôm đông lạnh", ic: IC.fshrimp }, th: { n: "Khay thịt bò rơi", ic: IC.beef },
    sp: [
      { n: "Đông Lạnh 360 Độ", b: 9, m: 4, d: "Hơi lạnh toả đều bốn phía: bốn bông tuyết tự tìm tới đối thủ", mk: (c, D) => four({ ic: IC.snow, sc: .5, spin: 1, dmg: D, col: "#bfdbfe" }, ["360°!", "LẠNH ĐỀU!", "KHÔNG SÓT!", "BRRR!"]) },
      { n: "Ba Chế Độ", b: 7, m: 3, d: "Vặn núm ba nấc: làm mát, đông mềm, đông cứng. Nấc cuối làm đối thủ cứng người", mk: (c, D) => [0, 1, 2].map(i => ({ p: 1, v: 330, ic: IC.coldwind, sc: .6 + i * .22, wob: 1, wave: 1, wait: .2 + i * .3, dmg: D * (.7 + i * .3), col: ["#bae6fd", "#7dd3fc", "#38bdf8"][i], on: i === 2 ? { stun: 1.1 } : undefined, say: ["LÀM MÁT!", "ĐÔNG MỀM!", "ĐÔNG CỨNG!"][i] })) },
      { n: "Smart Inverter", b: 0, d: "Chạy êm, tiết kiệm điện: xoá mọi đòn đang bay tới, hồi 15 HP", self: c => healClear(c, IC.ecoleaf) },
      { n: "Dàn Lạnh Đồng", b: 24, d: "Ống đồng quấn chặt lấy đối thủ, lạnh buốt từ trong ra", mk: (c, D) => [{ wait: .3, dmg: D * .4, on: { ctrl: ["coil", 2.3, D * .6, ""] }, say: "QUẤN!" }] },
      { n: "Khoá An Toàn", b: 12, d: "Khoá nắp lại: đối thủ không ra được skill trong 5 giây", mk: (c, D) => [{ wait: .45, dmg: D, fx: "drop", ic: IC.padlock, sc: 1, on: { mute: 5 }, say: "CẠCH!" }] },
      { n: "Bốn Bánh Xe", b: 14, m: 3, d: "Ba chiếc tủ đông lăn bánh ầm ầm qua người đối thủ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .5 + i * .34, dmg: D, fx: "bike", ic: IC.freezer, big: 1, n: i, say: ["RẦM!", "RẦM!", "TRÁNH RA!"][i] })) },
      { n: "Xả Đá", b: 36, d: "Mở van xả: mưa đá viên, cá đông và viên thả lẩu trút xuống", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "rain", ic: IC.icecube, ic2: IC.ffish, top: IC.tap, say: "XẢ ĐÁ!" }] },
      { n: "Âm 18 Độ", b: 90, fixed: 1, d: "Bật tung hai nắp, bão tuyết −18°C đóng băng đối thủ thành một khối đá. Xuyên khiên", mk: (c, D) => [{ wait: 1.3, dmg: D, pierce: 1, fx: "blizzard", on: { ctrl: ["ice", 2.4, 0, ""] }, say: "−18°C!" }] },
    ] },
  /* Nhân vật món ăn: quả trứng vịt lộn. Ăn kèm muối tiêu chanh và rau răm; "lộn" để đổi vận, xả xui */
  { id: "vitlon", name: "Trứng Vịt Lộn", role: "Lộn Là Hết Xui", col: "#d97706", tag: "Ăn kèm rau răm, muối tiêu chanh. Lộn một phát là đổi vận",
    F: { n: "Muối tiêu chanh", ic: IC.saltdish }, G: { n: "Trứng cút", ic: IC.quail }, th: { n: "Trứng vịt rơi", ic: IC.wegg },
    sp: [
      { n: "Phun Muối Tiêu", b: 8, m: 3, d: "Phun ba luồng muối tiêu vào mặt; luồng cuối làm đối thủ hắt xì đứng hình", mk: (c, D) => [0, 1, 2].map(i => ({ p: 1, v: 320, ic: IC.pepper, sc: .55 + i * .15, wob: 1, wait: .2 + i * .26, dmg: D * (.8 + i * .2), col: "#d6d3d1", on: i === 2 ? { stun: .9 } : undefined, say: ["PHÌ!", "PHÌ!", "HẮT XÌ!"][i] })) },
      { n: "Hột Vịt Dữa", b: 18, d: "Ném quả trứng ung: mùi bốc lên làm đối thủ choáng và lùi lại", mk: (c, D) => [{ p: 1, v: 320, ic: IC.rotegg, sc: .8, spin: 1, dmg: D, col: "#a3e635", on: { stun: .9, push: 24 }, say: "THÚI QUÁ!" }] },
      { n: "Xả Xui", b: 0, d: "Lộn một quả cho hết xui: xoá mọi đòn đang bay tới, hồi 15 HP", self: c => healClear(c, IC.xui) },
      { n: "Rau Răm Quấn", b: 24, d: "Rau răm mọc lên từ dưới đất, quấn chặt lấy đối thủ", mk: (c, D) => [{ wait: .3, dmg: D * .4, on: { ctrl: ["vine", 2.3, D * .6, ""] }, say: "MỌC!" }] },
      { n: "Lộn Xui Lộn Ngược", b: 22, d: "Lộn ngược đối thủ lên trời, vận xui đổ hết lên đầu", mk: (c, D) => [{ wait: .45, dmg: D, on: { ctrl: ["upside", 2.1, 0, ""] }, say: "LỘN!" }] },
      { n: "Bắp Xào", b: 36, d: "Chảo bắp xào bơ hành nóng hổi trút xuống đầu đối thủ", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "rain", ic: IC.kernel, ic2: IC.corncup, top: IC.wok, say: "BẮP XÀO ĐÂY!" }] },
      { n: "Trứng Cút Lộn Xào Me", b: 9, m: 5, d: "Năm quả trứng cút lộn xào me dính nhớp tự tìm tới đối thủ; quả cuối chua tới đứng hình", mk: (c, D) => [0, 1, 2, 3, 4].map(i => ({ p: 1, v: 270, hom: 1, h: HIGH + 26 - i * 13, wait: .3 + i * .13, ic: i % 2 ? IC.quailme : IC.quail, sc: .5, spin: 1, dmg: D, col: "#b45309", on: i === 4 ? { stun: 1 } : undefined, say: ["CÚT!", "LỘN!", "XÀO!", "ME!", "CHUA!"][i] })) },
      { n: "Thiên Nga Trăm Trứng", b: 90, fixed: 1, d: "Vỏ trứng nứt toác, vịt thiên nga bay ra đẻ trăm quả trứng bắn thẳng vào đối thủ. Xuyên khiên", mk: (c, D) => [{ wait: 1.5, dmg: D, pierce: 1, fx: "swan", on: { ctrl: ["flat", 1.6, 0, "NGẬP TRỨNG!"] }, say: "TRĂM TRỨNG!" }] },
    ] },
  /* Boss cuối của Tournament: không chọn được, chỉ xuất hiện sau khi thắng hết các nhân vật khác */
  { id: "boss", boss: 1, name: "DEADLINE", role: "Boss cuối", col: "#dc2626", tag: "Thần chết của mọi deadline: đồng hồ, lịch đỏ và lưỡi hái kim giờ",
    F: { n: "Kim giây", ic: IC.clock }, G: { n: "Lịch đỏ", ic: IC.cal }, th: { n: "Đồng hồ rơi", ic: IC.clock },
    sp: [
      { n: "Còn 5 Phút", b: 18, d: "Đồng hồ báo thức rơi trúng đầu, đối thủ cuống lên đứng hình", mk: (c, D) => [{ wait: .6, dmg: D, fx: "drop", ic: IC.clock, sc: 1.1, on: { stun: .8 }, say: "CÒN 5 PHÚT!" }] },
      { n: "ASAP ASAP", b: 9, m: 4, d: "Bốn chữ hối việc tự tìm tới đối thủ", mk: (c, D) => four({ ic: -3, bub: 1, dmg: D, col: "#fecaca" }, ["ASAP!", "GẤP!", "NGAY!", "HÔM QUA!"]) },
      { n: "Dời Hạn Cho Mình", b: 0, d: "Tự lùi deadline của chính mình: xoá mọi đòn đang bay, hồi 15 HP", self: c => healClear(c, IC.cal) },
      { n: "Thứ Sáu 5 Giờ Chiều", b: 25, d: "Tờ lịch đỏ khổng lồ đập xuống, đối thủ kẹt lại làm cho xong", mk: (c, D) => [{ wait: .7, dmg: D, fx: "drop", ic: IC.cal, sc: 1.5, on: { stun: 1.5 }, say: "GỬI TRƯỚC 5H!" }] },
      { n: "OT Xuyên Đêm", b: 13, m: 3, d: "Ba nhát lưỡi hái kim giờ", mk: (c, D) => [0, 1, 2].map(i => ({ wait: .15 + i * .2, dmg: D, fx: "slash", n: i, say: ["22 GIỜ!", "2 GIỜ SÁNG!", "5 GIỜ SÁNG!"][i] })) },
      { n: "Chạy Deadline", b: 45, d: "Chiếc đồng hồ khổng lồ lao xuyên qua đối thủ", mk: (c, D) => [{ wait: .55, dmg: D, fx: "dash", ic: IC.clock, sc: 1.8, col: "#dc2626", say: "TRỄ RỒI!" }] },
      { n: "Mưa Lịch Đỏ", b: 36, d: "Trời tối sầm, lịch đỏ và biển cảnh báo rơi như mưa", mk: (c, D) => [{ wait: 1.2, dmg: D, fx: "rain", ic: IC.cal, ic2: IC.warn, top: IC.clock, say: "QUÁ HẠN!" }] },
      { n: "HẾT GIỜ", b: 100, fixed: 1, d: "Đồng hồ khổng lồ đếm ngược về 0. Xuyên khiên", mk: (c, D) => [{ wait: 1.7, dmg: D, pierce: 1, fx: "timeup", on: { ctrl: ["dizzy", 1.8, 0, "HẾT GIỜ RỒI!"] }, say: "HẾT GIỜ!" }] },
    ] },
];
const NPC = CH.filter(c => !c.boss).length, BOSS = CH.findIndex(c => c.boss);   // NPC: số nhân vật chọn được
const SR = CH.length;          // hàng khung hình đặc biệt: 0 = Bao Tu cởi áo khoe cơ, 1 = Bao Tu dang tay ôm, 2 = Lê Như hoá tượng nữ thần
const PY = (CH.length + 1) * CHH;   // đạo cụ nằm ngay dưới các hàng nhân vật
CH.forEach(c => c.sp.forEach((s, i) => { s.k = KEYS[i]; s.t = TOF[i]; }));
const me = { ready: false, name: "", ch: 0 }, readyMsg = () => ({ t: "ready", name: me.name, ch: me.ch });
const G = { mode: "", lvl: 0, phase: "menu", round: 1, score: [0, 0], ME: 0, t: 0, stop: 0, shake: 0, flash: 0, ko: 0, cine: null, hits: 0, hitT: 0, keys: [], sound: true, names: ["", ""], chars: [0, 1], oppCh: 1 };
let F = [], ATK = [], FX = [], NUM = [], aid = [0, 0];
const KEY = { l: 0, r: 0, u: 0, d: 0 }, seq = { s: "", t: -9 };
const own = i => G.mode === "ai" || i === G.ME;        // máy này có quyền quyết định cho nhân vật i không
const chOf = i => CH[G.chars[i]];

function newF(i) {
  const o = G.mode === "ai" && i === 1 ? lv() : null;
  return { i, dir: i ? -1 : 1, x: i ? 372 : 110, y: 0, vy: 0, hp: o ? o.hp : 100, max: o ? o.hp : 100, lag: 1, mp: 25, guard: 100, stun: 0, inv: 0, shield: 0, parry: 0, charge: 0, big: 0, bigK: 0, giant: 0, nap: 0, mute: 0, smoke: 0, fly: 0, ride: null, paint: 0, lock: 0, ctrl: null, crouch: false, walk: 0, moving: false, act: "", actT: 0, cd: {}, ko: false, q: [], ai: o ? { rest: rnd(...o.rest), wind: 0, type: "", fire: 0 } : null };
}
function startMatch(mode, lvl, chars, sub) {
  G.cut = null; voStop();
  G.mode = mode; G.lvl = lvl || 0; G.sub = mode === "ai" ? sub || "" : ""; G.ally = null; G.lvo = G.sub === "tour" ? (chars[1] === BOSS ? BOSSLV : tourLv(G.tour.s, G.tour.order.length - 1)) : G.sub === "test" && G.passive ? DUMMY : null; $("tourBox").className = ""; G.round = 1; G.score = [0, 0]; G.ME = mode === "pvp" && !net.host ? 1 : 0; G.chars = chars;
  show("game"); scrollTo(0, 0);
  // bảng 8 skill ngay dưới sân đấu: chỉ để xem tổ hợp phím và tên chiêu, không bấm được; ô sáng khi đủ MP
  $("spells").innerHTML = chOf(G.ME).sp.map((s, i) => `<div class="sk t${s.t}" data-sp="${i}" data-mp="${TIER[s.t].mp}" title="${s.d}"><i>${TIER[s.t].mp}</i><span>${kshow(s.k, " ")}</span><b>${s.n}</b></div>`).join("");
  if (G.lvo && G.lvo.boss) { const pool = CH.map((c, i) => i).filter(i => i < NPC && i !== chars[0]); G.ally = { ci: pool[Math.floor(Math.random() * pool.length)], t: 5, act: 0 }; }   // boss kéo theo một nhân vật ngẫu nhiên
  newRound();
}
function newRound() {
  F = [newF(0), newF(1)]; ATK = []; FX = []; NUM = []; aid = [0, 0];
  G.phase = "fight"; G.ko = 0; G.hits = 0; G.cine = null; seq.s = "";
  const mine = me.name ? me.name + " · " + chOf(G.ME).name : chOf(G.ME).name, other = G.mode === "ai" ? chOf(1).name + " (" + lv().n + ")" : (G.oppName ? G.oppName + " · " : "") + chOf(1 - G.ME).name;
  G.names = G.ME === 0 ? [mine, other] : [other, mine];
  pop(G.sub === "tour" ? (G.lvo.boss ? "⚠ BOSS CUỐI: DEADLINE ⚠" : `TRẬN ${G.tour.s + 1}/${G.tour.order.length}`) : G.sub === "test" ? "TẬP LUYỆN" : "ROUND " + G.round, W / 2, 120, "#fff", 1.2, 2);
}

/* ======================= ÂM THANH ======================= */
let AC = null;
function beep(f, d = .08, type = "square", vol = .06, slide = 0) { if (!G.sound) return; try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d + .02); } catch {} }

/* ======================= NHẠC NỀN 16-BIT (tự phát bằng Web Audio, không dùng file nhạc) ======================= */
// Hai bài tự soạn: "menu" cho các màn ngoài trận, "fight" cho trận đấu. Mỗi bài 8 ô nhịp, lặp vô hạn.
// ch = hợp âm từng ô (nốt MIDI), lead = giai điệu 8 nốt móc đơn mỗi ô (0 = nghỉ).
const SONGS = {
  menu: { bpm: 138, ch: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]],
    lead: [69, 0, 72, 76, 81, 0, 76, 72, 77, 0, 76, 72, 69, 0, 72, 0, 79, 0, 74, 71, 74, 79, 83, 0, 76, 0, 71, 67, 71, 0, 76, 0, 81, 0, 84, 88, 93, 0, 88, 84, 89, 0, 88, 84, 81, 0, 84, 0, 91, 0, 86, 83, 86, 91, 95, 0, 92, 0, 88, 83, 88, 92, 95, 100] },
  fight: { bpm: 176, drive: 1, ch: [[52, 55, 59], [52, 55, 59], [48, 52, 55], [50, 54, 57], [52, 55, 59], [55, 59, 62], [48, 52, 55], [47, 51, 54]],
    lead: [76, 79, 83, 79, 76, 79, 83, 88, 86, 83, 79, 83, 86, 83, 79, 76, 84, 79, 76, 79, 84, 88, 84, 79, 81, 78, 74, 78, 81, 86, 81, 78, 76, 76, 88, 76, 86, 76, 83, 79, 83, 86, 91, 86, 83, 79, 83, 86, 84, 88, 91, 88, 84, 79, 76, 72, 83, 83, 87, 90, 95, 90, 87, 83] },
  boss: { bpm: 190, drive: 1, ch: [[50, 53, 57], [50, 53, 57], [46, 50, 53], [45, 49, 52], [50, 53, 57], [55, 58, 62], [46, 50, 53], [45, 49, 52]],
    lead: [74, 0, 74, 77, 74, 0, 81, 80, 81, 0, 77, 74, 73, 74, 77, 0, 82, 0, 77, 74, 70, 74, 77, 82, 81, 80, 81, 85, 88, 85, 81, 76, 86, 0, 86, 89, 86, 0, 93, 92, 94, 0, 91, 86, 82, 86, 91, 0, 94, 91, 89, 86, 82, 86, 89, 94, 93, 0, 88, 85, 81, 85, 88, 93] },
};
const MUS = { cur: "", step: 0, next: 0, out: null, nz: null }, hz = m => 440 * Math.pow(2, (m - 69) / 12);
function musNote(m, t, d, type, vol) { const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(hz(m), t); g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(vol, t + d * .7); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(MUS.out); o.start(t); o.stop(t + d + .02); }
function musDrum(t, d, vol, hp) { const n = AC.createBufferSource(), g = AC.createGain(), f = AC.createBiquadFilter(); n.buffer = MUS.nz; f.type = "highpass"; f.frequency.value = hp; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); n.connect(f); f.connect(g); g.connect(MUS.out); n.start(t, Math.random() * .5, d + .02); }
function musKick(t) { const o = AC.createOscillator(), g = AC.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + .11); g.gain.setValueAtTime(.3, t); g.gain.exponentialRampToValueAtTime(.0001, t + .13); o.connect(g); g.connect(MUS.out); o.start(t); o.stop(t + .15); }
function musTick() {
  if (!AC || AC.state !== "running" || !MUS.out) return;
  MUS.out.gain.value = G.sound && !document.hidden ? (G.cut && G.cut.vo ? .14 : .55) : 0;   // đang đọc thoại thì hạ nhạc nền
  if (voEnd && (VOA.currentTime >= voEnd - .03 || !G.sound || !$("game").classList.contains("on"))) voStop();
  const name = $("game").classList.contains("on") ? (G.lvo && G.lvo.boss ? "boss" : "fight") : "menu", S = SONGS[name], sl = 60 / S.bpm / 4, now = AC.currentTime;
  if (name !== MUS.cur || MUS.next < now - .3) { MUS.cur = name; MUS.step = 0; MUS.next = now + .06; }
  while (MUS.next < now + .25) {
    const st = MUS.step, t = MUS.next, bar = st >> 4, b16 = st & 15, ch = S.ch[bar], dr = S.drive;
    if (!(st & 1)) { const m = S.lead[st >> 1]; if (m) { let len = 1; while (len < 4 && ((st >> 1) + len) % 8 && !S.lead[(st >> 1) + len]) len++; musNote(m, t, sl * 2 * len * .9, "square", .05); if (dr) musNote(m + 12, t, sl * 1.2, "square", .014); else musNote(m - 12, t, sl * 2 * len * .9, "triangle", .03); } }   // giai điệu + lớp bè
    musNote(ch[[0, 1, 2, 1][b16 & 3]] + 12, t, sl * .85, "square", .016);                                                                                         // rải hợp âm
    if (dr) musNote(ch[0] - 24 + ([0, 0, 12, 0, 0, 12, 0, 7][b16 & 7]), t, sl * .9, "triangle", .12);                                                             // bass dồn từng nốt móc kép
    else if (!(b16 & 1)) musNote(ch[0] - 24 + ((b16 >> 1) % 4 === 3 ? 12 : (b16 >> 1) % 4 === 2 ? 7 : 0), t, sl * 1.8, "triangle", .13);
    if (dr ? b16 % 4 === 0 : b16 % 8 === 0 || b16 === 10) musKick(t);                                                                                             // trống
    if (b16 % 8 === 4) musDrum(t, .12, .1, 1400);
    if (dr || !(b16 & 1)) musDrum(t, .03, b16 & 1 ? .02 : .035, 6500);
    if (bar % 4 === 3 && b16 >= 12) musDrum(t, .07, .08, 1800);
    MUS.step = (st + 1) % 128; MUS.next += sl;
  }
}
// trình duyệt chỉ cho phát tiếng sau khi người chơi chạm hoặc bấm phím lần đầu
function musUnlock() { if (!VOA._u) { VOA._u = 1; try { VOA.muted = true; const pr = VOA.play(); const done = () => { VOA.pause(); VOA.muted = false; }; pr && pr.then ? pr.then(done, () => { VOA.muted = false; }) : done(); } catch {} }
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); if (!MUS.out) { MUS.out = AC.createGain(); MUS.out.gain.value = 0; MUS.out.connect(AC.destination); const b = AC.createBuffer(1, AC.sampleRate, AC.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; MUS.nz = b; setInterval(musTick, 50); } } catch {} }
addEventListener("pointerdown", musUnlock); addEventListener("keydown", musUnlock);

/* ======================= ĐIỀU KHIỂN ======================= */
const KMAP = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }, AMAP = { KeyS: "F", KeyD: "G", KeyW: "C", KeyE: "V", KeyQ: "B" };
/* mã đòn bên trong vẫn là F G B C V; phím thật và chữ hiển thị là S D Q W E */
const LB = { F: "S", G: "D", B: "Q", C: "W", V: "E" }, arrow = c => c === "d" ? "↓" : (c === "f") === (!F[G.ME] || F[G.ME].dir > 0) ? "→" : "←", kshow = (k, sep) => k.split("").map(c => LB[c] || arrow(c)).join(sep);
const SEQT = .38;   // mỗi lần bấm phải cách lần trước dưới 0,38 giây
function dirIn(k) { const p = F[G.ME]; if (!p || G.phase !== "fight") return;
  if (k === "u") {   // bấm ↑ hai lần liền (dưới 0,32 giây) là nhảy cao
    if (G.t - (p.upT || -9) < .32 && !p.hj && p.y > 0 && p.stun <= 0 && !p.ctrl && p.fly <= 0 && p.nap <= 0) { p.hj = 1; p.vy = 370; pop("NHẢY CAO!", p.x, FLOOR - 150 - p.y, "#7fd4ff", .6); beep(700, .1, "square", .04, 1200); for (let i = 0; i < 8; i++) FX.push({ k: "spark", t: 0, d: .3, x: p.x + rnd(-14, 14), y: FLOOR - p.y, vx: rnd(-40, 40), vy: rnd(20, 90), c: "#7fd4ff" }); }
    p.upT = G.t; p.jq = G.t + .15; return; } const c = k === "d" ? "d" : (k === "r") === (p.dir > 0) ? "f" : "b"; seq.s = G.t - seq.t < SEQT ? (seq.s + c).slice(-6) : c; seq.t = G.t; G.keys.push({ k: arrow(c), t: G.t }); if (G.keys.length > 8) G.keys.shift(); }
addEventListener("keydown", e => { if (!$("game").classList.contains("on")) return; if (KMAP[e.code] || AMAP[e.code]) e.preventDefault(); if (e.repeat) return; if (KMAP[e.code]) { KEY[KMAP[e.code]] = 1; dirIn(KMAP[e.code]); } if (AMAP[e.code]) press(AMAP[e.code]); });
addEventListener("keyup", e => { if (KMAP[e.code]) KEY[KMAP[e.code]] = 0; });
const canAct = p => !p.ko && G.phase === "fight" && p.stun <= 0 && !p.ctrl && p.lock <= 0 && p.charge <= 0 && p.fly <= 0 && p.nap <= 0;
function press(k) {
  if (G.cut) { if (G.cut.t > .4) { G.cut.t = Math.max(G.cut.t, G.cut.d - .12); voStop(); } return; }
  const p = F[G.ME]; if (!p || G.phase !== "fight" || p.ko) return;
  seq.s = G.t - seq.t < SEQT ? (seq.s + k).slice(-6) : k; seq.t = G.t; G.keys.push({ k, t: G.t }); if (G.keys.length > 8) G.keys.shift();
  // đang nạp (Q) hoặc vừa ra đòn nặng (D) vẫn nối được combo: phím kế tiếp khớp chuỗi thì huỷ nạp và ra skill luôn
  const free = canAct(p), link = !free && p.stun <= 0 && !p.ctrl && p.fly <= 0 && p.nap <= 0 && (p.lock <= 0 || p.softT > G.t);
  if (!free && !link) return;
  const SP = chOf(G.ME).sp; let best = null;                       // combo dài nhất khớp với phần cuối chuỗi phím
  for (const s of SP) if (seq.s.endsWith(s.k) && (!best || s.k.length > best.k.length)) best = s;
  if (best && p.mute > 0) { best = null; pop("ĐỒ ĐÂU RỒI?", p.x, FLOOR - 150, "#d4d4d8", .8); }
  if (best) { if (p.mp >= TIER[best.t].mp) { seq.s = ""; p.charge = 0; p.lock = 0; return doCast(G.ME, SP.indexOf(best), true); } if (free) pop("THIẾU NỘ", p.x, FLOOR - 150, "#7fd4ff", .8); beep(140, .12, "sawtooth"); }
  if (free) doBasic(G.ME, k, true);
}
function tapSpell(i) { const p = F[G.ME]; if (!p || !canAct(p)) return; if (p.mute > 0) { pop("ĐỒ ĐÂU RỒI?", p.x, FLOOR - 150, "#d4d4d8", .8); return; } if (p.mp < TIER[TOF[i]].mp) { pop("THIẾU NỘ", p.x, FLOOR - 150, "#7fd4ff", .8); return; } doCast(G.ME, i, true); }

/* ======================= ĐÒN CƠ BẢN & SKILL ======================= */
const CD = { F: .3, G: .65, C: .5, V: 1.6, B: .7 }, WARD = .5;   // V: vòng đỡ toàn diện, mở 0,5 giây, hồi 1,6 giây
const GAP = 48, near = i => Math.abs(F[0].x - F[1].x) < 125;   // GAP: hai nhân vật áp sát tối đa tới đâu
function doBasic(i, k, local) {
  const p = F[i], c = chOf(i); if (local && (p.cd[k] || 0) > 0) return;
  if (local && G.mode === "pvp") send({ t: "b", k });
  p.cd[k] = CD[k];
  if (k === "F") { p.act = "cast"; p.actT = .18; spawn(i, { p: 1, v: 300, dmg: BASIC.F, col: c.col, ic: c.F.ic, sc: .4, basic: 1, range: 62 }); beep(880, .06); if (near(i)) aiReact(i, .4); }
  if (k === "G") { p.act = "heavy"; p.actT = .3; p.lock = .22; p.softT = G.t + .25; const low = G.mode === "pvp"; spawn(i, { p: 1, v: 240, dmg: BASIC.G, col: c.col, ic: c.G.ic, sc: .6, wob: 1, low, h: low ? 16 : HIGH, basic: 1, range: 80 }); beep(330, .12, "sawtooth"); if (near(i)) aiReact(i, .7); }
  if (k === "C") { p.shield = .85; p.cd.C = .85 + CD.C; beep(520, .1, "triangle"); }
  if (k === "V") { p.parry = WARD; beep(700, .12, "triangle", .06, 1400); }
  if (k === "B") { p.charge = .65; beep(260, .3, "sine", .05, 520); }
}
/* ======================= FINAL ACT: màn dạo đầu của chiêu Tối thượng =======================
   Game đứng hình khoảng 2,7 giây: nền tối, dải chéo zoom vào gương mặt người ra chiêu (cắt từ poster), ba dòng kể chuyện
   hiện kiểu đánh máy, tên chiêu đập vào màn hình, chớp trắng rồi mới tới đòn kết liễu. Bấm một nút bất kỳ để bỏ qua. */
const STORY = {
  duc: ["Thứ Sáu. 17 giờ 59.", "Khách: «Em ơi, có tí feedback…»", "Anh bấm gọi cả team."],
  viet: ["Anh không cần slide.", "Anh chỉ cần vuốt tóc.", "Cả phòng họp nín thở."],
  nhan: ["Layout thứ 48.", "Lưng anh đã hết thẳng.", "Giờ tới lượt mày cong."],
  hieu: ["Slide 1 trên 120.", "Win khách. Win sếp. Win giải.", "Win luôn cả mày."],
  ngan: ["Headline chưa ai duyệt.", "Nhưng mèo thì đã đói.", "Meo… meo… ra đây nào!"],
  khoa: ["Chuyện này anh chỉ nghe kể…", "…nhưng anh kể lại cho cả công ty.", "Thêm chút mắm muối."],
  bao: ["Tập xong chưa kịp tắm.", "Nhưng story thì phải đăng.", "Ánh sáng: hoàn hảo."],
  nguyen: ["Tin nhắn thứ 99: «Ngủ ngon nha».", "Đã xem. Không trả lời.", "Tim anh hoá thành vũ khí."],
  thang: ["Outfit hôm nay: 10 điểm.", "Ngại ngùng: 0 điểm.", "Lại gần đây coi."],
  nhu: ["Góc trái: đẹp.", "Góc phải: cũng đẹp.", "Không có góc chết."],
  hang: ["Căn lề lệch đúng 1 pixel.", "Chị không tha thứ.", "Tông đơ đã sạc đầy."],
  jen: ["Loa phường vang lên.", "Cả khu phố xuống đường.", "Đều bước!"],
  tuan: ["Vé đi Bangkok: đã book.", "Dầu gió: đã mở nắp.", "Sawadee khrap."],
  tudong: ["Quán lẩu chật kín khách.", "Thịt bò, tôm, viên thả lẩu: đầy tủ.", "Mở nắp. Âm mười tám độ!"],
  vitlon: ["Xe trứng vịt lộn đầu hẻm.", "Vỏ nứt rồi. Ánh sáng loé lên!", "Thiên nga xuất hiện. Trăm trứng, bắn!"],
  boss: ["Brief nào rồi cũng tới hạn.", "Mọi câu «mai em gửi»…", "…đều về tay ta."],
};
const PFACE = [[.57, .15], [.45, .22], [.57, .14], [.48, .21], [.55, .29], [.36, .26], [.45, .2], [.5, .16], [.61, .11], [.49, .35], [.48, .19], [.48, .19], [.59, .19], [.47, .56], [.5, .4]];   // tâm gương mặt trên từng poster (tỉ lệ ngang, dọc)
/* Ba khung truyện vẽ riêng cho từng nhân vật (story.webp: mỗi hàng 3 ô 512×288). STROW: số nhân vật → hàng trong ảnh. Chưa tải xong thì dùng kiểu zoom poster. */
const STROW = Object.fromEntries(CH.map((c, i) => [i, i])), FW = 512, FH = 288, STO = new Image(), FR0 = .2, FRD = .95; STO.onerror = () => { if (!STO._f) { STO._f = 1; STO.src = CDN + "141ba990-ce2e-4ce7-8edb-c94d402ec593.webp"; } }; STO.src = "./story.webp";   // FRD: mỗi khung hiện 0,95 giây
/* Lồng tiếng Final Act: một file vox.mp3 chứa lần lượt các đoạn của từng nhân vật. VOX[ci] = [mốc bắt đầu trong file, dài câu 1, câu 2, câu 3, dài tiếng động kết].
   Nhân vật có lồng tiếng thì mỗi khung truyện kéo dài đúng bằng câu thoại của nó; chưa có thì dùng nhịp cố định và tiếng bíp. */
const VOX = { 0: [0, 2.17, 2.26, 1.21, 2.4], 1: [8.34, 1.13, 1.76, 1.58, 2.4], 2: [15.51, 2.22, 1.55, 1.89, 2.4], 3: [23.87, 1.93, 1.69, 1.52, 2.4], 4: [31.71, 2.03, 1.53, 2.42, 2.4], 5: [40.39, 1.81, 1.76, 1.3, 2.4], 6: [47.96, 1.48, 1.52, 1.63, 2.4], 7: [55.29, 3.0, 1.39, 2.03, 2.4], 8: [64.41, 1.65, 1.25, 1.72, 2.4], 9: [71.73, 1.19, 1.2, 1.6, 2.4], 10: [78.42, 1.76, 1.02, 1.42, 2.4], 11: [85.32, 2.29, 1.63, 1.14, 2.4], 12: [93.08, 2.3, 1.71, 1.2, 2.4], 13: [100.99, 1.99, 3.52, 2.52, 2.4], 14: [111.72, 1.64, 2.22, 2.21, 2.4], 15: [120.49, 1.44, 1.56, 1.05, 2.4] }, VOA = new Audio(); VOA.preload = "auto"; VOA.onerror = () => { if (!VOA._f) { VOA._f = 1; VOA.src = CDN + "35b28890-6d39-4d57-85f6-de9431fe18de.mp3"; } }; VOA.src = "./vox.mp3"; let voEnd = 0;
function voStop() { voEnd = 0; try { VOA.pause(); } catch {} }
function startCut(i, ci, name) {
  const fr = STROW[ci] != null && ok(STO), v = fr && G.sound && VOA.readyState >= 2 ? VOX[ci] : null, b = v ? [FR0, FR0 + v[1], FR0 + v[1] + v[2], FR0 + v[1] + v[2] + v[3]] : [FR0, FR0 + FRD, FR0 + FRD * 2, FR0 + FRD * 3];
  G.cut = { i, ci, n: name, t: 0, d: fr ? b[3] + (v ? Math.min(1.5, v[4] - .5) : .75) : 2.75, s: 0, fr, b, vo: v, lines: STORY[CH[ci].id] || ["…", "…", "…"] }; beep(120, .5, "sawtooth", .08, 900);
}
function stepCut(dt) {
  const c = G.cut, t0 = c.t; c.t += dt; const b = c.b;
  if (c.vo && t0 < FR0 && c.t >= FR0) { try { VOA.currentTime = c.vo[0]; voEnd = c.vo[0] + c.vo[1] + c.vo[2] + c.vo[3] + c.vo[4]; const pr = VOA.play(); if (pr && pr.catch) pr.catch(() => {}); } catch {} }   // bắt đầu đọc thoại đúng lúc khung 1 hiện
  const st = c.fr ? (c.t < b[0] ? 0 : c.t < b[1] ? 1 : c.t < b[2] ? 2 : c.t < b[3] ? 3 : 4) : c.t < .35 ? 0 : c.t < .9 ? 1 : c.t < 1.45 ? 2 : c.t < 2 ? 3 : 4;
  if (st > c.s) { c.s = st; if (!c.vo) { if (st < 4) beep(500 + st * 120, .06, "square", .05); else { beep(90, .5, "sawtooth", .12, 40); beep(1400, .25, "square", .06, 200); } } }
  if (c.t >= c.d) { G.cut = null; G.flash = .7; G.shake = 10; }   // tiếng động kết còn ngân thêm một chút sang lúc ra đòn
}
function drawCutFrames(c) {      // bản có tranh: ba khung truyện lần lượt phủ kín màn hình, khung cuối là lúc tung chiêu
  const t = c.t, ch = CH[c.ci], col = ch.col, ease = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3), kin = ease(t / FR0), b = c.b, tn = b[3], fi = t < b[1] ? 0 : t < b[2] ? 1 : 2, ft = Math.max(0, t - b[fi]), FD = b[fi + 1] - b[fi], row = STROW[c.ci];
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.fillStyle = `rgba(0,0,0,${kin})`; x.fillRect(0, 0, W, H);
  if (t >= FR0) { const z = 1.04 + (fi === 2 ? .1 : .06) * Math.min(1, ft / FD) + (fi === 2 && t >= tn ? .03 : 0), dx = [-1, 1, 0][fi] * (1 - Math.min(1, ft / FD)) * 10, sl = (1 - ease(ft / .16)) * [W * .5, -W * .5, 0][fi], jx = fi === 2 && t >= tn ? Math.sin(t * 90) * Math.max(0, tn + .3 - t) * 10 : 0;
    x.save(); x.beginPath(); x.rect(0, 22, W, H - 44); x.clip(); x.imageSmoothingEnabled = true; x.translate(W / 2 + dx + sl + jx, H / 2); x.scale(z, z); x.drawImage(STO, fi * FW, row * FH, FW, FH, -W / 2, -H / 2, W, H); x.restore(); x.imageSmoothingEnabled = false;
    if (ft < .12) { x.fillStyle = `rgba(255,255,255,${(1 - ft / .12) * .85})`; x.fillRect(0, 22, W, H - 44); }
    const g = x.createLinearGradient(0, H - 100, 0, H - 22); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.82)"); x.fillStyle = g; x.fillRect(0, H - 100, W, 78); }
  x.fillStyle = "#000"; x.fillRect(0, 0, W, 22); x.fillRect(0, H - 22, W, 22); x.fillStyle = col; x.fillRect(0, 21, W, 2); x.fillRect(0, H - 23, W, 2);
  text("★ FINAL ACT ★", 10, 16, col, 16); text(ch.name.toUpperCase(), W - 10, 16, "#fff", 16, "right"); [0, 1, 2].forEach(i => { x.fillStyle = i <= fi && t >= FR0 ? col : "#333"; x.fillRect(W / 2 - 22 + i * 16, 9, 12, 4); });
  if (t >= FR0 && t < tn) { const ln = c.lines[fi], n = Math.floor(ft / (FD * .6) * ln.length) + 1; x.font = FONT(22); x.textAlign = "center"; x.lineJoin = "round"; x.lineWidth = 5; x.strokeStyle = "#000"; const sh = ln.slice(0, n); x.strokeText(sh, W / 2, H - 34); x.fillStyle = "#fff"; x.fillText(sh, W / 2, H - 34); }
  text("bấm nút bất kỳ để bỏ qua", W / 2, H - 6, "#6b7280", 12, "center");
  if (t >= tn) { const u = clamp((t - tn) / .16, 0, 1), sc = 3.2 - 2.2 * ease(u); x.save(); x.translate(W / 2, H / 2 + 28); x.transform(1, 0, -.18, 1, 0, 0); x.scale(sc, sc); x.globalAlpha = u; const nm = c.n.toUpperCase(), size = nm.length > 15 ? 40 : 50; x.font = FONT(size); x.textAlign = "center"; x.lineJoin = "round"; x.lineWidth = 9; x.strokeStyle = "#000"; x.strokeText(nm, 0, 0); x.lineWidth = 3; x.strokeStyle = col; x.strokeText(nm, 0, 0); x.fillStyle = "#fff"; x.fillText(nm, 0, 0); x.restore(); if (u >= 1 && t < tn + .28) { x.fillStyle = `rgba(255,255,255,${(tn + .28 - t) * 2.4})`; x.fillRect(0, 0, W, H); } }
  const out = clamp((t - (c.d - .14)) / .14, 0, 1); if (out > 0) { x.fillStyle = `rgba(255,255,255,${out})`; x.fillRect(0, 0, W, H); }
  x.restore();
}
function drawCut() {
  if (G.cut.fr) return drawCutFrames(G.cut);
  const c = G.cut, t = c.t, ch = CH[c.ci], col = ch.col, left = c.i === 0, ease = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3), kin = ease(t / .28);
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
  x.fillStyle = `rgba(6,4,22,${.84 * kin})`; x.fillRect(0, 0, W, H);
  x.strokeStyle = col; x.lineWidth = 2; x.globalAlpha = .4 * kin; for (let i = 0; i < 28; i++) { const y = (i * 37) % H, len = 40 + (i * 53) % 130, xx = ((i * 97 + t * (left ? 1 : -1) * (900 + (i % 4) * 300)) % (W + 300) + W + 300) % (W + 300) - 150; x.beginPath(); x.moveTo(xx, y); x.lineTo(xx + len, y); x.stroke(); } x.globalAlpha = 1;
  // dải chéo: zoom vào gương mặt
  const by = 54, bh = 122, sk = 28, off = (1 - kin) * (left ? -W - 80 : W + 80), band = () => { x.beginPath(); x.moveTo(-12 + sk, by); x.lineTo(W + 12 + sk, by); x.lineTo(W + 12 - sk, by + bh); x.lineTo(-12 - sk, by + bh); x.closePath(); }, z = 1 + t * .1;
  x.save(); x.translate(off, 0); band(); x.fillStyle = col; x.fill(); x.save(); x.clip();
  if (c.ci < PFACE.length && ok(POST)) { const f = PFACE[c.ci], sw = 262 / z, sh = sw * bh / W, sx = clamp(c.ci * 360 + f[0] * 360 - sw / 2, c.ci * 360, c.ci * 360 + 360 - sw), sy = clamp(f[1] * 480 - sh / 2, 0, 480 - sh); x.imageSmoothingEnabled = true; x.drawImage(POST, sx, sy, sw, sh, 0, by, W, bh); x.imageSmoothingEnabled = false; }
  else if (ok(SPR)) { const sw = 76 / z, sh = sw * bh / W; x.imageSmoothingEnabled = false; x.fillStyle = "#1a0508"; x.fillRect(0, by, W, bh); if (!left) { x.translate(W, 0); x.scale(-1, 1); } x.drawImage(SPR, 96 - sw / 2, c.ci * CHH + 36 - sh / 2, sw, sh, 0, by, W, bh); }
  const g = x.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, "rgba(0,0,0,.35)"); g.addColorStop(.35, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.45)"); x.setTransform(1, 0, 0, 1, off, 0); x.fillStyle = g; x.fillRect(-20, by, W + 40, bh);
  if (Math.floor(t * 14) % 5 === 0) { x.fillStyle = "rgba(255,255,255,.12)"; x.fillRect(-20, by, W + 40, bh); }
  x.restore(); band(); x.strokeStyle = "#fff"; x.lineWidth = 3; x.stroke(); x.strokeStyle = col; x.lineWidth = 1; x.stroke(); x.restore();
  // viền phim + nhãn
  x.fillStyle = "#000"; x.fillRect(0, 0, W, 26 * kin); x.fillRect(0, H - 26 * kin, W, 26 * kin);
  if (kin > .9) { text("★ FINAL ACT ★", 10, 18, col, 17); text(ch.name.toUpperCase(), W - 10, 18, "#fff", 17, "right"); text("bấm nút bất kỳ để bỏ qua", W / 2, H - 8, "#6b7280", 12, "center"); }
  // ba dòng kể chuyện
  c.lines.forEach((ln, i) => { const ts = .35 + i * .55; if (t < ts) return; const n = Math.floor((t - ts) * 42), last = t < ts + .55 && i < 2 || i === 2 && t < 2; text(ln.slice(0, n) + (n < ln.length && Math.floor(t * 10) % 2 ? "▌" : ""), left ? 22 : W - 22, 196 + i * 17, last ? "#ffe14a" : "#cbd5e1", 17, left ? "left" : "right"); });
  // tên chiêu đập vào
  if (t >= 2) { const u = clamp((t - 2) / .16, 0, 1), sc = 3.2 - 2.2 * ease(u), jx = u >= 1 ? Math.sin(t * 90) * Math.max(0, 2.3 - t) * 8 : 0; x.save(); x.translate(W / 2 + jx, by + bh / 2 + 16); x.transform(1, 0, -.18, 1, 0, 0); x.scale(sc, sc); x.globalAlpha = u; const nm = c.n.toUpperCase(), size = nm.length > 15 ? 38 : 46; x.font = FONT(size); x.textAlign = "center"; x.lineJoin = "round"; x.lineWidth = 8; x.strokeStyle = "#000"; x.strokeText(nm, 0, 0); x.lineWidth = 3; x.strokeStyle = col; x.strokeText(nm, 0, 0); x.fillStyle = "#fff"; x.fillText(nm, 0, 0); x.restore(); if (u >= 1 && t < 2.3) { x.fillStyle = `rgba(255,255,255,${(2.3 - t) * 2})`; x.fillRect(0, 0, W, H); } }
  const out = clamp((t - (c.d - .14)) / .14, 0, 1); if (out > 0) { x.fillStyle = `rgba(255,255,255,${out})`; x.fillRect(0, 0, W, H); }
  x.restore();
}
const allyX = () => clamp((F[1] ? F[1].x : 400) + 46, 60, 462), CI = a => a.as ?? G.chars[a.from];
function doCast(i, si, local, as) {            // as: số nhân vật của đồng đội ra chiêu hộ (boss cuối), không khoá người gọi
  const p = F[i], s = (as != null ? CH[as] : chOf(i)).sp[si], T = TIER[s.t], tg = F[1 - i];
  if (local) { p.mp -= T.mp; if (G.mode === "pvp") send({ t: "c", s: si }); }
  const wait = s.t >= 3 ? .6 : .42, weak = (p.ai ? lv().sk || .55 : 1) * CUT[s.t];                 // máy ra skill yếu hơn người
  if (as == null) { p.lock = wait + .15 + REC[s.t]; p.act = "wind"; p.actT = wait; }
  if (s.t === 4) startCut(i, as ?? G.chars[i], s.n);
  G.cine = { n: (as != null ? CH[as].name.split(" ")[0] + ": " : "") + s.n, t: 0, d: wait + .25, tier: s.t, i }; beep(200, wait, "sawtooth", .05, 900); aiReact(i, 1);
  p.q.push({ t: wait, fn: () => {
    if (as == null) { p.act = s.t >= 3 ? "heavy" : "cast"; p.actT = .3; } beep(1200, .15, "square", .07, 300);
    if (s.self && as == null) s.self(p);
    if (s.mk) { const D = (s.fixed ? s.b : s.b * T.k) * weak; s.mk(p, D, T.k * weak, Math.abs(tg.x - p.x)).forEach(a => { if (s.fixed && a.on && a.on.ctrl && a.on.ctrl[2]) a.on.ctrl[2] *= weak; { const k = spawn(i, { ...a, sp: 1 }); if (as != null) { k.as = as; k.cx = allyX(); } if (SRANGE[si]) k.rng = SRANGE[si]; } }); }
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
function aiReact(i, k) { const o = F[1]; if (G.mode !== "ai" || i !== 0 || !o || o.ko || o.ctrl || o.stun > 0 || o.shield > 0 || o.lock > 0) return; if (Math.random() < lv().shield * k) { o.shield = 1.1; o.ai.wind = 0; } }
const mkCtrl = c => ({ k: c[0], t: c[1], end: c[2] || 0, lb: c[3] || "", ic: c[4] ?? null });

/* Người sở hữu mục tiêu quyết định đòn có trúng không */
function resolve(a, T) {
  const res = { id: a.id, r: "hit", dmg: 0, x: a.cond ? a.tx : T.x, h: a.p ? a.h : 70 };
  if (T.ko) return null;
  if (a.rng && !a.p && Math.abs(T.x - a.cx) > a.rng + (a.n ? 45 : 12)) { res.r = "miss"; res.far = 1; }   // skill tầm ngắn: đối thủ đứng ngoài tầm thì trượt
  else if (a.cond && Math.abs(T.x - a.tx) > 30) res.r = "miss";
  else if (T.smoke > 0 || T.nap > 0 || (T.inv > 0 && !a.sp)) res.r = "miss";
  else if (a.p && !a.low && T.crouch && !a.sp) res.r = "miss";
  else if (a.p && a.low && T.y > 24) res.r = "miss";
  else if (T.big > 0 && !a.pierce) res.r = "block";
  else if (T.parry > 0) { res.r = "ward"; res.dmg = a.pierce ? Math.max(1, Math.round(a.dmg * .3)) : 0; }   // vòng đỡ: chặn hết đòn thường, skill tối thượng chỉ còn 30%
  else if (T.shield > 0 && !a.pierce) {   // khiên: đòn thường chặn hết, skill vẫn lọt 20%; mỗi lần đỡ hao sức khiên, hết thì vỡ và choáng
    res.r = "guard"; res.dmg = a.sp ? Math.max(1, Math.round(a.dmg * .2)) : 0; T.guard -= a.sp ? 34 : 18;
    if (T.guard <= 0) { T.guard = 60; T.shield = 0; T.stun = 1.2; res.brk = 1; if (T.ai) T.ai.wind = 0; } }
  else res.dmg = Math.round(a.dmg);
  if (res.r === "miss") { if (a.p) { a.passed = 1; return null; } return res; }
  if (res.r === "hit") {
    const on = a.on || {};
    if (res.dmg > 0 && T.ai && a.basic) { const A = T.ai; A.cb = A.cbT > G.t ? A.cb + 1 : 1; A.cbT = G.t + .7; if (A.cb >= 3) { A.cb = 0; T.inv = .6; } }   // ăn 3 đòn thường liền thì máy thoát đòn, không bị khoá cứng
    if (res.dmg > 0) { if (!T.ctrl) { T.stun = T.ai ? .25 : .34; T.x = clamp(T.x - T.dir * (a.basic ? 16 : 10), 36, 448); } if (!T.ai) T.inv = .55; T.charge = 0; if (T.ai) T.ai.wind = 0; }
    if (T.ctrl && T.ctrl.k === "sleep" && res.dmg > 0) { T.ctrl = null; res.wake = 1; }   // đang ngủ mà bị đánh thì tỉnh
    if (on.stun) T.stun = on.stun; if (on.mute) T.mute = on.mute; if (on.steal) { const n = T.ai ? on.steal : Math.min(on.steal, T.mp); if (!T.ai) T.mp -= n; res.steal = n; } if (on.push) T.x = clamp(T.x - T.dir * on.push, 36, 448); if (on.paint) res.paint = on.paint;
    if (on.ctrl) { T.ctrl = mkCtrl(on.ctrl); T.shield = 0; T.y = 0; T.vy = 0; }
  }
  T.hp = Math.max(0, T.hp - res.dmg);
  if (T.hp <= 0) res.ko = 1;
  return res;
}
/* hiển thị kết quả (cả hai máy) */
function showRes(res, a) {
  const to = a ? a.to : res.to, T = F[to], X = res.x, Y = FLOOR - res.h - (T ? T.y : 0), col = a?.col || chOf(1 - to).col;
  if (res.r === "hit" || res.r === "guard") {
    if (res.dmg > 0) { const fr = a ? a.from : 1 - to, me = F[G.ME]; if (me && !me.ai) { if (fr === G.ME) me.mp = Math.min(100, me.mp + (a && a.basic ? (res.dmg >= 8 ? 9 : 6) : res.dmg * .25)); else if (to === G.ME) me.mp = Math.min(100, me.mp + res.dmg * .7); } }
    if (res.r === "guard" && !res.dmg) { pop("CHẶN!", X, Y - 24, "#7fd4ff", .7); burst(X, Y, "#7fd4ff", 8); beep(900, .06, "triangle"); }
    if (a && a.pierce && a.sp && res.dmg > 0 && !a.p) { G.stop = .16; pop("FINAL ACT!", W / 2, 96, "#fff", 1.1, 1.9); }
    if (res.brk) { pop("VỠ KHIÊN!", clamp(X, 50, W - 50), Y - 44, "#ff8a7a", 1.2, 1.3); burst(X, Y, "#9fd8ff", 26); G.shake = Math.max(G.shake, 7); beep(180, .3, "sawtooth", .09, 60); }
    if (res.dmg > 0) { pop("-" + res.dmg, X + rnd(-8, 8), Y - 20, res.r === "guard" ? "#9fd8ff" : "#ffe14a", .9); G.stop = Math.max(G.stop, .06); G.shake = Math.max(G.shake, a?.sp ? 7 : 3.5); G.flash = Math.max(G.flash, a?.sp ? .3 : .12); burst(X, Y, col, a?.sp ? 24 : 12); beep(res.r === "guard" ? 300 : 160, .1, "sawtooth", .08, 60);
      if ((a ? a.from : 1 - res.to) === G.ME) { G.hits++; G.hitT = 2.4; } }
    if (res.r === "hit" && a?.say) pop(a.say, clamp(X, 50, W - 50), Y - 42, "#fff", 1.1, 1.25);
    if (res.paint && T) T.paint = res.paint; if (res.steal) { const fr = F[a ? a.from : 1 - res.to]; if (fr && own(fr.i) && !fr.ai) fr.mp = Math.min(100, fr.mp + res.steal); pop("+" + res.steal + " MP", fr.x, FLOOR - 150, "#7fd4ff", .8); } if (res.wake) pop("GIẬT MÌNH!", X, Y - 60, "#fff", .8);
  } else if (res.r === "block") { pop("CHẶN!", X, Y - 24, "#7fd4ff", .7); burst(X, Y, "#7fd4ff", 8); beep(900, .06, "triangle"); }
  else if (res.r === "ward") { pop(res.dmg ? "ĐỠ ĐƯỢC! -" + res.dmg : "ĐỠ TRỌN!", clamp(X, 50, W - 50), Y - 24, "#ffe14a", 1, 1.2); burst(X, Y, "#ffe14a", 16); G.stop = Math.max(G.stop, .08); beep(1400, .12, "square"); if (res.dmg && (a ? a.from : 1 - res.to) === G.ME) { G.hits++; G.hitT = 2.4; } }
  else if (res.far && a) { if (!a.n) { const rx = a.cx + a.dir * a.rng; pop("HỤT TẦM", clamp(rx, 40, W - 40), FLOOR - 96, "#ddd", .9); for (let i = 0; i < 8; i++) FX.push({ k: "spark", t: 0, d: .35, x: rx + rnd(-10, 10), y: FLOOR - rnd(4, 60), vx: rnd(-50, 50), vy: rnd(10, 70), c: "#aaa" }); beep(160, .12, "triangle", .04); } }
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
  ["stun", "inv", "shield", "parry", "big", "smoke", "lock", "actT", "fly", "paint", "giant", "nap", "mute"].forEach(k => { if (p[k] > 0) p[k] = Math.max(0, p[k] - dt); });
  if (p.smoke <= 0 && own(p.i)) p.ride = null;
  for (let j = p.q.length - 1; j >= 0; j--) { p.q[j].t -= dt; if (p.q[j].t <= 0) { const e = p.q.splice(j, 1)[0]; if (!p.ko) e.fn(); } }
  if (p.charge > 0) { p.charge -= dt; p.mp = Math.min(100, p.mp + 15 * dt); if (Math.random() < .5) FX.push({ k: "mote", t: 0, d: .4, x: p.x + rnd(-30, 30), y: FLOOR - rnd(10, 110), tx: p.x + p.dir * 40, ty: FLOOR - HIGH, c: "#7fd4ff" }); }
  if (!p.ai) { p.mp = Math.min(100, p.mp + (G.sub === "test" ? 45 : 0) * dt);   // thanh nộ không tự hồi: chỉ tăng khi đánh trúng, bị đánh hoặc đứng nạp (Q)
    // mana đầy quá 3 giây mà không dùng thì tuột về 40
    if (p.mp >= 100 && G.sub !== "test") { p.fullT = (p.fullT || 0) + dt; if (p.fullT >= FULL_HOLD && own(p.i) && G.phase === "fight") { p.mp = FULL_DROP; p.fullT = 0; pop("TUỘT NỘ!", p.x, FLOOR - 150, "#7fd4ff", 1, 1.2); beep(500, .25, "sawtooth", .05, 120); } } else p.fullT = 0; }
  if (p.ctrl) { p.ctrl.t -= dt; if (p.ctrl.t <= 0) { const e = p.ctrl.end; p.ctrl = null; if (e && own(p.i) && !p.ko) { p.hp = Math.max(0, p.hp - Math.round(e)); const res = { id: "c", to: p.i, r: "hit", dmg: Math.round(e), x: p.x, h: 60, ko: p.hp <= 0 ? 1 : 0 }; showRes(res, null); if (G.mode === "pvp") send({ t: "res", res }); } p.stun = .3; } }
  if (p.shield <= 0) p.guard = Math.min(100, p.guard + 14 * dt);
  p.vy -= 900 * dt; p.y += p.vy * dt; if (p.y <= 0) { p.y = 0; p.vy = 0; p.hj = 0; }
}
function stepLocal(p, dt) {
  const o = F[1 - p.i]; p.moving = false; p.crouch = false;
  if (G.phase !== "fight" || p.stun > 0 || p.ctrl || p.ko || p.charge > 0 || p.lock > 0 || p.fly > 0 || p.nap > 0) return;
  if (KEY.d && p.y === 0) { p.crouch = true; return; }
  const mv = (KEY.r ? 1 : 0) - (KEY.l ? 1 : 0);
  if (mv) { p.x += mv * 125 * dt; p.moving = true; p.walk += dt; }
  p.x = p.i === 0 ? clamp(p.x, 36, o.x - GAP) : clamp(p.x, o.x + GAP, 444);
  if ((KEY.u || p.jq > G.t) && p.y === 0) { p.jq = 0; p.vy = 340; beep(500, .08, "square", .04, 800); }
}
function stepAI(p, dt) {
  const o = lv(), a = p.ai, pl = F[0], c = chOf(1); p.moving = false; p.crouch = false;
  if (p.ko || G.phase !== "fight" || p.ctrl || p.stun > 0) { a.wind = 0; a.duck = 0; return; }
  if (o.boss) {
    if (!a.rage && p.hp < p.max / 2) { a.rage = 1; G.flash = .7; G.shake = 12; pop("DEADLINE DÍ SÁT NÚT!", W / 2, 110, "#ff5a5a", 1.6, 1.6); beep(90, .7, "sawtooth", .1, 40); }   // dưới nửa máu: đánh nhanh hơn, gọi đồng đội dày hơn
    const al = G.ally; if (al) { al.act -= dt; al.t -= dt * (a.rage ? 1.6 : 1); if (al.t <= 0 && !pl.ko) { al.t = rnd(6, 9); al.act = 1.3; const ok2 = CH[al.ci].sp.map((s, i) => i).filter(i => CH[al.ci].sp[i].mk && TOF[i] <= 3 && (!SRANGE[i] || allyX() - pl.x <= SRANGE[i])); if (ok2.length) doCast(1, ok2[Math.floor(Math.random() * ok2.length)], false, al.ci); } }
  }
  if (p.lock > 0 || p.fly > 0 || p.nap > 0) return;
  // Tournament: nhìn đòn đang bay tới để né (cúi tránh đòn cao, nhảy qua đòn sát sàn) và mở vòng đỡ đúng lúc trước skill Tối thượng
  if (o.dodge) for (const k of ATK) {
    if (k.to !== 1 || k.age < (k.wait || 0) - .3) continue;
    if (k.pierce) { if (k.aiW === undefined) k.aiW = Math.random() < (o.ward || 0); if (k.aiW && p.parry <= 0 && (k.p ? Math.abs(k.x - p.x) < 60 : k.wait - k.age < .28)) p.parry = WARD; continue; }
    if (!k.p || k.sp || k.aiS || Math.abs(k.x - p.x) > 46 + o.dodge * 40) continue;
    k.aiS = 1; if (Math.random() < o.dodge && a.fire <= 0) { a.wind = 0; if (k.low) { if (p.y === 0) p.vy = 340; } else { a.duck = .26; a.counter = 1; } }
  }
  if (a.duck > 0) { a.duck -= dt; if (p.y === 0) { p.crouch = true; return; } }
  else if (a.counter) { a.counter = 0; if (p.x - pl.x <= 84) { a.want = 0; a.type = o.types.includes("lo") ? "lo" : "hi"; a.wind = o.wind * .5; } }   // né xong thì phản đòn ngay khi đối thủ còn trong tầm
  if (a.fire > 0) { a.fire -= dt; return; }
  if (a.wind > 0) { a.wind -= dt; p.act = "wind"; p.actT = .1; if (a.wind <= 0) { a.fire = .32; p.act = "cast"; p.actT = .32; beep(240, .15, "sawtooth", .06, 120);
      // đánh dồn: bắn xong có thể bồi ngay 1–2 phát nữa
      if (a.chain > 0) { a.chain--; if (!a.chain && o.boss) a.fin = 1; } else a.chain = Math.random() < (o.burst || 0) ? 1 + (Math.random() < o.burst ? 1 : 0) : 0;
      a.rest = a.chain > 0 ? .12 : rnd(...o.rest);
      if (a.type === "th") spawn(1, { wait: .8, dmg: o.dmg, cond: 1, tx: pl.x, fx: "drop", ic: c.th.ic, sc: .9, quick: 1, col: c.col });
      else if (a.type === "lo") spawn(1, { p: 1, v: o.bolt * .85, dmg: o.dmg, col: c.col, ic: c.G.ic, sc: .55, wob: 1, low: 1, h: 16, range: 66 });
      else spawn(1, { p: 1, v: o.bolt, dmg: o.dmg, col: c.col, ic: c.F.ic, sc: .45, range: 66 }); } return; }
  if (p.shield > 0) return;
  // di chuyển: đòn thường là cận chiến nên muốn đánh phải áp sát; máy Tournament còn lượn vào lượn ra và nhảy
  const REACH = 80, gap = p.x - pl.x;
  if (o.roam) { a.mvT = (a.mvT || 0) - dt; if (a.mvT <= 0) { a.mvT = rnd(.5, 1.4); a.goal = Math.random() < .3 + .4 * o.roam ? rnd(54, 96) : rnd(96, 200); if (p.y === 0 && Math.random() < .22 * o.roam) p.vy = 340; } }
  a.rest -= dt * (o.punish && (pl.stun > 0 || pl.ctrl || pl.charge > 0 || pl.lock > .3) ? 2.5 : 1) * (a.rage ? 1.5 : 1);     // thấy người chơi choáng, đang nạp hoặc đang hở sau chiêu thì ra đòn sớm hơn
  if (a.rest <= 0 && !a.want) {
    if (p.mute <= 0 && !a.chain && (a.fin || Math.random() < o.cast)) { a.fin = 0; /* boss luôn kết chuỗi đòn thường bằng một skill */ const okSp = c.sp.map((s, i) => i).filter(i => TOF[i] <= o.maxT && (TOF[i] < 4 || Math.random() < .35) && (!SRANGE[i] || !c.sp[i].mk || gap <= SRANGE[i])); if (!okSp.length) { a.rest = .4; return; } a.rest = rnd(...o.rest) + 1.2; return doCast(1, okSp[Math.floor(Math.random() * okSp.length)], false); }
    a.type = a.chain > 0 && a.type === "hi" && o.types.includes("lo") ? "lo" : a.chain > 0 && a.type === "lo" ? "hi" : o.types[Math.floor(Math.random() * o.types.length)]; a.want = 1; a.chase = 0;
  }
  if (a.want && (a.type === "th" || gap <= REACH)) { a.want = 0; a.wind = o.wind * (a.chain > 0 ? .6 : 1); return; }
  if (a.want) { a.chase += dt; if (a.chase > 2.2 && o.types.includes("th")) a.type = "th"; }       // đuổi mãi không tới thì thả đồ từ trần
  const want = pl.x + (a.want ? REACH - 14 : o.roam ? a.goal || o.dist : Math.min(o.dist, 150)), dx = want - p.x, sp = o.spd * (a.want ? 1.7 : 1);
  if (Math.abs(dx) > 6 && o.spd) { p.x += Math.sign(dx) * Math.min(Math.abs(dx), sp * dt); p.moving = true; p.walk += dt; }
  p.x = clamp(p.x, pl.x + GAP, 448);
}
function stepAttacks(dt) {
  for (let j = ATK.length - 1; j >= 0; j--) {
    const a = ATK[j]; if (!a) continue; const T = F[a.to]; a.age += dt;   // KO giữa vòng lặp sẽ xoá sạch danh sách đòn
    if (a.age < a.wait) continue;
    if (a.p) {
      a.x += a.v * dt; const fl = a.age - a.wait;
      if (a.hom) a.h += (HIGH - 20 + T.y - a.h) * Math.min(1, dt * 3) + Math.sin(fl * 14 + a.h0) * 30 * dt;
      if (Math.random() < .6) FX.push({ k: "spark", t: 0, d: .25, x: a.x, y: FLOOR - a.h, vx: rnd(-20, 20), vy: rnd(-20, 20), c: a.col });
      if (!a.passed && Math.abs(a.x - T.x) < 22 && own(a.to)) { const res = resolve(a, T); if (res) { showRes(res, a); if (G.mode === "pvp") send({ t: "res", res, aid: a.id }); ATK.splice(j, 1); continue; } }
      if (a.x < -40 || a.x > W + 40 || (a.range && Math.abs(a.x - a.cx) > a.range + 46)) ATK.splice(j, 1);
      else if (a.rng && Math.abs(a.x - a.cx) > a.rng) { pop("HỤT TẦM", a.x, FLOOR - a.h - 14, "#bbb", .6); burst(a.x, FLOOR - a.h, "#888", 5); ATK.splice(j, 1); }   // đòn thường chỉ với tới tầm ngắn
    } else if (!a.done) {
      a.done = 1; a.hitAt = a.age; a.hx = a.cond ? a.tx : a.rng ? a.cx + clamp(T.x - a.cx, -a.rng, a.rng) : T.x;
      if (own(a.to)) { const res = resolve(a, T); if (res) { showRes(res, a); if (G.mode === "pvp") send({ t: "res", res, aid: a.id }); } }
      if (a.fx === "world" || a.fx === "rain" || a.fx === "nobg" || a.fx === "orbit" || a.fx === "rise" || a.fx === "tornado" || a.fx === "aura" || a.fx === "zoom" || a.fx === "call" || a.fx === "butt" || a.fx === "perf" || a.fx === "prompt" || a.fx === "wedding" || a.fx === "cry" || a.fx === "shame" || a.fx === "runway" || a.fx === "goat" || a.fx === "glare" || a.fx === "paint" || a.fx === "filter" || a.fx === "goddess" || a.fx === "bus" || a.fx === "guides" || a.fx === "shave" || a.fx === "parade" || a.fx === "bkk" || a.fx === "fans" || a.fx === "inhale" || a.fx === "blizzard" || a.fx === "swan" || a.fx === "nine" || a.fx === "timeup" || a.fx === "sketch" || a.fx === "mob" || (a.fx === "drop" && a.sc > 1.2)) { G.flash = Math.max(G.flash, .5); G.shake = Math.max(G.shake, 9); beep(70, .35, "sawtooth", .1, 35); }
    } else if (a.age - a.hitAt > .6) ATK.splice(j, 1);
  }
}
function update(dt) {
  if (G.cut) return stepCut(dt);                          // đang chiếu Final Act: cả trận đứng hình
  G.t += dt;
  if (G.cine) { G.cine.t += dt; if (G.cine.t > G.cine.d) G.cine = null; }
  if (G.hitT > 0) { G.hitT -= dt; if (G.hitT <= 0) G.hits = 0; }
  F.forEach(p => { stepFighter(p, dt); if (p.ai) stepAI(p, dt); else if (p.i === G.ME) stepLocal(p, dt); });
  F.forEach(p => { if (!own(p.i)) return; if (p.fly > 0) { const k = 1 - p.fly / .9, o = F[1 - p.i]; p.flyX = p.x + (o.x + p.dir * 50 - p.x) * Math.sin(k * Math.PI); } else p.flyX = null; });
  stepAttacks(dt);
  F.forEach(p => { p.lag += ((p.hp / p.max) - p.lag) * Math.min(1, dt * 2.5); if (p.lag < p.hp / p.max) p.lag = p.hp / p.max; });
  if (G.phase === "ko") { G.ko -= dt; if (G.ko <= 0 && G.sub === "tour") return tourNext(); if (G.ko <= 0 && (G.mode === "ai" || net.host)) { G.round++; if (G.mode === "pvp") send({ t: "round", n: G.round, sc: G.score }); newRound(); } }
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
  if (p.nap > 0) return 8;
  if (p.ctrl) return p.ctrl.k === "swoon" ? 11 : p.ctrl.k === "art" || p.ctrl.k === "bald" || p.ctrl.k === "salute" ? 0 : p.ctrl.k === "dalat" ? 8 : p.ctrl.k === "film" || p.ctrl.k === "bow" ? 8 : p.ctrl.k === "sleep" ? 8 : p.ctrl.k === "shrimp" || p.ctrl.k === "meet" ? 8 : 10;
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
  if (CH[ci] && CH[ci].boss && o.s == null) o = { ...o, s: 1.2 };   // boss vẽ to hơn 20%
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
  if (p.nap > 0 || (c && c.k === "sleep")) {   // ngồi ghế văn phòng, đeo gối cổ, ngủ
    const d = p.dir, sw = Math.sin(t * 2) * 1.5; x.fillStyle = "#111"; x.fillRect(px - 2, FLOOR - 24, 4, 20); for (let i = -2; i <= 2; i++) { x.fillRect(px + i * 9 - 1, FLOOR - 6, 3, 4); x.beginPath(); x.arc(px + i * 9, FLOOR - 1, 2, 0, 6.283); x.fill(); } x.fillRect(px - 20, FLOOR - 5, 40, 2);
    x.fillStyle = "#1f2937"; x.fillRect(px - 20, FLOOR - 30, 40, 7); x.fillStyle = "#374151"; x.fillRect(px - d * 22 - 4, FLOOR - 84, 8, 56); x.fillStyle = "#4b5563"; x.fillRect(px - d * 22 - 3, FLOOR - 82, 6, 30);
    spr(ci, 8, px, bot - 26 + sw, flip, { tint, rot: -d * .12 });
    x.fillStyle = "#000"; x.fillRect(px - 15 + d * 2, FLOOR - 79 + sw, 28, 11); x.fillStyle = CH[ci].col; x.fillRect(px - 14 + d * 2, FLOOR - 78 + sw, 26, 9); x.fillStyle = "rgba(255,255,255,.35)"; x.fillRect(px - 12 + d * 2, FLOOR - 77 + sw, 22, 2); x.fillStyle = "#000"; x.fillRect(px - 4 + d * 8, FLOOR - 78 + sw, 6, 4);
    ["z", "Z", "Z"].forEach((s, i) => text(s, px + d * (14 + i * 9), FLOOR - 100 - i * 13 - ((t * 14) % 10), "#fff", 12 + i * 4, "center"));
    if (p.nap > 0) { x.save(); x.globalCompositeOperation = "lighter"; x.strokeStyle = "rgba(191,219,254,.6)"; x.lineWidth = 2; x.beginPath(); x.ellipse(px, FLOOR - 52, 40, 58, 0, 0, 6.283); x.stroke(); x.restore(); } }
  else if (p.giant > 0 && !c) { const s = 1 + .85 * clamp((2 - p.giant) / .35, 0, 1) * clamp(p.giant / .3, 0, 1), cy = FLOOR - 70 * s; x.save(); x.globalCompositeOperation = "lighter"; for (let i = 0; i < 14; i++) { const an = i / 14 * 6.283 + t * 1.5; x.fillStyle = i % 2 ? "rgba(255,216,74,.5)" : "rgba(255,255,255,.35)"; x.beginPath(); x.moveTo(px, cy); x.arc(px, cy, 70 * s, an, an + .2); x.fill(); } x.restore();
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
  else if (c.k === "awk") { spr(ci, f, px, bot, flip, { tint }); text("…", px, FLOOR - 138, "#fff", 30, "center"); prop(IC.crow, (t * 130) % (W + 80) - 40, 70 + Math.sin(t * 6) * 5, .6); prop(IC.cricket, px + 34, FLOOR - 8 - Math.abs(Math.sin(t * 9)) * 6, .35); }
  else if (c.k === "art") { const fy = 34, fw = 96, fh = 128, fx0 = clamp(px, 70, W - 70) - fw / 2; x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = "rgba(255,244,200,.22)"; x.beginPath(); x.moveTo(fx0 + fw / 2 - 6, 0); x.lineTo(fx0 + fw / 2 + 6, 0); x.lineTo(fx0 + fw + 20, fy + fh); x.lineTo(fx0 - 20, fy + fh); x.fill(); x.restore();
    x.fillStyle = "#3b2a12"; x.fillRect(fx0 - 7, fy - 7, fw + 14, fh + 14); x.fillStyle = "#d4a017"; x.fillRect(fx0 - 5, fy - 5, fw + 10, fh + 10); x.fillStyle = "#f6d55c"; x.fillRect(fx0 - 3, fy - 3, fw + 6, fh + 6); x.fillStyle = "#ece6d8"; x.fillRect(fx0, fy, fw, fh);
    x.save(); x.beginPath(); x.rect(fx0, fy, fw, fh); x.clip(); spr(ci, f, fx0 + fw / 2, fy + fh + 14 + Math.sin(t * 3), flip, { tint }); x.restore();
    x.fillStyle = "#fff"; x.fillRect(fx0 + fw / 2 - 34, fy + fh + 10, 68, 12); x.fillStyle = "#000"; x.font = FONT(11); x.textAlign = "center"; x.fillText("“ĐỐI THỦ”, 2026", fx0 + fw / 2, fy + fh + 19); prop(IC.rope, fx0 + fw / 2, FLOOR - 16, 1.3); }
  else if (c.k === "cling") { const jx = Math.sin(t * 45) * 2, o = 1 - p.i; spr(ci, f, px + jx, bot, flip, { tint: `rgba(255,120,160,${.2 + .15 * Math.sin(t * 6)})` }); spr(G.chars[o], 6, px + p.dir * 44 - jx, bot, o === 1, {}); prop(IC.goat, px - p.dir * 34, FLOOR - 26 - Math.abs(Math.sin(t * 9)) * 10, .95, p.dir > 0); for (let i = 0; i < 3; i++) prop(IC.heart, px - 16 + i * 16, FLOOR - 126 - ((t * 24 + i * 9) % 22), .25); }
  else if (c.k === "film") { spr(ci, f, px, bot, flip, { tint }); prop(IC.tripod, px + p.dir * 24, FLOOR - 62 + Math.sin(t * 7) * 2, .7, p.dir < 0); if (Math.floor(t * 3) % 2) { x.fillStyle = "#ef4444"; x.beginPath(); x.arc(px + p.dir * 24 - 16, FLOOR - 104, 3, 0, 6.283); x.fill(); text("REC", px + p.dir * 24 - 10, FLOOR - 100, "#fff", 12); } text("lần " + (3 - Math.floor(c.t)) + "…", px - p.dir * 26, FLOOR - 86, "#fda4af", 13, "center"); }
  else if (c.k === "bow") { spr(ci, f, px, bot, flip, { rot: p.dir * (.35 + .3 * Math.sin(t * 9)), tint }); for (let i = 0; i < 3; i++) prop(IC.petals, px - 24 + i * 24, FLOOR - 120 + ((t * 30 + i * 17) % 60), .3, false, .8); }
  else if (c.k === "melt") { const m = clamp(c.t / 2.2, .22, 1), cols = ["#f43f5e", "#facc15", "#22d3ee", "#a78bfa", "#4ade80"]; prop(IC.puddle, px, FLOOR - 4, .6 + (1 - m) * 1.1); spr(ci, f, px, bot, flip, { sy: m, tint: `rgba(244,63,94,${(1 - m) * .5})` }); for (let i = 0; i < 7; i++) { x.fillStyle = cols[i % 5]; const dx = -24 + i * 8, dy = ((t * 50 + i * 23) % (118 * m)); x.fillRect(px + dx, FLOOR - 118 * m + dy, 3, 7); } }
  else if (c.k === "lowbat") { spr(ci, f, px, bot, flip, { gray: 1 }); const bl = Math.floor(t * 4) % 2; x.fillStyle = "#000"; x.fillRect(px - 19, FLOOR - 160, 38, 18); x.fillRect(px + 19, FLOOR - 155, 3, 8); x.fillStyle = "#111827"; x.fillRect(px - 17, FLOOR - 158, 34, 14); if (bl) { x.fillStyle = "#ef4444"; x.fillRect(px - 15, FLOOR - 156, 4, 10); } text("10%", px + 4, FLOOR - 147, "#ef4444", 12, "center"); }
  else if (c.k === "seen") {   // gửi tin nhắn, bên kia "đã xem" mà không trả lời
    spr(ci, f, px, bot, flip, { tint }); const bx = clamp(px, 62, W - 62), by = FLOOR - 172, ph = Math.min(2, Math.floor(((c.T0 = c.T0 || c.t) - c.t) / .5));
    x.fillStyle = "#000"; x.fillRect(bx - 59, by - 1, 118, 40); x.fillStyle = "#e5f0ff"; x.fillRect(bx - 58, by, 116, 38); x.fillStyle = "#2563eb"; x.fillRect(bx - 46, by + 3, 100, 13); x.font = FONT(11); x.textAlign = "right"; x.fillStyle = "#fff"; x.fillText("Anh duyệt chưa ạ?", bx + 52, by + 13);
    if (ph >= 1) { x.fillStyle = "#64748b"; x.fillText("Đã xem ✓✓", bx + 52, by + 26); } if (ph >= 2) { x.textAlign = "left"; x.fillStyle = "#94a3b8"; x.fillText("…".repeat(1 + Math.floor(t * 3) % 3), bx - 52, by + 34); }
    text("…", px, FLOOR - 132, "#fff", 26, "center"); prop(IC.crow, (t * 130) % (W + 80) - 40, 78 + Math.sin(t * 6) * 5, .6); }
  else if (c.k === "vine") {   // rau răm mọc lên quấn quanh người
    spr(ci, f, px + Math.sin(t * 30) * 1.5, bot, flip, { tint: "rgba(90,200,90,.3)" }); const g = clamp(((c.T0 = c.T0 || c.t) - c.t) / .4, 0, 1); x.lineWidth = 3;
    for (let s = -1; s <= 1; s += 2) { x.strokeStyle = s < 0 ? "#15803d" : "#22c55e"; x.beginPath(); for (let i = 0; i <= 24 * g; i++) { const y = FLOOR - i * 5, X = px + Math.sin(i * .55 + t * 2) * 24 * s; if (i) x.lineTo(X, y); else x.moveTo(X, y); } x.stroke(); }
    for (let i = 0; i < 5; i++) if (i / 5 < g) prop(IC.rauram, px + Math.sin(i * 2.75 + t * 2) * 26 * (i % 2 ? 1 : -1), FLOOR - 14 - i * 24, .38, i % 2 > 0, 1, Math.sin(t * 3 + i) * .3); text("RAU RĂM QUẤN!", clamp(px, 60, W - 60), FLOOR - 146, "#86efac", 14, "center"); }
  else if (c.k === "upside") {   // bị lộn ngược lơ lửng, mây xui đổ lên đầu
    c.T0 = c.T0 || c.t; const g = clamp((c.T0 - c.t) / .3, 0, 1); spr(ci, 10, px + Math.sin(t * 4) * 5, bot - 34 * g + Math.sin(t * 5) * 3, flip, { vf: 1, rot: Math.sin(t * 3) * .25, tint: "rgba(120,60,160,.3)" });
    for (let i = 0; i < 3; i++) prop(IC.xui, px - 26 + i * 26 + Math.sin(t * 2 + i) * 5, FLOOR - 16 - ((t * 22 + i * 11) % 26), .34, false, .9); text("XUI LỘN NGƯỢC!", clamp(px, 62, W - 62), FLOOR - 150, "#d8b4fe", 14, "center"); }
  else if (c.k === "coil") {   // ống đồng quấn quanh người, hơi lạnh bốc lên
    spr(ci, f, px + Math.sin(t * 30) * 1.5, bot, flip, { tint: "rgba(120,190,255,.4)" }); x.lineWidth = 4; for (let i = 0; i < 6; i++) { const y = FLOOR - 16 - i * 17, w = 26 + Math.sin(t * 6 + i) * 3; x.strokeStyle = "#7a3b12"; x.beginPath(); x.ellipse(px, y, w, 6, 0, 0, Math.PI); x.stroke(); x.strokeStyle = i % 2 ? "#e89b4c" : "#c9722a"; x.lineWidth = 2.5; x.beginPath(); x.ellipse(px, y - .5, w, 6, 0, .1, Math.PI - .1); x.stroke(); x.lineWidth = 4; }
    for (let i = 0; i < 4; i++) prop(IC.snow, px - 30 + i * 20 + Math.sin(t * 3 + i) * 4, FLOOR - 124 - ((t * 26 + i * 12) % 30), .25, false, .8, t * 2 + i); text("LẠNH BUỐT…", clamp(px, 60, W - 60), FLOOR - 146, "#bae6fd", 14, "center"); }
  else if (c.k === "ice") {    // đóng băng thành khối đá
    c.T0 = c.T0 || c.t; const kk = clamp((c.T0 - c.t) / .25, 0, 1), crack = c.t < .5; spr(ci, 10, px, bot, flip, { gray: 1, tint: "rgba(90,170,255,.55)" }); x.save(); x.globalAlpha = .62 * kk; x.fillStyle = "#9bd3ff"; x.fillRect(px - 34, FLOOR - 134 * kk, 68, 134 * kk); x.globalAlpha = .9 * kk; x.strokeStyle = "#e0f2fe"; x.lineWidth = 2; x.strokeRect(px - 34, FLOOR - 134 * kk, 68, 134 * kk); x.fillStyle = "rgba(255,255,255,.55)"; x.fillRect(px - 28, FLOOR - 128 * kk, 6, 60 * kk); x.fillRect(px - 18, FLOOR - 128 * kk, 3, 34 * kk);
    if (crack) { x.strokeStyle = "#fff"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px - 10, FLOOR - 130); x.lineTo(px + 4, FLOOR - 92); x.lineTo(px - 8, FLOOR - 60); x.lineTo(px + 10, FLOOR - 20); x.stroke(); } x.restore();
    prop(IC.thermo, px + 46 * (p.dir > 0 ? -1 : 1), FLOOR - 104, .5); text("−18°C", clamp(px, 50, W - 50), FLOOR - 144, "#e0f2fe", 16, "center"); for (let i = 0; i < 5; i++) prop(IC.snow, px - 40 + i * 20, FLOOR - 150 + ((t * 40 + i * 23) % 150), .22, false, .7, t + i); }
  else if (c.k === "sand") {   // đồng hồ cát: cát dâng lấp người, đầy thì giam 1 giây rồi nổ
    c.T0 = c.T0 || c.t; const fill = clamp((c.T0 - c.t) / 1.2, 0, 1), h = 126 * fill, full = fill >= 1, jx = full ? Math.sin(t * 50) * 2 : 0;
    spr(ci, f, px + jx, bot, flip, { tint: full ? "rgba(217,160,60,.55)" : tint }); x.fillStyle = "rgba(230,180,80,.78)"; x.fillRect(px - 30, FLOOR - h, 60, h); x.fillStyle = "rgba(255,225,150,.9)"; x.fillRect(px - 30, FLOOR - h, 60, 3); x.strokeStyle = "#000"; x.lineWidth = 2; x.strokeRect(px - 31, FLOOR - 128, 62, 128);
    if (!full) { x.fillStyle = "#f6d27a"; for (let i = 0; i < 6; i++) x.fillRect(px - 3 + Math.sin(i * 3 + t * 9) * 3, FLOOR - 128 + ((t * 160 + i * 21) % Math.max(4, 128 - h)), 2, 5); }
    const gx = px, gy = FLOOR - 150; x.save(); x.translate(gx, gy); x.rotate(full ? Math.sin(t * 40) * .15 : 0); x.fillStyle = "#000"; x.fillRect(-11, -15, 22, 4); x.fillRect(-11, 11, 22, 4); x.fillStyle = "#e5e7eb"; x.beginPath(); x.moveTo(-9, -11); x.lineTo(9, -11); x.lineTo(1, 0); x.lineTo(9, 11); x.lineTo(-9, 11); x.lineTo(-1, 0); x.fill(); x.fillStyle = "#e6b450"; x.beginPath(); x.moveTo(-7 * (1 - fill), -11 + 10 * fill); x.lineTo(7 * (1 - fill), -11 + 10 * fill); x.lineTo(0, 0); x.fill(); x.beginPath(); x.moveTo(-8 * fill, 11); x.lineTo(8 * fill, 11); x.lineTo(0, 11 - 10 * fill); x.fill(); x.restore();
    text(full ? "TRỄ " + Math.max(0, c.t).toFixed(1) + "s" : "DELAY TIMELINE", clamp(px, 70, W - 70), gy - 22, full ? "#ff8a7a" : "#fde68a", 14, "center"); }
  else if (c.k === "chew") {   // cái đầu khổng lồ lơ lửng trên cao, nhai và thả chữ NHĂM rơi xuống đầu đối thủ (không áp sát người)
    const o = 1 - p.i, oc = G.chars[o], S = 96 + Math.sin(t * 22) * 6, hx = clamp(px - p.dir * 8, 60, W - 60), hy = 96, jx = Math.sin(t * 40) * 2; spr(ci, f, px + jx, bot, flip, { tint });
    if (ok(SPR)) { x.save(); x.translate(hx, hy + Math.sin(t * 22) * 3); x.scale(o === 1 ? -1 : 1, 1); x.rotate(.5 + Math.sin(t * 22) * .1); x.drawImage(SPR, 68, oc * CHH + 12, 56, 56, -S / 2, -S / 2, S, S); x.restore(); }
    for (let i = 0; i < 5; i++) { const u = (t * 1.5 + i / 5) % 1, wy = hy + 34 + u * (FLOOR - 128 - hy - 34), wx = px + Math.sin(i * 2.4 + u * 5) * 20; x.globalAlpha = u < .12 ? u / .12 : 1 - Math.max(0, u - .8) * 5; text(i % 2 ? "nhăm" : "NHĂM", wx, wy, i % 2 ? "#fff" : "#ffe14a", i % 2 ? 13 : 17, "center"); x.globalAlpha = 1; }
    for (let i = 0; i < 3; i++) text("✸", px - 18 + i * 18, FLOOR - 124 + Math.abs(Math.sin(t * 20 + i)) * 5, "#ffe14a", 12, "center"); }
  else if (c.k === "dalat") { x.fillStyle = "rgba(200,215,225,.82)"; x.fillRect(-10, -10, W + 20, H + 20); x.fillStyle = "#6b7280"; x.fillRect(0, FLOOR - 6, W, 40); x.fillStyle = "#fde68a"; for (let i = 0; i < 8; i++) x.fillRect(i * 64 + 10, FLOOR + 6, 30, 3); for (let i = 0; i < 7; i++) prop(IC.pine, 30 + i * 72, FLOOR - 52 - (i % 2) * 8, 1.3 + (i % 3) * .2); for (let i = 0; i < 4; i++) prop(IC.fog, ((i * 140 + t * 18) % (W + 120)) - 60, 70 + i * 36, 1.6, false, .7); prop(IC.sign, clamp(px + p.dir * 60, 40, W - 40), FLOOR - 40, 1.2); prop(IC.bus, clamp(px - p.dir * (90 + (2.6 - c.t) * 90), -80, W + 80), FLOOR - 32, 1.5, p.dir > 0); prop(IC.berry, px - 30, FLOOR - 8, .35); spr(ci, f, px + Math.sin(t * 30) * 1.5, bot, flip, { tint: "rgba(120,160,255,.25)" }); text("lạnh quá…", px, FLOOR - 92, "#fff", 13, "center"); }
  else if (c.k === "bald") { spr(ci, f, px, bot, flip, { tint }); const hx = px + p.dir * 3, hy = FLOOR - 119; x.fillStyle = "#000"; x.beginPath(); x.ellipse(hx, hy, 14, 12, 0, Math.PI, 0); x.fill(); x.fillStyle = "#f1c9a5"; x.beginPath(); x.ellipse(hx, hy, 12.5, 10.5, 0, Math.PI, 0); x.fill(); x.fillStyle = "#fff"; x.fillRect(hx - 6, hy - 8, 5, 2); if (Math.floor(t * 6) % 3 === 0) prop(IC.spark, hx + 8, hy - 12, .3); for (let i = 0; i < 5; i++) prop(IC.hair, px - 30 + i * 15, FLOOR - 100 + ((t * 40 + i * 21) % 96), .3, false, .9, t * 3 + i); }
  else if (c.k === "salute") { const pr = .86 + .05 * Math.sin(t * 9); spr(ci, f, px, bot, flip, { sy: pr, tint }); x.save(); x.globalCompositeOperation = "lighter"; for (let i = 0; i < 4; i++) { const yy = FLOOR - 150 + ((t * 70 + i * 34) % 120); x.strokeStyle = `rgba(250,204,21,${.7 - ((t * 70 + i * 34) % 120) / 200})`; x.lineWidth = 2; x.beginPath(); x.moveTo(px - 26, yy); x.lineTo(px, yy + 8); x.lineTo(px + 26, yy); x.stroke(); } x.restore(); prop(IC.gstar, px, FLOOR - 160 + Math.sin(t * 5) * 2, .4); }
  else if (c.k === "beanie") { const jx = Math.sin(t * 34) * 2; spr(ci, f, px + jx, bot, flip, { tint: "rgba(255,90,60,.25)" }); prop(IC.beanie, px + jx, FLOOR - 92, 1.75); x.strokeStyle = "#dc2626"; x.lineWidth = 2; for (let i = 0; i < 4; i++) { const yy = FLOOR - 56 + i * 14; x.beginPath(); x.ellipse(px, yy, 24 + Math.sin(t * 8 + i) * 3, 5, 0, t * 6 + i, t * 6 + i + 4.6); x.stroke(); } prop(IC.yarn, px - p.dir * 34, FLOOR - 12, .5, false, 1, t * 5); for (let i = 0; i < 3; i++) text("~", px - 12 + i * 12, FLOOR - 150 - ((t * 22 + i * 7) % 16), "#fca5a5", 14, "center"); }
  else if (c.k === "net") { const jx = Math.sin(t * 30) * 2; spr(ci, f, px + jx, bot, flip, { tint }); prop(IC.net, px, FLOOR - 62, 1.9, false, .95); x.strokeStyle = "rgba(255,255,255,.55)"; x.lineWidth = 1; for (let i = -3; i <= 3; i++) { x.beginPath(); x.moveTo(px + i * 12, FLOOR - 124); x.lineTo(px + i * 16, FLOOR); x.stroke(); } prop(IC.fish, px + 30, FLOOR - 14 - Math.abs(Math.sin(t * 12)) * 12, .5, false, 1, Math.sin(t * 12)); prop(IC.fish, px - 34, FLOOR - 10 - Math.abs(Math.cos(t * 10)) * 10, .4, true, 1, Math.cos(t * 10)); }
  else if (c.k === "minty") { const jx = Math.sin(t * 50) * 2.5; spr(ci, f, px + jx, bot, flip, { tint: "rgba(110,231,183,.5)" }); prop(IC.inhaler, px + p.dir * 16, FLOOR - 104 + Math.sin(t * 20) * 2, .9, false, 1, p.dir * -.9); for (let i = 0; i < 5; i++) prop(IC.vapor, px + Math.cos(t * 3 + i * 1.3) * 26, FLOOR - 120 - ((t * 30 + i * 14) % 50), .5 + .1 * i, false, .7); for (let i = 0; i < 4; i++) text("❄", px - 26 + i * 17, FLOOR - 60 + Math.sin(t * 9 + i) * 20, "#d1fae5", 12, "center"); }
  else if (c.k === "duck") { prop(IC.duck, px, FLOOR - 30 - Math.abs(Math.sin(t * 8)) * 6, 1.25, p.dir < 0); }
  else if (c.k === "blush") { spr(ci, f, px, bot, flip, { tint: "rgba(255,60,90,.4)" }); prop(IC.blush, px, FLOOR - 142 + Math.sin(t * 9) * 2, .5); }
  else if (c.k === "cook") { spr(ci, 10, px + Math.sin(t * 22) * 2, bot - 30, flip, { s: .8, tint: "rgba(255,80,40,.35)" }); prop(IC.pot, px, FLOOR - 30, 1.9); for (let i = 0; i < 3; i++) prop(IC.steam, px - 24 + i * 24, FLOOR - 92 - ((t * 44 + i * 17) % 44), .45, false, .8); text(["nghe nói nó…", "thiệt hả?!", "còn nữa nè…", "đừng kể ai nha"][Math.floor(t * 1.7) % 4], clamp(px + p.dir * 64, 60, W - 60), FLOOR - 124, "#fde68a", 14, "center"); }
  else if (c.k === "kara") { spr(ci, f, px + Math.sin(t * 5) * 2, bot, flip, { sy: .86, tint: "rgba(80,120,255,.35)" }); for (let i = 0; i < 3; i++) text("♪", px - 16 + i * 16, FLOOR - 118 - ((t * 30 + i * 11) % 24), "#93c5fd", 15, "center"); }
  else if (c.k === "mob") { spr(ci, 10, px + Math.sin(t * 44) * 3, bot, flip, { tint: "rgba(255,40,40,.3)" }); for (let i = 0; i < 6; i++) { const sd = i % 2 ? 1 : -1; prop(IC.fist, px + sd * (26 + Math.abs(Math.sin(t * 18 + i * 1.3)) * 30), FLOOR - 26 - i * 17, .5, sd > 0); } for (let i = 0; i < 3; i++) prop(IC.sandal, (t * 320 + i * 170) % (W + 60) - 30, FLOOR - 120 + Math.sin(t * 5 + i * 2) * 22, .4, false, 1, t * 11 + i); for (let i = 0; i < 4; i++) text("✸", px + Math.cos(t * 9 + i * 1.57) * 26, FLOOR - 70 + Math.sin(t * 9 + i * 1.57) * 34, "#ffe14a", 16, "center"); }
  else if (c.k === "flat") spr(ci, f, px, bot, flip, { sy: .22, tint });
  else if (c.k === "hair") { const sx = Math.sin(t * 40) * 3; spr(ci, f, px + sx, bot, flip, { tint }); prop(IC.wig, px + sx, FLOOR - 108, 1.05); if (Math.floor(t * 4) % 2) text("!?", px + 26, FLOOR - 120, "#ffe14a", 18); }
  else if (c.k === "meet") { spr(ci, f, px, bot, flip, { tint }); prop(IC.table, px + p.dir * 14, FLOOR - 30, 1.5, p.dir < 0); text("z", px + 10, FLOOR - 96 - (t * 20 % 16), "#fff", 14); text("Z", px + 18, FLOOR - 108 - (t * 20 % 16), "#fff", 18); }
  else { spr(ci, f, px, bot, flip, { tint });
    if (c.k === "house") {   // "ngôi nhà chiến lược" kiểu slide công ty: Vision, Mission, mái tam giác và hàng trụ cột; đối thủ phải đứng gồng mái
      c.T0 = c.T0 || c.t; const dk = clamp((c.T0 - c.t) / .22, 0, 1), hx = clamp(px, 166, W - 166), oy = -230 * (1 - dk) * (1 - dk) + (dk >= 1 ? Math.sin(t * 30) * Math.max(0, .35 - (c.T0 - c.t)) * 8 : 0), L = hx - 160, box = (X, Y, w, h, col) => { x.fillStyle = "#000"; x.fillRect(X - 1, Y - 1, w + 2, h + 2); x.fillStyle = col; x.fillRect(X, Y, w, h); };
      x.save(); x.translate(0, Math.round(oy) + 28); x.globalAlpha = .94;
      box(L, 30, 320, 30, "#1e4fa3"); text("VISION", hx, 44, "#fff", 17, "center"); text("Làm ít · Lương cao · Về trước 6 giờ", hx, 56, "#dbeafe", 12, "center");
      box(L, 63, 320, 15, "#5aa9e6"); text("MISSION", hx, 75, "#fff", 14, "center");
      [["Họp để", "chốt lịch họp"], ["Thêm một", "slide nữa"], ["Nghe hay", "mà khó làm"], ["Synergy", "là gì vậy?"], ["Đẩy sang", "tuần sau"]].forEach((tx2, i) => { box(L + i * 64.5, 81, 62, 28, "#f8fafc"); x.font = FONT(11); x.textAlign = "center"; x.fillStyle = "#1e293b"; x.fillText(tx2[0], L + i * 64.5 + 31, 92); x.fillText(tx2[1], L + i * 64.5 + 31, 104); });
      x.fillStyle = "#000"; x.beginPath(); x.moveTo(hx, 110); x.lineTo(L + 322, 152); x.lineTo(L - 2, 152); x.fill(); x.fillStyle = "#3f4650"; x.beginPath(); x.moveTo(hx, 113); x.lineTo(L + 314, 150); x.lineTo(L + 6, 150); x.fill(); text("TRỤ CỘT CHIẾN LƯỢC", hx, 136, "#fff", 15, "center"); text("& TRỤ CỘT GỒNG", hx, 148, "#cbd5e1", 11, "center");
      ["Cà phê", "Trà sữa", "Deadline", "OT", "KPI", "Vibe"].forEach((tx2, i) => { box(L + i * 53.6, 154, 51, 30, i < 3 ? "#6aa22e" : "#1e4fa3"); text(tx2, L + i * 53.6 + 25.5, 173, "#fff", 13, "center"); });
      x.restore(); x.globalAlpha = 1;
      if (dk >= 1) { spr(ci, 7, px + Math.sin(t * 38) * 1.5, bot, flip, { sy: .9, tint: "rgba(255,80,60,.25)" }); box(px - 27, 214, 54, 13, "#dc2626"); text("TRỤ THỨ 7", px, 225, "#fff", 12, "center"); x.fillStyle = "#7fd4ff"; for (let i = 0; i < 3; i++) x.fillRect(px - 22 + i * 20, FLOOR - 112 + ((t * 36 + i * 9) % 20), 3, 5); }
    }
    if (c.k === "frame") { x.save(); const bx = px - 34, by = FLOOR - 132; ["rgba(255,77,61,.28)", "rgba(255,216,74,.28)", "rgba(96,165,250,.28)", "rgba(45,212,191,.28)"].forEach((cl, i) => { x.fillStyle = cl; x.fillRect(bx + (i % 2) * 34, by + (i >> 1) * 64, 34, 64); }); x.strokeStyle = "#fff"; x.lineWidth = 2; x.strokeRect(bx, by, 68, 128); x.beginPath(); x.moveTo(px, by); x.lineTo(px, by + 128); x.moveTo(bx, by + 64); x.lineTo(bx + 68, by + 64); x.stroke(); x.restore(); } }
  if (c) { if (c.ic != null) prop(c.ic, px, FLOOR - 152 + Math.sin(t * 6) * 3, c.k === "lev" ? .9 : .6); if (c.lb) text(c.lb, clamp(px, 70, W - 70), FLOOR - (c.ic != null ? 176 : 142), "#fff", 14, "center"); }
  if (p.big > 0 && p.bigK !== 1) { x.save(); x.strokeStyle = "#bfe6ff"; x.lineWidth = 2; x.globalAlpha = .6 + .3 * Math.sin(t * 20); x.beginPath(); x.arc(px, FLOOR, 66, Math.PI, 0); x.stroke(); x.fillStyle = "rgba(127,212,255,.14)"; x.fill();
    if (p.bigK === 2) { x.beginPath(); x.moveTo(px, FLOOR); x.lineTo(px, FLOOR - 66); x.moveTo(px - 57, FLOOR - 33); x.lineTo(px + 57, FLOOR - 33); x.stroke(); x.globalAlpha = 1; "SWOT".split("").forEach((l, i) => text(l, px + (i % 2 ? 22 : -22), FLOOR - (i < 2 ? 40 : 10), "#fff", 20, "center")); } x.restore(); }
  else if (p.shield > 0) { x.save(); x.globalCompositeOperation = "lighter"; x.strokeStyle = "#7fd4ff"; x.lineWidth = 2; x.globalAlpha = .6 + .3 * Math.sin(t * 20); x.beginPath(); x.ellipse(px + p.dir * 30, FLOOR - 70, 9, 50, 0, 0, 6.283); x.stroke(); x.fillStyle = "rgba(127,212,255,.15)"; x.fill(); x.restore(); }
  if (p.mute > 0 && !c) { prop(IC.manne, px, FLOOR - 150 + Math.sin(t * 5) * 2, .4); text("mất đồ " + p.mute.toFixed(0) + "s", px, FLOOR - 136, "#d4d4d8", 12, "center"); }
  if (p.parry > 0) { const k = p.parry / WARD; x.save(); x.globalCompositeOperation = "lighter"; x.strokeStyle = "#ffe14a"; x.lineWidth = 3; x.globalAlpha = .5 + .5 * k; x.beginPath(); x.ellipse(px, FLOOR - 66, 44 + (1 - k) * 8, 74 + (1 - k) * 8, 0, 0, 6.283); x.stroke(); x.fillStyle = "rgba(255,225,74,.16)"; x.fill(); x.strokeStyle = "#fff"; x.lineWidth = 1; x.beginPath(); x.ellipse(px, FLOOR - 66, 38, 68, 0, t * 9, t * 9 + 2.2); x.stroke(); x.restore(); }
  if (p.ai && p.ai.wind > 0) { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = chOf(1).col; const r = 4 + (1 - p.ai.wind / lv().wind) * 6; x.beginPath(); x.arc(px - 44, FLOOR - (p.ai.type === "lo" ? 14 : p.ai.type === "th" ? 150 : HIGH), r, 0, 6.283); x.fill(); x.restore(); }
}
function bolt(x0, y0, x1, y1, c, w) { x.strokeStyle = c; x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); for (let i = 1; i < 8; i++) x.lineTo(x0 + (x1 - x0) * i / 8 + rnd(-9, 9), y0 + (y1 - y0) * i / 8 + rnd(-5, 5)); x.lineTo(x1, y1); x.stroke(); }
function drawAttack(a) {
  const T = F[a.to], C = F[a.from], col = a.col || chOf(a.from).col, t = G.t;
  if (a.p) {
    if (a.age < a.wait) return; const X = a.x, Y = FLOOR - a.h, d = Math.sign(a.v);
    if (a.ic >= 0) { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = col; x.globalAlpha = .35; x.beginPath(); x.ellipse(X - d * 10, Y, 20 * (a.sc || .5) * 2, 7, 0, 0, 6.283); x.fill(); x.restore(); prop(a.egg && a.age - a.wait < .3 ? IC.egg : a.ic, X, Y, a.sc || .5, d < 0, 1, a.spin ? a.age * 16 * d : a.wob ? Math.sin(a.age * 22) * .25 : 0); if (a.wave) { x.strokeStyle = col; x.lineWidth = 2; for (let i = 1; i < 4; i++) { x.beginPath(); x.arc(X + d * 18, Y, 10 + i * 9 + (a.age * 40 % 9), -0.7 + (d < 0 ? Math.PI : 0), .7 + (d < 0 ? Math.PI : 0)); x.stroke(); } } }
    else if (a.ic === -6) { const big = !!a.wob; spr(CI(a), [5, 6, 9, 4][(+a.id.split(":")[1]) % 4], X, Y + (big ? 34 : 26), d < 0, { s: big ? .6 : .42, a: .92, tint: "rgba(255,90,130,.28)" }); prop(IC.spark, X + d * 12, Y - 10 + Math.sin(a.age * 20) * 3, .22); }
    else if (a.ic === -7) { x.save(); x.translate(Math.round(X), Math.round(Y)); x.rotate(Math.sin(a.age * 9 + a.h0) * .25); x.fillStyle = "#000"; x.fillRect(-15, -18, 30, 36); x.fillStyle = "#fff"; x.fillRect(-14, -17, 28, 34); x.fillStyle = col; x.fillRect(-12, -15, 24, 24); if (ok(SPR)) { x.scale((+a.id.split(":")[1]) % 2 ? -1 : 1, 1); x.drawImage(SPR, 74, CI(a) * CHH + 18, 44, 44, -12, -15, 24, 24); } x.restore(); }
    else if (a.ic === -2) text("ABCĐÊÔƠƯ"[(+a.id.split(":")[1]) % 8], X, Y + 7, col, 22, "center");
    else if (a.ic === -3) { if (a.bub) { x.font = FONT(15); const w = x.measureText(a.say).width + 10; x.fillStyle = "#000"; x.fillRect(X - w / 2 - 1, Y - 11, w + 2, 20); x.fillStyle = "#fff"; x.fillRect(X - w / 2, Y - 10, w, 18); x.textAlign = "center"; x.fillStyle = "#1f1147"; x.fillText(a.say, X, Y + 4); } else text(a.say, X, Y + 6, "#fff", 18, "center"); }
    else if (a.ic === -4) text((chOf(a.from).F.words || ["bla", "BLA", "bla~"])[(+a.id.split(":")[1]) % 3], X, Y + 6, col, 18, "center");
    else if (a.ic === -1) { x.fillStyle = col; for (let i = 0; i < 3; i++) { x.fillRect(X - d * i * 11 - 3, Y - 3, 6, 6); x.fillStyle = "#fff"; } }
    else { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, 20, 4, 0, 0, 6.283); x.fill(); x.fillStyle = "#fff"; x.beginPath(); x.ellipse(X + d * 4, Y, 9, 2, 0, 0, 6.283); x.fill(); x.restore(); }
    if (a.lbl) text(a.lbl, X, Y + 34 * (a.sc || .5) + 6, "#fff", 12, "center");
    if (a.low) { x.fillStyle = col; for (let i = 0; i < 4; i++) x.fillRect(X - d * i * 8 - 2, FLOOR - 4 - ((t * 60 + i * 9) % 14), 4, 5); }
    return;
  }
  const k = clamp(a.age / Math.max(.01, a.wait), 0, 1), post = a.done ? a.age - a.hitAt : -1, TXfull = a.done ? a.hx : a.cond ? a.tx : T.x, short = a.rng && !a.p, TX = short ? a.cx + clamp(TXfull - a.cx, -a.rng, a.rng) : TXfull;   // skill tầm ngắn: hiệu ứng chỉ vươn tới hết tầm, không chạm đối thủ đứng xa
  if (short && !a.done && !a.n) { const rx = a.cx + a.dir * a.rng, al = .35 + .25 * Math.sin(t * 14); x.fillStyle = `rgba(255,255,255,${al})`; for (let u = a.cx + a.dir * 30; (rx - u) * a.dir > 0; u += a.dir * 12) x.fillRect(Math.round(u), FLOOR + 5, 6, 2); x.fillRect(Math.round(rx) - 1, FLOOR - 4, 3, 13); }   // vạch tầm với trên sàn lúc đang vận chiêu
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
  else if (a.fx === "clones") { const ci = CI(a), span = (TX + a.dir * 90) - a.cx; for (let i = 0; i < 5; i++) { const kk = clamp(a.age / (a.wait + .35) * 1.5 - i * .1, 0, 1); if (kk > 0 && kk < 1) spr(ci, 2 + Math.floor(a.age * 10 + i) % 2, a.cx + span * kk, FLOOR, a.dir < 0, { a: .7, tint: "rgba(255,216,74,.4)" }); } }
  else if (a.fx === "dash") { const X = a.cx + (TX + a.dir * 80 - a.cx) * (a.done ? 1 : k * k), al = a.done ? Math.max(0, 1 - post * 3) : 1; x.globalCompositeOperation = "lighter"; x.strokeStyle = col; x.lineWidth = 6; x.globalAlpha = .5 * al; x.beginPath(); x.moveTo(a.cx, FLOOR - 70); x.lineTo(X, FLOOR - 70); x.stroke(); x.globalCompositeOperation = "source-over"; prop(a.ic, X, FLOOR - 74 + (a.trail != null ? 26 : 0), a.sc || 1, a.dir < 0, al); if (a.trail != null) prop(a.trail, X + a.dir * 34, FLOOR - 66 + Math.sin(t * 20) * 3, .6, false, al); }
  else if (a.fx === "ring") { const r = Math.min(a.age, a.wait + .4) * 340; x.globalAlpha = a.done ? Math.max(0, 1 - post * 2.5) : 1; if (a.ic != null) for (let i = 0; i < 12; i++) { const an = i / 12 * 6.283 + t; prop(a.ic, a.cx + Math.cos(an) * r, FLOOR - 16 + Math.sin(an) * r * .14 - Math.abs(Math.sin(t * 5 + i)) * 8, .7, false, x.globalAlpha); } else { x.globalCompositeOperation = "lighter"; x.strokeStyle = col; x.lineWidth = 6; x.beginPath(); x.ellipse(a.cx, FLOOR, r, r * .16, 0, 0, 6.283); x.stroke(); } }
  else if (a.fx === "orbit") { const foods = [IC.pho, IC.banhmi, IC.roll, IC.cake, IC.sushi, IC.pizza, IC.chicken, IC.tea], R = a.done ? 70 * .3 * Math.max(0, 1 - post * 4) : 78 * (1 - k * .7), al = a.done ? Math.max(0, 1 - post * 3) : Math.min(1, k * 5);
    prop(IC.menu, a.cx + a.dir * 30, FLOOR - 120 - Math.min(1, k * 4) * 14, .6, false, a.done ? al : 1); prop(IC.buffet, TX - a.dir * 78, FLOOR - 30, 1.25 * Math.min(1, k * 4), false, al);
    foods.forEach((ic, i) => { const an = i / foods.length * 6.283 + a.age * (4 + k * 8); prop(ic, TX + Math.cos(an) * R * 1.25, FLOOR - 66 + Math.sin(an) * R * .75, .5, false, al, an); }); }
  else if (a.fx === "rise") { const al = a.done ? Math.max(0, 1 - post * 2) : 1, kk = a.done ? 1 : k * k; x.fillStyle = `rgba(0,0,0,${(a.done ? .6 : .6 * k) * al})`; x.fillRect(-10, -10, W + 20, H + 20); x.fillStyle = `rgba(10,0,25,${al})`; x.beginPath(); x.ellipse(TX, FLOOR + 2, 20 + 60 * kk, 4 + 9 * kk, 0, 0, 6.283); x.fill();
    x.save(); x.beginPath(); x.rect(0, 0, W, FLOOR + 6); x.clip(); prop(a.ic, TX, FLOOR + 80 - kk * (80 + 36 * a.sc - 8) + (a.done ? post * 120 : Math.sin(t * 30) * 2), a.sc, false, al); x.restore(); }
  else if (a.fx === "bike") { const dn = a.n % 2 ? -1 : 1, X = TX + dn * (a.age - a.wait) * 520; if (Math.abs(a.age - a.wait) < .55) { x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(X - dn * (40 + i * 9), FLOOR - 8 - i * 9); x.lineTo(X - dn * (80 + i * 9), FLOOR - 8 - i * 9); x.stroke(); } prop(a.ic ?? IC.bike, X, FLOOR - (a.big ? 42 : 34), a.big ? 1.8 : 1.25, dn < 0); if (a.big) prop(IC.dust, X - dn * 70, FLOOR - 8, .7); } }
  else if (a.fx === "tornado") { const X = a.done ? TX : a.cx + (TX - a.cx) * k, al = a.done ? Math.max(0, 1 - post * 3) : 1; x.fillStyle = `rgba(10,14,40,${.45 * (a.done ? al : Math.min(1, k * 3))})`; x.fillRect(-10, -10, W + 20, H + 20); prop(IC.cloud, X, 34, 2.2, false, al); prop(IC.wind, X, FLOOR - 70, 2.1, false, al, Math.sin(t * 18) * .12); for (let i = 0; i < 8; i++) prop([IC.note, IC.bulb, IC.zap][i % 3], X + Math.cos(t * 9 + i) * (24 + i * 7), FLOOR - 16 - i * 17, .32, false, al, t * 5 + i); }
  else if (a.fx === "aura") { const r = a.age * 230, al = a.done ? Math.max(0, 1 - post * 2) : 1; x.globalCompositeOperation = "lighter"; x.strokeStyle = `rgba(255,216,74,${.8 * al})`; x.lineWidth = 8; x.beginPath(); x.arc(a.cx, FLOOR - 90, r, 0, 6.283); x.stroke(); x.strokeStyle = `rgba(255,255,255,${.6 * al})`; x.lineWidth = 3; x.beginPath(); x.arc(a.cx, FLOOR - 90, r * .8, 0, 6.283); x.stroke(); x.globalCompositeOperation = "source-over"; for (let i = 0; i < 8; i++) prop(i % 2 ? IC.heart : IC.spark, a.cx + Math.cos(i * .785 + t) * r, FLOOR - 90 + Math.sin(i * .785 + t) * r * .6, .4, false, al); }
  else if (a.fx === "zoom") { const R = a.done ? 62 : 16 + 46 * k * k, cy = FLOOR - 72, al = a.done ? Math.max(0, 1 - post * 2.5) : 1; x.globalAlpha = al; x.strokeStyle = "#5b3a1e"; x.lineWidth = 9; x.beginPath(); x.moveTo(TX + a.dir * -R * .7, cy + R * .7); x.lineTo(TX - a.dir * (R * .7 + 46), cy + R * .7 + 46); x.stroke();
    x.save(); x.beginPath(); x.arc(TX, cy, R, 0, 6.283); x.clip(); x.fillStyle = "#cfe8ff"; x.fillRect(TX - R, cy - R, R * 2, R * 2); spr(G.chars[a.to], frameOf(T), TX, FLOOR + 62, a.to === 1, { s: 2 }); x.fillStyle = "rgba(255,255,255,.25)"; x.beginPath(); x.ellipse(TX - R * .3, cy - R * .4, R * .35, R * .18, -.6, 0, 6.283); x.fill(); if (!a.done) { x.fillStyle = "rgba(255,40,40,.5)"; x.fillRect(TX - R, cy - R + ((a.age * 160) % (R * 2)), R * 2, 2); } x.restore();
    x.strokeStyle = "#111"; x.lineWidth = 5; x.beginPath(); x.arc(TX, cy, R, 0, 6.283); x.stroke(); x.strokeStyle = "#9ca3af"; x.lineWidth = 2; x.stroke(); if (!a.done) text("ZOOM " + Math.round(100 + k * 300) + "%", clamp(TX, 60, W - 60), cy - R - 6, "#fff", 14, "center"); }
  else if (a.fx === "suck") { if (a.n === 3) { const mx = a.cx + a.dir * 34, my = FLOOR - 98; prop(IC.cig, mx, my, .55, a.dir > 0); for (let j = 0; j < 12; j++) { const u = (a.age * 1.6 + j / 12) % 1, X = TX + (mx - TX) * u, Y = FLOOR - 70 + (my - FLOOR + 70) * u + Math.sin(u * 12 + j) * 10 * (1 - u); prop(IC.smoke, X, Y, .5 * (1 - u * .7), false, .8); } x.strokeStyle = "rgba(255,255,255,.5)"; x.lineWidth = 1; for (let j = 0; j < 4; j++) { const u = (a.age * 2.5 + j / 4) % 1; x.beginPath(); x.arc(mx, my, 12 + (1 - u) * 60, a.dir > 0 ? -.5 : Math.PI - .5, a.dir > 0 ? .5 : Math.PI + .5); x.stroke(); } } }
  else if (a.fx === "mirror") { const P = [[-66, -52], [64, -70], [-30, -128], [70, -8]], al = a.done ? Math.max(0, 1 - post * 2) : Math.min(1, a.age * 4), ci = CI(a); (a.n === 2 ? [2, 3] : [a.n]).forEach(j => { const mx = TX + P[j][0], my = FLOOR + P[j][1] - 30; prop(IC.tmirror, mx, my, .95, false, al); x.save(); x.globalAlpha = al * .9; x.beginPath(); x.rect(mx - 9, my - 22, 18, 30); x.clip(); if (ok(SPR)) x.drawImage(SPR, 72, ci * CHH + 18, 46, 46, mx - 14, my - 22, 28, 28); x.restore(); });
    if (post >= 0 && post < .22) { const mx = TX + P[a.n][0], my = FLOOR + P[a.n][1] - 30; x.globalCompositeOperation = "lighter"; x.strokeStyle = "#fff"; x.lineWidth = 6; x.beginPath(); x.moveTo(mx, my); x.lineTo(TX, FLOOR - 70); x.stroke(); x.strokeStyle = "#93c5fd"; x.lineWidth = 12; x.globalAlpha = .4; x.stroke(); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; prop(IC.spark, TX, FLOOR - 70, .8); } }
  else if (a.fx === "hug") { if (!a.done) { const fl = a.from === 1; if (k < .5) { const kk = k * 2; x.save(); x.globalCompositeOperation = "lighter"; for (let i = 0; i < 12; i++) { const an = i / 12 * 6.283 + t * 2; x.fillStyle = "rgba(255,216,74,.4)"; x.beginPath(); x.moveTo(a.cx, FLOOR - 70); x.arc(a.cx, FLOOR - 70, 80, an, an + .2); x.fill(); } x.restore(); spr(SR, 0, a.cx, FLOOR, fl, {}); prop(IC.tee, a.cx - a.dir * (20 + kk * 70), FLOOR - 110 - kk * 60, .7, false, 1 - kk, kk * 5); prop(IC.spark, a.cx + 20, FLOOR - 100 + Math.sin(t * 20) * 3, .5); if (kk > .3) text("6 MÚI!", a.cx, FLOOR - 140, "#ffe14a", 20, "center"); }
      else { const kk = (k - .5) * 2, X = a.cx + (TX - a.dir * 26 - a.cx) * kk * kk; x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(X - a.dir * 30, FLOOR - 30 - i * 14); x.lineTo(X - a.dir * (60 + i * 5), FLOOR - 30 - i * 14); x.stroke(); } spr(SR, 1, X, FLOOR - Math.sin(kk * Math.PI) * 30, fl, {}); } } }
  else if (a.fx === "butt") { const ci = CI(a), up = k < .5, kk = up ? k * 2 : (k - .5) * 2, X = a.done ? TX : up ? a.cx + (TX - a.cx) * kk : TX, bot = a.done ? FLOOR - 34 : up ? FLOOR - (FLOOR + 30) * (1 - (1 - kk) * (1 - kk)) : -30 + (FLOOR - 34 + 30) * kk * kk; if (!a.done || post < .4) { x.fillStyle = "rgba(0,0,0,.35)"; x.beginPath(); x.ellipse(TX, FLOOR + 1, 34, 6, 0, 0, 6.283); x.fill(); spr(ci, 8, X, bot, a.from === 1, {}); prop(IC.barbell, X, bot - 72, 1.35); if (!a.done && !up) { x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = -2; i < 3; i++) { x.beginPath(); x.moveTo(X + i * 14, bot - 110); x.lineTo(X + i * 14, bot - 150); x.stroke(); } } } }
  else if (a.fx === "perf") { const ci = CI(a), al = a.done ? Math.max(0, 1 - post * 2) : 1, items = [IC.matcha, IC.tote, IC.vinyl, IC.obook, IC.camera], fr = [0, 5, 6, 4, 9]; x.fillStyle = `rgba(4,6,30,${.7 * (a.done ? al : Math.min(1, a.age * 4))})`; x.fillRect(-10, -10, W + 20, H + 20);
    for (let i = 0; i < 5; i++) { const ap = clamp((a.age - i * .2) * 5, 0, 1); if (ap <= 0) continue; const X = 60 + i * 90; x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = `rgba(147,197,253,${.28 * ap * al})`; x.beginPath(); x.moveTo(X - 8, 0); x.lineTo(X + 8, 0); x.lineTo(X + 40, FLOOR); x.lineTo(X - 40, FLOOR); x.fill(); x.restore(); spr(ci, fr[i], X, FLOOR + (1 - ap) * 30, i % 2 === 1, { s: 1.15, a: ap * al }); prop(items[i], X + 22, FLOOR - 150 + Math.sin(t * 5 + i) * 4, .5, false, ap * al); prop(IC.spark, X - 24 + Math.sin(t * 7 + i) * 6, FLOOR - 120 + Math.cos(t * 6 + i) * 10, .35 + .1 * Math.sin(t * 12 + i), false, ap * al); }
    if (a.age > .9 && (!a.done || post < .4)) text("✦ PERFORMATIVE ✦", W / 2, 84 + Math.sin(t * 10) * 2, "#fff", 34, "center"); }
  else if (a.fx === "prompt") { const al = a.done ? Math.max(0, 1 - post * 2.5) : 1, msg = "/imagine đối thủ gục ngã --v 7", n = Math.floor(clamp(k * 2.2, 0, 1) * msg.length); x.globalAlpha = al; x.fillStyle = "#0f172a"; x.fillRect(W / 2 - 150, 60, 300, 20); x.strokeStyle = "#a78bfa"; x.lineWidth = 1; x.strokeRect(W / 2 - 150.5, 59.5, 301, 21); prop(IC.aistar, W / 2 - 138, 70, .28); text(msg.slice(0, n) + (Math.floor(t * 6) % 2 ? "▌" : ""), W / 2 - 126, 75, "#e9d5ff", 15);
    if (k > .45) { const g2 = clamp((k - .45) / .5, 0, 1); x.fillStyle = "#1e1b4b"; x.fillRect(W / 2 - 80, 84, 160, 6); x.fillStyle = "#a78bfa"; x.fillRect(W / 2 - 80, 84, 160 * g2, 6); text("Generating " + Math.round(g2 * 100) + "%", W / 2, 102, "#c4b5fd", 12, "center"); const y = a.done ? FLOOR - 78 : -60 + (FLOOR - 18) * g2 * g2; for (let i = 0; i < 5; i++) { x.fillStyle = ["#f0f", "#0ff", "#ff0"][i % 3]; x.globalAlpha = al * .5; x.fillRect(TX - 40 + ((i * 37 + Math.floor(t * 20) * 13) % 80), y - 30 + i * 12, 22, 3); } x.globalAlpha = al; prop(IC.hand7, TX + (Math.floor(t * 20) % 2 ? 2 : -2), y, 2, false, al); } }
  else if (a.fx === "tone") { const mx = a.cx + a.dir * 40, my = FLOOR - 96, al = a.done ? Math.max(0, 1 - post * 3) : 1, cols = ["#f472b6", "#a78bfa", "#facc15"]; if (a.n === 2) prop(IC.mic, mx, my, .6, a.dir < 0); if (a.age > a.wait - .3) { const kk = clamp((a.age - (a.wait - .3)) / .3, 0, 1); x.strokeStyle = cols[a.n]; x.lineWidth = 3; x.globalAlpha = al; x.beginPath(); for (let i = 0; i <= 30; i++) { const u = i / 30 * kk, X = mx + (TX - mx) * u, Y = my + 22 - a.n * 12 + Math.sin(u * 22 + t * 30 + a.n) * (6 + u * 16) + (u > .5 ? (u - .5) * 60 * (a.n - 1) : 0); i ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.stroke(); for (let i = 0; i < 4; i++) { const u = (i / 4 + t * .8) % 1 * kk; prop(IC.note2, mx + (TX - mx) * u, my - a.n * 14 + Math.sin(u * 9 + i) * 22, .4, false, al, Math.sin(t * 9 + i) * .8); } } }
  else if (a.fx === "wedding") { const al = a.done ? Math.max(0, 1 - post * 2) : Math.min(1, a.age * 4), bz = 1 + .06 * Math.sin(t * 40); x.fillStyle = `rgba(40,0,30,${.5 * al})`; x.fillRect(-10, -10, W + 20, H + 20); x.save(); x.globalCompositeOperation = "lighter"; ["#f472b6", "#facc15", "#60a5fa", "#a3e635"].forEach((c2, i) => { x.fillStyle = c2; x.globalAlpha = .22 * al; x.beginPath(); x.moveTo(60 + i * 120, 0); x.lineTo(60 + i * 120 + Math.sin(t * 3 + i) * 140 - 30, FLOOR); x.lineTo(60 + i * 120 + Math.sin(t * 3 + i) * 140 + 30, FLOOR); x.fill(); }); x.restore();
    prop(IC.arch, a.cx, FLOOR - 78, 2.3, false, al); prop(IC.mic, a.cx + a.dir * 30, FLOOR - 100, .5, a.dir < 0, al); prop(IC.rings, a.cx, FLOOR - 162 + Math.sin(t * 5) * 3, .5, false, al); [-1, 1].forEach(s => prop(IC.speaker, TX + s * 62, FLOOR - 40, 1.1 * bz, s > 0, al)); if (k > .5 || a.done) { [-1, 1].forEach(s => prop(IC.popper, TX + s * 30, FLOOR - 120, .9, s > 0, al)); for (let i = 0; i < 24; i++) { x.fillStyle = ["#f472b6", "#facc15", "#60a5fa", "#a3e635", "#fff"][i % 5]; x.globalAlpha = al; x.fillRect(TX - 90 + (i * 53) % 180, ((i * 31 + a.age * 160) % 190) + 30, 3, 5); } } if (!a.done) text("♪ TIỆC CƯỚI BẮT ĐẦU ♪", W / 2, 74, "#fde68a", 20, "center"); }
  else if (a.fx === "cry") { const al = a.done ? Math.max(0, 1 - post * 2) : Math.min(1, a.age * 3), ci = CI(a); x.fillStyle = `rgba(6,12,50,${.72 * al})`; x.fillRect(-10, -10, W + 20, H + 20); spr(ci, 8, a.cx, FLOOR, a.from === 1, { a: al }); x.strokeStyle = `rgba(96,165,250,${al})`; x.lineWidth = 2; [-1, 1].forEach(s => { x.beginPath(); x.moveTo(a.cx + s * 4, FLOOR - 62); x.quadraticCurveTo(a.cx + s * 34, FLOOR - 100 - Math.sin(t * 12) * 8, a.cx + s * 52, FLOOR - 6); x.stroke(); }); prop(IC.tissue, a.cx - a.dir * 30, FLOOR - 12, .5, false, al); x.fillStyle = `rgba(96,165,250,${.5 * al})`; x.beginPath(); x.ellipse(a.cx, FLOOR + 2, 30 + k * 40, 5, 0, 0, 6.283); x.fill();
    for (let i = 0; i < 18; i++) prop(i % 3 ? IC.tear : IC.bheart, (i * 67 + 20) % W, ((i * 41 + a.age * (150 + i * 9)) % (FLOOR + 30)) - 20, i % 3 ? .3 : .42, false, al * .95, i % 3 ? 0 : Math.sin(t * 4 + i) * .4); if (!a.done || post < .4) { text("♪ người ta đâu có biết ♪", W / 2, 70, "#bfdbfe", 16, "center"); if (a.done) prop(IC.bheart, TX, FLOOR - 80, 2 - post * 2, false, 1 - post * 2); } }
  else if (a.fx === "hide") { const al = a.done ? Math.max(0, 1 - post * 1.6) : Math.min(1, a.age * 5); prop(IC.manne, TX, FLOOR - 150 + Math.sin(t * 6) * 3, .6, false, al); for (let i = 0; i < 5; i++) { const an = t * 5 + i * 1.26, r = a.done ? 30 + post * 160 : 30; prop([IC.hanger, IC.bag, IC.scarf, IC.beret, IC.sring][i], TX + Math.cos(an) * r, FLOOR - 80 + Math.sin(an) * r * .6 - (a.done ? post * 90 : 0), .4, false, al, an); } }
  else if (a.fx === "curse") { const al = a.done ? Math.max(0, 1 - post * 2.5) : 1, C2 = F[a.from], sy = ["#@$%!", "&*#@!!", "%$#…"][a.n]; if (a.n === 2 && !a.done) { spr(CI(a), 9, C2.x, FLOOR, a.from === 1, { a: .0 }); prop(IC.fshades, C2.x + C2.dir * 8, FLOOR - 150 + Math.sin(t * 8) * 3, .5); text("lêu lêu~", C2.x, FLOOR - 162, "#fff", 13, "center"); }
    if (a.age > a.wait - .35) { const by = FLOOR - 150 - a.n * 4, w2 = 62; x.globalAlpha = al; x.fillStyle = "#000"; x.fillRect(TX - w2 / 2 - 2, by - 14, w2 + 4, 24); x.fillStyle = "#fff"; x.fillRect(TX - w2 / 2, by - 12, w2, 20); x.fillStyle = "#e11d48"; x.font = FONT(18); x.textAlign = "center"; x.fillText(sy, TX + Math.sin(t * 50) * 1.5, by + 3); prop(IC.anger, TX + 26, FLOOR - 128, .45 + .1 * Math.sin(t * 20), false, al); } }
  else if (a.fx === "shame") { const al = a.done ? Math.max(0, 1 - post * 2) : Math.min(1, a.age * 4), ci = CI(a); spr(ci, 11, a.cx, FLOOR, a.from === 1, { a: al }); prop(IC.bandaid, a.cx - a.dir * 20, FLOOR - 22, .45, false, al); for (let i = 0; i < 3; i++) text("★", a.cx - a.dir * 30 + Math.cos(t * 6 + i * 2.1) * 14, FLOOR - 34 + Math.sin(t * 6 + i * 2.1) * 5, "#ffd84a", 12, "center"); if (!a.done) text(["Ui da…", "Đánh người!", "Có ai thấy không?!"][Math.min(2, Math.floor(k * 3))], clamp(a.cx, 70, W - 70), FLOOR - 50, "#fff", 14, "center");
    if (k > .3) { for (let i = 0; i < 6; i++) { const X = 40 + i * 80, fl = Math.floor(t * 9 + i * 3) % 4 === 0; prop(i % 2 ? IC.phonecam : IC.papcam, X, 112 + (i % 2) * 16, .8, X > TX, al); if (fl) { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = `rgba(255,255,255,${.5 * al})`; x.beginPath(); x.arc(X, 104, 20, 0, 6.283); x.fill(); x.restore(); } } x.fillStyle = `rgba(255,60,90,${.35 * al})`; x.beginPath(); x.ellipse(TX + F[a.to].dir * 6, FLOOR - 108, 10, 5, 0, 0, 6.283); x.fill(); } }
  else if (a.fx === "runway") { const ci = CI(a), al = a.done ? Math.max(0, 1 - post * 2.5) : 1, kk = clamp(a.age / (a.wait + .35), 0, 1), X = a.cx + (TX + a.dir * 70 - a.cx) * kk; x.fillStyle = `rgba(0,0,0,${.5 * al})`; x.fillRect(-10, -10, W + 20, H + 20); x.fillStyle = `rgba(255,255,255,${.85 * al})`; x.fillRect(0, FLOOR - 2, W, 6); for (let i = 0; i < 12; i++) { x.fillStyle = Math.floor(t * 10 + i) % 3 ? `rgba(255,255,255,${.3 * al})` : `rgba(255,236,150,${al})`; x.fillRect(i * 42 + 6, FLOOR + 6, 10, 4); }
    x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = `rgba(255,255,255,${.2 * al})`; x.beginPath(); x.moveTo(X - 6, 0); x.lineTo(X + 6, 0); x.lineTo(X + 44, FLOOR); x.lineTo(X - 44, FLOOR); x.fill(); x.restore(); spr(ci, 2 + Math.floor(a.age * 9) % 2, X, FLOOR, a.from === 1, { s: 1.2, a: al }); for (let i = 0; i < 5; i++) if (Math.floor(t * 12 + i * 5) % 5 === 0) prop(IC.spark, 30 + i * 100, 60 + (i % 2) * 40, .7, false, al); }
  else if (a.fx === "goat") { if (!a.done) { const ci = CI(a), X = a.cx + (TX - a.dir * 44 - a.cx) * k * k, hop = Math.abs(Math.sin(a.age * 12)) * 10; x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(X - a.dir * 40, FLOOR - 10 - i * 12); x.lineTo(X - a.dir * (70 + i * 6), FLOOR - 10 - i * 12); x.stroke(); } prop(IC.goat, X, FLOOR - 28 - hop, 1.3, a.dir < 0); spr(ci, 9, X - a.dir * 4, FLOOR - 40 - hop, a.from === 1, {}); for (let i = 0; i < 3; i++) prop(IC.heart, X - a.dir * (30 + i * 16), FLOOR - 90 - i * 10 + Math.sin(t * 9 + i) * 4, .3); } }
  else if (a.fx === "glare") { const C2 = F[a.from], ex = a.cx + a.dir * 10, ey = FLOOR - 112; if (!a.done) prop(IC.eye, a.cx + a.dir * 6, FLOOR - 150, .9 + k * .5, a.dir < 0); else if (post < .25) { x.globalCompositeOperation = "lighter"; [-10, 6].forEach(o => { x.fillStyle = "#fff"; x.beginPath(); x.moveTo(ex, ey); x.lineTo(TX, FLOOR - 78 + o - 4); x.lineTo(TX + a.dir * 40, FLOOR - 78 + o); x.lineTo(TX, FLOOR - 78 + o + 4); x.fill(); x.fillStyle = "rgba(244,63,94,.6)"; x.beginPath(); x.moveTo(ex, ey); x.lineTo(TX, FLOOR - 78 + o - 9); x.lineTo(TX, FLOOR - 78 + o + 9); x.fill(); }); x.globalCompositeOperation = "source-over"; prop(IC.eye, a.cx + a.dir * 6, FLOOR - 150, 1.5, a.dir < 0, 1 - post * 4); } }
  else if (a.fx === "snap") { const ci = CI(a), gx = a.cx + (TX - a.dir * 52 - a.cx) * (a.n + 1) / 3, near = Math.abs(a.age - a.wait); if (near < .16) { x.fillStyle = `rgba(255,255,255,${.55 * (1 - near / .16)})`; x.fillRect(-10, -10, W + 20, H + 20); } if (a.age > a.wait - .14 && (!a.done || post < .3)) spr(ci, [5, 9, 6][a.n], gx, FLOOR, a.from === 1, { a: a.done ? 1 - post * 3 : 1 });
    if (a.n === 2 && a.done && post < .55) { const al = 1 - post / .55; x.globalAlpha = al; x.fillStyle = "#000"; x.fillRect(TX - 48, FLOOR - 142, 96, 150); x.fillStyle = "#fff"; x.fillRect(TX - 46, FLOOR - 140, 92, 146); x.clearRect(0, 0, 0, 0); x.fillStyle = "rgba(244,63,94,.25)"; x.fillRect(TX - 40, FLOOR - 134, 80, 112); spr(G.chars[a.to], frameOf(T), TX, FLOOR - 24, a.to === 1, { s: .82, a: al }); x.globalAlpha = al; x.fillStyle = "#111"; x.font = FONT(14); x.textAlign = "center"; x.fillText("#OOTD", TX, FLOOR - 4); } }
  else if (a.fx === "paint") { const al = a.done ? Math.max(0, 1 - post * 2) : Math.min(1, a.age * 4), ex = a.cx + a.dir * 44; prop(IC.easel2, ex, FLOOR - 46, 1.3, a.dir < 0, al); prop(IC.palette, a.cx + a.dir * 16, FLOOR - 70 + Math.sin(t * 8) * 3, .45, false, al); if (!a.done) { const cols = ["#f43f5e", "#facc15", "#22d3ee", "#a78bfa"]; for (let i = 0; i < Math.floor(k * 9); i++) { x.fillStyle = cols[i % 4]; x.fillRect(ex - 12 + (i * 7) % 22, FLOOR - 78 + (i * 11) % 30, 8, 4); } x.strokeStyle = "rgba(255,255,255,.6)"; x.setLineDash([3, 3]); x.lineWidth = 1; x.strokeRect(TX - 30.5, FLOOR - 130.5, 60, 132); x.setLineDash([]); text("đứng yên nha!", clamp(TX, 60, W - 60), FLOOR - 138, "#fff", 13, "center"); } }
  else if (a.fx === "filter") { const al = a.done ? Math.max(0, 1 - post * 2) : Math.min(1, a.age * 3); x.fillStyle = `rgba(255,150,190,${.28 * al})`; x.fillRect(-10, -10, W + 20, H + 20); for (let i = 0; i < 10; i++) prop(IC.spark, (i * 97 + t * 40) % W, (i * 53 + t * 25) % (FLOOR - 20), .3 + .1 * Math.sin(t * 9 + i), false, al);
    x.globalAlpha = al; x.fillStyle = "rgba(0,0,0,.6)"; x.fillRect(W / 2 - 84, 62, 168, 34); ["Mịn da", "Thon mặt"].forEach((s2, i) => { text(s2, W / 2 - 78, 76 + i * 14, "#fff", 12); x.fillStyle = "#555"; x.fillRect(W / 2 - 24, 71 + i * 14, 96, 4); x.fillStyle = "#f43f5e"; x.fillRect(W / 2 - 24, 71 + i * 14, 96 * Math.min(1, k * 1.3), 4); }); if (k > .35 || a.done) { const cols = ["#fecdd3", "#fda4af", "#fff1f2", "#f9a8d4", "#e5e5e5"]; for (let yy = 0; yy < 15; yy++) for (let xx = 0; xx < 7; xx++) if ((xx * 7 + yy * 13 + Math.floor(t * 8)) % 3) { x.fillStyle = cols[(xx * 3 + yy * 5 + Math.floor(t * 6)) % 5]; x.globalAlpha = al * .85 * Math.min(1, (k - .35) * 3 + (a.done ? 1 : 0)); x.fillRect(TX - 28 + xx * 8, FLOOR - 122 + yy * 8, 8, 8); } } }
  else if (a.fx === "goddess") { const al = a.done ? Math.max(0, 1 - post * 1.8) : Math.min(1, a.age * 3), s = 1 + .75 * clamp(k * 2.2, 0, 1), cy = FLOOR - 78 * s; x.fillStyle = `rgba(30,20,0,${.6 * al})`; x.fillRect(-10, -10, W + 20, H + 20); x.save(); x.globalCompositeOperation = "lighter"; for (let i = 0; i < 16; i++) { const an = i / 16 * 6.283 + t * .8; x.fillStyle = i % 2 ? `rgba(255,236,170,${.45 * al})` : `rgba(255,255,255,${.25 * al})`; x.beginPath(); x.moveTo(a.cx, cy); x.arc(a.cx, cy, 260, an, an + .16); x.fill(); } x.restore();
    [-1, 1].forEach(sd => prop(IC.column, a.cx + sd * 62 * s * .8, FLOOR - 34, 1.1, false, al)); prop(IC.pedestal, a.cx, FLOOR - 10, 1.2, false, al); spr(SR, 2, a.cx, FLOOR - 16, a.from === 1, { s, a: al }); prop(IC.halo, a.cx, FLOOR - 16 - 138 * s + Math.sin(t * 4) * 2, .7 * s, false, al); for (let i = 0; i < 10; i++) prop(IC.petals, (i * 61 + t * 30) % W, (i * 37 + t * 60) % FLOOR, .35, false, al * .9, t + i); if (!a.done || post < .5) text("✦ THẬT HOÀN HẢO ✦", W / 2, 74, "#fde68a", 26, "center"); }
  else if (a.fx === "pat") { const ci = CI(a), gx = TX - a.dir * 40, hit = a.done && post < .16; if (a.age > .12 && (!a.done || post < .3 || a.n < 3)) { if (a.n === 0 || a.age > a.wait - .2) spr(ci, a.done && post < .14 ? 5 : 4, gx, FLOOR, a.from === 1, {}); } if (hit) { prop(IC.palm, TX - a.dir * 8, FLOOR - 104, .9, a.dir < 0); x.strokeStyle = "#fff"; x.lineWidth = 2; for (let i = 0; i < 6; i++) { const an = i * 1.05; x.beginPath(); x.moveTo(TX + Math.cos(an) * 12, FLOOR - 104 + Math.sin(an) * 12); x.lineTo(TX + Math.cos(an) * 24, FLOOR - 104 + Math.sin(an) * 24); x.stroke(); } } }
  else if (a.fx === "bighead") { if (!a.done) { const ci = CI(a), S = 56 + k * 40, X = a.cx + (clamp(TX + a.dir * 8, 60, W - 60) - a.cx) * k * k, Y = FLOOR - 112 + (96 - (FLOOR - 112)) * k; if (ok(SPR)) { x.save(); x.translate(X, Y); x.scale(a.from === 1 ? -1 : 1, 1); x.rotate(.5 * k); x.drawImage(SPR, 68, ci * CHH + 12, 56, 56, -S / 2, -S / 2, S, S); x.restore(); } } }
  else if (a.fx === "vacuum") { if (a.n === 2) { const al = a.done ? Math.max(0, 1 - post * 2.5) : Math.min(1, a.age * 5), vx = a.cx + a.dir * 52, vy = FLOOR - 34; prop(IC.vacuum, vx, vy, 1.7, a.dir < 0, al); if (!a.done) { x.strokeStyle = "rgba(255,255,255,.6)"; x.lineWidth = 1; for (let j = 0; j < 7; j++) { const u = (a.age * 2.2 + j / 7) % 1, X = TX + (vx + a.dir * 40 - TX) * u; x.beginPath(); x.moveTo(X, FLOOR - 20 - j * 13); x.lineTo(X - a.dir * 22, FLOOR - 20 - j * 13 + (j - 3) * 3 * u); x.stroke(); } for (let j = 0; j < 6; j++) { const u = (a.age * 1.7 + j / 6) % 1; prop(IC.dust, TX + (vx + a.dir * 40 - TX) * u, FLOOR - 30 - j * 14 + Math.sin(u * 9 + j) * 8, .45 * (1 - u * .6), false, .8); } } } }
  else if (a.fx === "bus") { if (!a.done) { const X = (a.dir > 0 ? -90 : W + 90) + (TX - (a.dir > 0 ? -90 : W + 90)) * k * (2 - k); x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(X - a.dir * 80, FLOOR - 10 - i * 11); x.lineTo(X - a.dir * (120 + i * 8), FLOOR - 10 - i * 11); x.stroke(); } prop(IC.bus, X, FLOOR - 36, 1.9, a.dir < 0); prop(IC.dust, X - a.dir * 84, FLOOR - 8, .7 + .2 * Math.sin(t * 20)); text("ĐÀ LẠT · GIƯỜNG NẰM", clamp(X, 80, W - 80), FLOOR - 84, "#fde68a", 13, "center"); } }
  else if (a.fx === "guides") { const al = a.done ? Math.max(0, 1 - post * 2.5) : 1, kk = a.done ? 1 : k * k, L = TX - 150 + 122 * kk, R = TX + 150 - 122 * kk, T2 = FLOOR - 250 + 118 * kk, B2 = FLOOR + 40 - 38 * kk; x.globalAlpha = al; x.strokeStyle = "#22d3ee"; x.lineWidth = 1; [[L, 0, L, H], [R, 0, R, H], [0, T2, W, T2], [0, B2, W, B2]].forEach(q => { x.beginPath(); x.moveTo(q[0] + .5, q[1] + .5); x.lineTo(q[2] + .5, q[3] + .5); x.stroke(); }); x.fillStyle = "rgba(34,211,238,.12)"; x.fillRect(L, T2, R - L, B2 - T2); x.fillStyle = "#f0abfc"; x.fillRect(0, 0, W, 9); x.fillRect(0, 0, 9, H); x.fillStyle = "#111"; for (let i = 0; i < 48; i++) { x.fillRect(i * 10, 0, 1, i % 5 ? 4 : 9); x.fillRect(0, i * 10, i % 5 ? 4 : 9, 1); } text(Math.round(R - L) + " × " + Math.round(B2 - T2) + " px", clamp(TX, 60, W - 60), T2 - 4, "#22d3ee", 12, "center"); }
  else if (a.fx === "shave") { const al = a.done ? Math.max(0, 1 - post * 2) : 1; if (!a.done) { const X = a.cx + (TX - a.cx) * Math.min(1, k * 1.6), zz = k > .6 ? Math.sin(t * 60) * 10 : 0; prop(IC.clipper, X + zz, FLOOR - 124 + Math.sin(t * 50) * 2, 1, a.dir < 0, 1, a.dir * .5); if (k > .6) { for (let i = 0; i < 6; i++) prop(IC.hair, TX + Math.cos(t * 9 + i) * (16 + i * 6), FLOOR - 120 - ((t * 60 + i * 15) % 40) + i * 6, .35, false, .9, t * 5 + i); text("rè rè rè", TX, FLOOR - 150, "#fff", 13, "center"); } } }
  else if (a.fx === "anthem") { const al = a.done ? Math.max(0, 1 - (post - 2.2)) : Math.min(1, a.age * 4); if (!a.done || post < 2.5) { prop(IC.flag, a.cx - a.dir * 22, FLOOR - 96, 1.5, a.dir < 0, Math.min(1, al)); for (let i = 0; i < 5; i++) { const u = (a.age * .6 + i / 5) % 1; text(i % 2 ? "♪" : "♫", a.cx + a.dir * 20 + (TX - a.cx) * u, FLOOR - 120 + Math.sin(u * 9 + i) * 16, "#fde68a", 16, "center"); } } }
  else if (a.fx === "knit") { if (!a.done) { const X = a.cx + (TX - a.cx) * k; prop(IC.yarn, X, FLOOR - 70 + Math.sin(a.age * 20) * 16, .8, false, 1, a.age * 14); x.strokeStyle = "#dc2626"; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 20; i++) { const u = i / 20, xx = a.cx + a.dir * 30 + (X - a.cx - a.dir * 30) * u, yy = FLOOR - 80 + Math.sin(u * 14 + a.age * 20) * 12; i ? x.lineTo(xx, yy) : x.moveTo(xx, yy); } x.stroke(); text("đan · đan · đan", a.cx, FLOOR - 146, "#fca5a5", 13, "center"); } }
  else if (a.fx === "concert") { const al = a.done && a.n === 2 ? Math.max(0, 1 - post * 2) : 1; if (a.n === 2 && (!a.done || post < .5)) { x.fillStyle = `rgba(10,0,30,${.62 * al * Math.min(1, a.age * 4)})`; x.fillRect(-10, -10, W + 20, H + 20); prop(IC.truss, W / 2 - 110, 22, 2.2, false, al); prop(IC.truss, W / 2 + 110, 22, 2.2, true, al); x.save(); x.globalCompositeOperation = "lighter"; ["#f472b6", "#22d3ee", "#facc15", "#a3e635", "#f472b6"].forEach((c2, i) => { x.fillStyle = c2; x.globalAlpha = .2 * al; const bx = 50 + i * 95, tx2 = bx + Math.sin(t * 3 + i * 1.3) * 120; x.beginPath(); x.moveTo(bx, 30); x.lineTo(tx2 - 26, FLOOR); x.lineTo(tx2 + 26, FLOOR); x.fill(); }); x.restore(); for (let i = 0; i < 16; i++) prop(IC.lstick, 14 + i * 30, H - 10 - Math.abs(Math.sin(t * 6 + i)) * 12, .4, false, al, Math.sin(t * 6 + i) * .5); }
    const t0 = Math.max(0, a.wait - .28), kk = clamp((a.age - t0) / .28, 0, 1), sx2 = TX + (a.n - 1) * 26, y = a.done ? FLOOR - 96 + Math.min(1, post * 6) * 20 : -60 + (FLOOR - 96 + 60) * kk * kk; if (kk > 0 && (!a.done || post < .35)) prop(IC.speaker, sx2, y, 1.5, a.n % 2 === 1, a.done ? 1 - post * 2.6 : 1); }
  else if (a.fx === "parade") { const ci = CI(a), al = a.done ? Math.max(0, 1 - post * 1.6) : Math.min(1, a.age * 4), from = a.dir > 0 ? -70 : W + 70, to = a.dir > 0 ? W + 260 : -260, kk = clamp(a.age / (a.wait * 1.9), 0, 1), lead = from + (TX + a.dir * 30 - from) * Math.min(1, a.age / a.wait) + (a.done ? a.dir * post * 260 : 0); x.fillStyle = `rgba(60,0,0,${.35 * al})`; x.fillRect(-10, -10, W + 20, H + 20);
    prop(IC.flag, a.cx - a.dir * 26, FLOOR - 104, 1.7, a.dir < 0, al); for (let i = 0; i < 6; i++) prop(IC.firework, 40 + i * 80, 50 + (i % 2) * 34, .8 + .5 * Math.abs(Math.sin(t * 3 + i)), false, al * Math.abs(Math.sin(t * 3 + i)));
    for (let i = 2; i >= 0; i--) { const X = lead - a.dir * i * 104; prop(IC.tank, X, FLOOR - 30 + Math.sin(t * 30 + i) * 1.5, 1.7, a.dir < 0, al); prop(IC.flag, X - a.dir * 10, FLOOR - 78, .6, a.dir < 0, al); prop(IC.dust, X - a.dir * 78, FLOOR - 6, .6, false, al * .8); }
    spr(ci, 0, a.cx, FLOOR, a.from === 1, { a: al }); prop(IC.drum, a.cx + a.dir * 34, FLOOR - 16 - Math.abs(Math.sin(t * 16)) * 4, .6, false, al); if (!a.done || post < .5) text("★ DIỄU BINH ★", W / 2, 74, "#fde047", 26, "center"); }
  else if (a.fx === "cafe") { const ci = CI(a), X = a.done ? TX - a.dir * 36 : a.cx + (TX - a.dir * 36 - a.cx) * k * k, al = a.done ? Math.max(0, 1 - Math.max(0, post - .4) * 5) : 1; spr(ci, a.done ? 5 : 9, X, FLOOR - (a.done ? 0 : Math.sin(k * Math.PI) * 30), a.from === 1, { a: al });
    if (a.done) { prop(IC.phin, TX + Math.sin(t * 34) * 12, FLOOR - 132, .55, a.dir < 0, al, Math.sin(t * 34) * .3); for (let i = 0; i < 3; i++) prop(IC.cdrop, TX - 16 + i * 16, FLOOR - 118 + ((t * 60 + i * 13) % 30), .25, false, al); for (let i = 0; i < 3; i++) text("~", TX - 14 + i * 14 + Math.sin(t * 6 + i) * 3, FLOOR - 150 - ((t * 26 + i * 8) % 18), "#d6b98c", 16, "center"); } }
  else if (a.fx === "nine") { const ci = CI(a), pick = (+a.id.split(":")[1]) % 9, cy = FLOOR - 8, go = clamp((k - .72) / .28, 0, 1);
    if (!a.done) { x.fillStyle = `rgba(20,10,50,${.35 * Math.min(1, a.age * 4)})`; x.fillRect(-10, -10, W + 20, H + 20);
      const order = [...Array(9).keys()].sort((p1, p2) => Math.sin(p1 / 9 * 6.283 + t * 1.6) - Math.sin(p2 / 9 * 6.283 + t * 1.6));
      for (const i of order) { const an = i / 9 * 6.283 + t * 1.6, ex = TX + Math.cos(an) * Math.min(150, 40 + a.age * 260), ey = cy + Math.sin(an) * 22, me = i === pick && go > 0, X = clamp(me ? ex + (TX - Math.sign(Math.cos(an) || 1) * 40 - ex) * go : ex, 24, W - 24), sc = .78 + Math.sin(an) * .14;
        spr(ci, me ? 5 : Math.floor(t * 4 + i) % 2, X, ey, Math.cos(an) > 0, { s: me ? .78 + go * .22 : sc, a: me ? 1 : .55 + Math.sin(an) * .15, tint: me ? null : "rgba(255,216,74,.35)" }); if (!me && k < .72) text("?", X, ey - 108 * sc, "#fff", 14, "center"); if (me) prop(IC.rose, X + (TX - X) * .5, FLOOR - 96 - Math.sin(go * 3.14) * 20, .5, false, 1, go * 6); } }
    else for (let i = 0; i < 9; i++) prop(IC.rose, TX + Math.cos(i * .7) * post * 150, FLOOR - 84 + Math.sin(i * .7) * post * 90 + post * post * 60, .5, false, 1 - post / .6, i + post * 8); }
  else if (a.fx === "swan") {   // vịt thiên nga bay ra từ vỏ trứng, đẻ trăm trứng bắn vào đối thủ
    const C2 = F[a.from], al = a.done ? Math.max(0, 1 - post * 1.6) : Math.min(1, a.age * 3), up = Math.min(1, a.age / .5), SX = C2.x + a.dir * 6, SY = FLOOR - 96 - 62 * up + Math.sin(t * 7) * 4;
    x.fillStyle = `rgba(40,20,0,${.5 * al})`; x.fillRect(-10, -10, W + 20, H + 20); x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = `rgba(255,216,74,${.2 * al})`; for (let i = 0; i < 10; i++) { const an = t * .7 + i * .628; x.beginPath(); x.moveTo(SX, SY); x.lineTo(SX + Math.cos(an) * 520, SY + Math.sin(an) * 520); x.lineTo(SX + Math.cos(an + .16) * 520, SY + Math.sin(an + .16) * 520); x.fill(); } x.restore();
    prop(IC.swan, SX, SY, (1.2 + up * .9) * (1 + Math.sin(t * 16) * .03), a.dir < 0, al); if (!a.done && a.age < .6) for (let i = 0; i < 6; i++) prop(IC.wegg, C2.x + Math.cos(i * 1.05) * a.age * 90, FLOOR - 60 + Math.sin(i * 1.05) * a.age * 90, .3, false, 1 - a.age, i);
    if (a.age > .45) for (let i = 0; i < 40; i++) { const u = (t * (1.5 + (i % 5) * .25) + i * .171) % 1, X = SX + (TX - SX) * u + Math.sin(i * 7.3) * 30 * (1 - u), Y = SY + (FLOOR - 62 - SY) * u * u + Math.cos(i * 3.1) * 26 * (1 - u); prop(i % 9 === 0 ? IC.gegg : IC.wegg, X, Y, .26 + (i % 3) * .07, false, al, t * 9 + i); }
    if (a.done && post < .5) for (let i = 0; i < 8; i++) prop(i % 4 ? IC.wegg : IC.duckling, TX + Math.cos(i * .785) * post * 130, FLOOR - 62 + Math.sin(i * .785) * post * 130, .4, false, 1 - post * 2, i + post * 8); }
  else if (a.fx === "blizzard") { const C2 = F[a.from], al = a.done ? Math.max(0, 1 - post * 1.7) : Math.min(1, a.age * 3); x.fillStyle = `rgba(150,205,255,${.36 * al})`; x.fillRect(-10, -10, W + 20, H + 20);
    if (!a.done) { prop(IC.thermo, W / 2, 62, 1.1, false, al); text(`${Math.round(4 - 22 * k)}°C`, W / 2 + 34, 70, "#e0f2fe", 24, "left"); }
    for (let i = 0; i < 46; i++) { const u = (t * (1.1 + (i % 5) * .22) + i * .137) % 1, X = C2.x + a.dir * (20 + u * (W + 40)), Y = FLOOR - 150 + ((i * 53) % 150) + Math.sin(u * 9 + i) * 10; if (i % 4 === 0) prop(IC.snow, X, Y, .2 + (i % 3) * .1, false, al * (1 - u * .4), t * 3 + i); else { x.fillStyle = `rgba(255,255,255,${al * .8})`; x.fillRect(Math.round(X), Math.round(Y), 2 + (i % 3) * 3, 2); } }
    if (!a.done) for (let i = 0; i < 3; i++) prop(IC.coldwind, C2.x + a.dir * (40 + ((t * 260 + i * 110) % 300)), FLOOR - 50 - i * 34, 1.1, a.dir < 0, al * .85);
    else { x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = `rgba(200,235,255,${.5 * al})`; x.beginPath(); x.arc(TX, FLOOR - 70, 30 + post * 160, 0, 6.283); x.fill(); x.restore(); for (let i = 0; i < 8; i++) prop(IC.icecube, TX + Math.cos(i * .8) * post * 150, FLOOR - 70 + Math.sin(i * .8) * post * 100, .35, false, al, i + post * 6); } }
  else if (a.fx === "timeup") { const al = a.done ? Math.max(0, 1 - post * 1.7) : Math.min(1, a.age * 3), cx = W / 2, cy = 118, R = 78;
    x.fillStyle = `rgba(60,0,0,${.62 * al})`; x.fillRect(-10, -10, W + 20, H + 20); x.save(); x.globalAlpha = al; x.translate(cx + (a.done ? 0 : Math.sin(t * 50) * 2 * k), cy);
    x.fillStyle = "#000"; x.beginPath(); x.arc(0, 0, R + 5, 0, 6.283); x.fill(); x.fillStyle = "#fff5f5"; x.beginPath(); x.arc(0, 0, R, 0, 6.283); x.fill(); x.fillStyle = "#dc2626"; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R - 4, -Math.PI / 2, -Math.PI / 2 + 6.283 * k); x.fill();
    x.fillStyle = "#000"; for (let i = 0; i < 12; i++) { x.save(); x.rotate(i * Math.PI / 6); x.fillRect(-2, -R + 4, 4, i % 3 ? 8 : 15); x.restore(); } x.save(); x.rotate(6.283 * k); x.fillRect(-3, -R + 12, 6, R - 6); x.restore(); x.beginPath(); x.arc(0, 0, 7, 0, 6.283); x.fill(); x.restore();
    if (!a.done) text(String(Math.max(0, 3 - Math.floor(k * 4))), cx, cy + 22, "#fff", 64, "center"); else { text("HẾT GIỜ!", cx, cy + 16, Math.floor(t * 12) % 2 ? "#fff" : "#ffe14a", 54, "center"); x.save(); x.globalCompositeOperation = "lighter"; for (let i = 0; i < 4; i++) bolt(cx + (i - 1.5) * 50, cy, TX + (i - 1.5) * 14, FLOOR - 40, "#ff8a8a", 4 * al); x.restore(); } }
  else if (a.fx === "pray") { const ci = CI(a);
    if (a.n === 2 && !a.done) { spr(ci, 8, a.cx, FLOOR, a.from === 1, {}); prop(IC.halo, a.cx, FLOOR - 100 + Math.sin(t * 6) * 2, .6); text("xin trời…", a.cx, FLOOR - 118, "#fde68a", 13, "center"); x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = "rgba(255,240,170,.2)"; x.beginPath(); x.moveTo(TX - 14, 0); x.lineTo(TX + 14, 0); x.lineTo(TX + 50, FLOOR); x.lineTo(TX - 50, FLOOR); x.fill(); x.restore(); }
    const sd = a.n % 2 ? 1 : -1, AX = TX + sd * (150 - 96 * k), AY = -20 + (FLOOR - 150 + a.n * 16) * k; if (!a.done) prop(IC.angel, AX, AY, .8, sd > 0); else if (post < .3) { prop(IC.angel, TX + sd * 54, FLOOR - 170 + a.n * 16, .8, sd > 0, 1 - post * 3); x.save(); x.globalCompositeOperation = "lighter"; bolt(TX + sd * 44, FLOOR - 160 + a.n * 16, TX, FLOOR - 70, "#ffe9a8", 3); x.restore(); } }
  else if (a.fx === "kara") { if (!a.done) { const ci = CI(a), sx = TX - a.dir * 48, u = clamp(a.age / .4, 0, 1), X = a.cx + (sx - a.cx) * u; prop(IC.ochair, X, FLOOR - 24, .78, a.dir < 0); spr(ci, 8, X, FLOOR - 12, a.from === 1, {});
      if (u >= 1) { prop(IC.karaoke, X - a.dir * 36, FLOOR - 32, .95, a.dir < 0); prop(IC.mic, X + a.dir * 16, FLOOR - 64 + Math.sin(t * 10) * 2, .3, a.dir < 0); for (let i = 0; i < 6; i++) text("♪♫"[i % 2], X + a.dir * (20 + ((t * 70 + i * 28) % 110)), FLOOR - 84 - (i % 3) * 12 + Math.sin(t * 7 + i) * 6, ["#f472b6", "#facc15", "#22d3ee"][i % 3], 17, "center"); text(["LA LÁ LA~", "Ố Ồ Ô~", "HÁT NỮA NÈ!", "BÀI CUỐI… CHƯA!"][Math.floor(a.age * 1.6) % 4], clamp(X, 60, W - 60), FLOOR - 126, "#fff", 14, "center"); } } }
  else if (a.fx === "sketch") { const ci = CI(a), GX = clamp(a.cx, 70, W - 70), PX2 = clamp(TX - a.dir * 50, 60, W - 60), PY2 = FLOOR - 150;
    if (!a.done) { x.fillStyle = `rgba(20,10,50,${.45 * Math.min(1, a.age * 4)})`; x.fillRect(-10, -10, W + 20, H + 20); x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = "rgba(255,230,150,.16)"; x.beginPath(); x.arc(GX, FLOOR - 120, 96 + Math.sin(t * 5) * 6, 0, 6.283); x.fill(); x.restore();
      spr(ci, 5, GX, FLOOR, a.from === 1, { s: 1.55, tint: "rgba(255,225,130,.3)" }); prop(IC.halo, GX, FLOOR - 236, 1); prop(IC.gpen, GX + a.dir * 66, FLOOR - 150 + Math.sin(t * 16) * 6, 1.1, a.dir < 0, 1, Math.sin(t * 16) * .3);
      x.save(); x.translate(Math.round(PX2), PY2); x.rotate(-.06); x.fillStyle = "#000"; x.fillRect(-33, -43, 66, 86); x.fillStyle = "#f8f5e6"; x.fillRect(-31, -41, 62, 82); if (ok(SPR)) { x.globalAlpha = Math.min(1, k * 1.3); x.filter = "grayscale(1) contrast(1.6)"; x.drawImage(SPR, 190 * 0 + 60, G.chars[a.to] * CHH + 14, 70, 136, -18, -38, 39, 76); x.filter = "none"; x.globalAlpha = 1; } x.fillStyle = "#f8f5e6"; x.fillRect(-31, -41 + 82 * Math.min(1, k * 1.25), 62, 82 * (1 - Math.min(1, k * 1.25))); x.restore(); text("đứng yên, vẽ xíu!", PX2, PY2 - 50, "#fde68a", 13, "center"); }
    else { const u = post / .6; [-1, 1].forEach(sd => { x.save(); x.translate(Math.round(PX2 + sd * (10 + u * 46)), PY2 + u * u * 70); x.rotate(sd * u * 1.2); x.globalAlpha = 1 - u; x.fillStyle = "#000"; x.fillRect(-17, -43, 34, 86); x.fillStyle = "#f8f5e6"; x.fillRect(-15, -41, 30, 82); x.restore(); }); for (let i = 0; i < 6; i++) prop(IC.scrap, TX + Math.cos(i * 1.05) * u * 70, FLOOR - 80 + Math.sin(i * 1.05) * u * 50 + u * u * 40, .4, false, 1 - u, i + u * 6); x.save(); x.globalCompositeOperation = "lighter"; bolt(TX - 30, FLOOR - 140, TX + 30, FLOOR - 10, "#fff", 4 * (1 - u)); x.restore(); } }
  else if (a.fx === "mob") { if (!a.done) { const al = Math.min(1, a.age * 4); x.fillStyle = `rgba(50,0,10,${.5 * al})`; x.fillRect(-10, -10, W + 20, H + 20); const C2 = F[a.from], lines = ["Mọi người ơi…", "…nó giật chồng đó!", "CÓ CLIP LUÔN!"], li = Math.min(2, Math.floor(k * 3)); x.font = FONT(15); const bw = x.measureText(lines[li]).width + 14, bx = clamp(C2.x + C2.dir * 20, bw / 2 + 4, W - bw / 2 - 4); x.fillStyle = "#000"; x.fillRect(bx - bw / 2 - 1, FLOOR - 161, bw + 2, 24); x.fillStyle = "#fff"; x.fillRect(bx - bw / 2, FLOOR - 160, bw, 22); x.textAlign = "center"; x.fillStyle = "#7f1d1d"; x.fillText(lines[li], bx, FLOOR - 144);
      prop(IC.pencil, C2.x + C2.dir * 26, FLOOR - 112 + Math.sin(t * 14) * 3, .4, C2.dir < 0); for (let i = 0; i < 8; i++) { const sd = i % 2 ? 1 : -1, sx2 = sd > 0 ? W + 40 + i * 14 : -40 - i * 14, X = sx2 + (TX + sd * (34 + (i >> 1) * 14) - sx2) * k * k; prop(i % 4 === 3 ? IC.sandal : IC.fist, X, FLOOR - 30 - (i >> 1) * 22 - Math.abs(Math.sin(t * 12 + i)) * 6, .55, sd > 0, al); } text("⚠ DRAMA ĐÁNH GHEN ⚠", W / 2, 76, Math.floor(t * 6) % 2 ? "#ff5a5a" : "#fff", 20, "center"); } }
  else if (a.fx === "knee") { const ci = CI(a), near = a.age - a.wait; if (near > -.22 && near < .2) { const u = clamp((near + .22) / .22, 0, 1), X = TX - a.dir * (70 - 44 * u), Y = FLOOR - 40 * Math.sin(u * Math.PI * .5) - (near > 0 ? near * 60 : 0); spr(ci, 9, X, Y, a.from === 1, { rot: a.dir * .25 }); if (near > 0 && near < .12) { prop(IC.mglove, TX, FLOOR - 92, .7, a.dir < 0); x.strokeStyle = "#fff"; x.lineWidth = 2; for (let i = 0; i < 6; i++) { const an = i * 1.05; x.beginPath(); x.moveTo(TX + Math.cos(an) * 12, FLOOR - 84 + Math.sin(an) * 12); x.lineTo(TX + Math.cos(an) * 26, FLOOR - 84 + Math.sin(an) * 26); x.stroke(); } } } }
  else if (a.fx === "tea") { const sx2 = a.cx + a.dir * 40, sy2 = FLOOR - 92, al = a.done ? Math.max(0, 1 - post * 3) : 1, len = a.done ? 1 : clamp(a.age / a.wait, 0, 1); prop(IC.thaitea, a.cx + a.dir * 30, FLOOR - 100, .7, a.dir < 0, al); x.strokeStyle = `rgba(251,146,60,${al})`; x.lineWidth = 12; x.lineCap = "round"; x.beginPath(); x.moveTo(sx2, sy2); x.quadraticCurveTo((sx2 + TX) / 2, sy2 - 40, sx2 + (TX - sx2) * len, sy2 + 14 * len); x.stroke(); x.strokeStyle = `rgba(255,237,213,${al})`; x.lineWidth = 4; x.stroke(); x.lineCap = "butt"; if (a.done) for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#fb923c" : "#ffedd5"; x.globalAlpha = al; x.fillRect(TX + Math.cos(i * .8) * post * 120, FLOOR - 80 + Math.sin(i * .8) * post * 90 + post * post * 160, 4, 4); } }
  else if (a.fx === "netthrow") { if (!a.done) { const X = a.cx + (TX - a.cx) * k, Y = FLOOR - 70 - Math.sin(k * Math.PI) * 70; prop(IC.net, X, Y, .6 + k * 1.2, false, 1, a.age * 6); prop(IC.nonla, a.cx + a.dir * 2, FLOOR - 134, .7); x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 1; x.beginPath(); x.moveTo(a.cx + a.dir * 30, FLOOR - 90); x.lineTo(X, Y); x.stroke(); } }
  else if (a.fx === "bkk") { const al = a.done ? Math.max(0, 1 - post * 2) : 1; x.fillStyle = `rgba(10,20,60,${.5 * al})`; x.fillRect(-10, -10, W + 20, H + 20); prop(IC.temple, W - 46, FLOOR - 56, 1.6, false, al); prop(IC.tuktuk, 46, FLOOR - 24, 1.1, false, al); if (!a.done) { const trips = 5, ph = a.age / a.wait * trips, leg = Math.floor(ph), u = ph - leg, fwd = leg % 2 === 0, X = fwd ? -60 + (W + 120) * u : W + 60 - (W + 120) * u, Y = 60 + leg * 14 + Math.sin(u * Math.PI) * -18; x.strokeStyle = "rgba(255,255,255,.6)"; x.setLineDash([6, 5]); x.lineWidth = 2; x.beginPath(); x.moveTo(fwd ? -60 : W + 60, Y + 10); x.lineTo(X, Y + 4); x.stroke(); x.setLineDash([]); prop(IC.plane, X, Y, 1.5, !fwd); text("SGN ⇄ BKK · chuyến " + (leg + 1), W / 2, 44, "#fde68a", 16, "center"); for (let i = 0; i < 4; i++) prop(IC.ticket, (i * 120 + a.age * 90) % (W + 60) - 30, 110 + i * 22 + Math.sin(t * 5 + i) * 6, .4, false, .8, t * 2 + i); } }
  else if (a.fx === "fans") { const al = a.done ? Math.max(0, 1 - post * 1.8) : 1, kk = a.done ? 1 : k * k; prop(IC.hi, a.cx + a.dir * 14, FLOOR - 150 + Math.sin(t * 9) * 3, .8, a.dir < 0, al); if (!a.done) text("say hi~", a.cx, FLOOR - 172, "#fde68a", 14, "center"); for (let i = 0; i < 6; i++) { const side = i % 2 ? 1 : -1, sx2 = side > 0 ? W + 60 + i * 20 : -60 - i * 20, X = sx2 + (TX + side * (10 + (i >> 1) * 18) - sx2) * kk, Y = FLOOR - 26 - (a.done ? (i >> 1) * 22 : 0) - Math.abs(Math.sin(t * 14 + i)) * 8; prop(IC.fans, X, Y, 1.25, side > 0, al); } for (let i = 0; i < 6; i++) text(["♥", "AAA!", "Anh ơi!", "♥", "Kyaa!", "Hi!!"][i], (i * 83 + t * 40) % W, 70 + (i * 29) % 80, "#f9a8d4", 13, "center"); }
  else if (a.fx === "inhale") { const al = a.done ? Math.max(0, 1 - post * 2) : 1, kk = a.done ? 1 : clamp(k * 1.4, 0, 1), Y = -80 + (FLOOR - 150 + 80) * kk * kk; x.fillStyle = `rgba(6,60,40,${.45 * al * Math.min(1, a.age * 3)})`; x.fillRect(-10, -10, W + 20, H + 20); prop(IC.inhaler, TX, Y, 3, false, al, Math.sin(t * 20) * .04); if (k > .6 || a.done) { for (let i = 0; i < 10; i++) prop(IC.vapor, TX + Math.cos(t * 2 + i) * (20 + i * 12), FLOOR - 60 - ((t * 40 + i * 19) % 110), .7 + (i % 3) * .3, false, al * .75); text("bạc hà · long não · 1000%", W / 2, 72, "#a7f3d0", 16, "center"); } }
  else if (a.fx === "nobg") { x.strokeStyle = "#000"; x.lineWidth = 1; x.setLineDash([4, 4]); x.lineDashOffset = -t * 24; x.strokeRect(TX - 34.5, FLOOR - 134.5, 68, 136); x.setLineDash([]); if (!a.done || post < .5) { x.fillStyle = "#1f2937"; x.fillRect(W / 2 - 78, 62, 156, 18); text("REMOVE BACKGROUND " + Math.round(k * 100) + "%", W / 2, 76, "#fff", 14, "center"); } }
  else if (a.fx === "slash" && post >= 0 && post < .28) { const o = (a.n - 1) * 16, x0 = TX - 40 + o, y0 = FLOOR - 126, x1 = TX + 40 + o, y1 = FLOOR - 14, cx1 = TX + 50 + o, cy1 = FLOOR - 120; x.strokeStyle = "#000"; x.lineWidth = 5; x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo(cx1, cy1, x1, y1); x.stroke(); x.strokeStyle = a.red ? "#ff3b30" : "#fff"; x.lineWidth = a.red ? 3 : 2; x.stroke(); if (a.red) prop(IC.redpen, x1 + 8, y1 - 8, .45); if (a.pcl) { x.strokeStyle = "#111"; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 12; i++) x.lineTo(x0 + (x1 - x0) * i / 12 + Math.sin(i * 2.1 + a.n) * 12, y0 + (y1 - y0) * i / 12 + Math.cos(i * 1.7) * 8); x.stroke(); prop(IC.pencil, x1 + 8, y1 - 8, .5); } if (a.pen) { x.strokeStyle = "#38bdf8"; x.lineWidth = 1; x.beginPath(); x.moveTo(x0, y0); x.lineTo(cx1, cy1); x.stroke(); [[x0, y0], [x1, y1], [cx1, cy1]].forEach(q => { x.fillStyle = "#fff"; x.fillRect(q[0] - 3, q[1] - 3, 6, 6); x.strokeRect(q[0] - 3.5, q[1] - 3.5, 7, 7); }); prop(IC.pen, x1 + 8, y1 - 6, .4); } }
  x.restore();
}
function hud() {
  [0, 1].forEach(i => { const p = F[i], bw = 190, bx = i ? W - 14 - bw : 14, r = p.hp / p.max;
    x.fillStyle = "#000"; x.fillRect(bx - 2, 12, bw + 4, 12); x.fillStyle = "#3a0d0d"; x.fillRect(bx, 14, bw, 8);
    const lw = bw * p.lag, hw = bw * r; x.fillStyle = "#fff"; x.fillRect(i ? bx : bx + bw - lw, 14, lw, 8); x.fillStyle = r < .3 ? "#ff3b30" : "#ffd21f"; x.fillRect(i ? bx : bx + bw - hw, 14, hw, 8);
    x.fillStyle = "#000"; x.fillRect(i ? W - 14 - 62 : 12, 24, 64, 4); x.fillStyle = p.guard < 36 ? "#ff8a7a" : "#7fd4ff"; const gw = 60 * Math.max(0, p.guard) / 100; x.fillRect(i ? W - 14 - gw : 14, 25, gw, 2);
    text(G.names[i].toUpperCase().slice(0, 26), i ? W - 14 : 14, 35, i === G.ME ? "#ffe680" : "#fff", 14, i ? "right" : "left");
    if (!p.ai) { x.fillStyle = "#000"; x.fillRect(i ? W - 14 - 122 : 12, 39, 124, 7); x.fillStyle = "#0d2440"; x.fillRect(i ? W - 14 - 120 : 14, 41, 120, 3); const full = p.mp >= 100; x.fillStyle = full ? (Math.floor(G.t * 8) % 2 ? "#ffe14a" : "#fff") : "#3aa0ff"; const mw = 120 * p.mp / 100; x.fillRect(i ? W - 14 - mw : 14, 41, mw, 3); if (i === G.ME) text(full ? (G.sub === "test" ? "NỘ ĐẦY" : "NỘ ĐẦY! DÙNG NGAY " + Math.max(0, FULL_HOLD - (p.fullT || 0)).toFixed(1) + "s") : "NỘ " + Math.floor(p.mp), i ? W - 14 : 14, 56, full ? "#ffe14a" : "#7fd4ff", 12, i ? "right" : "left"); } });
  x.fillStyle = "#000"; x.fillRect(W / 2 - 17, 9, 34, 18); x.fillStyle = "#c81e1e"; x.fillRect(W / 2 - 15, 11, 30, 14); text("KO", W / 2, 23, "#fff", 16, "center");
  text(G.sub === "tour" ? `${G.lvo.boss ? "BOSS CUỐI" : `TRẬN ${G.tour.s + 1}/${G.tour.order.length}`} · ${G.tour.score}đ` : G.sub === "test" ? "TẬP LUYỆN" : `HIỆP ${G.round}  ${G.score[0]}-${G.score[1]}`, W / 2, 50, "#fff", 13, "center");
  if (G.hits > 1) text(G.hits + " HIT", G.ME ? W - 20 : 20, 78, "#ffe14a", 22, G.ME ? "right" : "left");
  const ks = G.keys.filter(k => G.t - k.t < 1.6).map(k => LB[k.k] || k.k).join(" › "); if (ks) text(ks, 10, H - 6, "#9fd8ff", 14);
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
  if (G.ally && F[1]) { const al = G.ally, b = F[1], ax = allyX(), fr = b.ko ? 11 : al.act > .9 ? 4 : al.act > 0 ? 5 : Math.floor(G.t * 3) % 2; x.fillStyle = "rgba(0,0,0,.25)"; x.beginPath(); x.ellipse(ax, FLOOR + 1, 22, 4, 0, 0, 6.283); x.fill(); spr(al.ci, fr, ax, FLOOR, true, { s: .88, tint: al.act > 0 ? null : "rgba(120,0,0,.35)" }); if (!b.ko) text(CH[al.ci].name.split(" ")[0] + " (bị dí)", ax, FLOOR - 118, "#fca5a5", 11, "center"); }
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
let prev = performance.now(), lastSend = 0, lastUi = 0;
function loop(now) {
  requestAnimationFrame(loop); let dt = Math.min(.05, (now - prev) / 1000); prev = now;
  if (!$("game").classList.contains("on") || !F.length) return;
  if (G.stop > 0) { G.stop -= dt; dt = 0; }
  if (dt > 0) update(dt);
  if (now - lastUi > 150) { lastUi = now; const mp = F[G.ME].mute > 0 ? -1 : F[G.ME].mp; document.querySelectorAll("#spells .sk").forEach(b => b.classList.toggle("no", mp < +b.dataset.mp)); }
  if (G.mode === "pvp" && now - lastSend > 33) { lastSend = now; const p = F[G.ME]; send({ t: "s", x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, mp: Math.round(p.mp), f: frameOf(p), sh: +p.shield.toFixed(2), bg: +p.big.toFixed(2), bk: p.bigK, gi: +p.giant.toFixed(2), np: +p.nap.toFixed(2), mu: +p.mute.toFixed(1), sm: +p.smoke.toFixed(2), rd: p.ride, fx: p.flyX == null ? null : Math.round(p.flyX), iv: p.inv > 0 ? 1 : 0, cr: p.crouch ? 1 : 0, c: p.ctrl ? [p.ctrl.k, +p.ctrl.t.toFixed(2), 0, p.ctrl.lb, p.ctrl.ic] : null, ko: p.ko ? 1 : 0 }, false); }
  render(); if (G.cut) drawCut();
}
requestAnimationFrame(loop);

/* ======================= MẠNG: 2 NGƯỜI CHƠI ======================= */
function onMsg(m) {
  if (!m || !m.t) return;
  if (m.t === "hello") { if (net.host) send({ t: "hello" }); onConnected(); return; }
  if (m.t === "ping") return send({ t: "pong", ts: m.ts });
  if (m.t === "pong") { const r = performance.now() - m.ts; net.rtt = net.rtt ? net.rtt * .7 + r * .3 : r; $("pingTx").textContent = (net.mode === "relay" ? "RELAY " : "P2P ") + Math.round(net.rtt) + " ms"; return; }
  if (m.t === "ready") { G.oppReady = true; if (m.name) G.oppName = String(m.name).slice(0, 12); G.oppCh = clamp(m.ch | 0, 0, NPC - 1); (net.host ? $("p2St") : $("p1St")).textContent = "Sẵn sàng ✓ · " + CH[G.oppCh].name; return maybeStart(); }
  if (m.t === "go") return startMatch("pvp", 0, m.ch);
  const o = F[1 - G.ME]; if (!o || G.mode !== "pvp") return;
  if (m.t === "s") { o.x += (m.x - o.x) * .6; o.y = m.y; o.hp = m.hp; o.mp = m.mp; o.rf = m.f; o.shield = m.sh; o.big = m.bg; o.bigK = m.bk; o.giant = m.gi || 0; o.nap = m.np || 0; if (m.mu !== undefined) o.mute = m.mu; o.smoke = m.sm; o.ride = m.rd; o.flyX = m.fx; o.fly = m.fx == null ? 0 : .1; o.inv = m.iv ? .1 : 0; o.crouch = !!m.cr; o.ctrl = m.c ? mkCtrl(m.c) : null; return; }
  if (m.t === "b") return doBasic(1 - G.ME, m.k, false);
  if (m.t === "c") return doCast(1 - G.ME, m.s, false);
  if (m.t === "res") { const j = ATK.findIndex(a => a.id === m.aid), a = j >= 0 ? ATK[j] : null; if (a && a.p) ATK.splice(j, 1); if (m.res.to === undefined) m.res.to = 1 - G.ME; showRes(m.res, a); return; }
  if (m.t === "reset") { if (net.host) resetMatch(); return; }
  if (m.t === "round") { G.round = m.n; G.score = m.sc; return newRound(); }
}
function resetMatch() {                                   // đấu lại từ hiệp 1, tỉ số 0-0
  if (G.sub === "tour") return startTour(G.tour.me);
  if (G.mode === "ai") return startMatch("ai", G.lvl, G.chars, G.sub);
  if (G.mode !== "pvp") return;
  if (!net.host) return send({ t: "reset" });
  G.round = 1; G.score = [0, 0]; send({ t: "round", n: 1, sc: [0, 0] }); newRound();
}
function setReady() { me.ready = true; $("bReady").disabled = true; $("bReady").textContent = "Đã sẵn sàng – chờ đối thủ…"; (net.host ? $("p1St") : $("p2St")).textContent = "Sẵn sàng ✓ · " + CH[me.ch].name; send(readyMsg()); maybeStart(); }
function maybeStart() { if (me.ready && G.oppReady && net.host) { const ch = [me.ch, G.oppCh]; send({ t: "go", ch }); startMatch("pvp", 0, ch); } }
function banner(t, sub) { $("lobbyErr").textContent = t + (sub ? " – " + sub : ""); if (t === "MẤT KẾT NỐI") { $("netBar").textContent = "Mất kết nối với đối thủ"; $("netBar").style.display = "block"; } }

/* ======================= LƯU KẾT QUẢ (trên máy này) ======================= */
function goHome() { show("home"); G.mode = ""; G.sub = ""; F = []; $("tourBox").className = ""; $("homeStats").textContent = statLine(); }
function tourBox(title, sub, btns) { G.phase = "end"; const el = $("tourBox"); el.innerHTML = `<h2>${title}</h2><p>${sub}</p>` + btns.map((b, i) => `<button class="btn${i ? " b3" : ""}">${b[0]}</button>`).join(""); el.querySelectorAll("button").forEach((b, i) => b.onclick = btns[i][1]); el.className = "on"; }
function startTour(ci) { const order = CH.map((c, i) => i).filter(i => i !== ci && i < NPC); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } order.push(BOSS); G.tour = { me: ci, order, s: 0, score: 0, t0: Date.now() }; startMatch("ai", 0, [ci, order[0]], "tour"); }
function tourNext() {
  const T = G.tour, n = T.order.length, again = ["Đấu giải mới", () => startTour(T.me)], out = ["Thoát", goHome];
  const rank = ["Bảng xếp hạng", () => openRank()];
  if (G.loser === 0) { sendScore(false); const sc = T.score; return tourBox("GAME OVER", `Thua ${chOf(1).name} ở trận ${T.s + 1}/${n} · ${sc} điểm. Đấu lại thì còn nửa điểm.`, [["Đấu lại trận này", () => { T.score = Math.floor(sc / 2); startMatch("ai", 0, [T.me, T.order[T.s]], "tour"); }], again, rank, out]); }
  T.score += 100 * (T.s + 1) + Math.round(F[0].hp); T.s++; try { const k = "hmwiz-stats", s = JSON.parse(localStorage.getItem(k) || "{}"); s.tour = s.tour || { best: 0, champ: 0 }; s.tour.best = Math.max(s.tour.best, T.s); if (T.s >= n) s.tour.champ++; localStorage.setItem(k, JSON.stringify(s)); } catch {}
  if (T.s >= n) { sendScore(true); T.s = n - 1; return tourBox("VÔ ĐỊCH!", `${CH[T.me].name} thắng cả ${n} trận. Điểm: ${T.score}.`, [rank, again, out]); }
  startMatch("ai", 0, [T.me, T.order[T.s]], "tour");
}
/* ======================= BẢNG XẾP HẠNG TOURNAMENT ======================= */
function myPid() { try { let p = localStorage.getItem("agc-pid"); if (!p) { p = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("agc-pid", p); } return p; } catch { return "anon-" + Math.random().toString(36).slice(2, 12); } }
function sendScore(champ) {
  const T = G.tour, wins = champ ? T.order.length : T.s, row = { n: me.name || "Vô danh", c: T.me, score: T.score, wins, champ: champ ? 1 : 0, dur: Math.round((Date.now() - T.t0) / 1000) };
  if (!row.score) return;
  try { const l = JSON.parse(localStorage.getItem("agc-top") || "[]"); l.push({ ...row, at: Date.now() }); l.sort((a, b) => b.score - a.score); localStorage.setItem("agc-top", JSON.stringify(l.slice(0, 20))); } catch {}
  fetch("/api/agc/scores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pid: myPid(), ...row }) }).catch(() => {});
}
async function openRank() {
  show("rank"); scrollTo(0, 0); const el = $("rankBody"), esc = t => String(t).replace(/[<>&]/g, "");
  const draw = (rows, note) => { el.innerHTML = (note ? `<p class="muted">${note}</p>` : "") + (rows.length ? `<table><tr><th>#</th><th>Người chơi</th><th>Nhân vật</th><th>Điểm</th><th>Thắng</th></tr>` + rows.map((r, i) => `<tr${r.me ? ' class="me"' : ""}><td>${i + 1}</td><td>${esc(r.name)}</td><td>${CH[r.ch] ? CH[r.ch].name : "?"}</td><td><b>${r.score}</b></td><td>${r.champ ? "🏆 " : ""}${r.wins}/${NPC}</td></tr>`).join("") + "</table>" : `<p class="muted">Chưa có ai ghi điểm. Vào Tournament để mở bảng.</p>`); };
  el.innerHTML = `<p class="muted">Đang tải…</p>`;
  try { const r = await fetch("/api/agc/leaderboard?pid=" + myPid(), { cache: "no-store" }), j = await r.json(); if (!j.ok) throw 0; draw(j.rows, ""); }
  catch { let l = []; try { l = JSON.parse(localStorage.getItem("agc-top") || "[]"); } catch {} draw(l.map(r => ({ name: r.n, ch: r.c, score: r.score, wins: r.wins, champ: r.champ, me: 1 })), "Chưa gọi được máy chủ. Dưới đây là điểm lưu trên máy này."); }
}
function saveResult(win) { if (G.mode === "ai") return; try { const k = "hmwiz-stats", s = JSON.parse(localStorage.getItem(k) || "{}"), key = G.mode === "ai" ? "lv" + (G.lvl + 1) : "pvp"; s[key] = s[key] || { w: 0, l: 0 }; s[key][win ? "w" : "l"]++; localStorage.setItem(k, JSON.stringify(s)); } catch {} }
function statLine() { try { const s = JSON.parse(localStorage.getItem("hmwiz-stats") || "{}"), t = s.tour, p = s.pvp; return `Tournament: ${t ? "xa nhất " + t.best + " trận thắng · vô địch " + t.champ + " lần" : "chưa đấu"} · Đấu đôi: ${p ? p.w + " thắng / " + p.l + " thua" : "chưa đấu"}`; } catch { return ""; } }

/* ======================= GIAO DIỆN ======================= */
try { me.name = localStorage.getItem("hmwiz-name") || ""; me.ch = clamp(+localStorage.getItem("hmwiz-ch") || 0, 0, NPC - 1); } catch {}
document.querySelectorAll(".inName").forEach(el => { el.value = me.name; el.oninput = () => { me.name = el.value.trim().slice(0, 12); document.querySelectorAll(".inName").forEach(o => { if (o !== el) o.value = el.value; }); try { localStorage.setItem("hmwiz-name", me.name); } catch {} }; });
$("homeStats").textContent = statLine();
const FACE = [98, 98, 97, 96, 96, 96, 97, 98, 97, 94, 96, 93, 101, 96, 90];   // tâm khuôn mặt (x) trong khung đứng yên của từng nhân vật
const card = (c, i) => `<button class="chr" data-c="${i}" style="--c:${c.col}"><i style="background-position:calc(var(--t) * ${-((FACE[i] || 96) - 17) / 34}) calc(var(--t) * ${-(i * 150 + 19) / 34})"></i><b>${c.name.split(" ")[0]}</b><em></em></button>`;
/* chọn nhân vật đấu máy: chạm lần 1 = bạn, lần 2 = máy */
const pick = { a: -1, b: -1, mode: "test", passive: true };
$("pickGrid").innerHTML = CH.slice(0, NPC).map(card).join("") + `<button class="chr rnd" data-c="-1"><i></i><b>Bất kỳ</b><em></em></button>`;
function drawPick() {
  const tour = pick.mode === "tour", n = NPC - 1;
  $("pickTitle").textContent = tour ? "TOURNAMENT" : "TEST NHÂN VẬT";
  document.querySelectorAll("#pickGrid .chr").forEach((b, i) => { b.classList.toggle("p1", i === pick.a); b.classList.toggle("p2", i === pick.b); b.querySelector("em").textContent = (i === pick.a ? "BẠN" : "") + (i === pick.a && i === pick.b ? " + " : "") + (i === pick.b ? "MÁY" : ""); });
  [["postA", pick.a], ["postB", pick.b]].forEach(([id, ci]) => { const el = $(id); el.classList.toggle("empty", ci < 0); el.style.setProperty("--c", ci < 0 ? "#555" : CH[ci].col); el.querySelector("i").style.backgroundPosition = ci < 0 ? "0 9999px" : `-40px ${-ci * 150}px`; el.querySelector("u").style.backgroundPosition = ci < 0 ? "0 9999px" : `${ci * 100 / (NPC - 1)}% 0`; el.querySelector("b").textContent = ci < 0 ? "?" : CH[ci].name.toUpperCase(); el.querySelector("b").style.fontSize = ci >= 0 && CH[ci].name.length > 11 ? "15px" : ci >= 0 && CH[ci].name.length > 8 ? "18px" : ""; el.querySelector("small").textContent = ci < 0 ? "" : CH[ci].role.split(" · ").pop(); });
  if (tour) { $("postB").querySelector("b").textContent = n + " ĐỐI THỦ + BOSS"; $("postB").querySelector("small").textContent = "khó dần từng trận"; }
  $("pickTip").textContent = pick.a < 0 ? "Chạm để chọn nhân vật của BẠN" : tour ? `Bạn là ${CH[pick.a].name}. Đấu lần lượt ${n} nhân vật còn lại, thứ tự ngẫu nhiên, trận sau khó hơn trận trước. Thắng hết thì gặp BOSS CUỐI` : pick.b < 0 ? `Bạn là ${CH[pick.a].name}. Giờ chọn nhân vật làm ĐỐI THỦ` : `${CH[pick.a].name} đấu ${CH[pick.b].name}. Chạm nhân vật bất kỳ để chọn lại`;
  $("pickInfo").innerHTML = pick.a < 0 ? "" : `<b style="color:${CH[pick.a].col}">${CH[pick.a].name}</b> · ${CH[pick.a].tag}<br>S: ${CH[pick.a].F.n} · D: ${CH[pick.a].G.n} · Tối thượng: ${CH[pick.a].sp[7].n}`;
  $("lvPick").style.display = tour ? "none" : ""; $("tourName").style.display = tour ? "" : "none"; document.querySelectorAll("#lvPick button").forEach((b, i) => b.classList.toggle("on", (i === 0) === pick.passive));
  $("bFight").disabled = pick.a < 0 || (!tour && pick.b < 0); $("bFight").textContent = tour ? "VÀO GIẢI" : "VÀO TẬP";
}
document.querySelectorAll("#pickGrid .chr").forEach(b => b.onclick = () => { const i = +b.dataset.c < 0 ? Math.floor(Math.random() * NPC) : +b.dataset.c; if (pick.mode === "tour" || pick.a < 0 || pick.b >= 0) { pick.a = i; pick.b = -1; } else pick.b = i; drawPick(); });
$("lvPick").innerHTML = `<button><b>Bao cát</b><small>Đối thủ đứng yên, 300 HP</small></button><button><b>Đánh trả</b><small>Đối thủ đánh như Senior</small></button>`;
document.querySelectorAll("#lvPick button").forEach((b, i) => b.onclick = () => { pick.passive = i === 0; drawPick(); });
$("bRank").onclick = openRank;
const openPick = m => { pick.mode = m; pick.a = -1; pick.b = -1; drawPick(); show("pick"); scrollTo(0, 0); };
$("bTest").onclick = () => openPick("test"); $("bTour").onclick = () => openPick("tour");
$("bDuo").onclick = () => { $("duoBox").hidden = !$("duoBox").hidden; $("bDuo").classList.toggle("on", !$("duoBox").hidden); };
$("bFight").onclick = () => { me.ch = pick.a; try { localStorage.setItem("hmwiz-ch", me.ch); } catch {} if (pick.mode === "tour") return startTour(pick.a); G.passive = pick.passive; startMatch("ai", 1, [pick.a, pick.b], "test"); };
/* chọn nhân vật trong phòng 2 người */
$("roomGrid").innerHTML = CH.slice(0, NPC).map(card).join("");
const drawRoomPick = () => document.querySelectorAll("#roomGrid .chr").forEach((b, i) => { b.classList.toggle("p1", i === me.ch); b.querySelector("em").textContent = i === me.ch ? "BẠN" : ""; });
document.querySelectorAll("#roomGrid .chr").forEach(b => b.onclick = () => { if (me.ready) return; me.ch = +b.dataset.c; try { localStorage.setItem("hmwiz-ch", me.ch); } catch {} drawRoomPick(); });
drawRoomPick();
$("bCreate").onclick = createRoom; $("bJoin").onclick = () => joinRoom($("inCode").value); $("inCode").onkeydown = e => { if (e.key === "Enter") joinRoom($("inCode").value); };
$("bReady").onclick = setReady;
document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { if (b.dataset.go === "home" && (G.mode === "pvp" || net.connected)) return location.reload(); if (b.dataset.go === "home") return goHome(); show(b.dataset.go); });
$("bReset").onclick = resetMatch;
// màn mở đầu: dải nhân vật chạy ngang
$("roster").innerHTML = [0, 1].map(() => CH.slice(0, NPC).map((c, i) => `<div class="rost" style="--c:${c.col}"><u style="background-position:${i * 100 / (NPC - 1)}% 0"></u><i style="background-position:-40px ${-i * 150}px"></i><b>${c.name.toUpperCase()}</b><small>${c.role.split(" · ").pop()}</small></div>`).join("")).join("");
$("bSound").onclick = () => { G.sound = !G.sound; $("bSound").textContent = G.sound ? "🔊 Âm thanh" : "🔇 Tắt tiếng"; };
// nút cảm ứng: giữ được
document.querySelectorAll("[data-k]").forEach(b => { const k = b.dataset.k, down = e => { e.preventDefault(); b.classList.add("on"); if (KEY[k] !== undefined) { KEY[k] = 1; dirIn(k); } else press(k); }, up = e => { e.preventDefault(); b.classList.remove("on"); if (KEY[k] !== undefined) KEY[k] = 0; }; b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up); b.addEventListener("contextmenu", e => e.preventDefault()); });
// bảng 8 skill của một nhân vật (trang chơi: chạm để ra chiêu; trang hướng dẫn: để tra)
function spellHTML(ci, tap) { return `<div class="spg">` + CH[ci].sp.map((s, i) => `<button class="sp t${s.t}" ${tap ? `data-sp="${i}"` : "disabled"}><span class="ks">${kshow(s.k, " › ")} · ${TIER[s.t].mp} MP</span><b>${s.n}</b><small>${s.b ? (s.m ? s.m + " × " : "") + Math.round((s.fixed ? s.b : s.b * TIER[s.t].k) * CUT[s.t]) + " sát thương · " : ""}${s.d}</small></button>`).join("") + "</div>"; }
$("guideSpells").innerHTML = CH.slice(0, NPC).map((c, i) => `<h3 style="color:${c.col}">${c.name} · ${c.role}</h3><p>${c.tag}. Đòn S: ${c.F.n}. Đòn D: ${c.G.n}.</p>` + spellHTML(i, false)).join("");
window.__wz = { G, CH, doCast, get F() { return F; }, get ATK() { return ATK; }, press, tapSpell, startMatch, startTour, openRank, lv, MUS, net, setReady, KEY, pick };
