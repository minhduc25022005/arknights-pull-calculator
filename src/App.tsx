import { useState } from "react";
import BannerCalendar from "./BannerCalendar";
import BannerPlan from "./BannerPlan";
import { useBannerCatalog } from "./useBannerCatalog";
import { dayInZone, type Banner } from "./banners";
import { bannerKey, planDates } from "./banner-plan";
import {
  loadPlanner,
  PLANNER_KEY,
  type PlannerData as Data,
} from "./planner-storage";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Hexagon,
  LayoutDashboard,
  CalendarDays,
  Crosshair,
  ArrowUpRight,
  Plus,
  Trash2,
  Shield,
  Check,
  ChevronRight,
  Menu,
  Download,
} from "lucide-react";
import { dateKey, daysBetween, forecast, totalPulls } from "./calculator";

const today = dateKey();
const later = new Date();
later.setDate(later.getDate() + 60);
const defaults: Data = {
  resources: { orundum: 0, prime: 0, tickets: 0 },
  entries: [],
  banner: dateKey(later),
  target: 300,
  daily: 100,
  weekly: 1700,
  convert: true,
  name: "Banner tiếp theo",
};
function load(): Data {
  try {
    return loadPlanner(localStorage, defaults);
  } catch {
    return defaults;
  }
}
function preference(key: string, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
const fmt = (n: number) => n.toLocaleString("vi-VN");
export default function App() {
  const [data, setData] = useState<Data>(load);
  const [tab, setTab] = useState("overview");
  const {
    catalog,
    loading: catalogLoading,
    error: catalogError,
  } = useBannerCatalog();
  const [selectedKey, setSelectedKey] = useState(() =>
    preference("rhodes-banner-plan-v1"),
  );
  const [timeZone, setTimeZone] = useState(() => {
    const value = preference("rhodes-banner-timezone-v1", "Asia/Ho_Chi_Minh");
    return ["Asia/Ho_Chi_Minh", "Asia/Shanghai", "UTC"].includes(value)
      ? value
      : "Asia/Ho_Chi_Minh";
  });
  function selectKey(key: string) {
    setSelectedKey(key);
    try {
      localStorage.setItem("rhodes-banner-plan-v1", key);
    } catch {
      /* Legacy resources remain independent. */
    }
  }
  function selectBanner(event: Banner) {
    selectKey(bannerKey(event));
    setTab("planner");
  }
  function changeTimeZone(value: string) {
    setTimeZone(value);
    try {
      localStorage.setItem("rhodes-banner-timezone-v1", value);
    } catch {
      /* Viewing preferences are optional. */
    }
  }
  const selectedBanner = catalog?.events.find(
    (e) => bannerKey(e) === selectedKey,
  );
  const selectedDates = planDates(selectedBanner, timeZone);
  const effectiveDate =
    selectedDates.find((d) => d.key === "central")?.date || data.banner;
  const planningToday = selectedBanner
    ? dayInZone(new Date().toISOString(), timeZone)
    : today;
  const [day, setDay] = useState(today);
  const [saved, setSaved] = useState("");
  const [storageError, setStorageError] = useState(false);
  function update(p: Partial<Data>) {
    setData((old) => {
      const next = { ...old, ...p };
      try {
        localStorage.setItem(PLANNER_KEY, JSON.stringify(next));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
      return next;
    });
  }
  const pulls = totalPulls(data.resources, data.convert),
    days = daysBetween(planningToday, effectiveDate),
    projected = forecast(
      data.resources,
      days,
      data.daily,
      data.weekly,
      data.convert,
    ),
    progress = Math.min(100, (pulls / Math.max(1, data.target)) * 100);
  const chartDays = Math.max(
    days,
    ...selectedDates.map((d) => daysBetween(planningToday, d.date)),
  );
  const sampleDays = [
    ...new Set([
      ...Array.from({ length: Math.min(chartDays, 12) + 1 }, (_, i) =>
        Math.round((i * chartDays) / Math.max(1, Math.min(chartDays, 12))),
      ),
      ...selectedDates.map((d) => daysBetween(planningToday, d.date)),
    ]),
  ].sort((a, b) => a - b);
  const chart = sampleDays.map((n) => ({
    day: n,
    pulls: forecast(data.resources, n, data.daily, data.weekly, data.convert),
  }));
  function dayLabel(n: number) {
    const d = new Date(planningToday + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  function record() {
    update({
      entries: [
        ...data.entries.filter((e) => e.date !== day),
        { date: day, ...data.resources },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    });
    setSaved(`Đã lưu tài nguyên ngày ${day}`);
  }
  function number(
    label: string,
    value: number,
    onChange: (n: number) => void,
    suffix?: string,
  ) {
    return (
      <label className="field">
        <span>{label}</span>
        <div>
          <input
            aria-label={label}
            type="number"
            min="0"
            max="100000000"
            value={value}
            onChange={(e) =>
              onChange(
                Math.max(
                  0,
                  Math.min(100000000, Math.floor(Number(e.target.value) || 0)),
                ),
              )
            }
          />
          {suffix && <small>{suffix}</small>}
        </div>
      </label>
    );
  }
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="#">
          <Hexagon size={35} />
          <span>
            RHODES ISLAND<small>RESOURCE TERMINAL</small>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav>
          {[
            [LayoutDashboard, "overview", "Tổng quan"],
            [CalendarDays, "history", "Nhật ký tài nguyên"],
            [Crosshair, "planner", "Kế hoạch banner"],
            [CalendarDays, "calendar", "Lịch banner"],
          ].map(([Icon, id, label]) => {
            const I = Icon as typeof Menu;
            return (
              <button
                key={id as string}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id as string)}
              >
                <I size={18} />
                {label as string}
                {tab === id && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="side-note">
          <Shield size={20} />
          <strong>Dữ liệu của bạn, trên máy bạn.</strong>
          <p>Tự động lưu trong trình duyệt. Không cần tài khoản.</p>
        </div>
        <div className="doctor">
          <div className="avatar">D</div>
          <div>
            Doctor<small>Local workspace</small>
          </div>
          <span className="online" />
        </div>
      </aside>
      <main>
        <header>
          <div className="crumb">
            Workspace <ChevronRight size={13} /> <span>Pull Calculator</span>
          </div>
          <span className="status">
            <i /> LOCAL STORAGE
          </span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">ARKNIGHTS / RESOURCE PLANNING</div>
              <h1>
                {tab === "history"
                  ? "Nhật ký tài nguyên"
                  : tab === "calendar"
                    ? "Lịch banner"
                    : tab === "planner"
                      ? "Kế hoạch banner"
                      : "Mỗi pull, một cơ hội."}
              </h1>
              <p>Theo dõi hôm nay. Sẵn sàng cho Operator ngày mai.</p>
            </div>
            <div className="date-chip">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString("vi-VN")}
            </div>
          </div>
          {storageError && (
            <div role="alert" className="notice">
              Không thể lưu trên trình duyệt. Hãy xuất dữ liệu trước khi đóng
              trang.
            </div>
          )}
          {tab === "calendar" && (
            <BannerCalendar
              catalog={catalog}
              loading={catalogLoading}
              error={catalogError}
              onSelect={selectBanner}
              timeZone={timeZone}
              onTimeZoneChange={changeTimeZone}
            />
          )}
          {tab !== "calendar" && (
            <>
              <section className="hero">
                <div className="hero-grid" />
                <div className="hero-copy">
                  <span className="tag">RECRUITMENT RESERVE</span>
                  <div className="hero-total">
                    {fmt(pulls)}
                    <span>pulls khả dụng</span>
                  </div>
                  <p>Tích lũy từng chút, tiến gần hơn đến mục tiêu.</p>
                  <div className="hero-meta">
                    <span>
                      <i />{" "}
                      {data.convert
                        ? "Đã tính quy đổi Originite Prime"
                        : "Chưa quy đổi Originite Prime"}
                    </span>
                    <span>600 Orundum = 1 pull</span>
                  </div>
                </div>
                <div className="hero-mark">
                  <Hexagon />
                  <span>R.I.</span>
                </div>
                <div className="hero-target">
                  <Crosshair size={21} />
                  <span>MỤC TIÊU BANNER</span>
                  <strong>
                    {fmt(data.target)} <small>pulls</small>
                  </strong>
                  <div className="progress">
                    <div style={{ width: `${progress}%` }} />
                  </div>
                  <p>
                    {Math.round(progress)}% hoàn thành{" "}
                    <span>{fmt(Math.max(0, data.target - pulls))} còn lại</span>
                  </p>
                </div>
              </section>
              {tab !== "history" && (
                <>
                  <div className="section-title">
                    <h2>Tài nguyên hiện tại</h2>
                    <span>Chỉnh sửa để tính tự động</span>
                  </div>
                  <section className="resource-grid">
                    {(["orundum", "prime", "tickets"] as const).map(
                      (key, i) => (
                        <div className={`resource card r${i}`} key={key}>
                          <div className="resource-head">
                            <span className="resource-icon">
                              {["◆", "⬡", "▰"][i]}
                            </span>
                            <span>0{i + 1}</span>
                          </div>
                          {number(
                            [
                              "Orundum",
                              "Originite Prime",
                              "Headhunting Permit",
                            ][i],
                            data.resources[key],
                            (n) =>
                              update({
                                resources: { ...data.resources, [key]: n },
                              }),
                          )}
                          <div className="resource-foot">
                            {
                              [
                                "600 = 1 pull",
                                "1 Prime = 180 Orundum",
                                "1 Permit = 1 pull",
                              ][i]
                            }
                            <span>
                              {fmt(
                                i === 0
                                  ? Math.floor(data.resources.orundum / 600)
                                  : i === 1
                                    ? Math.floor(
                                        (data.resources.prime * 180) / 600,
                                      )
                                    : data.resources.tickets,
                              )}{" "}
                              pulls <ArrowUpRight size={13} />
                            </span>
                          </div>
                        </div>
                      ),
                    )}
                  </section>
                  <div className="resource-actions">
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={data.convert}
                        onChange={(e) => update({ convert: e.target.checked })}
                      />{" "}
                      Quy đổi Originite Prime sang Orundum
                    </label>
                    <span>Không tính các vật phẩm chưa nhận</span>
                  </div>
                  <div className="lower-grid">
                    <section className="card chart-card">
                      <div className="section-title">
                        <div>
                          <h2>Dự báo tích lũy</h2>
                          <p>Số pull dự kiến từ hôm nay đến banner</p>
                        </div>
                        <span className="legend">
                          <i /> Pulls dự kiến
                        </span>
                      </div>
                      <div className="chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={chart}
                            margin={{
                              top: 15,
                              right: 12,
                              left: -20,
                              bottom: 0,
                            }}
                          >
                            <defs>
                              <linearGradient
                                id="fill"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor="#d8e99c"
                                  stopOpacity={0.25}
                                />
                                <stop
                                  offset="100%"
                                  stopColor="#d8e99c"
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              stroke="#292d31"
                              vertical={false}
                              strokeDasharray="3 4"
                            />
                            <XAxis
                              dataKey="day"
                              type="number"
                              domain={[0, "dataMax"]}
                              tickFormatter={dayLabel}
                              stroke="#6e757d"
                              fontSize={11}
                              tickLine={false}
                              axisLine={false}
                              minTickGap={25}
                            />
                            <YAxis
                              stroke="#6e757d"
                              fontSize={11}
                              tickLine={false}
                              axisLine={false}
                              domain={[0, "auto"]}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "#1a1f24",
                                border: "1px solid #343b40",
                                borderRadius: 8,
                                color: "#fff",
                              }}
                              labelFormatter={(v) => dayLabel(Number(v))}
                              formatter={(v) => [`${v} pulls`, "Dự kiến"]}
                            />
                            <ReferenceLine
                              y={data.target}
                              stroke="#646d50"
                              strokeDasharray="4 4"
                            />
                            {selectedDates.map((d) => (
                              <ReferenceLine
                                key={d.key}
                                x={daysBetween(planningToday, d.date)}
                                stroke={d.predicted ? "#d1ad79" : "#9dc8b3"}
                                strokeDasharray={
                                  d.predicted ? "4 4" : undefined
                                }
                                label={{
                                  value: d.predicted
                                    ? {
                                        early: "Sớm",
                                        central: "Trung tâm",
                                        late: "Muộn",
                                      }[d.key]
                                    : "Chính thức",
                                  position: "insideTopRight",
                                  fill: d.predicted ? "#d1ad79" : "#9dc8b3",
                                  fontSize: 9,
                                }}
                              />
                            ))}
                            <Area
                              type="monotone"
                              dataKey="pulls"
                              stroke="#d8e99c"
                              fill="url(#fill)"
                              strokeWidth={2}
                              strokeDasharray={
                                selectedBanner?.estimate &&
                                !selectedBanner.startAt
                                  ? "5 4"
                                  : undefined
                              }
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="chart-bottom">
                        <span>DỰ KIẾN TẠI BANNER</span>
                        <strong>
                          {fmt(projected)} <small>pulls</small>
                        </strong>
                        <span className="gain">
                          +{fmt(projected - pulls)} từ tích lũy
                        </span>
                      </div>
                    </section>
                    <section className="card planner">
                      <div className="section-title">
                        <h2>Banner tiếp theo</h2>
                        <Crosshair size={18} />
                      </div>
                      {(catalogError || catalog?.sync.status !== "ok") && (
                        <p className="hint">
                          Lịch tự động chưa đồng bộ đầy đủ. Xem trạng thái và
                          nguồn tại mục Lịch banner; kế hoạch tự chọn vẫn hoạt
                          động.
                        </p>
                      )}
                      <BannerPlan
                        events={catalog?.events || []}
                        selectedKey={selectedKey}
                        onSelect={selectKey}
                        timeZone={timeZone}
                        today={planningToday}
                        resources={data.resources}
                        daily={data.daily}
                        weekly={data.weekly}
                        convert={data.convert}
                      />
                      <label className="field">
                        <span>Múi giờ lịch đã chọn</span>
                        <select
                          aria-label="Múi giờ kế hoạch"
                          value={timeZone}
                          onChange={(e) => changeTimeZone(e.target.value)}
                        >
                          <option value="Asia/Ho_Chi_Minh">
                            Việt Nam · UTC+7
                          </option>
                          <option value="UTC">UTC</option>
                          <option value="Asia/Shanghai">
                            Trung Quốc · UTC+8
                          </option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Tên banner</span>
                        <input
                          value={selectedBanner?.name || data.name}
                          disabled={!!selectedBanner}
                          maxLength={100}
                          onChange={(e) => update({ name: e.target.value })}
                        />
                      </label>
                      <div className="two-fields">
                        <label className="field">
                          <span>Ngày bắt đầu</span>
                          <input
                            type="date"
                            min={today}
                            value={effectiveDate}
                            disabled={!!selectedBanner}
                            onChange={(e) =>
                              e.target.value &&
                              update({ banner: e.target.value })
                            }
                          />
                        </label>
                        {number("Mục tiêu pull", data.target, (n) =>
                          update({ target: Math.max(1, n) }),
                        )}
                      </div>
                      <div className="countdown">
                        <CalendarDays size={16} />
                        {effectiveDate < planningToday
                          ? "Banner đã qua"
                          : `Còn ${days} ngày để chuẩn bị`}
                        <span>
                          {projected >= data.target
                            ? "Đủ mục tiêu"
                            : "Cần tích lũy thêm"}
                        </span>
                      </div>
                      <div className="income-title">THU NHẬP DỰ KIẾN</div>
                      <div className="two-fields">
                        {number("Orundum / ngày", data.daily, (n) =>
                          update({ daily: n }),
                        )}
                        {number("Orundum / tuần", data.weekly, (n) =>
                          update({ weekly: n }),
                        )}
                      </div>
                      <p className="hint">
                        Mặc định: 100/ngày từ nhiệm vụ; 1.700/tuần gồm 500 nhiệm
                        vụ + 1.200 Annihilation. Điều chỉnh theo tài khoản; chưa
                        tính sự kiện, thẻ tháng và quà banner. Thu nhập tuần
                        được cộng sau mỗi 7 ngày.
                      </p>
                    </section>
                  </div>
                </>
              )}
              {tab !== "planner" && (
                <section className="card journal">
                  <div className="section-title">
                    <div>
                      <h2>Nhật ký tài nguyên</h2>
                      <p>Lưu số dư cuối ngày để nhìn lại hành trình.</p>
                    </div>
                    <div className="record">
                      <input
                        aria-label="Ngày ghi nhận"
                        type="date"
                        max={today}
                        value={day}
                        onChange={(e) =>
                          e.target.value && setDay(e.target.value)
                        }
                      />
                      <button
                        className="primary"
                        onClick={record}
                        disabled={day > today}
                      >
                        <Plus size={15} /> Lưu hôm nay
                      </button>
                    </div>
                  </div>
                  <div aria-live="polite" className="saved">
                    {saved && (
                      <>
                        <Check size={13} />
                        {saved} · Ghi lại cùng ngày sẽ cập nhật số dư.
                      </>
                    )}
                  </div>
                  {data.entries.length === 0 ? (
                    <div className="empty">
                      <CalendarDays size={27} />
                      <strong>Hành trình bắt đầu từ hôm nay</strong>
                      <p>
                        Nhập tài nguyên ở trên và lưu bản ghi đầu tiên của bạn.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Ngày</th>
                              <th>Orundum</th>
                              <th>Prime</th>
                              <th>Permit</th>
                              <th>Tổng pull</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {[...data.entries].reverse().map((e) => (
                              <tr key={e.date}>
                                <td>{e.date.split("-").reverse().join("/")}</td>
                                <td>{fmt(e.orundum)}</td>
                                <td>{fmt(e.prime)}</td>
                                <td>{fmt(e.tickets)}</td>
                                <td className="accent">
                                  {fmt(totalPulls(e, data.convert))}
                                </td>
                                <td>
                                  <button
                                    className="delete"
                                    aria-label={`Xóa bản ghi ${e.date}`}
                                    onClick={() =>
                                      update({
                                        entries: data.entries.filter(
                                          (x) => x.date !== e.date,
                                        ),
                                      })
                                    }
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {data.entries.length > 1 && (
                        <div className="history-chart">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={data.entries.map((e) => ({
                                date: e.date,
                                pulls: totalPulls(e, data.convert),
                              }))}
                            >
                              <XAxis
                                dataKey="date"
                                fontSize={11}
                                stroke="#858b92"
                              />
                              <YAxis fontSize={11} stroke="#858b92" />
                              <Tooltip
                                contentStyle={{
                                  background: "#1a1f24",
                                  border: "1px solid #343b40",
                                }}
                              />
                              <Area
                                dataKey="pulls"
                                stroke="#d8e99c"
                                fill="#d8e99c22"
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </>
                  )}
                  <button
                    className="export"
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(data, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `rhodes-resources-${today}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download size={14} /> Xuất dữ liệu JSON
                  </button>
                </section>
              )}
            </>
          )}
          <footer>
            <span>
              <Hexagon size={14} /> RHODES ISLAND · PLANNING TERMINAL
            </span>
            <span>Fan-made tool. Không liên kết với Hypergryph / Yostar.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
