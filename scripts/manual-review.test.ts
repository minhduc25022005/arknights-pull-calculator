import { describe, expect, it } from "vitest";
import {
  validateReviewManifest,
  readReviewHistory,
  appendReviewHistory,
} from "./manual-review.mjs";

// Synthetic quote/source fixtures only; no source is requested or published.
const url = "https://ak.hypergryph.com/news/synthetic-review-test";
const event = {
  id: "review-test",
  eventId: "review-test",
  server: "CN",
  operators: [],
  sources: [
    { url, server: "CN", kind: "official", confirmedFields: ["event"] },
  ],
};
function packet(fields = ["event", "publishedAt"]) {
  return {
    review: {
      reviewer: "fixture-reviewer",
      reviewedAt: "2026-10-20T10:00:00+07:00",
      evidence: fields.map((field) => ({
        bannerId: event.id,
        server: "CN",
        sourceUrl: url,
        field,
        quote: `  Synthetic verbatim ${field} quote  `,
      })),
    },
  };
}

describe("human review evidence manifests", () => {
  it("records manual provenance without presenting user-provided extracts as fetched originals", () => {
    expect(validateReviewManifest(packet(), [event])).toMatchObject({
      method: "reviewer-transcription",
      sourceFetched: false,
    });
    const userExtract = packet();
    Object.assign(userExtract.review, {
      method: "user-provided-extract",
      sourceFetched: false,
    });
    expect(validateReviewManifest(userExtract, [event])).toMatchObject({
      method: "user-provided-extract",
      sourceFetched: false,
    });
    const fetched = packet();
    Object.assign(fetched.review, { sourceFetched: true });
    expect(() => validateReviewManifest(fetched, [event])).toThrow(
      /sourceFetched/,
    );
    const unsupported = packet();
    Object.assign(unsupported.review, { method: "automatically-scraped" });
    expect(() => validateReviewManifest(unsupported, [event])).toThrow(
      /review method/,
    );
    const historical = {
      ...validateReviewManifest(packet(), [event]),
      method: "legacy-extra-metadata",
      sourceFetched: "unknown-old-note",
    };
    expect(readReviewHistory({ reviews: [historical] })[0]).toBe(historical);
  });
  it("requires a new nonempty packet to carry a review and all required quotes", () => {
    expect(() => validateReviewManifest({}, [event])).toThrow(
      /review manifest/,
    );
    expect(() => validateReviewManifest(packet(["event"]), [event])).toThrow(
      /publishedAt/,
    );
    expect(validateReviewManifest({}, [])).toBeNull();
  });
  it("preserves original quote and source while normalizing the review instant, without changing facts", () => {
    const before = JSON.stringify(event);
    const result = validateReviewManifest(packet(), [event]);
    expect(result.reviewedAt).toBe("2026-10-20T03:00:00.000Z");
    expect(result.evidence[0].quote).toBe("  Synthetic verbatim event quote  ");
    expect(result.evidence[0].sourceUrl).toBe(url);
    expect(JSON.stringify(event)).toBe(before);
  });
  it("requires date and operator evidence only for fields actually imported", () => {
    const dated = {
      ...event,
      startAt: "2026-11-01T00:00:00Z",
      endAt: "2026-11-08T00:00:00Z",
      operators: ["Synthetic Operator"],
      sources: [
        {
          ...event.sources[0],
          confirmedFields: ["event", "startAt", "endAt", "operators"],
        },
      ],
    };
    expect(() => validateReviewManifest(packet(), [dated])).toThrow(/startAt/);
    expect(
      validateReviewManifest(
        packet(["event", "publishedAt", "startAt", "endAt", "operators"]),
        [dated],
      ).evidence,
    ).toHaveLength(5);
    expect(() =>
      validateReviewManifest(packet(["event", "publishedAt", "startAt"]), [
        event,
      ]),
    ).toThrow(/absent/);
  });
  it("rejects wrong original source, wrong server, missing source field evidence and orphan claims", () => {
    for (const patch of [
      { sourceUrl: "https://ak.hypergryph.com/news/other" },
      {
        server: "Global",
        sourceUrl: "https://www.arknights.global/news/synthetic",
      },
      { bannerId: "orphan" },
    ]) {
      const value = packet();
      Object.assign(value.review.evidence[0], patch);
      expect(() => validateReviewManifest(value, [event])).toThrow();
    }
    expect(() =>
      validateReviewManifest(packet(), [
        { ...event, sources: [{ ...event.sources[0], confirmedFields: [] }] },
      ]),
    ).toThrow(/confirmed field/);
  });
  it("rejects unsupported field names, duplicate keys and conflicting quotes", () => {
    const unsupported = packet(["event", "publishedAt", "anything"]);
    expect(() => validateReviewManifest(unsupported, [event])).toThrow(
      /Unsupported/,
    );
    for (const quote of ["same", "conflicting"]) {
      const value = packet();
      value.review.evidence.push({ ...value.review.evidence[0], quote });
      expect(() => validateReviewManifest(value, [event])).toThrow(
        /Duplicate or conflicting/,
      );
    }
  });
  it("rejects missing/oversized reviewer, blank/oversized quotes, unknown offset and malformed dates", () => {
    for (const reviewer of ["", " ".repeat(2), "r".repeat(201)]) {
      const value = packet();
      value.review.reviewer = reviewer;
      expect(() => validateReviewManifest(value, [event])).toThrow(/reviewer/);
    }
    for (const quote of ["", "  ", "q".repeat(4001)]) {
      const value = packet();
      value.review.evidence[0].quote = quote;
      expect(() => validateReviewManifest(value, [event])).toThrow(/quote/);
    }
    for (const reviewedAt of [
      "2026-10-20",
      "2026-10-20T00:00:00",
      "2026-10-20T00:00:00-00:00",
      "2026-02-30T00:00:00Z",
    ]) {
      const value = packet();
      value.review.reviewedAt = reviewedAt;
      expect(() => validateReviewManifest(value, [event])).toThrow(/timezone/);
    }
  });
  it("keeps legacy history readable and rejects malformed existing review metadata", () => {
    expect(readReviewHistory({ schemaVersion: 1, events: [event] })).toEqual(
      [],
    );
    const review = validateReviewManifest(packet(), [event]);
    const enriched = {
      ...review,
      maintainerNote: "keep this original metadata",
    };
    expect(readReviewHistory({ reviews: [enriched] })[0]).toBe(enriched);
    expect(appendReviewHistory([enriched], review)[0]).toBe(enriched);
    expect(readReviewHistory({ reviews: [review] })).toEqual([review]);
    expect(() => readReviewHistory({ reviews: "bad" })).toThrow(/existing/);
    expect(() =>
      readReviewHistory({ reviews: [{ reviewer: "bad" }] }),
    ).toThrow();
    // Historical evidence may refer to an earlier version, not the latest event fields.
    expect(readReviewHistory({ reviews: [review], events: [] })).toHaveLength(
      1,
    );
  });
  it("deduplicates a replayed complete manifest while retaining separate review history", () => {
    const review = validateReviewManifest(packet(), [event]);
    const history = appendReviewHistory([], review);
    expect(appendReviewHistory(history, review)).toBe(history);
    expect(appendReviewHistory(history, null)).toBe(history);
    expect(
      appendReviewHistory(history, { ...review, reviewer: "another-reviewer" }),
    ).toHaveLength(2);
  });
});
