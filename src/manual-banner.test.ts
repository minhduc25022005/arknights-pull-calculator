import { describe, expect, it } from "vitest";
import {
  buildManualBanner,
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
