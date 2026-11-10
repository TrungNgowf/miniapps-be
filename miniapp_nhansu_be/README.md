# miniapp_nhansu_be

API của mini-app **Nhân sự** (`miniapp_samples/apps/nhan-su`), dựng để **thử hiệu năng bundle nặng**: zip khoảng 20 MB (gói danh bạ offline 20.000 nhân viên ≈ 6 MB JSON, 120 ảnh chân dung 800px + 120 ảnh nhỏ), có backend và đăng nhập thật. Dữ liệu hoàn toàn là dữ liệu sinh ra.

## Chạy

```bash
pnpm install
pnpm gen          # sinh dữ liệu và ảnh (khoảng 40 giây)
pnpm dev          # cổng 4200
```

`PORTAL_API` mặc định là `https://miniapp-portal-be.onrender.com`, phải trùng portal mà Super App đang dùng (xem `.env.example`). Chạy portal local: xem `../miniapp_kho_be/README.md`.

`pnpm gen` ghi `data/` cho backend và `../../miniapp_samples/apps/nhan-su/public/{data,img,icon.png}` cho mini-app. Chỉnh kích thước bundle bằng biến môi trường: `PHOTOS` (số ảnh, mặc định 120), `PHOTO_SIZE` (800), `PHOTO_QUALITY` (92), `COUNT` (20000). Ảnh là JPEG có nhiễu nên gần như không nén thêm được: dung lượng zip ≈ tổng dung lượng ảnh.

## Xác thực và phân quyền

Giống Kho hàng: mini-app xin token qua bridge `auth.getToken` (trình duyệt thường thì đăng nhập form), gửi `Authorization: Bearer`, backend hỏi portal `GET /api/auth/me` (nhớ 60 giây).

| Vai trò | Quyền |
|---|---|
| mọi người | `directory.read`: danh bạ, chi tiết, chấm công, tạo đơn nghỉ phép |
| MANAGER, HR, ADMIN, DIRECTOR, REGION_LEAD, TEAM_LEAD | thêm `stats.read`, `leave.approve` |
| ADMIN, DIRECTOR, HR | thêm `salary.read` (thấy lương) |

## API

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| GET | `/health` | Không cần token |
| GET | `/api/me` | Người dùng và quyền |
| GET | `/api/employees` | `q`, `dept`, `status`, `sort`, `limit`, `offset` |
| GET | `/api/employees/:id` | Kèm chấm công 30 ngày và đơn nghỉ phép |
| GET | `/api/stats` | Tổng hợp cho biểu đồ (`stats.read`) |
| GET/POST | `/api/leaves`, `/api/leaves/:id/approve\|reject` | Gửi lại cùng `requestId` không tạo trùng |
| GET | `/api/bench?kb=N` | Trả `N` KB, dùng đo độ trễ và băng thông |

Đơn nghỉ phép mới ghi vào `data/leaves-live.json`. Xóa file này để về dữ liệu ban đầu.

## Thử trên Super App

1. `pnpm dev` ở đây.
2. `cd ../../miniapp_samples && pnpm bundle nhan-su` → `out/nhan-su/bundle.zip` (≈ 19,9 MB, giới hạn 50 MB).
3. Đăng lên portal: `appId` `nhan-su`, `permissions` rỗng, `requiredRoles` theo `miniapp.config.json`.
4. Mặc định app gọi `https://miniapp-nhansu-be.onrender.com` (đặt trong `miniapp_samples/apps/nhan-su/.env`). Chạy backend trên máy thì đổi ở mục **Tài khoản → Địa chỉ máy chủ**: iOS Simulator `http://localhost:4200`, Android Emulator `http://10.0.2.2:4200`, điện thoại thật `http://<IP máy>:4200`.

Tab **Hiệu năng** trong app đo: nạp/parse JSON 6 MB, lọc 20k bản ghi, tải 120 ảnh nhỏ/lớn, độ trễ và băng thông API, FPS, JS heap, lưới 600 ảnh.
