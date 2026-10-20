import { describe, expect, it } from "vitest";
import {
  buildManualBanner,
  buildReviewedPackage,
  isAnnouncementUrl,
  sourceTimestamp,
  type ManualBannerInput,
} from "./manual-banner";

// Synthetic fixtures only: these article paths are never fetched or published.
const input: ManualBannerInput = {
  id: "manual-ui-test-global",
  eventId: "manual-ui-test",
  name: "Synthetic manual entry",
  server: "Global",
  category: "limited",
  sourceUrl: "https://www.arknights.global/news/synthetic-unit-fixture",
  sourceName: "Synthetic source fixture",
  publishedLocal: "2026-10-20T18:00",
  publishedOffset: "+08:00",
  startLocal: "",
  startOffset: "",
  endLocal: "",
  endOffset: "",
  operators: "",
  reviewed: true,
};
const now = "2026-10-20T10:00:00Z";

describe("reviewed manual banner preparation", () => {
  it("exports a sourced official announcement without inventing event dates or operators", () => {
    const record = buildManualBanner(input, now);
    expect(record).toMatchObject({
      origin: "manual",
      reviewed: true,
      status: "official",
      scheduleState: "announced",
      operators: [],
    });
    expect(record.startAt).toBeUndefined();
    expect(record.endAt).toBeUndefined();
    expect(record.sources[0]).toMatchObject({
      url: input.sourceUrl,
      publishedAt: "2026-10-20T10:00:00.000Z",
      confirmedFields: ["event"],
    });
  });
  it("requires review and keeps input untouched", () => {
    expect(() => buildManualBanner({ ...input, reviewed: false }, now)).toThrow(
      /xác nhận/,
    );
    const before = JSON.stringify(input);
    buildManualBanner(input, now);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("rejects cross-server, community, credential and home-page URLs", () => {
    for (const url of [
      "https://ak.hypergryph.com/news/test",
      "https://example.com/article",
      "https://token@www.arknights.global/news/test",
      "http://www.arknights.global/news/test",
      "https://www.arknights.global/",
      "https://www.arknights.global/?utm_source=test",
      "https://www.arknights.global/#/",
      "https://www.arknights.global/#top",
      "https://www.arknights.global/index.html",
    ]) {
      expect(() =>
        buildManualBanner({ ...input, sourceUrl: url }, now),
      ).toThrow(/link bài/);
    }
    expect(
      isAnnouncementUrl(
        "https://www.arknights.global/?article=synthetic-fixture",
        "Global",
      ),
    ).toBe(true);
    expect(
      isAnnouncementUrl("https://ak.hypergryph.com/#/news/unit-test", "CN"),
    ).toBe(true);
  });
  it("requires explicit source timezone and rejects nonexistent local dates", () => {
    expect(() => sourceTimestamp("2026-10-20T18:00", "", "Test")).toThrow(
      /offset/,
    );
    expect(() => sourceTimestamp("2026-02-30T18:00", "+08:00", "Test")).toThrow(
      /không hợp lệ/,
    );
    expect(() => sourceTimestamp("2026-10-20T24:01", "Z", "Test")).toThrow();
    expect(() =>
      sourceTimestamp("2026-10-20T18:00", "+14:30", "Test"),
    ).toThrow();
    expect(sourceTimestamp("2026-10-20T01:00", "+08:00", "Test")).toBe(
      "2026-10-19T17:00:00.000Z",
    );
  });
  it("rejects RFC3339 unknown local offset rather than guessing UTC", () => {
    expect(() => sourceTimestamp("2026-10-20T18:00", "-00:00", "Test")).toThrow(
      /offset/,
    );
  });
  it("records only explicitly entered facts, preserving independent source offsets", () => {
    const record = buildManualBanner(
      {
        ...input,
        startLocal: "2026-10-21T16:00",
        startOffset: "-07:00",
        endLocal: "2026-11-01T15:59",
        endOffset: "-07:00",
        operators: "Test Operator\nTest Operator,Another Fixture",
      },
      now,
    );
    expect(record).toMatchObject({
      scheduleState: "scheduled",
      startAt: "2026-10-21T23:00:00.000Z",
      endAt: "2026-11-01T22:59:00.000Z",
      operators: ["Another Fixture", "Test Operator"],
    });
    expect(record.sources[0].confirmedFields).toEqual([
      "endAt",
      "event",
      "operators",
      "startAt",
    ]);
  });
  it("rejects an end without start, reversed range or missing identifiers", () => {
    expect(() =>
      buildManualBanner(
        { ...input, endLocal: "2026-10-21T16:00", endOffset: "Z" },
        now,
      ),
    ).toThrow(/bắt đầu/);
    expect(() =>
      buildManualBanner(
        {
          ...input,
          startLocal: "2026-10-22T16:00",
          startOffset: "Z",
          endLocal: "2026-10-21T16:00",
          endOffset: "Z",
        },
        now,
      ),
    ).toThrow(/End must follow start/);
    expect(() => buildManualBanner({ ...input, eventId: "" }, now)).toThrow(
      /ID/,
    );
  });
});

describe("manual review manifest", () => {
  const reviewedInput = {
    ...input,
    reviewer: "Test reviewer",
    eventQuote: "Synthetic exact source quote for the Global event.",
    publishedQuote:
      "Synthetic source publication quote: 2026-10-20 18:00 UTC+08.",
  };
  it("preserves original links and explicit human field evidence alongside existing event schema", () => {
    const result = buildReviewedPackage(reviewedInput, now);
    expect(result.schemaVersion).toBe(1);
    expect(result.events[0]).toEqual(buildManualBanner(input, now));
    expect(result.review).toEqual({
      reviewer: "Test reviewer",
      reviewedAt: "2026-10-20T10:00:00.000Z",
      method: "reviewer-transcription",
      sourceFetched: false,
      evidence: [
        {
          bannerId: input.id,
          server: "Global",
          sourceUrl: input.sourceUrl,
          field: "event",
          quote: reviewedInput.eventQuote,
        },
        {
          bannerId: input.id,
          server: "Global",
          sourceUrl: input.sourceUrl,
          field: "publishedAt",
          quote: reviewedInput.publishedQuote,
        },
      ],
    });
  });
  it("requires a review identity and event/publication quotes without weakening the review checkbox", () => {
    expect(() =>
      buildReviewedPackage({ ...reviewedInput, reviewer: "" }, now),
    ).toThrow(/người kiểm duyệt/);
    expect(() =>
      buildReviewedPackage({ ...reviewedInput, eventQuote: "" }, now),
    ).toThrow(/trích dẫn/);
    expect(() =>
      buildReviewedPackage({ ...reviewedInput, publishedQuote: "" }, now),
    ).toThrow(/trích dẫn/);
    expect(() =>
      buildReviewedPackage({ ...reviewedInput, reviewed: false }, now),
    ).toThrow(/xác nhận/);
  });
  it("requires an independent quote for each entered date and Operator field", () => {
    const scheduled = {
      ...reviewedInput,
      startLocal: "2026-11-01T10:00",
      startOffset: "Z",
      endLocal: "2026-11-08T10:00",
      endOffset: "Z",
      operators: "Synthetic Operator",
    };
    expect(() => buildReviewedPackage(scheduled, now)).toThrow(/bắt đầu/);
    expect(() =>
      buildReviewedPackage(
        { ...scheduled, startQuote: "Start source quote" },
        now,
      ),
    ).toThrow(/kết thúc/);
    expect(() =>
      buildReviewedPackage(
        {
          ...scheduled,
          startQuote: "Start source quote",
          endQuote: "End source quote",
        },
        now,
      ),
    ).toThrow(/Operator/);
    const result = buildReviewedPackage(
      {
        ...scheduled,
        startQuote: "Start source quote",
        endQuote: "End source quote",
        operatorsQuote: "Operator source quote",
      },
      now,
    );
    expect(result.review.evidence.map((item) => item.field)).toEqual([
      "event",
      "publishedAt",
      "startAt",
      "endAt",
      "operators",
    ]);
  });
  it("never derives dates or Operators from quotation text alone", () => {
    const result = buildReviewedPackage(
      {
        ...reviewedInput,
        startQuote:
          "Quoted text may mention 2027 and a name, but no structured date was entered.",
        operatorsQuote: "No structured Operator entered.",
      },
      now,
    );
    expect(result.events[0].startAt).toBeUndefined();
    expect(result.events[0].operators).toEqual([]);
    expect(result.review.evidence.map((item) => item.field)).toEqual([
      "event",
      "publishedAt",
    ]);
  });
  it("bounds quote/reviewer lengths and preserves source-language text as text", () => {
    expect(() =>
      buildReviewedPackage(
        { ...reviewedInput, reviewer: "x".repeat(201) },
        now,
      ),
    ).toThrow(/200/);
    expect(() =>
      buildReviewedPackage(
        { ...reviewedInput, eventQuote: "x".repeat(4001) },
        now,
      ),
    ).toThrow(/4.000/);
    const result = buildReviewedPackage(
      {
        ...reviewedInput,
        eventQuote: "  原文：限定寻访 <b>text, not executable HTML</b>  ",
      },
      now,
    );
    expect(result.review.evidence[0].quote).toBe(
      "原文：限定寻访 <b>text, not executable HTML</b>",
    );
  });
});

describe("source publication day precision", () => {
  const dayInput: ManualBannerInput = {
    ...input,
    publicationMode: "day",
    publicationKind: "updated",
    publishedDay: "2026-10-09",
    publishedLocal: "",
    publishedOffset: "",
  };
  it("keeps an update-only calendar day without manufacturing a time or timezone", () => {
    const record = buildManualBanner(dayInput, now);
    expect(record.sources[0]).toMatchObject({
      publishedAt: "2026-10-09",
      publicationPrecision: "day",
      publicationKind: "updated",
    });
    expect(record.sources[0].publishedAt).not.toContain("T");
    expect(record.startAt).toBeUndefined();
    expect(record.endAt).toBeUndefined();
  });
  it("rejects invalid or datetime values instead of silently correcting a calendar day", () => {
    for (const value of [
      "2026-02-30",
      "2026-13-09",
      "2026-10-09T00:00:00Z",
      "",
    ]) {
      expect(() =>
        buildManualBanner({ ...dayInput, publishedDay: value }, now),
      ).toThrow(/publication date/);
    }
  });
  it("leaves legacy timestamp-only callers unchanged", () => {
    const source = buildManualBanner(input, now).sources[0];
    expect(source.publishedAt).toBe("2026-10-20T10:00:00.000Z");
    expect(source.publicationPrecision).toBeUndefined();
    expect(source.publicationKind).toBeUndefined();
  });
  it("still requires an explicit offset for an event start when the publication is date-only", () => {
    expect(() =>
      buildManualBanner(
        { ...dayInput, startLocal: "2026-10-21T10:00", startOffset: "" },
        now,
      ),
    ).toThrow(/offset/);
  });
  it("exports day-only review evidence as human transcription without implying a fetched source", () => {
    const packet = buildReviewedPackage(
      {
        ...dayInput,
        reviewer: "Test reviewer",
        eventQuote: "Synthetic event quote",
        publishedQuote: "Source update: 2026-10-09, no time supplied",
      },
      now,
    );
    expect(packet.review).toMatchObject({
      method: "reviewer-transcription",
      sourceFetched: false,
    });
    expect(packet.review.evidence.map((item) => item.field)).toEqual([
      "event",
      "publishedAt",
    ]);
    expect(packet.events[0].sources[0].publishedAt).toBe("2026-10-09");
  });
});
