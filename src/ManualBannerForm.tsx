import { useId, useState, type FormEvent } from "react";
import { Download, ExternalLink, FileCheck2, ScanText } from "lucide-react";
import {
  buildReviewedPackage,
  isAnnouncementUrl,
  type ManualBannerInput,
  type ManualReviewPackage,
  type ManualEvidenceField,
} from "./manual-banner";
import { formatSourceDate, type Category, type Server } from "./banners";
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
  publicationMode: "instant",
  publicationKind: "published",
  publishedDay: "",
  startLocal: "",
  startOffset: "",
  endLocal: "",
  endOffset: "",
  operators: "",
  reviewed: false,
  reviewer: "",
  eventQuote: "",
  publishedQuote: "",
  startQuote: "",
  endQuote: "",
  operatorsQuote: "",
};

const evidenceLabels: Record<ManualEvidenceField, string> = {
  event: "Sự kiện và server",
  publishedAt: "Ngày đăng/cập nhật và độ chính xác nguồn",
  startAt: "Ngày bắt đầu",
  endAt: "Ngày kết thúc",
  operators: "Operator",
};

export default function ManualBannerForm() {
  const [input, setInput] = useState<ManualBannerInput>(empty);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ManualReviewPackage | null>(null);
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
    if (key !== "reviewed") setPreview(null);
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
      if (!preview)
        throw new Error("Xem bản kiểm tra trước khi xác nhận và tải JSON.");
      const reviewed = buildReviewedPackage(input, new Date().toISOString());
      const body = JSON.stringify(reviewed, null, 2) + "\n";
      const url = URL.createObjectURL(
        new Blob([body], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "reviewed-banners.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage(
        "Đã tạo tệp nhập kèm hồ sơ kiểm duyệt. Lịch công khai và dữ liệu tài nguyên chưa thay đổi.",
      );
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể tạo tệp nhập.",
      );
      setMessage("");
    }
  }
  function preparePreview() {
    try {
      // Preview is explicitly a draft. The final export independently requires
      // the user's checkbox and runs all validation again.
      setPreview(
        buildReviewedPackage(
          { ...input, reviewed: true },
          new Date().toISOString(),
        ),
      );
      setInput((old) => ({ ...old, reviewed: false }));
      setError("");
      setMessage("");
    } catch (cause) {
      setPreview(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Không thể chuẩn bị bản kiểm tra.",
      );
    }
  }
  function quoteField(
    key:
      | "eventQuote"
      | "publishedQuote"
      | "startQuote"
      | "endQuote"
      | "operatorsQuote",
    label: string,
  ) {
    return (
      <label className="field manual-quote">
        <span>{label}</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={input[key] || ""}
          onChange={(e) => change(key, e.target.value)}
        />
        <small>
          Chép nguyên văn từ thông báo, gồm múi giờ nếu nguồn có giờ. Nội dung
          này được lưu cùng hồ sơ kiểm duyệt.
        </small>
      </label>
    );
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
          {isAnnouncementUrl(input.sourceUrl.trim(), input.server) && (
            <a
              className="manual-source-link"
              href={input.sourceUrl.trim()}
              target="_blank"
              rel="noopener noreferrer"
            >
              Mở thông báo gốc để kiểm tra <ExternalLink size={13} />
            </a>
          )}
          {field("sourceName", "Tên nguồn")}
          <div className="manual-pair">
            <label className="field">
              <span>Loại ngày nguồn</span>
              <select
                aria-label="Loại ngày nguồn"
                value={input.publicationKind || "published"}
                onChange={(e) =>
                  change(
                    "publicationKind",
                    e.target.value as "published" | "updated",
                  )
                }
              >
                <option value="published">Ngày đăng</option>
                <option value="updated">Ngày cập nhật nguồn</option>
              </select>
            </label>
            <label className="field">
              <span>Độ chính xác ngày nguồn</span>
              <select
                aria-label="Độ chính xác ngày nguồn"
                value={input.publicationMode || "instant"}
                onChange={(e) =>
                  change("publicationMode", e.target.value as "instant" | "day")
                }
              >
                <option value="instant">Có ngày, giờ và offset nguồn</option>
                <option value="day">Chỉ có ngày, chưa có giờ</option>
              </select>
            </label>
          </div>
          {input.publicationMode === "day" ? (
            <label className="field">
              <span>Ngày nguồn · không có giờ</span>
              <input
                type="date"
                required
                aria-label="Ngày nguồn chỉ có ngày"
                value={input.publishedDay || ""}
                onChange={(e) => change("publishedDay", e.target.value)}
              />
            </label>
          ) : (
            timeField(
              input.publicationKind === "updated"
                ? "Ngày cập nhật"
                : "Ngày đăng",
              "publishedLocal",
              "publishedOffset",
              true,
            )
          )}
          <p className="manual-time-help">
            {input.publicationMode === "day"
              ? "Giữ nguyên ngày lịch ghi trên nguồn, không tự thêm giờ 00:00 hoặc múi giờ. Ngày bắt đầu/kết thúc sự kiện nếu nhập vẫn phải có giờ và offset được xác nhận."
              : "Nhập offset được nguồn xác nhận, không lấy múi giờ thiết bị làm mặc định."}{" "}
            Bỏ trống ngày/Operator chưa được thông báo; không dùng ngày đăng/cập
            nhật làm ngày bắt đầu.
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
          <fieldset className="manual-evidence-fields">
            <legend>Hồ sơ dẫn chứng từ thông báo</legend>
            <p className="manual-notice">
              Những trích dẫn dưới đây là bằng chứng do người kiểm duyệt cung
              cấp. Website không đọc nguồn hoặc tự xác minh nội dung của chúng.
            </p>
            <label className="field">
              <span>Người kiểm duyệt</span>
              <input
                type="text"
                maxLength={200}
                value={input.reviewer || ""}
                onChange={(e) => change("reviewer", e.target.value)}
              />
              <small>
                Tên sẽ được lưu trong hồ sơ review trên Git; không nhập thông
                tin liên hệ riêng tư.
              </small>
            </label>
            {quoteField("eventQuote", "Trích dẫn xác nhận sự kiện và server")}
            {quoteField(
              "publishedQuote",
              "Trích dẫn ngày đăng/cập nhật và độ chính xác nguồn",
            )}
            {input.startLocal.trim() &&
              quoteField("startQuote", "Trích dẫn ngày bắt đầu")}
            {input.endLocal.trim() &&
              quoteField("endQuote", "Trích dẫn ngày kết thúc")}
            {input.operators.trim() &&
              quoteField("operatorsQuote", "Trích dẫn Operator được xác nhận")}
          </fieldset>
          <button
            type="button"
            className="manual-preview-button"
            onClick={preparePreview}
          >
            <ScanText size={14} />
            Xem bản kiểm tra trước khi tải
          </button>
          {preview && (
            <section
              className="manual-evidence-preview"
              aria-label="Bản kiểm tra banner"
            >
              <div className="manual-draft-label">
                BẢN KIỂM TRA · CHƯA CÔNG BỐ
              </div>
              <h4>{preview.events[0].name}</h4>
              <p>
                Dữ liệu dưới đây được chuẩn hóa từ thông tin bạn nhập, chưa phải
                kết quả đọc nguồn tự động.
              </p>
              <dl>
                <dt>Server / ID</dt>
                <dd>
                  {preview.events[0].server} / {preview.events[0].id}
                </dd>
                <dt>Thông báo gốc</dt>
                <dd>
                  <a
                    href={preview.events[0].sources[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {preview.events[0].sources[0].url}
                    <ExternalLink size={12} />
                  </a>
                </dd>
                <dt>Phân loại sau khi review được chấp nhận</dt>
                <dd>
                  Chính thức · kiểm duyệt thủ công /{" "}
                  {preview.events[0].scheduleState === "announced"
                    ? "Đã công bố, chưa có ngày"
                    : "Có ngày theo dẫn chứng"}
                </dd>
                <dt>Ngày đăng/cập nhật nguồn</dt>
                <dd>
                  {formatSourceDate(preview.events[0].sources[0], "UTC")}
                  <small>
                    Giá trị JSON: {preview.events[0].sources[0].publishedAt}
                  </small>
                </dd>
                <dt>Bắt đầu / kết thúc chuẩn hóa UTC</dt>
                <dd>
                  {preview.events[0].startAt || "Chưa xác nhận"} /{" "}
                  {preview.events[0].endAt || "Chưa xác nhận"}
                </dd>
                <dt>Operator</dt>
                <dd>
                  {preview.events[0].operators.join(" · ") || "Chưa xác nhận"}
                </dd>
                <dt>Người kiểm duyệt</dt>
                <dd>{preview.review.reviewer}</dd>
              </dl>
              <div className="manual-preview-quotes">
                {preview.review.evidence.map((item) => (
                  <div key={item.field}>
                    <strong>{evidenceLabels[item.field]}</strong>
                    <blockquote>{item.quote}</blockquote>
                  </div>
                ))}
              </div>
              <details className="manual-json-preview">
                <summary>Xem JSON chuẩn bị nhập</summary>
                <pre>{JSON.stringify(preview, null, 2)}</pre>
              </details>
              <p>
                Chỉ được công bố sau khi người quản lý kiểm tra hồ sơ, chạy
                check/import và review thay đổi qua Git. Xuất JSON không chứng
                minh quyền thu thập hoặc đồng bộ live.
              </p>
            </section>
          )}
          <label className="manual-review">
            <input
              type="checkbox"
              required
              checked={input.reviewed}
              onChange={(e) => change("reviewed", e.target.checked)}
            />
            <span>
              Tôi đã đọc thông báo gốc và xác minh server, ngày đăng/cập nhật,
              các ngày sự kiện và Operator đã nhập. Mọi lần sửa sẽ yêu cầu xác
              nhận lại.
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
          <button
            type="submit"
            className="manual-download"
            disabled={!preview || !input.reviewed}
          >
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
