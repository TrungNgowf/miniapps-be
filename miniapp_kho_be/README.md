# miniapp_kho_be

API của mini-app **Kho hàng** (`miniapp_samples/apps/kho-hang`): tồn kho, nhập hàng, kiểm kê, hao hụt và chuyển kho cho chuỗi Siêu thị Minh Phát. Đây là backend riêng của mini-app, tách khỏi `miniapp_portal_be`.

Mini-app này được dựng để **thử tải bundle nặng**: zip khoảng 35 MB (596 file ảnh sản phẩm + gói danh mục offline), có backend và đăng nhập thật.

## Chạy

```bash
pnpm install
pnpm gen          # sinh dữ liệu và ảnh (lần đầu, khoảng 1 phút)
PORTAL_API=http://127.0.0.1:3000 pnpm dev
```

`pnpm gen` gồm hai bước:

- `pnpm gen:data`: 605 SKU, 3.486 dòng tồn ở 7 địa điểm, 73 nghìn biến động kho trong 30 ngày, doanh số 365 ngày, 15 phiếu chuyển kho. Ghi vào `data/` và gói offline vào `miniapp_samples/apps/kho-hang/public/data`.
- `pnpm gen:images`: 298 dòng sản phẩm, mỗi dòng một ảnh 960px và một ảnh nhỏ 200px, ghi vào `miniapp_samples/apps/kho-hang/public/img`.

Chạy lại `pnpm gen:data` sẽ xóa mọi thay đổi đã ghi (`data/mutations.jsonl`) và đưa dữ liệu về ban đầu. Khi server khởi động, mọi ngày trong dữ liệu được dịch cho khớp với ngày hôm nay.

Biến môi trường: xem `.env.example`.

## Dữ liệu là dữ liệu thật hay giả?

Là dữ liệu **sinh ra**, không phải dữ liệu của một doanh nghiệp thật:

- Nhãn hàng, tên sản phẩm, quy cách và giá lẻ lấy theo thị trường Việt Nam (Vinamilk, Hảo Hảo, Coca-Cola, Omo…), giá chỉ mang tính tham khảo.
- Mã vạch EAN-13 hợp lệ về checksum nhưng **do script tạo**, có thể trùng với mã của sản phẩm khác ngoài đời.
- Tồn, bán, nhập được sinh ngược từ tồn hiện tại nên nhật ký luôn khớp: tồn đầu + nhập − bán − hao hụt ± kiểm kê = tồn cuối, không bao giờ âm.
- Ảnh là hình minh họa bao bì vẽ bằng SVG, có thêm nhiễu để dung lượng gần ảnh chụp thật.
- Cửa hàng là cửa hàng hư cấu của tenant `minhphat` trong dự án.

## Xác thực và phân quyền

```
Super App ──auth.getToken──▶ mini-app ──Bearer──▶ miniapp_kho_be ──GET /api/auth/me──▶ miniapp_portal_be
```

1. Mini-app xin token của phiên Super App qua bridge `auth.getToken`. Trên trình duyệt thường thì đăng nhập bằng form, gọi `POST /api/auth/login` của portal.
2. Mọi request tới API Kho hàng gửi `Authorization: Bearer <token>`.
3. Backend này **không tự cấp token**. Nó hỏi portal (`GET /api/auth/me`) để biết token còn hiệu lực không và người dùng có đơn vị, vai trò gì. Kết quả được nhớ 60 giây.
4. Token hết hạn thì mini-app xin token mới (host) hoặc refresh (đăng nhập form) rồi gọi lại một lần.

Vai trò và đơn vị lấy từ `app_metadata` của tài khoản, không lấy từ `user_metadata`.

| Vai trò | Quyền trong app |
|---|---|
| `CASHIER` | Xem tồn, xem danh mục. Không thấy giá vốn |
| `STORE_KEEPER` | + nhập hàng, kiểm kê, hao hụt, tạo phiếu chuyển kho, nhận hàng |
| `MANAGER` | + đặt mức tồn tối thiểu, xem giá vốn, duyệt phiếu |
| `REGION_LEAD`, `DIRECTOR`, `ADMIN` | Như `MANAGER` |
| vai trò khác (`USER`…) | 403 |

**Phạm vi theo đơn vị**: người dùng thao tác được trên địa điểm thuộc tenant của mình và tenant con. Mọi người trong Minh Phát được xem tồn Kho tổng để đặt hàng. Tài khoản ngoài cây `minhphat` bị 403.

| Địa điểm | Tenant |
|---|---|
| Kho tổng Minh Phát | `minhphat` |
| Minh Phát Quang Trung, Văn Quán | `minhphat-hadong` |
| Minh Phát Trần Thái Tông, Xuân Thủy | `minhphat-caugiay` |
| Minh Phát Phú Mỹ Hưng, Thủ Đức | `minhphat-mn` |

Tài khoản thử nằm trong `TAI-KHOAN.md`:

| Tài khoản | Thử gì |
|---|---|
| `thao.ha` (ADMIN, `minhphat`) | Toàn bộ 7 địa điểm, duyệt và xuất kho từ Kho tổng |
| `hung.vo` (REGION_LEAD, `minhphat-mb`) | 4 cửa hàng miền Bắc, xem giá vốn |
| `toan.mai` (STORE_KEEPER, `minhphat-caugiay`) | Nhập hàng, kiểm kê, tạo và nhận phiếu cho 2 cửa hàng Cầu Giấy |
| `lien.ha` (CASHIER, `minhphat-hadong`) | Chỉ xem, 2 cửa hàng Hà Đông |
| `binh.mac` (USER, `minhphat`) | Bị chặn: chưa có vai trò kho |
| `duc.le` (USER, `tinasoft`) | Bị chặn: ngoài Minh Phát |

## Chuyển kho

`REQUESTED → APPROVED → SHIPPED → RECEIVED`, hoặc `REJECTED` / `CANCELLED`.

- Tạo: người có quyền `transfer.request`, nơi nhận phải thuộc phạm vi của họ.
- Duyệt, từ chối: quyền `transfer.approve` ở nơi gửi.
- Xuất kho: quyền `stock.write` ở nơi gửi. Lúc này tồn nơi gửi mới giảm. Không đủ tồn thì 409.
- Nhận: quyền `transfer.receive` ở nơi nhận, được nhập số thực nhận từng dòng (không vượt số gửi). Lúc này tồn nơi nhận mới tăng.
- Hủy: người tạo, hoặc người có quyền duyệt, khi phiếu chưa xuất.

## API

Mọi route `/api/*` cần Bearer. Lỗi trả `{ error: { code, message } }`.

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| GET | `/health` | Không cần token |
| GET | `/api/me` | Người dùng, quyền, địa điểm được xem và thao tác |
| GET | `/api/catalog/version` | So với gói offline trong bundle |
| GET | `/api/products`, `/api/products/:sku`, `/api/products/barcode/:code` | Chi tiết có tồn theo địa điểm, lịch sử giá, biến động |
| GET | `/api/stock?location=` | Lọc `q`, `category`, `status`, `sort`; phân trang |
| POST | `/api/stock/receipts` | Nhập hàng nhiều dòng |
| POST | `/api/stock/waste` | Hao hụt |
| POST | `/api/stock/adjustments` | Kiểm kê, báo 409 `STALE_STOCK` nếu tồn đã đổi |
| PUT | `/api/stock/:locationId/:sku/minimum` | Mức tồn tối thiểu |
| GET | `/api/movements` | Nhật ký, phân trang bằng `cursor` |
| GET/POST | `/api/transfers`, `/api/transfers/:id`, `/api/transfers/:id/:action` | `approve`, `reject`, `ship`, `receive`, `cancel` |
| GET | `/api/dashboard?location=&days=` | Doanh thu, nhóm hàng, top bán chạy, hàng tồn chậm |
| GET | `/api/replenishment?location=` | Gợi ý bổ sung theo lượng bán 14 ngày |

Các route ghi nhận `requestId` trong body: gửi lại cùng mã thì không ghi trùng.

## Lưu trữ

Dữ liệu gốc nằm trong `data/*.json`, nạp vào bộ nhớ khi khởi động. Mọi thay đổi (nhập, kiểm kê, phiếu chuyển kho…) được **ghi nối vào `data/mutations.jsonl`** và phát lại khi khởi động lại. Đủ cho thử nghiệm một tiến trình. Muốn chạy thật cần thay bằng cơ sở dữ liệu.

## Kiểm thử

```bash
pnpm typecheck
pnpm test        # kiểm thử đơn vị cho phân quyền
pnpm accept      # 41 kiểm tra đầu-cuối qua API, đăng nhập thật qua portal
```

`pnpm accept` cần portal đang chạy và ghi dữ liệu thật vào `mutations.jsonl`. Chạy portal local không cần Supabase:

```bash
cd ../miniapp_portal_be
STORE=memory ADMIN_API_KEY=dev PORT=3000 CORS_ORIGIN=http://localhost:5173,http://localhost:5174 npx tsx src/server.ts
```

## Đưa lên Super App để thử

1. Chạy backend này trên máy bạn. Mặc định nghe cổng `4100` trên mọi giao diện.
2. Đóng gói: `cd ../../miniapp_samples && pnpm bundle kho-hang`. Zip ra `out/kho-hang/bundle.zip` (khoảng 35 MB, dưới giới hạn 50 MB).
3. Đăng zip lên portal. `appId` `kho-hang`, `permissions` rỗng, `requiredRoles` theo `miniapp.config.json`, đối tượng là tenant `minhphat`.
4. Mở app trong Super App bằng một tài khoản Minh Phát có vai trò kho (ví dụ `toan.mai`).

Địa chỉ API mặc định của mini-app là bản trên Render, `https://miniapp-kho-be.onrender.com` (đặt trong `miniapp_samples/apps/kho-hang/.env`). Chạy backend trên máy thì đổi trong app:

| Thiết bị | Địa chỉ API cần đặt |
|---|---|
| iOS Simulator | `http://localhost:4100` (mặc định) |
| Android Emulator | `http://10.0.2.2:4100` |
| Điện thoại thật | `http://<IP máy bạn>:4100`, cùng Wi-Fi |

Đổi địa chỉ ngay trong app, ở màn **Tài khoản → Máy chủ** (hoặc mục **Địa chỉ máy chủ** ở màn đăng nhập), không cần build lại.

Super App trên Android chỉ cho gọi `http://` ở bản debug. Bản iOS cho phép mạng cục bộ (`NSAllowsLocalNetworking`).

**Token từ Super App** là token của portal mà Super App đang trỏ tới (hiện là `https://miniapp-portal-be.onrender.com`). Vì vậy `PORTAL_API` của backend này phải trỏ cùng nơi đó, nếu không backend sẽ trả 401. Mặc định đã đúng. Portal trên Render ngủ sau 15 phút nên lần gọi đầu có thể mất tới 1 phút.
