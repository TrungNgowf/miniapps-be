# miniapps-be

Backend riêng của hai mini-app nặng, tách khỏi backend portal (`miniapp_portal_be`):

| Thư mục | Mini-app | Cổng local | Chi tiết |
|---|---|---|---|
| `miniapp_kho_be` | Kho hàng (`kho-hang`), Minh Phát | 4100 | [README](miniapp_kho_be/README.md) |
| `miniapp_nhansu_be` | Nhân sự (`nhan-su`) | 4200 | [README](miniapp_nhansu_be/README.md) |

Bản deploy: `https://miniapp-kho-be.onrender.com`, `https://miniapp-nhansu-be.onrender.com`. Cả hai xác thực bằng token Super App, hỏi lại portal qua `GET /api/auth/me` (biến `PORTAL_API`).

## Deploy lên Render

`render.yaml` khai báo hai web service Docker (gói free), mỗi service build từ thư mục của nó: Render → **New → Blueprint** → chọn repo này. Push lên `main` thì service nào có thay đổi trong thư mục của nó sẽ tự deploy lại.

Dữ liệu gốc (`data/*.json`) được commit sẵn để khớp với gói offline trong bundle của mini-app. Thay đổi lúc chạy (`miniapp_kho_be/data/mutations.jsonl`, `miniapp_nhansu_be/data/leaves-live.json`) nằm trên ổ tạm của Render: mất khi deploy lại hoặc khởi động lại.
