/**
 * Explicitly manual policy investigation, not banner collection. Only known
 * official homepage/robots roots are requested. No policy or public data writes.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";
import { SOURCES, fetchText } from "./banner-pipeline.mjs";
import { hasAnnouncementLocator } from "../src/announcement-url.ts";

const digest = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HTTP_ERRORS = Array.from({ length: 200 }, (_, i) => 400 + i);

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (
      isIP(host) ||
      !host.includes(".") ||
      /\.(?:local|internal|localhost)$/i.test(host)
    )
      return null;
    // SPA route paths can carry article identifiers; query values cannot enter logs.
    let hash = url.hash.split("?")[0];
    if (/[=&]/.test(hash)) hash = "";
    return {
      url: `${url.origin}${url.pathname}${hash}`,
      queryRedacted: !!url.search || hash !== url.hash,
    };
  } catch {
    return null;
  }
}
function safeRedirects(redirects = []) {
  return redirects.map((item) => ({
    url: safeUrl(item.url)?.url ?? null,
    status: item.status,
    location: safeUrl(item.location)?.url ?? null,
  }));
}
function visibleTitle(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/([?&][^=\s]+)=[^\s&]+/g, "$1=[redacted]")
    .replace(
      /\b(token|csrf|nonce|session|auth|key|signature)\s*[=:]\s*[^\s<>"']+/gi,
      "$1=[redacted]",
    )
    .trim()
    .slice(0, 120);
}
function candidateLinks($, pageUrl, source) {
  const acceptedOrigins = new Set(
    source.robotsOrigins ?? [new URL(source.homepage).origin],
  );
  const found = new Map();
  $("a[href], link[href]").each((_, element) => {
    const item = $(element);
    let target;
    try {
      target = new URL(item.attr("href"), pageUrl);
    } catch {
      return;
    }
    const safe = safeUrl(target.href);
    if (!safe) return;
    const label = item.text().trim();
    const pathText = `${target.pathname} ${target.hash.split("?")[0]} ${label}`;
    const mime = (item.attr("type") ?? "").toLowerCase();
    let kind;
    if (
      /application\/(?:rss|atom)\+xml/.test(mime) ||
      /\b(?:rss|atom|feed)\b/i.test(pathText)
    )
      kind = "feed";
    else if (
      /terms|legal|agreement|conditions|privacy|使用条款|服务协议|用户协议|隐私|法律/i.test(
        pathText,
      )
    )
      kind = "terms";
    else if (/\bapi\b|开发文档|接口文档/i.test(pathText)) kind = "api";
    else if (/news|notice|announcement|event|新闻|公告|活动/i.test(pathText))
      kind = "news";
    if (!kind) return;
    const officialOrigin = acceptedOrigins.has(target.origin);
    // A linked external legal page can be a policy-review lead, never an approved
    // collection origin. Arbitrary external news/API/feed origins are not accepted.
    if (!officialOrigin && kind !== "terms") return;
    const key = `${kind}:${safe.url}`;
    found.set(key, {
      kind,
      ...safe,
      officialOrigin,
      verified: false,
      fetched: false,
    });
  });
  const all = [...found.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url),
  );
  return {
    candidateLinks: all.slice(0, 40),
    candidateLinksTruncated: all.length > 40,
  };
}

/** Metadata only: this function never returns the supplied response body. */
export function analyzeHtmlResponse(page, source) {
  const metadata = {
    received: true,
    url: safeUrl(page.url)?.url ?? null,
    httpStatus: page.status,
    contentType: page.contentType ?? null,
    redirects: safeRedirects(page.redirects),
  };
  const text = typeof page.text === "string" ? page.text : "";
  const isHtml =
    /\btext\/html\b|\bapplication\/xhtml\+xml\b/i.test(
      page.contentType ?? "",
    ) ||
    /<!doctype\s+html|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)/i.test(text);
  if (page.status !== 200 || !text.trim() || !isHtml)
    return {
      ...metadata,
      bodyKind:
        page.status !== 200
          ? "not-inspected-http-status"
          : text.trim()
            ? "non-html"
            : "empty",
      html: null,
    };
  const $ = load(text);
  const indicators = [];
  if (
    $("#challenge-form, #cf-challenge-running, #cf-challenge-stage").length ||
    /window\._cf_chl_opt\b/.test(text)
  )
    indicators.push("cloudflare-challenge-markup");
  if ($('script[src*="challenges.cloudflare.com"]').length)
    indicators.push("cloudflare-challenge-script");
  if ($("#px-captcha").length) indicators.push("perimeterx-captcha-markup");
  if ($("[data-sitekey].g-recaptcha, .h-captcha[data-sitekey]").length)
    indicators.push("captcha-widget-markup");
  return {
    ...metadata,
    bodyKind: "html",
    html: {
      // fetchText validates UTF-8. These are decoded-text fingerprints, not hashes
      // of compressed/on-wire bytes and not evidence of permission to collect.
      utf8TextSha256: digest(text),
      whitespaceNormalizedSha256: digest(text.replace(/\s+/g, "")),
      title: visibleTitle($("title").first().text()),
      hasAppRoot:
        $("#root, #app, #__next, #__nuxt, [data-reactroot]").length > 0,
      linkedScriptAssetCount: $("script[src]").length,
      challengeIndicators: indicators,
    },
  };
}

/** Fingerprints and concrete markers support a hypothesis, never a robots rule. */
export function compareRobotsHomepage(robots, homepage) {
  if (!robots.received)
    return {
      classification: "unavailable",
      evidence: ["No complete robots origin response was received."],
      robotsTreatAsRules: false,
      permissionVerified: false,
    };
  if (robots.bodyKind !== "html")
    return {
      classification: "not-html",
      evidence: [
        "No HTTP200 HTML robots body was inspected; use the normal robots resolver separately.",
      ],
      robotsTreatAsRules: false,
      permissionVerified: false,
    };
  const exactMatch =
    !!homepage.html &&
    robots.html.utf8TextSha256 === homepage.html.utf8TextSha256;
  const normalizedMatch =
    !!homepage.html &&
    robots.html.whitespaceNormalizedSha256 ===
      homepage.html.whitespaceNormalizedSha256;
  const markers = robots.html.challengeIndicators;
  if (markers.length)
    return {
      classification: "challenge-markers",
      evidence: [
        "The actual robots HTML contains recognized challenge/widget markers. This supports investigation of a protection page, not a definitive cause or permission.",
        ...(normalizedMatch
          ? ["The homepage HTML fingerprint also matches."]
          : []),
      ],
      challengeIndicators: markers,
      exactHomepageMatch: exactMatch,
      normalizedHomepageMatch: normalizedMatch,
      robotsTreatAsRules: false,
      permissionVerified: false,
    };
  if (normalizedMatch)
    return {
      classification: "matches-homepage",
      evidence: [
        exactMatch
          ? "The HTTP200 robots HTML and homepage have identical decoded UTF-8 text fingerprints."
          : "The HTTP200 robots HTML and homepage match after whitespace-only normalization.",
        "Matching homepage HTML is consistent with a fallback route; hosting configuration and collection permission are not established.",
      ],
      exactHomepageMatch: exactMatch,
      normalizedHomepageMatch: true,
      robotsTreatAsRules: false,
      permissionVerified: false,
    };
  return {
    classification: "unknown-html",
    evidence: [
      "The robots endpoint returned HTML, but no matching homepage fingerprint or recognized challenge marker establishes why.",
    ],
    exactHomepageMatch: false,
    normalizedHomepageMatch: false,
    robotsTreatAsRules: false,
    permissionVerified: false,
  };
}
function requestFailure(error, requestedUrl) {
  return {
    received: false,
    url: safeUrl(error.url ?? requestedUrl)?.url ?? null,
    code: error.code ?? "REQUEST_FAILED",
    ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
    contentType: error.contentType ?? null,
    redirects: safeRedirects(error.redirects),
    bodyKind: "unavailable",
    html: null,
  };
}

/** Only an explicitly requested original official announcement can add one read. */
function requestedAnnouncement(value) {
  if (value === undefined || value === "") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Announcement URL must be an original HTTPS article on an approved official origin",
    );
  }
  const source = SOURCES.find((item) =>
    (item.robotsOrigins ?? [new URL(item.homepage).origin]).includes(
      url.origin,
    ),
  );
  if (!source || !hasAnnouncementLocator(url.href) || !safeUrl(url.href))
    throw new Error(
      "Announcement URL must be an original HTTPS article on an approved official origin",
    );
  return { source, url: url.href };
}

/** Observed publication fields only. These are not event start dates or verified facts. */
export function analyzeAnnouncementStructure(page) {
  const unavailable = {
    available: false,
    schemaKeys: [],
    schemaTypes: [],
    publicationCandidates: [],
    eventFactsExtracted: false,
  };
  const html = typeof page.text === "string" ? page.text : "";
  if (
    page.status !== 200 ||
    !html.trim() ||
    !(
      /text\/html|application\/xhtml\+xml/i.test(page.contentType ?? "") ||
      /<html(?:\s|>)/i.test(html)
    )
  )
    return unavailable;
  const $ = load(html),
    keys = new Set(),
    types = new Set(),
    candidates = new Map();
  let jsonLdDocuments = 0,
    invalidJsonLdDocuments = 0,
    visited = 0;
  function dateCandidate(value, field) {
    if (typeof value !== "string") return;
    const observed = value.trim();
    if (
      !/^\d{4}[-/]\d{2}[-/]\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
        observed,
      )
    )
      return;
    candidates.set(`${field}:${observed}`, {
      field,
      value: observed,
      precision: observed.length === 10 ? "date" : "time",
      timezoneExplicit:
        /[T\s]/.test(observed) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(observed),
      verifiedForEvent: false,
      usedAsEventStart: false,
    });
  }
  function walk(value, depth = 0) {
    if (depth > 20 || visited++ > 5000 || !value || typeof value !== "object")
      return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const key of Object.keys(value))
      if (/^[A-Za-z@][A-Za-z0-9_:@-]{0,79}$/.test(key) && keys.size < 40)
        keys.add(key);
    for (const raw of [value["@type"]].flat()) {
      if (typeof raw !== "string") continue;
      const type = raw.replace(/^https?:\/\/schema\.org\//, "");
      if (/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(type) && types.size < 20)
        types.add(type);
    }
    dateCandidate(value.datePublished, "jsonld.datePublished");
    dateCandidate(value.dateModified, "jsonld.dateModified");
    for (const [key, child] of Object.entries(value))
      if (key !== "@context") walk(child, depth + 1);
  }
  $('script[type="application/ld+json"]').each((_, element) => {
    jsonLdDocuments++;
    try {
      walk(JSON.parse($(element).text()));
    } catch {
      invalidJsonLdDocuments++;
    }
  });
  for (const [selector, field] of [
    [
      'meta[property="article:published_time"], meta[name="datePublished"], meta[itemprop="datePublished"]',
      "meta.datePublished",
    ],
    [
      'meta[property="article:modified_time"], meta[name="dateModified"], meta[itemprop="dateModified"]',
      "meta.dateModified",
    ],
  ])
    $(selector).each((_, element) =>
      dateCandidate($(element).attr("content"), field),
    );
  return {
    available: true,
    jsonLdDocuments,
    invalidJsonLdDocuments,
    schemaKeys: [...keys].sort(),
    schemaTypes: [...types].sort(),
    publicationCandidates: [...candidates.values()].slice(0, 20),
    eventFactsExtracted: false,
  };
}

/** Only known roots and one explicitly requested article are read; links/assets are not followed. */
export async function auditSources(options = {}) {
  const {
    fetchFn = globalThis.fetch,
    sleep = pause,
    now = new Date().toISOString(),
    announcementUrl,
  } = options;
  // Validate the optional user-requested URL BEFORE any network request.
  const requested = requestedAnnouncement(announcementUrl);
  const sources = [];
  for (const source of SOURCES) {
    const pages = {};
    for (const [stage, url] of [
      ["robots", source.robotsUrl],
      ["homepage", source.homepage],
    ]) {
      try {
        const page = await fetchText(url, source, fetchFn, () => true, {
          acceptStatuses: HTTP_ERRORS,
          maxRedirects: 5,
          approvedOrigins: source.robotsOrigins,
        });
        pages[stage] = analyzeHtmlResponse(page, source);
        if (stage === "homepage" && pages[stage].html)
          Object.assign(
            pages[stage],
            candidateLinks(load(page.text), page.url, source),
          );
      } catch (error) {
        pages[stage] = requestFailure(error, url);
      }
      await sleep(1000);
    }
    sources.push({
      server: source.server,
      homepage: pages.homepage,
      robots: pages.robots,
      comparison: compareRobotsHomepage(pages.robots, pages.homepage),
    });
  }
  let announcement;
  if (requested) {
    let response,
      structure = {
        available: false,
        schemaKeys: [],
        schemaTypes: [],
        publicationCandidates: [],
        eventFactsExtracted: false,
      };
    try {
      const page = await fetchText(
        requested.url,
        requested.source,
        fetchFn,
        () => true,
        {
          acceptStatuses: HTTP_ERRORS,
          maxRedirects: 5,
          approvedOrigins: requested.source.robotsOrigins,
        },
      );
      response = analyzeHtmlResponse(page, requested.source);
      structure = analyzeAnnouncementStructure(page);
    } catch (error) {
      response = requestFailure(error, requested.url);
    }
    announcement = {
      server: requested.source.server,
      explicitlyRequested: true,
      readOnly: true,
      response,
      structure,
      permissionVerified: false,
      eventFactsExtracted: false,
    };
  }
  return {
    schemaVersion: 1,
    mode: "manual-source-policy-audit",
    attemptedAt: now,
    requestScope: requested
      ? "known-official-homepage-and-robots plus one explicitly requested official announcement; no linked pages, assets or APIs fetched"
      : "known-official-homepage-and-robots-only; no linked pages, assets or APIs fetched",
    collectionEnabled: false,
    sourcePolicyChanged: false,
    liveRecords: 0,
    liveSyncVerified: false,
    permissionVerified: false,
    sources,
    ...(announcement ? { announcement } : {}),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--announcement"))
    throw new Error(
      "Usage: npm run banners:audit [-- --announcement <official-article-url>] (manual inspection only)",
    );
  const report = await auditSources({ announcementUrl: args[1] });
  console.log(JSON.stringify(report, null, 2));
  // This diagnostic never establishes publisher terms approval or a real sync.
  process.exitCode = 2;
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`Manual source audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
