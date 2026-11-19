# 333 Cheers Lab

**Link app:** https://cheerbeerapp.netlify.app/

Web app nhận diện cú cụng bia 333 bằng camera, đọc **hình dáng (shape)** của các lon đang cụng, liên tưởng thành một hình ảnh trong đời sống, rồi nhờ **Higgsfield** vẽ thành tranh (poster đồ hoạ hiện đại kiểu in lụa, từ khoá lời chúc to nhất, chữ rải rác).

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
| `APP_PASSCODE` | nên có | Mã truy cập tự đặt (vd `333dô`). Người dùng nhập 1 lần trên mỗi máy. Không đặt thì ai có link cũng dùng được key của bạn. |
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
