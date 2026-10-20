import { useId, useState, type FormEvent } from "react";
import { Download, FileCheck2 } from "lucide-react";
import { buildManualBanner, type ManualBannerInput } from "./manual-banner";
import type { Category, Server } from "./banners";
import "./manual-banner.css";

const empty: ManualBannerInput = {
  id: "",
  eventId: "",
  name: "",
  server: "Global",
  category: "event",
  sourceUrl: "",
  sourceName: "",
  publishedLocal: "",
  publishedOffset: "",
  startLocal: "",
  startOffset: "",
  endLocal: "",
  endOffset: "",
  operators: "",
  reviewed: false,
};

export default function ManualBannerForm() {
  const [input, setInput] = useState<ManualBannerInput>(empty);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const sectionId = useId();
  function change<K extends keyof ManualBannerInput>(
    key: K,
    value: ManualBannerInput[K],
  ) {
    setInput((old) => ({
      ...old,
      [key]: value,
      ...(key !== "reviewed" ? { reviewed: false } : {}),
    }));
    setError("");
    setMessage("");
  }
  function field(
    key: "id" | "eventId" | "name" | "sourceUrl" | "sourceName",
    label: string,
    hint?: string,
  ) {
    return (
      <label className="field">
        <span>{label}</span>
        <input
          type={key === "sourceUrl" ? "url" : "text"}
          required
          maxLength={key === "sourceUrl" ? 3000 : 200}
          value={input[key]}
          onChange={(e) => change(key, e.target.value)}
        />
        {hint && <small>{hint}</small>}
      </label>
    );
  }
  function timeField(
    label: string,
    local: "publishedLocal" | "startLocal" | "endLocal",
    offset: "publishedOffset" | "startOffset" | "endOffset",
    required = false,
  ) {
    return (
      <div className="manual-time-row">
        <label className="field">
          <span>
            {label}
            {required ? " *" : " · nếu được công bố"}
          </span>
          <input
            type="datetime-local"
            required={required}
            value={input[local]}
            onChange={(e) => change(local, e.target.value)}
          />
        </label>
        <label className="field">
          <span>Offset của {label.toLowerCase()}</span>
          <input
            type="text"
            placeholder="Z hoặc +07:00"
            aria-label={`Offset ${label.toLowerCase()}`}
            required={required || !!input[local]}
            maxLength={6}
            value={input[offset]}
            onChange={(e) => change(offset, e.target.value)}
          />
        </label>
      </div>
    );
  }
  function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const banner = buildManualBanner(input, new Date().toISOString());
      const body =
        JSON.stringify({ schemaVersion: 1, events: [banner] }, null, 2) + "\n";
      const url = URL.createObjectURL(
        new Blob([body], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "reviewed-banners.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage(
        "Đã tạo tệp nhập. Lịch công khai và dữ liệu tài nguyên chưa thay đổi.",
      );
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể tạo tệp nhập.",
      );
      setMessage("");
    }
  }
  return (
    <details className="card manual-banner-form">
      <summary>
        <FileCheck2 size={17} />
        <span>
          Chuẩn bị banner kiểm duyệt thủ công
          <small>Dùng thông báo gốc khi nguồn tự động chưa đọc được</small>
        </span>
      </summary>
      <div className="manual-form-content">
        <p id={`${sectionId}-notice`} className="manual-notice">
          Biểu mẫu chỉ tạo tệp JSON để người quản lý nhập và review qua Git.
          Không tự công bố banner, không gọi nguồn từ trình duyệt và không thay
          đổi tài nguyên đã lưu.
        </p>
        <form onSubmit={download} aria-describedby={`${sectionId}-notice`}>
          <div className="manual-pair">
            <label className="field">
              <span>Server của thông báo</span>
              <select
                aria-label="Server nhập thủ công"
                value={input.server}
                onChange={(e) => change("server", e.target.value as Server)}
              >
                <option value="Global">Global</option>
                <option value="CN">CN</option>
              </select>
            </label>
            <label className="field">
              <span>Loại sự kiện</span>
              <select
                aria-label="Loại sự kiện nhập thủ công"
                value={input.category}
                onChange={(e) => change("category", e.target.value as Category)}
              >
                <option value="event">Sự kiện</option>
                <option value="limited">Limited</option>
                <option value="anniversary">Anniversary</option>
                <option value="rerun">Rerun</option>
                <option value="standard">Standard banner</option>
              </select>
            </label>
          </div>
          {field("name", "Tên sự kiện theo thông báo")}
          <div className="manual-pair">
            {field("id", "ID bản ghi", "ID riêng cho bản ghi trên server này.")}
            {field(
              "eventId",
              "Khóa đối chiếu eventId",
              "Chỉ dùng chung CN/Global khi đã xác minh cùng sự kiện; rerun cần khóa riêng.",
            )}
          </div>
          {field(
            "sourceUrl",
            "Link thông báo gốc",
            "Dán URL bài chính thức đúng server. Trang chủ không đủ bằng chứng.",
          )}
          {field("sourceName", "Tên nguồn")}
          {timeField("Ngày đăng", "publishedLocal", "publishedOffset", true)}
          <p className="manual-time-help">
            Nhập offset được nguồn xác nhận, không lấy múi giờ thiết bị làm mặc
            định. Bỏ trống ngày/Operator chưa được thông báo; không dùng ngày
            đăng làm ngày bắt đầu.
          </p>
          {timeField("Ngày bắt đầu", "startLocal", "startOffset")}
          {timeField("Ngày kết thúc", "endLocal", "endOffset")}
          <label className="field">
            <span>Operator đã được thông báo xác nhận · không bắt buộc</span>
            <textarea
              rows={2}
              value={input.operators}
              onChange={(e) => change("operators", e.target.value)}
            />
            <small>
              Mỗi tên một dòng hoặc ngăn bằng dấu phẩy. Công bố CN không xác
              nhận Operator Global.
            </small>
          </label>
          <label className="manual-review">
            <input
              type="checkbox"
              required
              checked={input.reviewed}
              onChange={(e) => change("reviewed", e.target.checked)}
            />
            <span>
              Tôi đã đọc thông báo gốc và xác minh server, ngày đăng, các ngày
              sự kiện và Operator đã nhập. Mọi lần sửa sẽ yêu cầu xác nhận lại.
            </span>
          </label>
          {error && (
            <p role="alert" className="manual-form-error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="manual-form-success">
              {message}
            </p>
          )}
          <button type="submit" className="manual-download">
            <Download size={14} />
            Tải JSON đã kiểm duyệt
          </button>
          <p className="manual-import-next">
            Sau khi tải: người quản lý chạy{" "}
            <code>npm run banners:check -- reviewed-banners.json</code>, sau đó
            nhập bằng{" "}
            <code>npm run banners:import -- reviewed-banners.json</code>, xem
            diff của curated/public JSON rồi commit và tạo PR. Xuất tệp không
            chứng minh đồng bộ live thành công.
          </p>
        </form>
      </div>
    </details>
  );
}
