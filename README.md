# HandMagination

**Link app:** https://vmltestlab.netlify.app/

Tạo dáng bằng bàn tay trước camera → app đồ lại hình bóng bàn tay → Claude tưởng tượng nó giống thứ gì và viết lời chúc → AI vẽ thành poster đồ hoạ hiện đại (từ khoá lời chúc to nhất, chữ rải rác).

Luồng chỉ 2 bước: **Scan tay → Ra hình**. Trong lúc chờ có màn hình động. Nút ⚙ là khu quản lý (xem prompt, tự xếp chữ, logo, khung).

> Tính năng "cụng bia 333" (nhận diện lon, train SKU) đã được cất đi: code vẫn còn trong `public/index.html`, đặt `HAND_ONLY = false` để bật lại.

## Ứng dụng con `/tech/`

`public/tech/index.html` – camera theo dõi 2 bàn tay theo thời gian thực, chạy hoàn toàn trên trình duyệt (không gọi API):
- **Tay trái → bông hoa**: mỗi đầu ngón là một cánh hoa, xoè tay hoa nở, nắm tay thành nụ; thân và lá đung đưa.
- **Tay phải → vũ công**: ngón trỏ và ngón út là hai tay, ngón giữa vẽ dải lụa, ngón áp út làm váy xoè, chân nhảy theo nhịp và tốc độ di chuyển.
- **5 combo** (bảng hướng dẫn trên màn hình, sáng lên + ✓ khi mở khoá):
  1. 🌸 Nở hoa – tay trái nắm rồi xoè nhanh
  2. 🌀 Xoay vũ điệu – tay phải xoay cổ tay nửa vòng
  3. 💞 Trao hoa – đưa hai bàn tay sát nhau
  4. 🎆 Pháo hoa – xoè cả hai tay giơ cao
  5. ✌️ Chiến thắng – cả hai tay làm chữ V
- Chụm ngón: hoa rắc cánh, vũ công rắc sao. Xoè đẩy / nắm hút mảng hình nền.
- Nút ⇄ đổi tay trái/phải nếu camera nhận ngược; chế độ demo tự diễn các combo.

## Game `/combat/`

`public/combat/index.html` – đối kháng thời gian thực 2 máy qua mã phòng 4 ký tự.
- **Kết nối**: ưu tiên WebRTC peer-to-peer (PeerJS tự host, nhiều STUN + TURN PeerJS). Nếu sau ~6,5 giây không nối thẳng được (NAT 4G…) hoặc máy chủ ghép phòng lỗi → **tự chuyển sang chuyển tiếp** qua máy chủ MQTT công cộng (WebSocket: HiveMQ → EMQX → Mosquitto, `mqtt.min.js` tự host). Phòng chờ hiện bảng chẩn đoán; HUD hiện `P2P`/`RELAY` + ping.
- **TURN riêng (tuỳ chọn, khuyên dùng cho sự kiện)**: đặt `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN` (Cloudflare Realtime TURN) trên Netlify, `/api/ice` sẽ cấp thêm TURN để P2P nối được qua 4G. Kênh `state` không gửi lại (vị trí ~45 lần/giây), kênh `event` chắc chắn (đòn đánh, KO). Nhân vật của mình phản hồi tức thì; đối thủ được dự đoán theo vận tốc để bù trễ. Hiển thị ping.
- **Điều khiển**: tay trái = joystick (sang trái/phải để chạy, giơ nhanh lên để nhảy, nắm để đỡ). Tay phải = ra đòn: ✊ + đẩy nhanh: Đấm (0⚡) · ✌️ + vung: Chém (15⚡) · ✋ + đẩy: Chưởng bay (30⚡) · ☝️ giữ 0,5s: Tuyệt chiêu (100⚡).
- **Ống năng lượng**: tự nạp theo thời gian, +7 khi đánh trúng, +4 khi bị đánh; đầy thì phát sáng "TUYỆT CHIÊU SẴN SÀNG".
- Máu 100, đồng hồ 99 giây, K.O. / hết giờ, đấu lại. Có bảng hướng dẫn thao tác, camera nhỏ hiển thị khung xương tay.
- Dự phòng: bàn phím (A D W S J K L U) / nút bấm trên màn hình; chế độ **tập với máy**.
- Test 2 tab trên 1 máy: mở `/combat/#local` ở hai cửa sổ.

## Cấu trúc

| Thư mục / file | Vai trò |
|---|---|
| `public/index.html` | Toàn bộ giao diện + logic trên trình duyệt (MediaPipe, camera, train SKU, shape guide, poster) |
| `netlify/edge-functions/analyze.js` | `POST /api/analyze` – gọi Claude (Anthropic API) để nhận diện lon 333, cú cụng, liên tưởng, lời chúc |
| `netlify/edge-functions/paint.js` | `POST /api/paint` – tải shape guide lên Higgsfield và gửi yêu cầu vẽ |
| `netlify/edge-functions/status.js` | `GET /api/status?id=` – hỏi trạng thái tranh |
| `netlify/edge-functions/image.js` | `GET /api/image?url=` – lấy tranh về cùng tên miền để ghép poster |
| `netlify/lib/shared.js` | Hàm dùng chung (đọc biến môi trường, mã truy cập, gọi Higgsfield) |

API key chỉ nằm trên Netlify (biến môi trường), không bao giờ gửi xuống trình duyệt.

## Biến môi trường trên Netlify

| Tên | Bắt buộc | Giá trị |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✔ | Key `sk-ant-...` từ console.anthropic.com |
| `HIGGSFIELD_API_KEY` | ✔ | Nguyên chuỗi API key copy từ open.higgsfield.ai (dán y nguyên, không thêm chữ `Key`) |
| `GEMINI_API_KEY` | tuỳ chọn | Key từ aistudio.google.com. Khi có biến này, app vẽ tranh bằng **Nano Banana Pro** (`gemini-3-pro-image`) thay cho Higgsfield |
| `GEMINI_IMAGE_MODEL` | tuỳ chọn | Mặc định `gemini-3-pro-image`. Muốn rẻ/nhanh hơn: `gemini-3.1-flash-image` (Nano Banana 2) |
| `GEMINI_IMAGE_SIZE` | tuỳ chọn | `1K`, `2K` (mặc định) hoặc `4K` |
| `IMAGE_PROVIDER` | tuỳ chọn | Đặt `higgsfield` để quay lại Higgsfield dù đã có GEMINI_API_KEY |
| `APP_PASSCODE` | tuỳ chọn | Chỉ dùng để khoá trang kiểm tra `/api/diag?pass=…`. App chính mở công khai, không hỏi mã. |
| `ANTHROPIC_MODEL` | tuỳ chọn | Mặc định `claude-sonnet-5-5` |
| `HIGGSFIELD_MODEL` | tuỳ chọn | Đường dẫn model Higgsfield, mặc định `xai/grok-imagine-image-2.0` (nhận ảnh tham chiếu). Có thể thử `ideogram/v4.0`. |

Sau khi thêm/sửa biến: **Deploys → Trigger deploy → Deploy site**.

## Cách dùng

1. **① Train SKU**: thêm 10–30 ảnh cho mỗi SKU 333 và ảnh bia khác vào lớp "Không phải 333", bấm *Train & đánh giá*. Dữ liệu lưu trên trình duyệt của máy đó; dùng *Xuất / Nhập dữ liệu train* để chuyển sang máy khác (vd máy ở booth).
2. **Giao diện chính**: chọn Dáng tay / Cụng lon → Bắt đầu scan → app tự nhận diện, tự tạo hình, hiện màn chờ động → ra poster (Lưu / Chia sẻ / Tạo lại). Train SKU và tuỳ chỉnh nằm trong nút ⚙.
3. **② Kiểm tra ảnh (trong ⚙)** – chọn chế độ:
   - **🍻 Cú cụng lon**: đọc hình dáng các lon đang cụng.
   - **🤟 Hình bàn tay**: tạo dáng bằng tay (chim, tim, hươu, hoa…) và giữ yên 1 giây; app đồ lại hình bóng bàn tay, Claude tưởng tượng nó giống thứ gì, Higgsfield vẽ thành tranh.
   - **🎥 Mở camera trực tiếp**: app theo dõi tay + lon, tự chụp đúng lúc các lon chạm nhau (hoặc bấm *📸 Chụp* / *⏱️ 3s*). Bật *Tự vẽ tranh* để tự gửi Higgsfield ngay.
   - Hoặc tải ảnh lên / chụp ảnh.
3. App hiện: kết quả nhận diện từng lon, shape guide, ý tưởng liên tưởng, prompt gửi Higgsfield, bản nháp và tranh hoàn chỉnh. Bấm *Lưu tranh* để tải về.

Camera chỉ chạy trên HTTPS (link `*.netlify.app` đã là HTTPS).

## Chạy thử trên máy

```bash
npm i -g netlify-cli
netlify dev        # cần file .env chứa các biến ở trên
```

## Game `/combatNew/` – Boxing bằng cả người

`public/combatNew/index.html` – đấm bốc 2 máy, 2 võ sĩ đứng 2 góc trái (XANH, chủ phòng) – phải (ĐỎ), nhìn ngang xoay 3/4.

- MediaPipe **PoseLandmarker** lấy `worldLandmarks` (mét, 3D, gốc giữa hông) → hệ cơ thể L (trái thật của người chơi) / F (phía trước) / U (lên). Không lật gương dữ liệu; điểm 11/13/15 luôn là vai/khuỷu/cổ tay TRÁI. Găng hiển thị chữ **T/P**; nút "⇄ đảo trái/phải" cho máy có camera tự lật ảnh.
- Chống giật: model `pose_landmarker_full` (tự hạ xuống `lite` nếu máy xử lý >42 ms/khung), chỉ xử lý khung hình mới, 2 tầng lọc One-Euro (đứng yên lọc mạnh, đánh nhanh lọc nhẹ), giữ điểm bị khuất, nội suy 60 fps cho võ sĩ của mình, bộ đệm nội suy ~50–140 ms cho tư thế đối thủ nhận qua mạng. Đòn chỉ tính khi nắm đấm đi ≥ 14 cm và ≥ 1,6 m/s.
- Bù độ sâu khi đấm thẳng về camera: biết chiều dài bắp tay/cẳng tay → độ sâu = √(dài² − hình chiếu²).
- Đòn nhận theo vận tốc nắm đấm: thẳng (tiến tới), móc (ngang, vào trong, khuỷu cao), móc ngược (lên), song chưởng (2 tay chập đẩy, 100⚡). Nâng 2 tay lên thủ không tính là đòn.
- Trúng/đỡ/né = **va chạm 3D thật**: đường đi của nắm đấm so với đầu (cầu), thân (khối trụ), cẳng tay + găng của đối thủ (đỡ). Bên bị đánh kiểm tra lại với tư thế hiện tại của mình rồi trả kết quả.
- Khi ra đòn thân xoay theo tay đánh; trúng đòn đầu giật ra sau.
- Gửi tư thế 11 điểm (cm) ~33 Hz. Mạng dùng chung với `/combat/` (PeerJS + Cloudflare TURN + MQTT relay).
- **Tập tư thế** (nút 🎯 ở sảnh): không cần đối thủ, hình nộm đứng yên + khung huấn luyện 13 bài (thủ thế, thẳng/móc/móc ngược từng tay, né trái/phải, cúi, đỡ & né đòn thật của hình nộm, combo), báo máy nhận đòn gì, tay nào, tốc độ m/s; sau đó tập tự do.
- Test: `/combatNew/#local` 2 cửa sổ, hoặc "Đấu thử với võ sĩ máy" (máy tự nâng thủ / lắc né bằng chính cơ thể).

## App `/move/` – cơ thể thành tranh

`public/move/index.html` – camera đọc cả người (MediaPipe PoseLandmarker full → lite nếu máy chậm), vẽ một hình người bằng mảng màu in lụa cử động theo, tay chân để lại vệt màu, bàn tay là bông hoa, vườn hoa quanh viền nở khi lại gần, bước chân mọc hoa, nền đổi theo năng lượng chuyển động.

- Chống giật: lọc One-Euro từng điểm, chỉ xử lý khung hình mới, giữ điểm bị khuất, nội suy 60 fps, tự căn khung (người luôn cao ~2/3 màn hình, vẫn thấy di chuyển ngang & nhảy).
- 7 combo: 🙌 Nở rộ (2 tay qua đầu), 🦋 Cánh bướm (dang tay vỗ 2 lần), 🌀 Vòng xoáy (quay tay tròn), 🌈 Cầu vồng (vung tay qua đầu sang bên kia – chờ 0,45 s để phân biệt với vòng xoáy), 🦘 Bật nhảy, 💃 Lắc lư (lắc hông trái–phải), 🙏 Hoa sen (chắp tay trước ngực 1 s).
- 🎵 **Nốt nhạc Jingle Bells** (bật mặc định, nút 🎵 để tắt): 51 nốt điệp khúc rơi theo nhịp 84 BPM trên 5 làn Đô–Mi–Sol–Fa–Rê (Mi và Fa ở hai bên người, Sol trên đầu). Bàn tay chạm nốt → chuông tổng hợp Web Audio (5 hoạ âm + lục lạc) + vòng sáng, sao lấp lánh, hoa bung, chữ tên nốt. Đếm nốt chạm, combo, hết bài tổng kết rồi chơi lại sau 5 giây. Demo tự chơi hết bài.
- Nút: 📸 lưu/chia sẻ ảnh, 🔄 camera trước/sau (vẽ người khác), 👁 camera nhỏ, 🧹 xoá hoa. Chế độ demo có vũ công ảo diễn đủ 7 combo.

## App `/play/` – đàn dây ảo bằng tay

`public/play/index.html` – MediaPipe HandLandmarker (2 tay, lọc One-Euro).

- Tạo dây có chủ đích: 2 điểm chụm phải sát nhau (< 22% cạnh ngắn màn hình), giữ yên 0,45 s (vòng vàng nạp đầy) rồi mới kéo ra → căng 1 dây (tối đa 10); nút "✏️ Kéo dây" khoá việc tạo dây khi chỉ muốn gảy; chụm 1 tay vào đầu dây để dời; kéo ra ngoài màn hình để xoá.
- Quẹt đầu ngón tay cắt ngang dây → gảy (1 lần/bàn tay/dây mỗi 110 ms); tốc độ quẹt = độ to. Dây ngắn = nốt cao (thang Ngũ cung / Đô trưởng / La thứ, 3 quãng tám).
- Tiếng: Guitar (Karplus–Strong), Đàn hạc (hoạ âm sine), Synth (saw + lọc); có reverb tự tạo.
- Hiệu ứng (đã tiết chế): dây gradient phát sáng nhẹ, rung theo điểm gảy rồi theo hoạ âm, vạch phím; chỉ khi gảy mới có 1–2 nốt ♪♫ bay ra; khung xương tay neon mảnh; nền camera hoặc nền vũ trụ, màu nền dịu.
- Quay video: MediaRecorder ghép `canvas.captureStream(30)` + âm thanh Web Audio (MP4 trên Safari/iOS, WebM trên Chrome/Android) → xem lại, lưu, chia sẻ.
- Demo: hai tay ảo tự kéo 3 dây và gảy.

## Game `/pickleball/` – tập pickleball với máy bắn bóng

`public/pickleball/index.html` – MediaPipe PoseLandmarker (full → lite), lọc One-Euro, hiển thị như gương.

- Vợt ảo gắn vào tay cầm vợt (chọn tay phải/trái): cán ở cổ tay, hướng = 60% cẳng tay + 40% bàn tay; mặt vợt cách cổ tay 0,8 vai. Không nhận diện vợt thật.
- Máy bắn 1 bóng/lần tới điểm đánh tính theo vị trí vai người chơi (thuận tay / trái tay); vòng báo co dần về cỡ bóng = lúc đánh. 5 bài: Hỗn hợp, Thuận tay, Trái tay, Dink, Volley nhanh.
- Chạm = đường đi mặt vợt cắt bóng trong cửa sổ k 0,90–1,14. Tốc độ vung (vai/giây): < 1,2 rúc lưới, 1,2–8,5 vào sân (càng mạnh càng sâu), > 8,5 ra ngoài; Dink: > 3,5 là mạnh quá. Lệch nhịp → bóng lệch ngang, quá ±150 ms ra biên. (Mô hình đơn giản hoá, không phải vật lý thật.)
- Siêu chiêu anime (+3 điểm, cần vung ≥ 4,5 vai/giây và lệch nhịp < 90 ms): 🔥 Hoả Long (bổ xuống), ⚡ Lôi Tốc (quét ngang), 🌪 Lốc Xoáy (hất lên). Hiệu ứng: băng tên chiêu chéo, vạch tốc độ manga, chớp màu, rung màn hình, vệt lửa / tia sét / xoáy, nổ khi bóng chạm sân. Vào sân thường +1; chuỗi ≥ 3 cộng thêm 1.
- Demo: người ảo tự đánh đủ các kiểu.

### Cập nhật 22/11: DragonPickleBall

- Đổi tên game thành **DragonPickleBall**; màn mở đầu "Đấu trường đỉnh cao" (chữ DRAGON / PICKLEBALL đập vào, VS Siêu Quỷ Pickleball, FIGHT!).
- Đối thủ **Siêu Quỷ Pickleball** thay máy bắn bóng: có thanh máu (20 + 8/level), bóng vào sân trừ 1 máu, siêu chiêu trừ 3, mana ≥ 60 nhân đôi; hạ quỷ +10×level điểm, quỷ hồi sinh level cao hơn và giao bóng nhanh hơn 6%/level.
- Chạm bóng tính theo **đỉnh tốc độ vung 3D** (worldLandmarks, tính cả chiều sâu khi vung từ sau ra trước) trong lúc vợt ở gần điểm đánh; không vung mà vợt chặn đúng đường bóng thì tính chạm nhẹ.
- Không vẽ đè lên mặt; khung xương là dòng năng lượng neon; vợt vẽ dáng thon dài mặt đen viền hồng → xanh (không có logo/chữ thương hiệu).
- Mana: tăng khi đánh chuẩn, tụt dần; ≥ 60 thì mắt xoẹt năng lượng và điểm ×2. Mọi cú vào sân đều có tia sáng, vòng sáng, vệt bóng.
- Nút ⏺ quay video (hình + hiệu ứng + tiếng), xem lại, lưu, chia sẻ.

## Công cụ `/testReal/` – đo độ trễ giữa 2 thiết bị

`public/testReal/index.html` – dùng lại khối mạng của game (PeerJS P2P + Cloudflare TURN + relay MQTT, tiền tố `hmtest`).

- **Máy A** (điện thoại): camera → PoseLandmarker lite → nhân vật 13 điểm; gửi mỗi khung (~30 gói/giây, kênh không gửi lại) kèm số thứ tự và giờ gửi. **Máy B** (laptop): nhập mã 4 ký tự, vẽ lại nhân vật.
- Đồng bộ đồng hồ kiểu NTP (B hỏi mỗi 0,4 s, lấy mẫu có khứ hồi nhỏ nhất) → B tính độ trễ một chiều từng gói: trung bình / min / max / p95 trong 5 giây, tính cả từ lúc A bắt đầu xử lý khung hình, tốc độ nhận, dao động, % rớt gói, gói sai thứ tự, biểu đồ 20 giây. B gửi số đo về để A cũng thấy.
- Hiện đường truyền thật: P2P trực tiếp (LAN / Internet), P2P qua TURN, hay chuyển tiếp MQTT (đọc từ `getStats`).
- Kiểm tra bằng mắt: nút "⚡ Chớp cả 2 máy"; đồng hồ mili-giây trên cả 2 màn hình (B hiện giờ-máy-A của hình đang vẽ → chụp chung 2 màn hình để thấy chênh lệch thật, gồm cả độ trễ màn hình); trên A có bóng trắng mờ = hình B đang thấy.
- Không đo được: độ trễ cảm biến camera của A (thường 30–80 ms) và độ trễ màn hình. `#local` = test 2 cửa sổ cùng máy với nhân vật giả lập; `#sim` = máy A không dùng camera.
