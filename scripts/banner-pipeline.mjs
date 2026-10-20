/** Server/job-only collection. The browser only reads public/data/banners.json. */
import { createHash } from "node:crypto";
import { load } from "cheerio";
import robotsParser from "robots-parser";
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
  },
  {
    server: "CN",
    name: "明日方舟 · Hypergryph",
    homepage: "https://ak.hypergryph.com/",
    robotsUrl: "https://ak.hypergryph.com/robots.txt",
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
/** No automatic redirects to an unapproved host, no arbitrary import URL fetches. */
export async function fetchText(
  url,
  source,
  fetchFn = globalThis.fetch,
  allowUrl = () => true,
) {
  let target = sourceUrl(url, source);
  if (!target) throw new Error("URL outside the approved official origin");
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowUrl(target))
      throw new Error("robots.txt disallows request or redirect");
    const response = await fetchFn(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html, text/plain, application/ld+json;q=0.9",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      target = location && sourceUrl(new URL(location, target).href, source);
      if (!target)
        throw new Error("Redirect outside the approved official origin");
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get("content-length") || 0) > MAX_BYTES)
      throw new Error("Response exceeds size limit");
    const reader = response.body?.getReader();
    let text = "",
      bytes = 0;
    if (reader) {
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) throw new Error("Response exceeds size limit");
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
      }
    } else {
      text = await response.text();
    }
    if (text.length > MAX_BYTES) throw new Error("Response exceeds size limit");
    return { text, url: target };
  }
  throw new Error("Too many redirects");
}
function errorText(error) {
  // Fixed diagnostic categories: never persist response bodies, headers or credentials.
  const message = String(error?.message ?? error);
  if (/HTTP \d{3}/.test(message)) return message.match(/HTTP \d{3}/)[0];
  if (
    /robots|policy|terms|structure|Event|JSON-LD|source|timezone|timestamp|Redirect|origin|limit/i.test(
      message,
    )
  )
    return message.slice(0, 180);
  if (/timeout|abort/i.test(message)) return "Request timed out";
  return "Network request failed (check official host / proxy access)";
}
export function robotsRules(text, source) {
  if (typeof text !== "string" || !/^\s*User-agent\s*:/im.test(text))
    throw new Error("robots.txt unavailable or ambiguous; collection denied");
  return robotsParser(source.robotsUrl, text);
}
function permitted(rules, url) {
  return rules.isAllowed(url, USER_AGENT) === true;
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
  const warnings = [];
  let robots, homepage;
  try {
    robots = await fetchText(source.robotsUrl, source, fetchFn);
  } catch (error) {
    warnings.push(`${source.server}: robots.txt: ${errorText(error)}`);
  }
  // An inaccessible/ambiguous robots policy denies collection, including the landing page.
  if (!robots)
    return { server: source.server, events: [], warnings, success: false };
  let rules;
  try {
    rules = robotsRules(robots.text, source);
  } catch (error) {
    warnings.push(`${source.server}: ${errorText(error)}`);
  }
  if (!rules)
    return { server: source.server, events: [], warnings, success: false };
  if (!permitted(rules, source.homepage))
    return {
      server: source.server,
      events: [],
      warnings: [`${source.server}: robots.txt disallows collection`],
      success: false,
    };
  const delay = Math.max(1000, (rules.getCrawlDelay(USER_AGENT) ?? 1) * 1000);
  if (delay > 30_000)
    return {
      server: source.server,
      events: [],
      warnings: [
        `${source.server}: robots crawl-delay exceeds safe job budget`,
      ],
      success: false,
    };
  await sleep(delay);
  try {
    homepage = await fetchText(source.homepage, source, fetchFn, (target) =>
      permitted(rules, target),
    );
  } catch (error) {
    warnings.push(`${source.server}: homepage: ${errorText(error)}`);
  }
  if (!homepage)
    return { server: source.server, events: [], warnings, success: false };
  if (!policyReviewed(policy)) {
    warnings.push(
      `${source.server}: terms not reviewed; article collection disabled`,
    );
    return { server: source.server, events: [], warnings, success: false };
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
      const parsed = parseStructuredEvents(page.text, page.url, source, now);
      events.push(...parsed.events);
    } catch (error) {
      warnings.push(`${source.server}: linked article: ${errorText(error)}`);
    }
  }
  if (!events.length)
    warnings.push(
      `${source.server}: no explicit supported Event JSON-LD; last valid data retained`,
    );
  try {
    return {
      server: source.server,
      events: normalizeBanners(events),
      warnings,
      success: events.length > 0,
    };
  } catch (error) {
    return {
      server: source.server,
      events: [],
      warnings: [
        ...warnings,
        `${source.server}: normalized source batch rejected`,
      ],
      success: false,
    };
  }
}
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
  return normalizeBanners(value.events);
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
