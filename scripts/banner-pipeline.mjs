/** Server/job-only collection. The browser only reads public/data/banners.json. */
import { createHash } from "node:crypto";
import { load } from "cheerio";
import robotsParser from "robots-parser";
import { hasAnnouncementLocator } from "../src/announcement-url.ts";
import {
  normalizeBanners,
  predictGlobal,
  validateCatalog,
  validInstant,
} from "../src/banners.ts";

export const SOURCES = Object.freeze([
  {
    server: "Global",
    name: "Arknights Global",
    homepage: "https://www.arknights.global/",
    robotsUrl: "https://www.arknights.global/robots.txt",
    robotsOrigins: ["https://www.arknights.global", "https://arknights.global"],
  },
  {
    server: "CN",
    name: "明日方舟 · Hypergryph",
    homepage: "https://ak.hypergryph.com/",
    robotsUrl: "https://ak.hypergryph.com/robots.txt",
    robotsOrigins: ["https://ak.hypergryph.com"],
  },
]);
export const USER_AGENT = "RhodesPullCalendar/1.0";
const MAX_BYTES = 2_000_000;
const MAX_ARTICLES = 6;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const canonical = (value) => {
  const url = new URL(value);
  url.hash = "";
  return url.href;
};
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);

export function sourceUrl(value, source) {
  try {
    const url = new URL(value, source.homepage);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname === new URL(source.homepage).hostname
      ? canonical(url.href)
      : null;
  } catch {
    return null;
  }
}
/** Safe public diagnostics deliberately omit bodies, credentials and URL query values. */
function diagnosticUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol)
      ? `${u.origin}${u.pathname}`
      : undefined;
  } catch {
    return undefined;
  }
}
export class RequestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    Object.assign(this, details);
    if (this.url) this.url = diagnosticUrl(this.url);
  }
}
function networkError(error, details) {
  const messages = [
    error?.message,
    error?.cause?.message,
    error?.cause?.cause?.message,
  ]
    .filter(Boolean)
    .join(" ");
  const codes = [error?.code, error?.cause?.code, error?.cause?.cause?.code]
    .filter(Boolean)
    .join(" ");
  const receivedHeaders =
    Number.isInteger(details.httpStatus) && details.httpStatus > 0;
  if (
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    /TIMEOUT|TIMEDOUT/i.test(codes)
  )
    return new RequestError(
      receivedHeaders ? "BODY_READ_TIMEOUT" : "NETWORK_TIMEOUT",
      receivedHeaders
        ? `Response body timed out after HTTP ${details.httpStatus}; complete representation unavailable`
        : "Request timed out; robots policy is unreachable",
      details,
    );
  if (
    !receivedHeaders &&
    /proxy.*403|CONNECT.*403|tunnel.*403|403.*proxy/i.test(messages)
  )
    return new RequestError(
      "NETWORK_PROXY_DENIED",
      "Proxy CONNECT denied (403); no origin HTTP response",
      details,
    );
  if (/CERT|TLS|SSL|SELF_SIGNED/i.test(codes))
    return new RequestError(
      receivedHeaders ? "BODY_READ_ERROR" : "NETWORK_TLS_ERROR",
      receivedHeaders
        ? `Response body TLS failure after HTTP ${details.httpStatus}`
        : "TLS verification failed; robots policy is unreachable",
      details,
    );
  return new RequestError(
    receivedHeaders ? "BODY_READ_ERROR" : "NETWORK_ERROR",
    receivedHeaders
      ? `Response body could not be read after HTTP ${details.httpStatus}`
      : "Network request failed; no origin HTTP response",
    details,
  );
}
function requestUrl(value, source, approvedOrigins) {
  try {
    const u = new URL(value, source.homepage);
    const origins = approvedOrigins ?? [new URL(source.homepage).origin];
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      origins.includes(u.origin)
      ? canonical(u.href)
      : null;
  } catch {
    return null;
  }
}
/**
 * Redirects are manual and bounded. Content stays on its original official origin.
 * robots.txt may use explicitly approved official aliases (RFC 9309 §2.3.1.2),
 * never arbitrary cross-origin URLs or a private/network-policy bypass.
 */
export async function fetchText(
  url,
  source,
  fetchFn = globalThis.fetch,
  allowUrl = () => true,
  options = {},
) {
  let target = requestUrl(url, source, options.approvedOrigins);
  if (!target)
    throw new RequestError(
      "URL_REJECTED",
      "URL outside the approved official origin",
    );
  const redirects = [],
    maxRedirects = options.maxRedirects ?? 5;
  for (;;) {
    const details = { url: target, redirects: [...redirects] };
    if (!allowUrl(target))
      throw new RequestError(
        "ROBOTS_DISALLOWED",
        "robots.txt disallows request or redirect",
        details,
      );
    let response;
    try {
      response = await fetchFn(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html, text/plain, application/ld+json;q=0.9",
        },
      });
    } catch (error) {
      throw networkError(error, details);
    }
    const status = response.status,
      contentType = response.headers.get("content-type") || null;
    const metadata = { ...details, httpStatus: status, contentType };
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.get("location");
      let next, locationUrl;
      try {
        locationUrl = location ? new URL(location, target).href : null;
        next =
          locationUrl &&
          requestUrl(locationUrl, source, options.approvedOrigins);
      } catch {
        next = null;
      }
      const redirect = {
        url: diagnosticUrl(target),
        status,
        location: locationUrl ? diagnosticUrl(locationUrl) : null,
      };
      redirects.push(redirect);
      if (!next)
        throw new RequestError(
          "REDIRECT_REJECTED",
          "Redirect outside the approved official origin or missing Location",
          { ...metadata, redirects: [...redirects] },
        );
      if (redirects.length > maxRedirects)
        throw new RequestError(
          "REDIRECT_LIMIT",
          "Too many redirects; robots policy cannot be established",
          { ...metadata, redirects: [...redirects] },
        );
      target = next;
      continue;
    }
    if (!response.ok) {
      if (!options.acceptStatuses?.includes(status))
        throw new RequestError(
          "HTTP_STATUS",
          `HTTP ${status} at official endpoint`,
          metadata,
        );
      // An actual final HTTP status is enough; do not interpret an error-page body as robots.
      return {
        text: "",
        url: target,
        status,
        contentType,
        redirects: [...redirects],
      };
    }
    if (Number(response.headers.get("content-length") || 0) > MAX_BYTES)
      throw new RequestError(
        "RESPONSE_TOO_LARGE",
        "Response exceeds size limit",
        metadata,
      );
    const reader = response.body?.getReader();
    let text = "",
      bytes = 0;
    try {
      if (reader) {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES)
            throw new RequestError(
              "RESPONSE_TOO_LARGE",
              "Response exceeds size limit",
              metadata,
            );
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } else {
        text = await response.text();
      }
    } catch (error) {
      if (error instanceof RequestError) throw error;
      if (error instanceof TypeError && /encod|decod/i.test(error.message))
        throw new RequestError(
          "INVALID_UTF8",
          "Response is not valid UTF-8",
          metadata,
        );
      throw networkError(error, metadata);
    } finally {
      if (reader) await reader.cancel().catch(() => {});
    }
    if (text.length > MAX_BYTES)
      throw new RequestError(
        "RESPONSE_TOO_LARGE",
        "Response exceeds size limit",
        metadata,
      );
    return {
      text,
      url: target,
      status,
      contentType,
      redirects: [...redirects],
    };
  }
}
function errorText(error) {
  if (error instanceof RequestError)
    return `${error.code}: ${error.message}${error.contentType ? ` (Content-Type: ${error.contentType})` : ""}`;
  const message = String(error?.message ?? error);
  if (
    /robots|policy|terms|structure|Event|JSON-LD|source|timezone|timestamp|Redirect|origin|limit/i.test(
      message,
    )
  )
    return message.slice(0, 180);
  return "Source processing failed; previous valid data retained";
}
export function robotsRules(text, source, options = {}) {
  const contentType = options.contentType?.split(";")[0].trim().toLowerCase();
  const value = typeof text === "string" ? text.replace(/^\uFEFF/, "") : "";
  const metadata = {
    url: options.url ?? source.robotsUrl,
    contentType: options.contentType ?? null,
    httpStatus: options.status ?? 200,
    redirects: options.redirects ?? [],
  };
  if (
    typeof text !== "string" ||
    /<!doctype\s+html|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)|<script(?:\s|>)/i.test(
      value,
    )
  )
    throw new RequestError(
      "ROBOTS_HTML",
      "robots.txt returned HTML instead of robots rules; ambiguous policy",
      metadata,
    );
  if (contentType && contentType !== "text/plain")
    throw new RequestError(
      "ROBOTS_CONTENT_TYPE",
      "robots.txt Content-Type is not text/plain; ambiguous policy",
      metadata,
    );
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/i
    .exec(options.contentType ?? "")?.[1]
    ?.toLowerCase();
  if (charset && !["utf-8", "utf8", "us-ascii"].includes(charset))
    throw new RequestError(
      "ROBOTS_ENCODING",
      "robots.txt is not declared UTF-8",
      metadata,
    );
  const parser = robotsParser(source.robotsUrl, value);
  // RFC 9309 §2.3.1.5: process parseable lines, ignoring invalid lines. Empty,
  // comment-only and Sitemap-only text are valid with no applicable restrictions.
  // robots-parser returns undefined when no group matches; RFC default is allow.
  return {
    isAllowed: (url, agent) => parser.isAllowed(url, agent) !== false,
    getCrawlDelay: (agent) => parser.getCrawlDelay(agent),
  };
}
function permitted(rules, url) {
  return rules.isAllowed(url, USER_AGENT) !== false;
}
function responseDiagnostic(stage, page, code, decision) {
  return {
    stage,
    code,
    url: diagnosticUrl(page.url),
    httpStatus: page.status,
    contentType: page.contentType,
    redirects: page.redirects,
    decision,
  };
}
function failureDiagnostic(stage, error) {
  return {
    stage,
    code: error.code ?? "SOURCE_ERROR",
    ...(error.url ? { url: error.url } : {}),
    ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
    ...("contentType" in error ? { contentType: error.contentType } : {}),
    ...(error.redirects ? { redirects: error.redirects } : {}),
    decision: "deny",
  };
}
/** RFC 9309 §2.3.1.3 permits access on 4xx; we choose only 404/410 and
 * conservatively deny authorization/rate-limit responses. 5xx/network always deny. */
export async function resolveRobots(source, fetchFn = globalThis.fetch) {
  let page;
  try {
    page = await fetchText(source.robotsUrl, source, fetchFn, () => true, {
      acceptStatuses: Array.from({ length: 200 }, (_, i) => 400 + i),
      maxRedirects: 5,
      approvedOrigins: source.robotsOrigins,
    });
  } catch (error) {
    return {
      rules: null,
      diagnostic: failureDiagnostic("robots", error),
      warning: errorText(error),
    };
  }
  if (page.status === 404 || page.status === 410) {
    return {
      rules: robotsRules("", source),
      diagnostic: responseDiagnostic(
        "robots",
        page,
        "ROBOTS_NOT_FOUND",
        "allow-no-file",
      ),
      warning: null,
    };
  }
  if (page.status >= 400) {
    const unreachable = page.status >= 500;
    return {
      rules: null,
      diagnostic: responseDiagnostic(
        "robots",
        page,
        unreachable ? "ROBOTS_UNREACHABLE" : "ROBOTS_ACCESS_DENIED",
        "deny",
      ),
      warning: `HTTP ${page.status}: ${unreachable ? "robots policy unreachable; collection denied" : "robots access/rate-limit response; collection conservatively denied"}`,
    };
  }
  try {
    return {
      rules: robotsRules(page.text, source, page),
      diagnostic: responseDiagnostic(
        "robots",
        page,
        "ROBOTS_RULES",
        "evaluate",
      ),
      warning: null,
    };
  } catch (error) {
    return {
      rules: null,
      diagnostic: failureDiagnostic("robots", error),
      warning: errorText(error),
    };
  }
}
function policyReviewed(policy) {
  const x = policy?.termsReview;
  if (
    !x ||
    x.reviewed !== true ||
    x.permitsAutomatedCollection !== true ||
    !validInstant(x.reviewedAt) ||
    typeof x.reviewedBy !== "string" ||
    !x.reviewedBy.trim()
  )
    return false;
  try {
    const u = new URL(x.url);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function discoverArticleLinks(html, source) {
  const $ = load(html);
  const links = new Map();
  $("a[href]").each((_, element) => {
    const href = sourceUrl($(element).attr("href"), source);
    if (
      !href ||
      href === source.homepage ||
      /\.(?:png|jpg|svg|webp|mp4|pdf|zip)(?:\?|$)/i.test(href)
    )
      return;
    const label = $(element).text().trim();
    // Rank URLs actually linked by the site. No path or endpoint is manufactured.
    const score = /headhunt|banner|寻访/i.test(label)
      ? 3
      : /news|notice|event|活动|公告|新闻/i.test(
            `${label} ${new URL(href).pathname}`,
          )
        ? 2
        : 0;
    if (score) links.set(href, Math.max(score, links.get(href) ?? 0));
  });
  return [...links]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_ARTICLES)
    .map(([url]) => url);
}
function hasType(object, type) {
  return [object?.["@type"]]
    .flat()
    .some((value) => value === type || value === `https://schema.org/${type}`);
}
function property(object, name) {
  return [object.additionalProperty ?? []]
    .flat()
    .find((p) => p && p.name === name)?.value;
}
/** Only explicit structured facts are accepted; publication is NEVER used as startDate. */
export function parseStructuredEvents(html, articleUrl, source, now) {
  const $ = load(html),
    events = [];
  let structured = 0;
  function walk(value, publication) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, publication);
      return;
    }
    if (!value || typeof value !== "object") return;
    const publishedAt = validInstant(value.datePublished)
      ? value.datePublished
      : publication;
    if (hasType(value, "Event")) {
      structured++;
      if (!publishedAt)
        throw new Error(
          "Event has no explicit publication timestamp with timezone",
        );
      if (typeof value.name !== "string" || !value.name.trim())
        throw new Error("Event has no name");
      const url = sourceUrl(articleUrl, source);
      const eventUrl = sourceUrl(value.url || articleUrl, source);
      if (!url || !eventUrl)
        throw new Error("Event source URL outside official origin");
      if (value.startDate !== undefined && !validInstant(value.startDate))
        throw new Error("Event start timestamp requires explicit timezone");
      if (value.endDate !== undefined && !validInstant(value.endDate))
        throw new Error("Event end timestamp requires explicit timezone");
      const explicitOperators =
        property(value, "Operators") ??
        property(value, "Operator") ??
        property(value, "干员");
      const operators =
        explicitOperators === undefined ? [] : [explicitOperators].flat();
      if (!operators.every((n) => typeof n === "string" && n.trim()))
        throw new Error("Event Operator structure unsupported");
      const explicitCategory = property(value, "Arknights event category");
      const category = [
        "limited",
        "anniversary",
        "rerun",
        "standard",
        "event",
      ].includes(explicitCategory)
        ? explicitCategory
        : "event";
      const confirmedFields = [
        "event",
        ...(value.startDate ? ["startAt"] : []),
        ...(value.endDate ? ["endAt"] : []),
        ...(operators.length ? ["operators"] : []),
      ];
      const identity = `${eventUrl}#${value["@id"] || value.name}`;
      events.push({
        id: `${source.server.toLowerCase()}-${hash(identity)}`,
        eventId: `source-${hash(identity)}`,
        name: value.name.trim(),
        server: source.server,
        category,
        operators,
        ...(value.startDate ? { startAt: value.startDate } : {}),
        ...(value.endDate ? { endAt: value.endDate } : {}),
        status: "official",
        scheduleState: value.startDate ? "scheduled" : "announced",
        sources: [
          {
            url,
            name: source.name,
            publishedAt,
            server: source.server,
            confirmedFields,
            kind: "official",
          },
        ],
        updatedAt: now,
        origin: "sync",
      });
    }
    for (const [key, child] of Object.entries(value))
      if (key !== "@context") walk(child, publishedAt);
  }
  $('script[type="application/ld+json"]').each((_, element) => {
    let json;
    try {
      json = JSON.parse($(element).text());
    } catch {
      throw new Error("Invalid official JSON-LD structure");
    }
    walk(json, undefined);
  });
  return { events: normalizeBanners(events), structured };
}
export async function collectSource(source, policy, options = {}) {
  const {
    fetchFn = globalThis.fetch,
    sleep = pause,
    now = new Date().toISOString(),
  } = options;
  const warnings = [],
    diagnostics = [];
  const finish = (events = [], success = false) => ({
    server: source.server,
    events,
    warnings,
    diagnostics,
    success,
  });
  const robots = await resolveRobots(source, fetchFn);
  diagnostics.push(robots.diagnostic);
  if (robots.warning)
    warnings.push(`${source.server}: robots.txt: ${robots.warning}`);
  if (!robots.rules) return finish();
  const rules = robots.rules;
  if (!permitted(rules, source.homepage)) {
    warnings.push(`${source.server}: robots.txt disallows collection`);
    diagnostics.push({
      stage: "robots",
      code: "ROBOTS_DISALLOWED",
      url: diagnosticUrl(source.homepage),
      decision: "deny",
    });
    return finish();
  }
  // No missing/empty/404 robots file can supply terms consent.
  if (!policyReviewed(policy)) {
    warnings.push(
      `${source.server}: terms not reviewed; page and article collection disabled`,
    );
    diagnostics.push({
      stage: "policy",
      code: "TERMS_UNREVIEWED",
      decision: "deny",
    });
    return finish();
  }
  const crawl = rules.getCrawlDelay(USER_AGENT);
  const delay = Math.max(1000, Number.isFinite(crawl) ? crawl * 1000 : 1000);
  if (delay > 30_000) {
    warnings.push(
      `${source.server}: robots crawl-delay exceeds safe job budget`,
    );
    return finish();
  }
  await sleep(delay);
  let homepage;
  try {
    homepage = await fetchText(source.homepage, source, fetchFn, (target) =>
      permitted(rules, target),
    );
    diagnostics.push(
      responseDiagnostic("homepage", homepage, "HTTP_OK", "read"),
    );
  } catch (error) {
    warnings.push(`${source.server}: homepage: ${errorText(error)}`);
    diagnostics.push(failureDiagnostic("homepage", error));
    return finish();
  }
  const links = discoverArticleLinks(homepage.text, source);
  if (!links.length)
    warnings.push(
      `${source.server}: no supported article links; source structure needs review`,
    );
  const events = [];
  for (const url of links) {
    if (!permitted(rules, url)) {
      warnings.push(`${source.server}: robots.txt disallows linked article`);
      continue;
    }
    await sleep(delay);
    try {
      const page = await fetchText(url, source, fetchFn, (target) =>
        permitted(rules, target),
      );
      diagnostics.push(responseDiagnostic("article", page, "HTTP_OK", "read"));
      const parsed = parseStructuredEvents(page.text, page.url, source, now);
      events.push(...parsed.events);
    } catch (error) {
      warnings.push(`${source.server}: linked article: ${errorText(error)}`);
      diagnostics.push(failureDiagnostic("article", error));
    }
  }
  if (!events.length)
    warnings.push(
      `${source.server}: no explicit supported Event JSON-LD; last valid data retained`,
    );
  try {
    return finish(normalizeBanners(events), events.length > 0);
  } catch {
    warnings.push(`${source.server}: normalized source batch rejected`);
    return finish();
  }
}
/** Shared with the manual form; content still requires human review. */
export const isAnnouncementUrl = hasAnnouncementLocator;
export function validateManual(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.events))
    throw new Error("Manual import requires {schemaVersion:1,events:[]}");
  if (
    !value.events.every(
      (event) => event.origin === "manual" && event.reviewed === true,
    )
  )
    throw new Error(
      "Every manual record requires origin: manual and reviewed: true",
    );
  const events = normalizeBanners(value.events);
  if (
    events.some((event) =>
      event.sources.some((source) => !isAnnouncementUrl(source.url)),
    )
  )
    throw new Error(
      "Manual import requires original announcement URLs, not bare homepages",
    );
  return events;
}
function eventContent(event) {
  const { updatedAt, ...rest } = event;
  return JSON.stringify(rest);
}
/** Preserve acquisition time for identical content; retain all previous valid events on errors. */
function stableIncoming(previous, incoming) {
  return incoming.map((next) => {
    const exact = previous.find(
      (old) => old.server === next.server && old.eventId === next.eventId,
    );
    // A reviewed manual correspondence takes precedence over a source-generated identity.
    const candidates = previous.filter(
      (old) =>
        old.origin === "manual" &&
        old.server === next.server &&
        old.name === next.name &&
        old.sources.some((s) => next.sources.some((n) => n.url === s.url)),
    );
    const mapped =
      exact || (candidates.length === 1 ? candidates[0] : undefined);
    const candidate =
      mapped && !exact
        ? {
            ...next,
            eventId: mapped.eventId,
            id: mapped.id,
            category: mapped.category,
          }
        : next;
    return mapped && eventContent(candidate) === eventContent(mapped)
      ? { ...candidate, updatedAt: mapped.updatedAt }
      : candidate;
  });
}
export function catalogContent(catalog) {
  return JSON.stringify({
    events: catalog.events.map((event) => JSON.parse(eventContent(event))),
    status: catalog.sync.status,
    warnings: catalog.sync.warnings,
  });
}
export function mergeResults(
  previous,
  manual,
  results,
  now = new Date().toISOString(),
  report = {},
) {
  const old = validateCatalog(previous);
  const warnings = results.flatMap((r) => r.warnings);
  let merged = normalizeBanners([...old.events, ...manual]);
  let successful = 0;
  report.acceptedRecords = 0;
  for (const result of results) {
    try {
      const valid = normalizeBanners(result.events);
      if (valid.some((event) => event.server !== result.server))
        throw new Error("Server mismatch");
      if (result.success && valid.length) {
        merged = normalizeBanners([
          ...merged,
          ...stableIncoming(merged, valid),
        ]);
        successful++;
        report.acceptedRecords += valid.length;
      }
    } catch {
      warnings.push(
        `${result.server}: invalid new source data rejected; previous events retained`,
      );
    }
  }
  const candidate = validateCatalog({
    schemaVersion: 1,
    events: predictGlobal(merged, now),
    sync: {
      lastAttemptAt: now,
      lastSuccessAt: successful ? now : old.sync.lastSuccessAt,
      status:
        successful === SOURCES.length
          ? warnings.length
            ? "partial"
            : "ok"
          : successful
            ? "partial"
            : "error",
      warnings: [...new Set(warnings)].sort(),
    },
  });
  return catalogContent(candidate) === catalogContent(old) ? old : candidate;
}
export function importCatalog(
  previous,
  manual,
  now = new Date().toISOString(),
) {
  const old = validateCatalog(previous);
  const candidate = validateCatalog({
    ...old,
    events: predictGlobal(normalizeBanners([...old.events, ...manual]), now),
  });
  return catalogContent(candidate) === catalogContent(old) ? old : candidate;
}
