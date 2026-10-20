import { describe, expect, it } from "vitest";
import {
  normalizeBanners,
  predictGlobal,
  validInstant,
  validateCatalog,
  dayInZone,
  formatBannerTime,
  formatSourceDate,
  phase,
  isOfficialUrl,
  type Banner,
  type BannerSource,
} from "./banners";
const now = "2025-01-01T00:00:00Z";
const msDay = 86400000;
function iso(s: string) {
  return new Date(s).toISOString();
}
function official(
  eventId = "event-a",
  server: "CN" | "Global" = "CN",
  startAt = "2024-01-01T08:00:00+08:00",
  overrides: Partial<Banner> = {},
): Banner {
  const article: BannerSource = {
    url:
      server === "CN"
        ? `https://ak.hypergryph.com/news/${eventId}`
        : `https://www.arknights.global/news/${eventId}`,
    name: "Official test fixture",
    server,
    kind: "official",
    publishedAt: "2023-12-20T00:00:00Z",
    confirmedFields: ["event", "startAt", "endAt", "operators"],
  };
  return {
    id: `${server}-${eventId}`,
    eventId,
    name: eventId,
    server,
    category: "limited",
    operators: [],
    startAt,
    status: "official",
    scheduleState: "scheduled",
    sources: [article],
    updatedAt: "2024-12-20T00:00:00Z",
    origin: "manual",
    reviewed: true,
    ...overrides,
  };
}
function samples(count = 3, category: Banner["category"] = "limited") {
  return Array.from({ length: count }, (_, i) => {
    const start = Date.parse("2023-01-01T00:00:00Z") + i * 20 * msDay;
    return [
      official(`pair-${i}`, "CN", new Date(start).toISOString(), { category }),
      official(
        `pair-${i}`,
        "Global",
        new Date(start + (180 + i * 2) * msDay).toISOString(),
        { category },
      ),
    ];
  }).flat();
}
describe("official status and provenance", () => {
  it("keeps a CN official announcement separate from Global", () => {
    const cn = official();
    expect(normalizeBanners([cn])[0].status).toBe("official");
    expect(() => normalizeBanners([{ ...cn, server: "Global" }])).toThrow(
      /confirmed for this server/,
    );
  });
  it("rejects an official hostname masquerading as the other server", () => {
    const b = official();
    b.sources[0].server = "Global";
    expect(() => normalizeBanners([b])).toThrow(/host does not match/);
  });
  it("rejects community speculation and unsupported operator confirmations", () => {
    const b = official();
    b.sources[0].kind = "community";
    expect(() => normalizeBanners([b])).toThrow(/Start date/);
    const names = official();
    names.operators = ["Unverified Operator"];
    names.sources[0].confirmedFields = ["event", "startAt"];
    expect(() => normalizeBanners([names])).toThrow(/Operator/);
  });
  it("represents a confirmed event with no published date separately", () => {
    const b = official("undated", "Global", undefined as unknown as string, {
      startAt: undefined,
      scheduleState: "announced",
    });
    b.sources[0].confirmedFields = ["event"];
    const result = normalizeBanners([b])[0];
    expect(result.status).toBe("official");
    expect(result.scheduleState).toBe("announced");
    expect(result.startAt).toBeUndefined();
  });
  it("rejects dates and estimates on unknown banners even with field evidence", () => {
    const base = {
      ...official(),
      status: "unknown" as const,
      scheduleState: "unknown" as const,
    };
    expect(() => normalizeBanners([base])).toThrow(
      /Unknown banner cannot claim/,
    );
    expect(() =>
      normalizeBanners([{ ...base, endAt: "2024-01-15T00:00:00Z" }]),
    ).toThrow(/Unknown banner cannot claim/);
    const interval = {
      earliest: "2025-06-01T00:00:00Z",
      central: "2025-06-05T00:00:00Z",
      latest: "2025-06-09T00:00:00Z",
      confidence: "low" as const,
      sampleSize: 3,
      explanation: "Three independently matched historical pairs",
    };
    expect(() =>
      normalizeBanners([{ ...base, startAt: undefined, estimate: interval }]),
    ).toThrow(/Unknown banner cannot claim/);
    expect(normalizeBanners([{ ...base, startAt: undefined }])[0].status).toBe(
      "unknown",
    );
  });
  it("requires sources and manual review", () => {
    expect(() => normalizeBanners([{ ...official(), sources: [] }])).toThrow(
      /source/,
    );
    expect(() =>
      normalizeBanners([{ ...official(), reviewed: false }]),
    ).toThrow(/reviewed/);
  });
  it("rejects credential URLs and lookalike official hosts", () => {
    expect(
      isOfficialUrl("https://ak.hypergryph.com.evil.test/news/1", "CN"),
    ).toBe(false);
    expect(
      isOfficialUrl("https://user:secret@ak.hypergryph.com/news/1", "CN"),
    ).toBe(false);
    expect(isOfficialUrl("http://ak.hypergryph.com/news/1", "CN")).toBe(false);
    expect(isOfficialUrl("https://ak.hypergryph.com/news/1", "CN")).toBe(true);
  });
});
describe("normalization and last-good data boundary", () => {
  it("deduplicates by server + reviewed correspondence ID, not title", () => {
    const b = official();
    const duplicate = {
      ...b,
      id: "another-id",
      updatedAt: "2024-12-21T00:00:00Z",
    };
    const result = normalizeBanners([
      b,
      duplicate,
      official("different-event"),
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.eventId === b.eventId)?.id).toBe("another-id");
  });
  it("rejects conflicting official duplicates with equal update dates", () => {
    const b = official();
    expect(() =>
      normalizeBanners([b, { ...b, startAt: "2024-01-02T00:00:00Z" }]),
    ).toThrow(/Conflicting official/);
  });
  it("rejects reused IDs, invalid date order, and malformed catalogs atomically", () => {
    expect(() =>
      normalizeBanners([
        official(),
        { ...official("second"), id: "CN-event-a" },
      ]),
    ).toThrow(/reused/);
    expect(() =>
      normalizeBanners([{ ...official(), endAt: "2020-01-01T00:00:00Z" }]),
    ).toThrow(/End must follow/);
    expect(() => validateCatalog({ schemaVersion: 2, events: [] })).toThrow(
      /schema/,
    );
  });
  it("can preserve a previously valid catalog when a bad refresh is rejected", () => {
    const current = validateCatalog({
      schemaVersion: 1,
      events: [official()],
      sync: {
        lastAttemptAt: now,
        lastSuccessAt: now,
        status: "ok",
        warnings: [],
      },
    });
    let result = current;
    try {
      result = validateCatalog({
        ...current,
        events: [...current.events, { name: "missing source" }],
      });
    } catch {
      /* fetch consumer retains current */
    }
    expect(result).toEqual(current);
    expect(result.events).toHaveLength(1);
  });
});
describe("Global estimates from matched historical events", () => {
  it("does not predict with fewer than 3 real matched pairs", () => {
    const result = predictGlobal(
      [...samples(2), official("candidate", "CN", "2024-12-01T00:00:00Z")],
      now,
    );
    const unknown = result.find(
      (e) => e.server === "Global" && e.eventId === "candidate",
    )!;
    expect(unknown.status).toBe("unknown");
    expect(unknown.scheduleState).toBe("unknown");
    expect(unknown.estimate).toBeUndefined();
    expect(unknown.operators).toEqual([]);
    expect(unknown.startAt).toBeUndefined();
  });
  it("uses a category-specific median and interval, independent of CN ordering", () => {
    const result = predictGlobal(
      [
        ...samples(3),
        official("candidate", "CN", "2024-12-01T00:00:00Z"),
      ].reverse(),
      now,
    );
    const estimate = result.find(
      (e) => e.server === "Global" && e.eventId === "candidate",
    )!;
    expect(estimate.status).toBe("predicted");
    expect(estimate.estimate?.sampleSize).toBe(3);
    expect(estimate.estimate?.confidence).toBe("low");
    expect(
      Date.parse(estimate.estimate!.central) -
        Date.parse("2024-12-01T00:00:00Z"),
    ).toBe(182 * msDay);
    expect(
      Date.parse(estimate.estimate!.latest) -
        Date.parse(estimate.estimate!.earliest),
    ).toBeGreaterThanOrEqual(7 * msDay);
    expect(estimate.sources.every((s) => s.server === "CN")).toBe(true);
    expect(estimate.operators).toEqual([]);
  });
  it("does not mix categories or unmatched event IDs", () => {
    const input = [
      ...samples(4, "standard"),
      official("candidate", "CN", "2024-12-01T00:00:00Z"),
    ];
    expect(
      predictGlobal(input, now).find(
        (e) => e.server === "Global" && e.eventId === "candidate",
      )?.status,
    ).toBe("unknown");
    const wrong = samples(3).map((b) =>
      b.server === "Global" ? { ...b, eventId: `unmatched-${b.eventId}` } : b,
    );
    expect(
      predictGlobal(
        [...wrong, official("candidate", "CN", "2024-12-01T00:00:00Z")],
        now,
      ).filter((e) => e.status === "predicted"),
    ).toHaveLength(0);
  });
  it("ignores pairs not actually released and negative delay pairs", () => {
    const future = samples(3).map((b) =>
      b.server === "Global" ? { ...b, startAt: "2026-01-01T00:00:00Z" } : b,
    );
    expect(
      predictGlobal(
        [...future, official("candidate", "CN", "2024-12-01T00:00:00Z")],
        now,
      ).some((e) => e.status === "predicted"),
    ).toBe(false);
  });
  it("preserves an official undated announcement while attaching a distinct estimate", () => {
    const announced = official(
      "candidate",
      "Global",
      undefined as unknown as string,
      { startAt: undefined, scheduleState: "announced" },
    );
    announced.sources[0].confirmedFields = ["event"];
    const result = predictGlobal(
      [
        ...samples(),
        official("candidate", "CN", "2024-12-01T00:00:00Z"),
        announced,
      ],
      now,
    );
    const banner = result.find(
      (e) => e.server === "Global" && e.eventId === "candidate",
    )!;
    expect(banner.status).toBe("official");
    expect(banner.scheduleState).toBe("announced");
    expect(banner.startAt).toBeUndefined();
    expect(banner.estimate).toBeDefined();
  });
  it("uses an official Global schedule over an older prediction and removes its estimate", () => {
    const predicted = predictGlobal(
      [...samples(), official("candidate", "CN", "2024-12-01T00:00:00Z")],
      now,
    ).find((e) => e.server === "Global" && e.eventId === "candidate")!;
    const global = official("candidate", "Global", "2025-06-15T10:00:00-07:00");
    const result = predictGlobal(
      [
        ...samples(),
        official("candidate", "CN", "2024-12-01T00:00:00Z"),
        predicted,
        global,
      ],
      now,
    ).find((e) => e.server === "Global" && e.eventId === "candidate")!;
    expect(result.status).toBe("official");
    expect(result.startAt).toBe(iso("2025-06-15T10:00:00-07:00"));
    expect(result.estimate).toBeUndefined();
  });
  it("removes unsupported estimates when historical evidence disappears", () => {
    const all = predictGlobal(
      [...samples(), official("candidate", "CN", "2024-12-01T00:00:00Z")],
      now,
    );
    const withoutPairs = all.filter((b) => b.eventId === "candidate");
    const refreshed = predictGlobal(withoutPairs, now).find(
      (b) => b.server === "Global",
    )!;
    expect(refreshed.status).toBe("unknown");
    expect(refreshed.estimate).toBeUndefined();
    const announced = official(
      "candidate",
      "Global",
      undefined as unknown as string,
      {
        startAt: undefined,
        scheduleState: "announced",
        estimate: all.find(
          (b) => b.server === "Global" && b.eventId === "candidate",
        )!.estimate,
      },
    );
    announced.sources[0].confirmedFields = ["event"];
    const retained = predictGlobal(
      [official("candidate", "CN", "2024-12-01T00:00:00Z"), announced],
      now,
    ).find((b) => b.server === "Global")!;
    expect(retained.status).toBe("official");
    expect(retained.scheduleState).toBe("announced");
    expect(retained.estimate).toBeUndefined();
  });
  it("is deterministic on unchanged valid input", () => {
    const input = [
      ...samples(),
      official("candidate", "CN", "2024-12-01T00:00:00Z"),
    ];
    expect(predictGlobal(predictGlobal(input, now), now)).toEqual(
      predictGlobal(input, now),
    );
  });
});
describe("timezone and phase behavior", () => {
  it("requires explicit offsets and rejects impossible dates", () => {
    expect(validInstant("2026-10-20")).toBe(false);
    expect(validInstant("2026-10-20T08:00:00")).toBe(false);
    expect(validInstant("2026-02-30T08:00:00Z")).toBe(false);
    expect(validInstant("2026-10-20T25:00:00Z")).toBe(false);
    expect(validInstant("2026-10-20T08:00:00+08:00")).toBe(true);
  });
  it("normalizes CN +08 and Global -07 timestamps without changing the instant", () => {
    expect(normalizeBanners([official()])[0].startAt).toBe(
      "2024-01-01T00:00:00.000Z",
    );
    expect(dayInZone("2026-10-20T18:30:00Z", "Asia/Ho_Chi_Minh")).toBe(
      "2026-10-21",
    );
    expect(dayInZone("2026-10-20T18:30:00Z", "UTC")).toBe("2026-10-20");
    expect(formatBannerTime("2026-10-20T18:30:00Z")).toContain("GMT+7");
  });
  it("treats end as exclusive and does not fabricate ongoing or ended events", () => {
    const b = official("phase", "Global", "2026-10-20T00:00:00Z", {
      endAt: "2026-10-21T00:00:00Z",
    });
    expect(phase(b, "2026-10-19T00:00:00Z")).toBe("upcoming");
    expect(phase(b, "2026-10-20T00:00:00Z")).toBe("ongoing");
    expect(phase(b, "2026-10-21T00:00:00Z")).toBe("ended");
    expect(phase({ ...b, endAt: undefined }, "2026-10-21T00:00:00Z")).toBe(
      "undated",
    );
    const prediction = predictGlobal(
      [...samples(), official("candidate", "CN", "2024-12-01T00:00:00Z")],
      now,
    ).find((e) => e.status === "predicted")!;
    expect(phase(prediction, "2030-01-01T00:00:00Z")).toBe("undated");
  });
});

describe("publication metadata precision", () => {
  function dayNotice(): Banner {
    const banner = official(
      "sealed-with-time-2026",
      "Global",
      "2026-10-14T08:00:00-07:00",
      {
        name: "Sealed With Time",
        category: "limited",
        endAt: "2026-10-28T03:59:00-07:00",
        operators: ["Kal'tsit Esperanta", "Closure", "Crackborne"],
        updatedAt: "2026-10-20T08:00:00Z",
        origin: "manual",
        reviewed: true,
      },
    );
    banner.sources = [
      {
        url: "https://www.arknights.global/news/4814",
        name: "Arknights Global",
        server: "Global",
        kind: "official",
        confirmedFields: ["event", "startAt", "endAt", "operators"],
        publishedAt: "2026-10-09",
        publicationPrecision: "day",
        publicationKind: "updated",
      },
    ];
    return banner;
  }
  it("retains a reviewed day-only update without inventing midnight", () => {
    const source = normalizeBanners([dayNotice()])[0].sources[0];
    expect(source.publishedAt).toBe("2026-10-09");
    expect(source.publicationKind).toBe("updated");
    expect(source.publicationPrecision).toBe("day");
    const expected = "Ngày cập nhật: 09/10/2026 (chưa có giờ)";
    expect(formatSourceDate(source, "Asia/Ho_Chi_Minh")).toBe(expected);
    expect(formatSourceDate(source, "America/Los_Angeles")).toBe(expected);
    expect(formatSourceDate(source, "UTC")).toBe(expected);
    expect(formatSourceDate({ ...source, publicationKind: "published" })).toBe(
      "Ngày đăng: 09/10/2026 (chưa có giờ)",
    );
  });
  it("requires explicit day precision and rejects invalid calendar metadata", () => {
    const banner = dayNotice();
    expect(() =>
      normalizeBanners([
        {
          ...banner,
          sources: [{ ...banner.sources[0], publicationPrecision: undefined }],
        },
      ]),
    ).toThrow(/publication date/);
    expect(() =>
      normalizeBanners([
        {
          ...banner,
          sources: [{ ...banner.sources[0], publicationPrecision: "instant" }],
        },
      ]),
    ).toThrow(/publication date/);
    for (const publishedAt of [
      "2026-02-30",
      "2026-13-09",
      "2026-10-00",
      "2026-10-09T00:00:00Z",
    ]) {
      expect(() =>
        normalizeBanners([
          { ...banner, sources: [{ ...banner.sources[0], publishedAt }] },
        ]),
      ).toThrow(/publication date/);
    }
    expect(() =>
      normalizeBanners([
        {
          ...banner,
          sources: [{ ...banner.sources[0], publishedAt: "2024-02-29" }],
        },
      ]),
    ).not.toThrow();
  });
  it("still requires exact timezone instants for event schedules and updates", () => {
    const banner = dayNotice();
    expect(() =>
      normalizeBanners([{ ...banner, startAt: "2026-10-14" }]),
    ).toThrow(/start date/);
    expect(() =>
      normalizeBanners([{ ...banner, endAt: "2026-10-28" }]),
    ).toThrow(/end date/);
    expect(() =>
      normalizeBanners([{ ...banner, updatedAt: "2026-10-20" }]),
    ).toThrow(/update date/);
  });
  it("keeps legacy ISO source shape and exact-instant formatting compatible", () => {
    const source = normalizeBanners([official()])[0].sources[0];
    expect(source.publishedAt).toBe("2023-12-20T00:00:00.000Z");
    expect(source).not.toHaveProperty("publicationPrecision");
    expect(source).not.toHaveProperty("publicationKind");
    expect(formatSourceDate(source)).toBe(
      `Đăng: ${formatBannerTime(source.publishedAt)}`,
    );
    expect(
      formatSourceDate({
        ...source,
        publicationKind: "updated",
        publicationPrecision: "instant",
      }),
    ).toBe(`Cập nhật: ${formatBannerTime(source.publishedAt)}`);
  });
  it("converts the user-provided Sealed With Time schedule exactly and records manual provenance", () => {
    const banner = normalizeBanners([dayNotice()])[0];
    expect(banner.status).toBe("official");
    expect(banner.server).toBe("Global");
    expect(banner.startAt).toBe("2026-10-14T15:00:00.000Z");
    expect(banner.endAt).toBe("2026-10-28T10:59:00.000Z");
    expect(formatBannerTime(banner.startAt!, "Asia/Ho_Chi_Minh")).toContain(
      "22:00",
    );
    expect(formatBannerTime(banner.endAt!, "Asia/Ho_Chi_Minh")).toContain(
      "17:59",
    );
    expect(dayInZone(banner.startAt!)).toBe("2026-10-14");
    expect(dayInZone(banner.endAt!)).toBe("2026-10-28");
    expect(banner.operators).toEqual([
      "Closure",
      "Crackborne",
      "Kal'tsit Esperanta",
    ]);
    const catalog = validateCatalog({
      schemaVersion: 1,
      events: [banner],
      sync: {
        lastAttemptAt: "2026-10-20T08:00:00Z",
        lastSuccessAt: null,
        status: "error",
        warnings: [
          "CONNECT 403; reviewed from the user-supplied official announcement",
        ],
      },
    });
    expect(catalog.events[0].origin).toBe("manual");
    expect(catalog.events[0].reviewed).toBe(true);
    expect(catalog.sync.lastSuccessAt).toBeNull();
    expect(catalog.sync.status).toBe("error");
  });
});
