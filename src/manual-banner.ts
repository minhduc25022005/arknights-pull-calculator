import { hasAnnouncementLocator } from "./announcement-url";
import {
  isOfficialUrl,
  normalizeBanners,
  validInstant,
  type Banner,
  type Category,
  type ConfirmedField,
  type Server,
} from "./banners";

export interface ManualBannerInput {
  id: string;
  eventId: string;
  name: string;
  server: Server;
  category: Category;
  sourceUrl: string;
  sourceName: string;
  publishedLocal: string;
  publishedOffset: string;
  publicationMode?: "instant" | "day";
  publicationKind?: "published" | "updated";
  publishedDay?: string;
  startLocal: string;
  startOffset: string;
  endLocal: string;
  endOffset: string;
  operators: string;
  reviewed: boolean;
  reviewer?: string;
  eventQuote?: string;
  publishedQuote?: string;
  startQuote?: string;
  endQuote?: string;
  operatorsQuote?: string;
}

export type ManualEvidenceField =
  "event" | "publishedAt" | "startAt" | "endAt" | "operators";
export interface ManualReviewPackage {
  schemaVersion: 1;
  events: Banner[];
  review: {
    reviewer: string;
    reviewedAt: string;
    method?: "reviewer-transcription" | "user-provided-extract";
    sourceFetched?: false;
    evidence: {
      bannerId: string;
      server: Server;
      sourceUrl: string;
      field: ManualEvidenceField;
      quote: string;
    }[];
  };
}

/** Parse only a source-specified offset; never use the browser/machine timezone. */
export function sourceTimestamp(
  local: string,
  offset: string,
  label: string,
): string {
  const value = local.trim();
  const zone = offset.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    throw new Error(`${label}: cần ngày và giờ đúng như thông báo gốc.`);
  }
  if (!/^(?:Z|[+-]\d{2}:\d{2})$/.test(zone) || zone === "-00:00") {
    throw new Error(`${label}: cần offset rõ ràng từ nguồn (Z hoặc ±HH:MM).`);
  }
  const timestamp = `${value.length === 16 ? `${value}:00` : value}${zone}`;
  if (!validInstant(timestamp)) {
    throw new Error(`${label}: ngày, giờ hoặc offset không hợp lệ.`);
  }
  return new Date(timestamp).toISOString();
}

export function isAnnouncementUrl(value: string, server: Server): boolean {
  return isOfficialUrl(value, server) && hasAnnouncementLocator(value);
}

/** Human-reviewed data preparation only. This never fetches or publishes a banner. */
export function buildManualBanner(
  input: ManualBannerInput,
  now: string,
): Banner {
  if (!input.reviewed) {
    throw new Error(
      "Hãy đọc thông báo gốc và xác nhận các trường trước khi xuất tệp.",
    );
  }
  if (!isAnnouncementUrl(input.sourceUrl.trim(), input.server)) {
    throw new Error(
      "Cần link bài thông báo chính thức đúng server; không dùng trang chủ.",
    );
  }
  if (
    !input.id.trim() ||
    !input.eventId.trim() ||
    !input.name.trim() ||
    !input.sourceName.trim()
  ) {
    throw new Error("Điền ID, khóa đối chiếu, tên sự kiện và tên nguồn.");
  }
  if (input.endLocal.trim() && !input.startLocal.trim()) {
    throw new Error(
      "Chỉ nhập ngày kết thúc khi thông báo đã xác nhận ngày bắt đầu.",
    );
  }
  const publicationMode = input.publicationMode ?? "instant";
  const publicationKind = input.publicationKind ?? "published";
  if (
    !["instant", "day"].includes(publicationMode) ||
    !["published", "updated"].includes(publicationKind)
  ) {
    throw new Error("Chọn độ chính xác và loại ngày thông báo hợp lệ.");
  }
  // Day precision is source calendar metadata, not an instant. The shared
  // normalizer checks its real Gregorian date without inventing midnight/offset.
  const publishedAt =
    publicationMode === "day"
      ? input.publishedDay?.trim() || ""
      : sourceTimestamp(
          input.publishedLocal,
          input.publishedOffset,
          "Ngày đăng/cập nhật",
        );
  const startAt = input.startLocal.trim()
    ? sourceTimestamp(input.startLocal, input.startOffset, "Ngày bắt đầu")
    : undefined;
  const endAt = input.endLocal.trim()
    ? sourceTimestamp(input.endLocal, input.endOffset, "Ngày kết thúc")
    : undefined;
  const operators = [
    ...new Set(
      input.operators
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const confirmedFields: ConfirmedField[] = ["event"];
  if (startAt) confirmedFields.push("startAt");
  if (endAt) confirmedFields.push("endAt");
  if (operators.length) confirmedFields.push("operators");
  const [banner] = normalizeBanners([
    {
      id: input.id.trim(),
      eventId: input.eventId.trim(),
      name: input.name.trim(),
      server: input.server,
      category: input.category,
      operators,
      ...(startAt ? { startAt } : {}),
      ...(endAt ? { endAt } : {}),
      status: "official",
      scheduleState: startAt ? "scheduled" : "announced",
      sources: [
        {
          url: input.sourceUrl.trim(),
          name: input.sourceName.trim(),
          publishedAt,
          ...(publicationMode === "day" ? { publicationPrecision: "day" } : {}),
          ...(input.publicationKind !== undefined ? { publicationKind } : {}),
          server: input.server,
          confirmedFields,
          kind: "official",
        },
      ],
      updatedAt: now,
      origin: "manual",
      reviewed: true,
    },
  ]);
  return banner;
}

/** Stores a human review trail; quotes are never scraped or interpreted as facts. */
export function buildReviewedPackage(
  input: ManualBannerInput,
  now: string,
): ManualReviewPackage {
  const banner = buildManualBanner(input, now);
  const reviewer = input.reviewer?.trim() || "";
  if (!reviewer || reviewer.length > 200) {
    throw new Error("Điền tên người kiểm duyệt (tối đa 200 ký tự).");
  }
  const required: [ManualEvidenceField, string | undefined, string][] = [
    ["event", input.eventQuote, "tên và server của sự kiện"],
    [
      "publishedAt",
      input.publishedQuote,
      "ngày đăng/cập nhật và độ chính xác nguồn",
    ],
    ...(banner.startAt
      ? [
          ["startAt", input.startQuote, "ngày bắt đầu"] as [
            ManualEvidenceField,
            string | undefined,
            string,
          ],
        ]
      : []),
    ...(banner.endAt
      ? [
          ["endAt", input.endQuote, "ngày kết thúc"] as [
            ManualEvidenceField,
            string | undefined,
            string,
          ],
        ]
      : []),
    ...(banner.operators.length
      ? [
          ["operators", input.operatorsQuote, "Operator"] as [
            ManualEvidenceField,
            string | undefined,
            string,
          ],
        ]
      : []),
  ];
  const evidence = required.map(([field, value, label]) => {
    const quote = value?.trim() || "";
    if (!quote || quote.length > 4000) {
      throw new Error(
        `Cần trích dẫn nguyên văn cho ${label} (tối đa 4.000 ký tự).`,
      );
    }
    return {
      bannerId: banner.id,
      server: banner.server,
      sourceUrl: banner.sources[0].url,
      field,
      quote,
    };
  });
  return {
    schemaVersion: 1,
    events: [banner],
    review: {
      reviewer,
      reviewedAt: new Date(now).toISOString(),
      method: "reviewer-transcription",
      sourceFetched: false,
      evidence,
    },
  };
}
