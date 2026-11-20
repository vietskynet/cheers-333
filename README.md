# HandMagination

**Link app:** https://cheerbeerapp.netlify.app/

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
- **Kết nối**: WebRTC peer-to-peer (PeerJS, file `peerjs.min.js` tự host; ghép phòng qua máy chủ PeerJS miễn phí, có TURN dự phòng). Kênh `state` không gửi lại (vị trí ~45 lần/giây), kênh `event` chắc chắn (đòn đánh, KO). Nhân vật của mình phản hồi tức thì; đối thủ được dự đoán theo vận tốc để bù trễ. Hiển thị ping.
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
