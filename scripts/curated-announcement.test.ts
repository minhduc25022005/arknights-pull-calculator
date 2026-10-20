import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dayInZone,
  formatBannerTime,
  formatSourceDate,
  normalizeBanners,
  phase,
} from "../src/banners";
import { importCatalog, validateManual } from "./banner-pipeline.mjs";
import { readReviewHistory, validateReviewManifest } from "./manual-review.mjs";

// A real notice extract supplied by the user, not a scraped HTML fixture.
const curated = JSON.parse(
  readFileSync(
    new URL("../data/curated-banners.json", import.meta.url),
    "utf8",
  ),
);
const records = validateManual(curated);
const record = records.find(
  (event: { id: string }) => event.id === "global-sealed-with-time-2026-10",
);
const review = readReviewHistory(curated).find(
  (item: { evidence: { bannerId: string }[] }) =>
    item.evidence.some((e) => e.bannerId === record?.id),
);
describe("user-reviewed Global notice 4814", () => {
  it("keeps original provenance and exact source without asserting a fetched source", () => {
    expect(record).toMatchObject({
      name: "Sealed With Time",
      server: "Global",
      category: "limited",
      status: "official",
      origin: "manual",
      reviewed: true,
    });
    expect(record.sources[0].url).toBe(
      "https://www.arknights.global/news/4814",
    );
    expect(review).toMatchObject({
      method: "user-provided-extract",
      sourceFetched: false,
    });
    expect(validateReviewManifest({ review }, [record]).evidence).toHaveLength(
      5,
    );
  });
  it("converts the supplied UTC-7 event boundaries correctly and does not invent an update hour", () => {
    expect(record.startAt).toBe("2026-10-14T15:00:00.000Z");
    expect(record.endAt).toBe("2026-10-28T10:59:00.000Z");
    expect(formatBannerTime(record.startAt, "Asia/Ho_Chi_Minh")).toContain(
      "22:00",
    );
    expect(formatBannerTime(record.endAt, "Asia/Ho_Chi_Minh")).toContain(
      "17:59",
    );
    expect(dayInZone(record.endAt, "Asia/Ho_Chi_Minh")).toBe("2026-10-28");
    expect(record.sources[0]).toMatchObject({
      publishedAt: "2026-10-09",
      publicationKind: "updated",
      publicationPrecision: "day",
    });
    expect(formatSourceDate(record.sources[0], "Asia/Ho_Chi_Minh")).toContain(
      "chưa có giờ",
    );
    expect(record.operators).toEqual([
      "Closure",
      "Crackborne",
      "Kal'tsit Esperanta (Limited)",
    ]);
    expect(phase(record, "2026-10-20T00:00:00Z")).toBe("ongoing");
  });
  it("does not create a CN confirmation or live-sync success when manually publishing the extract", () => {
    const previous = {
      schemaVersion: 1,
      events: [],
      sync: {
        lastAttemptAt: null,
        lastSuccessAt: null,
        status: "never",
        warnings: [],
      },
    };
    const result = importCatalog(previous, [record]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].server).toBe("Global");
    expect(result.sync).toEqual(previous.sync);
    expect(normalizeBanners(result.events)[0].estimate).toBeUndefined();
  });
});
