# Arknights Pull Calculator

Ứng dụng React + TypeScript + Vite + Tailwind CSS, giao diện dark mode responsive.

## Phát triển

Yêu cầu Node.js 22+ và npm.

```sh
npm ci --cache /workspace/.npm-cache
npm run dev
```

Vite lắng nghe trên cổng 5173. Kiểm tra bằng `npm test` và `npm run build`; xem bản production bằng `npm run preview`.

## Chức năng

- Quy đổi Orundum (600/pull), Originite Prime (180 Orundum/Prime), và Headhunting Permit. Có thể loại Prime khỏi tổng.
- Ghi số dư tài nguyên theo ngày; ghi cùng ngày sẽ thay thế bản ghi cũ. Nhật ký có biểu đồ số pull thực tế và nút xóa.
- Dự báo đến ngày banner bằng thu nhập hằng ngày và mỗi tuần trọn vẹn; cấu hình mục tiêu và tên banner.
- Lưu tự động bằng localStorage; xuất JSON để sao lưu. Dữ liệu chỉ tồn tại trong trình duyệt đang dùng, có thể mất khi xóa dữ liệu trang. Chưa có đồng bộ hoặc nhập lại JSON.

Dự báo là ước tính thu nhập, không dự đoán kết quả gacha. Mặc định 100 Orundum/ngày và 1.700/tuần (500 nhiệm vụ tuần + 1.200 Annihilation); điều chỉnh theo tiến độ tài khoản. Không tự cộng sự kiện, thẻ tháng hoặc quà miễn phí. Không cần API key, backend hoặc database.
