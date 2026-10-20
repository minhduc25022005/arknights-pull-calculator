/** Shared, dependency-free public-data contract used by the UI and the Node job. */
export type Server = "CN" | "Global";
export type Category =
  "limited" | "anniversary" | "rerun" | "standard" | "event";
export type BannerStatus = "official" | "predicted" | "unknown";
export type ConfirmedField = "event" | "operators" | "startAt" | "endAt";
export interface BannerSource {
  url: string;
  name: string;
  /** Exact instant by default; a calendar date only when precision is explicitly day. */
  publishedAt: string;
  publicationKind?: "published" | "updated";
  publicationPrecision?: "day" | "instant";
  server: Server;
  confirmedFields: ConfirmedField[];
  kind: "official" | "community";
}
export interface BannerEstimate {
  earliest: string;
  central: string;
  latest: string;
  confidence: "low" | "medium" | "high";
  sampleSize: number;
  explanation: string;
}
export interface Banner {
  id: string;
  /** A reviewed correspondence key, never inferred from announcement ordering. */
  eventId: string;
  name: string;
  server: Server;
  category: Category;
  operators: string[];
  startAt?: string;
  endAt?: string;
  status: BannerStatus;
  scheduleState: "announced" | "scheduled" | "estimated" | "unknown";
  sources: BannerSource[];
  updatedAt: string;
  estimate?: BannerEstimate;
  origin: "manual" | "sync" | "prediction";
  reviewed?: boolean;
}
export interface Catalog {
  schemaVersion: 1;
  events: Banner[];
  sync: {
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    status: "ok" | "partial" | "error" | "never";
    warnings: string[];
  };
}

const categories: Category[] = [
  "limited",
  "anniversary",
  "rerun",
  "standard",
  "event",
];
const fields: ConfirmedField[] = ["event", "operators", "startAt", "endAt"];
const day = 86_400_000;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 3000)
    throw new Error(`Invalid ${label}`);
  return value.trim();
}
function member<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error(`Invalid ${label}`);
  return value as T;
}
/** Calendar metadata has no time or implied timezone; do not pass through Date parsing. */
function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, date] = value.split("-").map(Number);
  // setUTCFullYear avoids Date.UTC treating years 00–99 as 1900–1999.
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, date);
  calendar.setUTCHours(0, 0, 0, 0);
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === date
  );
}
/** Reject date-only / local timestamps: host timezone must never invent an instant. */
export function validInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    )!;
  const [, y, m, d, h, min, sec, , oh = "0", om = "0"] = match;
  const calendar = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    Number.isFinite(Date.parse(value)) &&
    calendar.getUTCFullYear() === Number(y) &&
    calendar.getUTCMonth() === Number(m) - 1 &&
    calendar.getUTCDate() === Number(d) &&
    Number(h) < 24 &&
    Number(min) < 60 &&
    Number(sec) < 60 &&
    Number(oh) <= 14 &&
    Number(om) < 60 &&
    !(Number(oh) === 14 && Number(om) !== 0)
  );
}
function instant(value: unknown, label: string): string {
  if (!validInstant(value))
    throw new Error(
      `Invalid ${label}: ISO timestamp with explicit timezone required`,
    );
  return new Date(value).toISOString();
}
export function isOfficialUrl(url: string, server: Server): boolean {
  try {
    const parsed = new URL(url);
    const hosts =
      server === "CN"
        ? ["ak.hypergryph.com"]
        : ["www.arknights.global", "arknights.global"];
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      hosts.includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
function source(value: unknown): BannerSource {
  const x = object(value);
  const server = member(x.server, ["CN", "Global"] as const, "source server");
  const kind = member(
    x.kind,
    ["official", "community"] as const,
    "source kind",
  );
  const url = text(x.url, "source URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid source URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("Source requires credential-free HTTPS");
  if (kind === "official" && !isOfficialUrl(url, server))
    throw new Error("Official source host does not match server");
  if (!Array.isArray(x.confirmedFields))
    throw new Error("Missing source confirmedFields");
  const confirmedFields = [
    ...new Set(
      x.confirmedFields.map((v) => member(v, fields, "confirmed field")),
    ),
  ].sort();
  const publicationPrecision =
    x.publicationPrecision === undefined
      ? undefined
      : member(
          x.publicationPrecision,
          ["day", "instant"] as const,
          "publication precision",
        );
  const publicationKind =
    x.publicationKind === undefined
      ? undefined
      : member(
          x.publicationKind,
          ["published", "updated"] as const,
          "publication kind",
        );
  let publishedAt: string;
  if (publicationPrecision === "day") {
    if (!validCalendarDate(x.publishedAt))
      throw new Error(
        "Invalid publication date: a real calendar date is required for day precision",
      );
    publishedAt = x.publishedAt;
  } else {
    publishedAt = instant(x.publishedAt, "publication date");
  }
  const normalized: BannerSource = {
    url,
    name: text(x.name, "source name"),
    publishedAt,
    server,
    confirmedFields,
    kind,
  };
  // Keep old ISO source objects structurally identical for local catalog compatibility.
  if (publicationPrecision !== undefined)
    normalized.publicationPrecision = publicationPrecision;
  if (publicationKind !== undefined)
    normalized.publicationKind = publicationKind;
  return normalized;
}
function estimate(value: unknown): BannerEstimate {
  const x = object(value);
  const earliest = instant(x.earliest, "earliest estimate");
  const central = instant(x.central, "central estimate");
  const latest = instant(x.latest, "latest estimate");
  if (
    Date.parse(earliest) > Date.parse(central) ||
    Date.parse(central) > Date.parse(latest)
  )
    throw new Error("Unordered estimated interval");
  if (
    typeof x.sampleSize !== "number" ||
    !Number.isInteger(x.sampleSize) ||
    x.sampleSize < 3
  )
    throw new Error("Estimate requires at least three matched event pairs");
  return {
    earliest,
    central,
    latest,
    confidence: member(
      x.confidence,
      ["low", "medium", "high"] as const,
      "confidence",
    ),
    sampleSize: x.sampleSize,
    explanation: text(x.explanation, "prediction explanation"),
  };
}
function normalizeBanner(value: unknown): Banner {
  const x = object(value);
  if (
    !Array.isArray(x.operators) ||
    !x.operators.every(
      (v) => typeof v === "string" && v.trim() && v.length <= 200,
    )
  )
    throw new Error("Invalid Operators");
  if (!Array.isArray(x.sources) || !x.sources.length)
    throw new Error("Banner must have a source");
  const banner: Banner = {
    id: text(x.id, "banner ID"),
    eventId: text(x.eventId, "event correspondence ID"),
    name: text(x.name, "event name"),
    server: member(x.server, ["CN", "Global"] as const, "server"),
    category: member(x.category, categories, "category"),
    operators: [...new Set(x.operators as string[])].sort(),
    status: member(
      x.status,
      ["official", "predicted", "unknown"] as const,
      "banner status",
    ),
    scheduleState: member(
      x.scheduleState,
      ["announced", "scheduled", "estimated", "unknown"] as const,
      "schedule state",
    ),
    sources: x.sources.map(source).sort((a, b) => a.url.localeCompare(b.url)),
    updatedAt: instant(x.updatedAt, "update date"),
    origin: member(
      x.origin,
      ["manual", "sync", "prediction"] as const,
      "origin",
    ),
  };
  if (typeof x.reviewed === "boolean") banner.reviewed = x.reviewed;
  if (banner.origin === "manual" && !banner.reviewed)
    throw new Error("Manual data requires reviewed: true");
  if (x.startAt !== undefined)
    banner.startAt = instant(x.startAt, "start date");
  if (x.endAt !== undefined) banner.endAt = instant(x.endAt, "end date");
  if (banner.endAt && !banner.startAt)
    throw new Error("End date without a confirmed start date");
  if (
    banner.endAt &&
    banner.startAt &&
    Date.parse(banner.endAt) <= Date.parse(banner.startAt)
  )
    throw new Error("End must follow start");
  if (x.estimate !== undefined) banner.estimate = estimate(x.estimate);
  const evidence = (field: ConfirmedField) =>
    banner.sources.some(
      (s) =>
        s.kind === "official" &&
        s.server === banner.server &&
        s.confirmedFields.includes(field),
    );
  // Exact dates and operator names are verified facts, independently of display status.
  if (banner.operators.length && !evidence("operators"))
    throw new Error("Operator names are not confirmed for this server");
  if (banner.startAt && !evidence("startAt"))
    throw new Error("Start date is not confirmed for this server");
  if (banner.endAt && !evidence("endAt"))
    throw new Error("End date is not confirmed for this server");
  if (banner.status === "official" && !evidence("event"))
    throw new Error("Official event is not confirmed for this server");
  if (
    banner.status === "official" &&
    banner.scheduleState !== (banner.startAt ? "scheduled" : "announced")
  )
    throw new Error("Official announcement/schedule state mismatch");
  if (
    banner.status === "predicted" &&
    (!banner.estimate ||
      banner.startAt ||
      banner.endAt ||
      banner.scheduleState !== "estimated")
  )
    throw new Error(
      "Predicted banner requires an estimate, not official dates",
    );
  if (
    banner.status === "unknown" &&
    (banner.scheduleState !== "unknown" ||
      banner.startAt ||
      banner.endAt ||
      banner.estimate)
  )
    throw new Error(
      "Unknown banner cannot claim dates, an estimate, or a schedule",
    );
  if (banner.status === "official" && banner.startAt) delete banner.estimate;
  return banner;
}
function rank(banner: Banner): number {
  return banner.status === "official"
    ? banner.startAt
      ? 40
      : 30
    : banner.status === "predicted"
      ? 20
      : 10;
}
function identity(banner: Banner): string {
  return `${banner.server}:${banner.eventId}`;
}
/** Reject a bad batch atomically; callers retain their last known valid catalog. */
export function normalizeBanners(value: unknown): Banner[] {
  if (!Array.isArray(value)) throw new Error("Expected events array");
  if (value.length > 10000) throw new Error("Too many events");
  const events = new Map<string, Banner>();
  const ids = new Map<string, string>();
  for (const raw of value) {
    const next = normalizeBanner(raw);
    const key = identity(next);
    if (ids.has(next.id) && ids.get(next.id) !== key)
      throw new Error("Banner ID reused across events");
    ids.set(next.id, key);
    const current = events.get(key);
    if (
      current &&
      current.status === "official" &&
      next.status === "official" &&
      current.updatedAt === next.updatedAt &&
      (current.startAt !== next.startAt ||
        current.endAt !== next.endAt ||
        current.category !== next.category ||
        JSON.stringify(current.operators) !== JSON.stringify(next.operators))
    )
      throw new Error(`Conflicting official duplicate: ${key}`);
    if (
      !current ||
      rank(next) > rank(current) ||
      (rank(next) === rank(current) &&
        Date.parse(next.updatedAt) > Date.parse(current.updatedAt))
    )
      events.set(key, next);
  }
  return [...events.values()].sort((a, b) =>
    identity(a).localeCompare(identity(b)),
  );
}
export function validateCatalog(value: unknown): Catalog {
  const x = object(value);
  if (x.schemaVersion !== 1) throw new Error("Unsupported banner schema");
  const sync = object(x.sync);
  if (
    !Array.isArray(sync.warnings) ||
    !sync.warnings.every((v) => typeof v === "string")
  )
    throw new Error("Invalid sync warnings");
  return {
    schemaVersion: 1,
    events: normalizeBanners(x.events),
    sync: {
      lastAttemptAt:
        sync.lastAttemptAt === null
          ? null
          : instant(sync.lastAttemptAt, "last attempt"),
      lastSuccessAt:
        sync.lastSuccessAt === null
          ? null
          : instant(sync.lastSuccessAt, "last success"),
      status: member(
        sync.status,
        ["ok", "partial", "error", "never"] as const,
        "sync status",
      ),
      warnings: sync.warnings as string[],
    },
  };
}
/** Uses actual, past cross-server matches of the same category; no ordering assumptions. */
export function predictGlobal(
  input: Banner[],
  now = new Date().toISOString(),
): Banner[] {
  const events = normalizeBanners(input);
  // Recompute estimates from the current verified history on every run. A stale
  // forecast never survives solely because it existed in a prior output file.
  const globalByEvent = new Map(
    events
      .filter((b) => b.server === "Global")
      .map((b) => {
        const next = { ...b };
        if (!next.startAt && next.estimate) {
          delete next.estimate;
          if (next.status === "predicted") {
            next.status = "unknown";
            next.scheduleState = "unknown";
          }
        }
        return [next.eventId, next] as const;
      }),
  );
  const nowMs = Date.parse(now);
  const paired = events
    .filter(
      (cn) =>
        cn.server === "CN" &&
        cn.status === "official" &&
        cn.startAt &&
        Date.parse(cn.startAt) <= nowMs,
    )
    .flatMap((cn) => {
      const global = globalByEvent.get(cn.eventId);
      if (
        !global ||
        global.status !== "official" ||
        !global.startAt ||
        global.category !== cn.category ||
        Date.parse(global.startAt) > nowMs
      )
        return [];
      const delay = Date.parse(global.startAt) - Date.parse(cn.startAt!);
      return delay > 0 && delay <= 730 * day ? [{ cn, global, delay }] : [];
    });
  for (const cn of events.filter(
    (b) =>
      b.server === "CN" &&
      b.status === "official" &&
      b.startAt &&
      Date.parse(b.startAt) <= nowMs,
  )) {
    const existing = globalByEvent.get(cn.eventId);
    if (existing?.status === "official" && existing.startAt) continue;
    const sample = paired.filter((p) => p.cn.category === cn.category);
    if (sample.length < 3) {
      if (!existing)
        globalByEvent.set(cn.eventId, {
          id: `prediction-global-${cn.eventId}`,
          eventId: cn.eventId,
          name: `${cn.name} · Global`,
          server: "Global",
          category: cn.category,
          operators: [],
          status: "unknown",
          scheduleState: "unknown",
          sources: cn.sources,
          updatedAt: cn.updatedAt,
          origin: "prediction",
        });
      continue;
    }
    const delays = sample.map((p) => p.delay).sort((a, b) => a - b);
    const median =
      delays.length % 2
        ? delays[Math.floor(delays.length / 2)]
        : (delays[delays.length / 2 - 1] + delays[delays.length / 2]) / 2;
    const low = Math.min(delays[0], median - 3.5 * day);
    const high = Math.max(delays[delays.length - 1], median + 3.5 * day);
    const rangeDays = (high - low) / day;
    const confidence =
      sample.length >= 8 && rangeDays <= 14
        ? "high"
        : sample.length >= 5 && rangeDays <= 30
          ? "medium"
          : "low";
    const start = Date.parse(cn.startAt!);
    const prediction: BannerEstimate = {
      earliest: new Date(start + low).toISOString(),
      central: new Date(start + median).toISOString(),
      latest: new Date(start + high).toISOString(),
      confidence,
      sampleSize: sample.length,
      explanation: `${sample.length} cặp sự kiện ${cn.category} đã ra mắt trên cả CN và Global, đối chiếu bằng eventId được kiểm duyệt. Độ trễ trung vị ${(median / day).toFixed(1)} ngày; khoảng quan sát ${(delays[0] / day).toFixed(1)}–${(delays[delays.length - 1] / day).toFixed(1)} ngày, mở rộng tối thiểu 7 ngày. Các cặp: ${sample.map((p) => p.cn.eventId).join(", ")}. Không giả định thứ tự phát hành; đây là ước tính, không phải lịch công bố.`,
    };
    // Historical samples inform an estimate; their notices must never become confirmation evidence for this event.
    const sources = [...(existing?.sources ?? []), ...cn.sources];
    const uniqueSources = [
      ...new Map(sources.map((s) => [`${s.server}:${s.url}`, s])).values(),
    ];
    const updatedAt = [
      cn.updatedAt,
      ...sample.flatMap((p) => [p.cn.updatedAt, p.global.updatedAt]),
      ...(existing ? [existing.updatedAt] : []),
    ]
      .sort()
      .at(-1)!;
    const next: Banner =
      existing?.status === "official"
        ? {
            ...existing,
            estimate: prediction,
            updatedAt,
            sources: uniqueSources,
          }
        : {
            id: existing?.id ?? `prediction-global-${cn.eventId}`,
            eventId: cn.eventId,
            name: existing?.name ?? `${cn.name} · Global`,
            server: "Global",
            category: cn.category,
            operators: existing?.operators ?? [],
            status: "predicted",
            scheduleState: "estimated",
            sources: uniqueSources,
            updatedAt,
            origin: "prediction",
            estimate: prediction,
          };
    globalByEvent.set(cn.eventId, next);
  }
  return normalizeBanners([
    ...events.filter((b) => b.server === "CN"),
    ...globalByEvent.values(),
  ]);
}
export function dayInZone(iso: string, timeZone = "Asia/Ho_Chi_Minh"): string {
  if (!validInstant(iso)) throw new Error("Invalid timestamp");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function formatBannerTime(
  iso: string,
  timeZone = "Asia/Ho_Chi_Minh",
): string {
  if (!validInstant(iso)) throw new Error("Invalid timestamp");
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).format(new Date(iso));
}
/** Render source metadata without fabricating an hour for day-only notices. */
export function formatSourceDate(
  source: BannerSource,
  timeZone = "Asia/Ho_Chi_Minh",
): string {
  const updated = source.publicationKind === "updated";
  if (source.publicationPrecision === "day") {
    if (!validCalendarDate(source.publishedAt))
      throw new Error("Invalid publication calendar date");
    const date = source.publishedAt.split("-").reverse().join("/");
    return `${updated ? "Ngày cập nhật" : "Ngày đăng"}: ${date} (chưa có giờ)`;
  }
  return `${updated ? "Cập nhật" : "Đăng"}: ${formatBannerTime(source.publishedAt, timeZone)}`;
}
export function phase(
  banner: Banner,
  now: string | number = Date.now(),
): "ongoing" | "upcoming" | "ended" | "undated" {
  const ms = typeof now === "number" ? now : Date.parse(now);
  if (banner.startAt) {
    if (ms < Date.parse(banner.startAt)) return "upcoming";
    if (banner.endAt)
      return ms >= Date.parse(banner.endAt) ? "ended" : "ongoing";
    // An announcement without an end time cannot establish that an event is still running.
    return "undated";
  }
  if (banner.estimate && ms < Date.parse(banner.estimate.latest))
    return "upcoming";
  return "undated";
}
