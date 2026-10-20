import ManualBannerForm from "./ManualBannerForm";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  ExternalLink,
} from "lucide-react";
import {
  formatBannerTime,
  formatSourceDate,
  phase,
  type Banner,
  type Catalog,
} from "./banners";
import "./banner-calendar.css";

type Props = {
  catalog: Catalog | null;
  loading: boolean;
  error: string | null;
  onSelect: (banner: Banner) => void;
  timeZone: string;
  onTimeZoneChange: (zone: string) => void;
};
type Phase = "ongoing" | "upcoming" | "ended" | "undated";
const labels = {
  official: "CHÍNH THỨC",
  predicted: "DỰ ĐOÁN",
  unknown: "CHƯA XÁC ĐỊNH",
};
const categories = {
  limited: "Limited",
  anniversary: "Anniversary",
  rerun: "Rerun",
  standard: "Standard banner",
  event: "Sự kiện",
};
const confidence = { low: "Thấp", medium: "Trung bình", high: "Cao" };
const tabs: [Phase, string][] = [
  ["ongoing", "Đang diễn ra"],
  ["upcoming", "Sắp tới"],
  ["ended", "Đã kết thúc"],
  ["undated", "Chưa có lịch"],
];

function countdown(instant: string, now: number): string {
  const minutes = Math.ceil((Date.parse(instant) - now) / 60000);
  if (minutes <= 0) return "Đã đến mốc thời gian này";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0
    ? `Còn ${days} ngày ${hours} giờ`
    : hours > 0
      ? `Còn ${hours} giờ ${minutes % 60} phút`
      : `Còn ${minutes} phút`;
}

export default function BannerCalendar({
  catalog,
  loading,
  error,
  onSelect,
  timeZone,
  onTimeZoneChange,
}: Props) {
  const [server, setServer] = useState("all");
  const [activeTab, setActiveTab] = useState<Phase>("upcoming");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const serverEvents = useMemo(
    () =>
      (catalog?.events ?? []).filter(
        (event) => server === "all" || event.server === server,
      ),
    [catalog, server],
  );
  const events = serverEvents
    .filter((event) => phase(event, now) === activeTab)
    .sort((a, b) => {
      const left = a.startAt ?? a.estimate?.central ?? "9999";
      const right = b.startAt ?? b.estimate?.central ?? "9999";
      return (
        (activeTab === "ended"
          ? right.localeCompare(left)
          : left.localeCompare(right)) || a.name.localeCompare(b.name)
      );
    });
  const lastSuccess = catalog?.sync.lastSuccessAt;
  const stale =
    lastSuccess && now - Date.parse(lastSuccess) > 48 * 60 * 60 * 1000;
  const warnings = [
    ...new Set([...(error ? [error] : []), ...(catalog?.sync.warnings ?? [])]),
  ];
  const format = (date: string) => formatBannerTime(date, timeZone);

  return (
    <section className="banner-calendar" aria-label="Lịch banner Arknights">
      <div className="card calendar-intro">
        <div className="section-title">
          <div>
            <h2>Lịch banner & sự kiện</h2>
            <p>
              Công bố CN và Global được xác minh độc lập. Dự đoán không phải
              lịch chính thức.
            </p>
          </div>
          <CalendarDays size={21} />
        </div>
        <div className="calendar-controls">
          <label className="field">
            <span>Server</span>
            <select
              aria-label="Lọc server"
              value={server}
              onChange={(e) => setServer(e.target.value)}
            >
              <option value="all">Tất cả server</option>
              <option value="Global">Global</option>
              <option value="CN">CN</option>
            </select>
          </label>
          <label className="field">
            <span>Múi giờ hiển thị</span>
            <select
              aria-label="Múi giờ lịch banner"
              value={timeZone}
              onChange={(e) => onTimeZoneChange(e.target.value)}
            >
              <option value="Asia/Ho_Chi_Minh">Việt Nam · UTC+07:00</option>
              <option value="UTC">UTC · UTC+00:00</option>
              <option value="Asia/Shanghai">Trung Quốc · UTC+08:00</option>
            </select>
          </label>
        </div>
        <div className="calendar-sync-meta">
          <span>
            <Clock3 size={13} /> Đồng bộ thành công:{" "}
            {lastSuccess
              ? format(lastSuccess)
              : "Chưa có lần đồng bộ thực tế thành công"}
          </span>
          {catalog?.sync.lastAttemptAt && (
            <span>
              Lần kiểm tra được lưu: {format(catalog.sync.lastAttemptAt)}
            </span>
          )}
        </div>
        <p className="calendar-time-note">
          Thời gian bên dưới theo {timeZone}. Di chuột lên ngày để xem timestamp
          gốc; ngày bắt đầu chỉ được dùng khi có múi giờ rõ ràng.
        </p>
      </div>
      <ManualBannerForm />
      {(warnings.length > 0 ||
        stale ||
        catalog?.sync.status === "never" ||
        catalog?.sync.status === "error" ||
        catalog?.sync.status === "partial") && (
        <div className="calendar-warning" role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {error
                ? "Không tải được lịch mới"
                : stale
                  ? "Dữ liệu có thể đã cũ"
                  : "Dữ liệu chưa đồng bộ đầy đủ"}
            </strong>
            <p>
              Dữ liệu hợp lệ gần nhất được giữ lại. Hãy kiểm tra thông báo nguồn
              trước khi lập kế hoạch.
            </p>
            {stale && <p>Lần đồng bộ thực tế gần nhất đã quá 48 giờ.</p>}
            {warnings.length > 0 && (
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {catalog?.events.some((event) => event.origin === "manual") && (
        <p className="calendar-manual-note">
          Lịch có bản ghi được kiểm duyệt thủ công; nguồn gốc được ghi riêng
          trên từng sự kiện.
        </p>
      )}
      <div
        className="calendar-tabs"
        role="tablist"
        aria-label="Trạng thái thời gian banner"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            id={`calendar-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            aria-controls="calendar-events"
            className={activeTab === key ? "selected" : ""}
            onClick={() => setActiveTab(key)}
          >
            {label}
            <span>
              {serverEvents.filter((event) => phase(event, now) === key).length}
            </span>
          </button>
        ))}
      </div>
      <div
        id="calendar-events"
        role="tabpanel"
        aria-labelledby={`calendar-tab-${activeTab}`}
        aria-busy={loading}
      >
        {loading && !catalog && (
          <div className="card calendar-empty" role="status">
            <Clock3 size={25} />
            <strong>Đang tải lịch banner…</strong>
          </div>
        )}
        {!loading && events.length === 0 && (
          <div className="card calendar-empty">
            <CalendarDays size={30} />
            <strong>
              {catalog?.events.length
                ? "Chưa có sự kiện phù hợp với bộ lọc"
                : "Chưa có lịch đã được xác minh"}
            </strong>
            <p>
              {catalog?.events.length
                ? "Bạn có thể đổi server hoặc xem mục Chưa có lịch."
                : "Chưa có dữ liệu nguồn chính thức đã được xác minh trong bản lịch này. Không có ngày hoặc Operator nào được tự tạo."}
            </p>
            <p>
              Những sự kiện đã công bố nhưng chưa có ngày nằm trong mục “Chưa có
              lịch”. Bạn vẫn có thể nhập ngày thủ công trong Kế hoạch banner.
            </p>
          </div>
        )}
        <div className="calendar-event-grid">
          {events.map((event) => {
            const eventPhase = phase(event, now);
            const operatorsConfirmed = event.sources.some(
              (source) =>
                source.kind === "official" &&
                source.server === event.server &&
                source.confirmedFields.includes("operators"),
            );
            const actualStart = event.startAt;
            const estimatedStart = event.estimate?.central;
            return (
              <article
                className="card calendar-event"
                key={`${event.server}:${event.eventId}`}
              >
                <div className="calendar-event-top">
                  <span className={`banner-status status-${event.status}`}>
                    {labels[event.status]}
                  </span>
                  <span className="calendar-server">{event.server}</span>
                </div>
                <div className="calendar-category">
                  {categories[event.category]} · {event.id}
                </div>
                <h3>{event.name}</h3>
                <p className="calendar-operators">
                  <span>
                    {operatorsConfirmed
                      ? "Operator đã xác nhận"
                      : event.status === "predicted"
                        ? "Operator tham chiếu từ CN"
                        : "Operator"}
                  </span>
                  {event.operators.length
                    ? event.operators.join(" · ")
                    : "Chưa xác nhận"}
                </p>
                {actualStart ? (
                  <div className="calendar-dates">
                    <div>
                      <span>
                        {event.status === "official"
                          ? "Bắt đầu chính thức"
                          : "Bắt đầu tham khảo"}
                      </span>
                      <time dateTime={actualStart} title={actualStart}>
                        {format(actualStart)}
                      </time>
                    </div>
                    <div>
                      <span>Kết thúc</span>
                      {event.endAt ? (
                        <time dateTime={event.endAt} title={event.endAt}>
                          {format(event.endAt)}
                        </time>
                      ) : (
                        <strong>Chưa được công bố</strong>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="calendar-undated">
                    {event.status === "official" &&
                    event.scheduleState === "announced"
                      ? "Đã công bố sự kiện · Chưa công bố ngày"
                      : event.estimate
                        ? "Ngày bên dưới là dự đoán, chưa được Global xác nhận."
                        : "Chưa đủ dữ liệu để xác định lịch."}
                  </div>
                )}
                {event.estimate && !actualStart && (
                  <div className="calendar-estimate">
                    <div>
                      <strong>Khoảng ngày dự đoán</strong>
                      <span>
                        Tin cậy: {confidence[event.estimate.confidence]}
                      </span>
                    </div>
                    <p>
                      <time
                        dateTime={event.estimate.earliest}
                        title={event.estimate.earliest}
                      >
                        {format(event.estimate.earliest)}
                      </time>
                      <span> → </span>
                      <time
                        dateTime={event.estimate.latest}
                        title={event.estimate.latest}
                      >
                        {format(event.estimate.latest)}
                      </time>
                    </p>
                    <p>
                      Trung tâm:{" "}
                      <time
                        dateTime={event.estimate.central}
                        title={event.estimate.central}
                      >
                        {format(event.estimate.central)}
                      </time>
                    </p>
                    <p>{event.estimate.explanation}</p>
                    <small>
                      {event.estimate.sampleSize} cặp sự kiện đối chiếu CN /
                      Global.
                    </small>
                  </div>
                )}
                {(actualStart || estimatedStart) && (
                  <p
                    className={`calendar-countdown ${event.status === "predicted" || (!actualStart && event.estimate) ? "estimated" : ""}`}
                  >
                    <Clock3 size={14} />
                    {actualStart
                      ? eventPhase === "ended"
                        ? "Sự kiện đã kết thúc"
                        : eventPhase === "ongoing"
                          ? event.endAt
                            ? `Kết thúc: ${countdown(event.endAt, now).toLowerCase()}`
                            : "Đã bắt đầu · Chưa rõ ngày kết thúc"
                          : countdown(actualStart, now)
                      : `Mốc dự đoán: ${countdown(estimatedStart!, now).toLowerCase()}`}
                  </p>
                )}
                <div className="calendar-sources">
                  <span>THÔNG BÁO NGUỒN</span>
                  {event.sources.map((source, index) => (
                    <div key={`${source.url}:${index}`}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.name} · {source.server}
                        <ExternalLink size={11} />
                      </a>
                      <small>
                        <time
                          dateTime={source.publishedAt}
                          title={source.publishedAt}
                        >
                          {formatSourceDate(source, timeZone)}
                        </time>
                        {source.kind !== "official" && " · Tham khảo cộng đồng"}
                      </small>
                    </div>
                  ))}
                </div>
                <div className="calendar-event-bottom">
                  <span>
                    {event.origin === "manual"
                      ? "Kiểm duyệt thủ công"
                      : event.origin === "prediction"
                        ? event.estimate
                          ? "Ước tính từ lịch đối chiếu"
                          : "Chưa đủ dữ liệu đối chiếu"
                        : "Đọc từ nguồn chính thức"}
                    <small>
                      Cập nhật:{" "}
                      <time dateTime={event.updatedAt} title={event.updatedAt}>
                        {format(event.updatedAt)}
                      </time>
                    </small>
                  </span>
                  <button
                    type="button"
                    className="calendar-plan"
                    disabled={!(actualStart || estimatedStart)}
                    onClick={() => onSelect(event)}
                  >
                    {!actualStart && estimatedStart
                      ? "Dự báo 3 kịch bản"
                      : "Lập kế hoạch"}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
