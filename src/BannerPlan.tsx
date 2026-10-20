import "./banner-plan.css";
import { type Banner, formatBannerTime } from "./banners";
import { bannerKey, planDates } from "./banner-plan";
import { daysBetween, forecast, type Resources } from "./calculator";
type Props = {
  events: Banner[];
  selectedKey: string;
  onSelect: (key: string) => void;
  timeZone: string;
  today: string;
  resources: Resources;
  daily: number;
  weekly: number;
  convert: boolean;
};
export default function BannerPlan(p: Props) {
  const selected = p.events.find((e) => bannerKey(e) === p.selectedKey);
  const dates = planDates(selected, p.timeZone);
  return (
    <div className="banner-plan">
      <label className="field">
        <span>Chọn từ lịch banner</span>
        <select
          aria-label="Chọn từ lịch banner"
          value={p.selectedKey}
          onChange={(e) => p.onSelect(e.target.value)}
        >
          <option value="">Ngày tự chọn (giữ kế hoạch đã lưu)</option>
          {p.events.map((e) => (
            <option
              key={bannerKey(e)}
              value={bannerKey(e)}
              disabled={!e.startAt && !e.estimate}
            >
              {e.server} · {e.name} ·{" "}
              {e.startAt
                ? "Chính thức"
                : e.estimate
                  ? "Ngày dự đoán"
                  : "Chưa có ngày"}
            </option>
          ))}
        </select>
      </label>
      {p.selectedKey && !selected && (
        <p className="hint">
          Sự kiện đã chọn chưa có trong lịch hiện tại. Đang dùng kế hoạch tự
          chọn đã lưu.
        </p>
      )}
      {selected && (
        <>
          <p className="plan-origin">
            {selected.server} ·{" "}
            {selected.startAt
              ? "Ngày được công bố chính thức"
              : "Ngày dự đoán, chưa có lịch chính thức"}{" "}
            · {p.timeZone}
          </p>
          {selected.estimate && !selected.startAt && (
            <p className="hint">
              {selected.status === "official"
                ? "Sự kiện đã được công bố; các ngày dưới đây vẫn là ước tính. "
                : ""}
              {selected.estimate.explanation}
            </p>
          )}
          <div
            className={`scenario-grid ${dates.length === 1 ? "single" : ""}`}
          >
            {dates.map((d) => (
              <div className="scenario" key={d.key}>
                <span>
                  {d.label}
                  {d.predicted ? " · dự đoán" : ""}
                </span>
                <strong>
                  {forecast(
                    p.resources,
                    daysBetween(p.today, d.date),
                    p.daily,
                    p.weekly,
                    p.convert,
                  ).toLocaleString("vi-VN")}{" "}
                  <small>pulls</small>
                </strong>
                <time dateTime={d.instant}>
                  {formatBannerTime(d.instant, p.timeZone)}
                </time>
                {d.date < p.today && (
                  <small>Ngày đã qua · dùng số dư hiện tại</small>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
