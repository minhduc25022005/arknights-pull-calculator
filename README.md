# Arknights Pull Calculator

Ứng dụng React + TypeScript + Vite + Tailwind CSS + Recharts, giữ phong cách Rhodes Island dark mode và bố cục responsive.

## Chạy và kiểm tra

Yêu cầu **Node.js 24+**, npm; Vercel/GitHub Actions cần dùng cùng major Node.

```sh
npm ci --cache /workspace/.npm-cache
npm run dev -- --host 0.0.0.0
npm test
npm run build
npm run preview
```

Vite dùng cổng 5173; build tĩnh nằm trong `dist/`. Trên máy ngoài cloud có thể bỏ `--cache /workspace/.npm-cache`.

## Tài nguyên và tương thích dữ liệu cũ

- Orundum: 600/pull; Originite Prime: 180 Orundum/Prime; Permit: 1/pull. Prime có thể được loại khỏi tổng.
- Giữ nhật ký số dư theo ngày, biểu đồ lịch sử, mục tiêu pull, thu nhập hằng ngày/tuần và xuất JSON.
- **Không đổi hoặc di chuyển key `rhodes-pulls-v1`.** Các trường `resources`, `entries`, `banner`, `target`, `daily`, `weekly`, `convert`, `name` cũ được đọc nguyên vẹn. Mở lịch và chọn sự kiện không ghi đè kế hoạch tự chọn, số dư hoặc lịch sử.
- Lịch công khai/cache, sự kiện đang chọn và múi giờ nằm ở các key riêng: `rhodes-banner-catalog-v1`, `rhodes-banner-plan-v1`, `rhodes-banner-timezone-v1`.
- Dữ liệu tài nguyên vẫn chỉ nằm trên trình duyệt; xuất JSON trước khi xóa dữ liệu trang. Chưa có tài khoản/đồng bộ tài nguyên hoặc chức năng nhập lại bản xuất tài nguyên.

Dự báo tài nguyên là ước tính thu nhập, không dự đoán kết quả gacha. Mặc định 100 Orundum/ngày, 1.700/tuần (500 nhiệm vụ tuần + 1.200 Annihilation); cộng thu nhập tuần sau mỗi 7 ngày trọn vẹn. Chưa tự cộng sự kiện, thẻ tháng hoặc quà banner.

## Lịch banner và trạng thái dữ liệu hiện tại

Nguồn được phép xét:

- Global: <https://www.arknights.global/>
- CN: <https://ak.hypergryph.com/>

**Chưa có lần đồng bộ thông báo thực tế thành công.** Trong môi trường cloud, cả hai trang chủ và `robots.txt` bị proxy chặn CONNECT `403` trước khi kết nối tới website. Chưa xác minh được API/RSS công khai, URL điều khoản hoặc cấu trúc bài thật. Xem bằng chứng và các điều kiện mở adapter tại [docs/source-audit.md](docs/source-audit.md).

Run GitHub Actions `39394219723` / job `118532842204` do người dùng cung cấp ghi nhận CN robots HTTP 404 và Global bị parser cũ đánh giá ambiguous. Các kết quả đó khác đường mạng cloud: tại đây vẫn bị CONNECT 403. HTTP 404 thật không được đánh đồng với proxy 403; riêng thông báo ambiguous cũ chưa chứng minh Global trả HTML hay MIME nào. Bản sửa ghi status, Content-Type và toàn bộ chuỗi redirect an toàn để xác định nguyên nhân ở lần chạy tiếp theo.

`public/data/banners.json` ban đầu không có sự kiện được bịa sẵn. Calendar trống và cảnh báo đồng bộ là trạng thái có chủ ý khi chưa có dữ liệu được xác minh. Fixture tổng hợp chỉ dùng trong tests, không được phát hành thành banner thật.

Sidebar có mục **Lịch banner**: lọc Global/CN/tất cả, tab đang diễn ra/sắp tới/đã kết thúc/**chưa có lịch**, nguồn gốc, ngày đăng, thời điểm cập nhật và countdown. Dữ liệu chính thức chưa công bố ngày được thể hiện riêng. Mốc dự đoán đã qua không có bằng chứng kết thúc sẽ nằm ở “Chưa có lịch”, không được trình bày như sự kiện đã thực sự diễn ra.

Múi giờ mặc định Việt Nam `Asia/Ho_Chi_Minh`, có thể đổi UTC hoặc `Asia/Shanghai`. Mỗi timestamp nhập vào phải có offset rõ ràng, được chuẩn hóa UTC rồi hiển thị theo múi giờ chọn. Không tự suy ra múi giờ Global từ tên server. Giá trị date-only/thiếu offset bị từ chối; ngày đăng thông báo không được dùng thay ngày bắt đầu sự kiện.

## Mô hình dữ liệu, bằng chứng và đối chiếu

Mỗi bản ghi gồm:

- `id`, `eventId`, `name`, `server` (`CN`/`Global`), `category` (`limited`, `anniversary`, `rerun`, `standard`, `event`).
- `status`: `official` / `predicted` / `unknown`; `scheduleState`: `scheduled` / `announced` / `estimated` / `unknown`.
- `operators`, `startAt`, `endAt` khi có bằng chứng; `updatedAt`, `origin` (`sync`, `manual`, `prediction`).
- `sources[]`: URL, tên nguồn, server, `kind`, `publishedAt`, `confirmedFields` (`event`, `operators`, `startAt`, `endAt`). Các trường chỉ được ghi chính xác khi có nguồn chính thức đúng server xác nhận riêng từng trường.
- `estimate` nếu đủ dữ liệu: `earliest`, `central`, `latest`, `confidence`, `sampleSize`, `explanation`.

`eventId` dùng chung giữa hai server **chỉ khi người kiểm duyệt đã đối chiếu đúng sự kiện**. Tách rerun và lần phát hành đầu thành ID khác; không ghép theo thứ tự, tên gần giống hoặc Operator trùng. ID adapter tự sinh được cô lập theo nguồn; muốn đưa vào lịch sử dự đoán cần bản ghi kiểm duyệt gắn đúng URL nguồn với cùng `eventId`.

Một thông báo CN không xác nhận ngày hoặc Operator Global. Website kiểm tra hostname chính thức **và** server trong nguồn. `CHÍNH THỨC` cho sự kiện không đồng nghĩa ngày đã chính thức: sự kiện `official + announced` vẫn có thể có khoảng ngày **dự đoán** tách biệt. Dữ liệu cộng đồng không được nâng thành chính thức. Validation kiểm tra cấu trúc/provenance; việc nội dung bài thật xác nhận chính xác trường nào vẫn cần adapter đã kiểm chứng hoặc người kiểm duyệt có trách nhiệm.

### Dự đoán Global

Dùng tối thiểu **3 cặp sự kiện độc lập cùng loại** có ngày CN và Global đã thực sự diễn ra, cùng `eventId` đã kiểm duyệt. Tính trung vị độ trễ, khoảng min/max quan sát mở rộng tối thiểu 7 ngày; mức tin cậy dựa số mẫu và độ phân tán, không phải xác suất đã được hiệu chỉnh. Dùng các loại limited/anniversary/rerun/standard riêng, không giả định Global đi theo thứ tự CN. Mẫu lỗi/độ trễ âm hoặc trên 730 ngày không được dùng.

Dưới ngưỡng: Global hiện **Chưa đủ dữ liệu**, không tự tạo ngày/Operator. Khi có ngày Global chính thức, ngày đó thay dự đoán. Trong **Kế hoạch banner**, chọn sự kiện để tính pull theo ngày bắt đầu; sự kiện dự đoán có ba kịch bản sớm nhất/trung tâm/muộn nhất và mốc nét đứt trên biểu đồ. Ngày chính thức dùng mốc nét liền. Kế hoạch tự chọn cũ luôn có thể chọn lại.

## Job Node và nhập dữ liệu kiểm duyệt

Trình duyệt chỉ tải JSON cùng origin ở `/data/banners.json`; không scrape nguồn chính thức. Job Node:

```sh
npm run banners:sync
npm run banners:diagnose
npm run banners:check -- /path/to/reviewed-banners.json
npm run banners:import -- /path/to/reviewed-banners.json
```

Trong **Lịch banner**, mở mục thu gọn **Chuẩn bị banner kiểm duyệt thủ công**. Nhập thông tin đúng bài thông báo, link gốc đúng server, ngày đăng và offset ghi rõ; chỉ điền ngày/Operator đã được nguồn xác nhận. Form yêu cầu xác nhận lại sau mỗi thay đổi. Tải `reviewed-banners.json`, chạy `banners:check` để kiểm tra mà **không ghi file**, rồi `banners:import`, xem diff và tạo commit/PR. Trang chủ hoặc anchor chung không đủ làm link thông báo. Form chỉ tạo tệp nhập, không tự công bố vào lịch hay sửa dữ liệu localStorage. Validation không thay thế việc người kiểm duyệt đọc nội dung thật.

Import nhận `{ "schemaVersion": 1, "events": [...] }` theo kiểu `Banner` trong [src/banners.ts](src/banners.ts). Mọi bản ghi nhập phải có `origin: "manual"`, `reviewed: true`, URL thông báo thật, ngày đăng có offset, server và `confirmedFields` đúng nội dung được kiểm duyệt. Chưa biết Operator thì để `operators: []`; chưa biết ngày thì bỏ `startAt`/`endAt` và dùng trạng thái thích hợp. Sử dụng thời điểm cập nhật mới hơn khi sửa bản ghi, kiểm tra diff rồi review qua GitHub. Không dùng homepage hay bài cộng đồng làm bằng chứng cho ngày chưa được công bố.

Import hợp lệ được ghi vào `data/curated-banners.json` và hợp nhất vào JSON công khai; không đánh dấu đồng bộ live thành công. Cả curated và public file cần được commit khi nhập thủ công. Dữ liệu mới sai bị từ chối; không thay file public cũ nếu nó không đọc/validate được.

### Bật thu thập nguồn thực tế

1. Mở HTTPS tới đúng hai hostname trong cấu hình mạng cloud; giữ các tên miền đang dùng. Đã lưu yêu cầu vào bản nháp cấu hình; việc lưu draft không áp dụng ngay hoặc Publish môi trường.
2. Đọc được trang chủ, `robots.txt`, điều khoản được **liên kết thật** từ website; cập nhật audit. Không tự bịa API/RSS/endpoint. Ưu tiên feed/API công khai có tài liệu nếu thực sự tìm thấy.
3. Sau khi xác nhận việc lấy dữ liệu được phép, điền `data/source-policy.json`: `termsReview.reviewed`, URL điều khoản thật, `reviewedAt` có offset, `reviewedBy`, `permitsAutomatedCollection`. Không bật các cờ nếu chưa kiểm tra.
4. Adapter hiện chỉ hỗ trợ thông báo HTML có JSON-LD `Event` chứa dữ kiện thời gian minh bạch. Đây là parser bảo thủ **chưa được xác minh trên website thật**; không khẳng định hai nguồn hiện xuất JSON-LD tương thích. Parser chỉ nhận Operator từ trường cấu trúc ghi rõ Operator, không từ một tên bất kỳ trong bài.
5. Nếu nguồn thật dùng SPA/API/HTML khác, thêm adapter sau khi đã kiểm chứng cấu trúc/endpoint và fixture bài thật, rồi xác minh ít nhất một lần đồng bộ có dữ liệu thực. HTTP 200 hoặc JSON rỗng không đủ chứng minh thành công.

### Robots và chẩn đoán HTTP theo RFC 9309

- Robots HTTP **404/410 thật**: xem là file không có; RFC §2.3.1.3 cho phép MAY access, nhưng vẫn dừng nếu chưa duyệt điều khoản. Không tự bật `permitsAutomatedCollection`.
- **401/403/429 thật**: lựa chọn bảo thủ của dự án là từ chối, không gọi chúng là 404. **5xx**, lỗi mạng, TLS và timeout: từ chối theo §2.3.1.4; không biến lỗi thành file allow-all.
- Proxy **CONNECT 403**: không có HTTP response từ website; log `NETWORK_PROXY_DENIED` và không gán origin HTTP status giả. Lỗi body sau khi có header HTTP được ghi riêng.
- UTF-8 `text/plain` rỗng, chỉ comment/Sitemap, BOM hoặc không có group phù hợp là hợp lệ; áp dụng các dòng parse được thay vì bắt buộc có `User-agent:`. Không có robots cache lưu giữa các job; khi không đọc được file và không có cache thì dừng bảo thủ.
- **200 HTML/SPA/challenge**, Content-Type sai, charset không hỗ trợ hoặc bytes UTF-8 hỏng: từ chối với mã riêng và metadata, không giả vờ đó là 404. Content-Type thiếu được ghi `null`; chỉ chấp nhận văn bản không có dấu hiệu HTML.
- Theo tối đa 5 redirect liên tiếp; robots có thể chuyển giữa các origin chính thức đã cho phép (www/apex Global). Từ chối rõ ràng redirect ngoài allowlist; không bypass proxy hoặc truy cập URL tùy ý.

`npm run banners:diagnose` chạy kiểm tra nguồn thật và in JSON metadata, **không ghi curated/public data**. Mỗi nguồn có mã lỗi, HTTP status nếu thực sự nhận từ origin, Content-Type (kể cả null) và redirect chain. Chẩn đoán không lưu body, credentials hoặc query values. Khi không nhận sự kiện live hợp lệ, lệnh vẫn exit 2; chạy diagnostic không chứng minh sync thành công.

Job kiểm tra robots, terms gate, host/HTTPS/redirect, giới hạn kích thước/timeout/số bài và crawl-delay. Không thực thi JavaScript website. Lỗi nguồn/parse/schema giữ sự kiện hợp lệ trước đó, ghi cảnh báo; không xóa lịch vì nguồn lỗi. Cache trình duyệt cũng giữ lịch hợp lệ khi không tải được JSON mới.

`npm run banners:sync` trả exit **2** nếu không có bản ghi live hợp lệ; lỗi cấu hình/file cũ trả exit **1**. Import được kiểm duyệt có thể thành công trong khi live sync vẫn chưa hoạt động. Job log ghi từng lần thử; timestamp public chỉ thay khi dữ liệu/trạng thái có thay đổi ý nghĩa, tránh commit chỉ vì đồng hồ thay đổi. Do đó timestamp public là snapshot, không phải heartbeat; xem Actions để biết lần chạy mới nhất.

## GitHub Actions và Vercel

`.github/workflows/update-banners.yml` chạy mỗi ngày **02:17 UTC / 09:17 Việt Nam** và hỗ trợ **Run workflow**. Cron chỉ được GitHub chạy từ default branch sau khi workflow được merge vào `main`; trước merge có thể chọn branch feature khi chạy thủ công. Lịch GitHub có thể trễ, không phải SLA.

Workflow lưu `banner-sync-report.json` thành artifact **banner-source-diagnostics-<run_id>-<attempt>** trong 7 ngày, kể cả khi sync lỗi. JSON report cũng được in vào log; đây là nơi kiểm tra riêng HTTP404/403, HTML/MIME và redirect của Global. Thu thập metadata không tự cấp quyền đọc bài khi terms chưa được duyệt.

Job chỉ cấp `contents: write` để commit JSON hợp lệ có thay đổi, dùng `GITHUB_TOKEN` có sẵn; không cần API key trả phí. Chạy tests/build trước khi commit. Khi nguồn lỗi, vẫn lưu trạng thái có thay đổi và giữ dữ liệu cũ, sau đó đánh dấu workflow thất bại để không che giấu lỗi. Nếu branch protection chặn bot push, cần quyền cập nhật dữ liệu qua quy trình PR theo chính sách repository; workflow không bỏ qua bảo vệ.

Vercel: Framework **Vite**, Node **24.x**, build `npm run build`, output `dist`. `public/data/banners.json` được đóng gói vào bản triển khai. Khi repository cập nhật dữ liệu bằng commit, Git integration triển khai lại theo cấu hình branch của Vercel. Không cần server scrape, cron Vercel hoặc secrets trên client. Cần kiểm tra Git integration/auto-deploy của dự án Vercel; việc có workflow trong mã không chứng minh một deployment đã chạy.
