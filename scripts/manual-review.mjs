/** Human review provenance. Presence of quotes is not a network/content verification. */
import { isOfficialUrl, validInstant } from "../src/banners.ts";
import { hasAnnouncementLocator } from "../src/announcement-url.ts";

const fields = new Set([
  "event",
  "publishedAt",
  "startAt",
  "endAt",
  "operators",
]);
function text(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Invalid review ${label}`);
  return value;
}
function evidenceKey(item) {
  return JSON.stringify([
    item.bannerId,
    item.server,
    item.sourceUrl,
    item.field,
  ]);
}
function normalizeReview(value, requireManualProvenance = true) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Manual import requires a review manifest");
  const reviewer = text(value.reviewer, "reviewer", 200).trim();
  const method = value.method ?? "reviewer-transcription";
  if (
    requireManualProvenance &&
    !["reviewer-transcription", "user-provided-extract"].includes(method)
  )
    throw new Error("Invalid manual review method");
  if (
    requireManualProvenance &&
    value.sourceFetched !== undefined &&
    value.sourceFetched !== false
  )
    throw new Error("Manual review cannot claim sourceFetched: true");

  if (!validInstant(value.reviewedAt) || /-00:00$/.test(value.reviewedAt))
    throw new Error("Review reviewedAt requires an explicit ISO timezone");
  if (
    !Array.isArray(value.evidence) ||
    !value.evidence.length ||
    value.evidence.length > 10000
  )
    throw new Error("Review evidence must be a nonempty array");
  const seen = new Set();
  const evidence = value.evidence
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("Invalid review evidence");
      const bannerId = text(item.bannerId, "bannerId", 3000);
      if (!["CN", "Global"].includes(item.server))
        throw new Error("Invalid review evidence server");
      if (!fields.has(item.field))
        throw new Error("Unsupported review evidence field");
      const sourceUrl = text(item.sourceUrl, "source URL", 3000);
      if (
        !isOfficialUrl(sourceUrl, item.server) ||
        !hasAnnouncementLocator(sourceUrl)
      )
        throw new Error(
          "Review evidence requires an original official announcement URL for the same server",
        );
      const quote = text(item.quote, "quote", 4000);
      const result = {
        bannerId,
        server: item.server,
        sourceUrl,
        field: item.field,
        quote,
      };
      const key = evidenceKey(result);
      if (seen.has(key))
        throw new Error("Duplicate or conflicting review evidence key");
      seen.add(key);
      return result;
    })
    .sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));
  return {
    reviewer,
    method,
    sourceFetched: requireManualProvenance
      ? false
      : (value.sourceFetched ?? false),
    reviewedAt: new Date(value.reviewedAt).toISOString(),
    evidence,
  };
}
/** Existing legacy manual records may predate evidence manifests. Never erase them. */
export function readReviewHistory(curated) {
  if (!Object.hasOwn(curated, "reviews")) return [];
  if (!Array.isArray(curated.reviews) || curated.reviews.length > 10000)
    throw new Error("Invalid existing manual review history");
  return curated.reviews.map((review) => {
    normalizeReview(review, false);
    // Preserve existing audit metadata and source text exactly; validation must
    // not silently migrate historical dossier records.
    return review;
  });
}
/** Validate a new packet against exactly the incoming records and field-specific sources. */
export function validateReviewManifest(packet, incoming) {
  if (!incoming.length && packet.review === undefined) return null;
  const review = normalizeReview(packet.review);
  const byId = new Map(incoming.map((event) => [event.id, event]));
  for (const item of review.evidence) {
    const banner = byId.get(item.bannerId);
    if (!banner || item.server !== banner.server)
      throw new Error("Orphan or wrong-server review evidence");
    const allowed = new Set([
      "event",
      "publishedAt",
      ...(banner.startAt ? ["startAt"] : []),
      ...(banner.endAt ? ["endAt"] : []),
      ...(banner.operators.length ? ["operators"] : []),
    ]);
    if (!allowed.has(item.field))
      throw new Error(
        "Review evidence claims a field absent from the imported event",
      );
    const source = banner.sources.find(
      (s) =>
        s.url === item.sourceUrl &&
        s.server === banner.server &&
        s.kind === "official" &&
        (item.field === "publishedAt" ||
          s.confirmedFields.includes(item.field)),
    );
    if (!source)
      throw new Error(
        "Review evidence does not match the original official source and confirmed field",
      );
  }
  for (const banner of incoming) {
    const required = [
      "event",
      "publishedAt",
      ...(banner.startAt ? ["startAt"] : []),
      ...(banner.endAt ? ["endAt"] : []),
      ...(banner.operators.length ? ["operators"] : []),
    ];
    for (const field of required)
      if (
        !review.evidence.some(
          (item) =>
            item.bannerId === banner.id &&
            item.server === banner.server &&
            item.field === field,
        )
      )
        throw new Error(`Missing review quote for ${field}`);
  }
  return review;
}
export function appendReviewHistory(history, review) {
  if (!review) return history;
  const serialized = JSON.stringify(normalizeReview(review));
  return history.some(
    (item) => JSON.stringify(normalizeReview(item, false)) === serialized,
  )
    ? history
    : [...history, review];
}
