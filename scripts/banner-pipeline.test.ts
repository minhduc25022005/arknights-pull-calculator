import { describe, it, expect, vi } from "vitest";
import {
  SOURCES,
  fetchText,
  resolveRobots,
  RequestError,
  isAnnouncementUrl,
  USER_AGENT,
  robotsRules,
  discoverArticleLinks,
  parseStructuredEvents,
  collectSource,
  validateManual,
  mergeResults,
  importCatalog,
} from "./banner-pipeline.mjs";
import type { Banner, Catalog } from "../src/banners";

const now = "2026-10-20T08:00:00Z";
const global = SOURCES[0];
function event(p: Partial<Banner> = {}): Banner {
  return {
    id: "fixture-global",
    eventId: "fixture-event",
    name: "Synthetic test fixture",
    server: "Global",
    category: "event",
    operators: [],
    startAt: "2026-11-01T10:00:00Z",
    endAt: "2026-11-08T10:00:00Z",
    status: "official",
    scheduleState: "scheduled",
    sources: [
      {
        url: "https://www.arknights.global/news/synthetic-test-fixture",
        name: "Official fixture",
        publishedAt: "2026-10-01T10:00:00Z",
        server: "Global",
        confirmedFields: ["event", "startAt", "endAt"],
        kind: "official",
      },
    ],
    updatedAt: "2026-10-01T10:00:00Z",
    origin: "sync",
    ...p,
  };
}
function catalog(events: Banner[] = []): Catalog {
  return {
    schemaVersion: 1,
    events,
    sync: {
      lastAttemptAt: null,
      lastSuccessAt: null,
      status: "never",
      warnings: [],
    },
  };
}
const reviewed = {
  termsReview: {
    reviewed: true,
    permitsAutomatedCollection: true,
    url: "https://www.arknights.global/terms-synthetic-test",
    reviewedAt: now,
    reviewedBy: "unit-test",
  },
};
const jsonld = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const structured = {
  "@type": "NewsArticle",
  datePublished: "2026-10-01T12:00:00-07:00",
  subject: {
    "@type": "Event",
    name: "Synthetic structured event",
    startDate: "2026-11-01T16:00:00+08:00",
    endDate: "2026-11-08T16:00:00+08:00",
  },
};
const noSleep = async () => {};

describe("official source adapter", () => {
  it("only discovers same-origin links actually in the supplied page", () => {
    const links = discoverArticleLinks(
      '<a href="/news/synthetic-fixture">Headhunting</a><a href="https://elsewhere.example/news">News</a><a href="//127.0.0.1/news">News</a>',
      global,
    );
    expect(links).toEqual([
      "https://www.arknights.global/news/synthetic-fixture",
    ]);
  });
  it("parses explicit timezone facts without inventing Operator names from performers", () => {
    const data = structuredClone(structured);
    Object.assign(data.subject, {
      performer: { name: "Not an Operator claim" },
    });
    const { events } = parseStructuredEvents(
      jsonld(data),
      "https://www.arknights.global/news/synthetic-fixture",
      global,
      now,
    );
    expect(events[0].startAt).toBe("2026-11-01T08:00:00.000Z");
    expect(events[0].sources[0].publishedAt).toBe("2026-10-01T19:00:00.000Z");
    expect(events[0].operators).toEqual([]);
  });
  it("publication timestamp is not the start of an announced event", () => {
    const { events } = parseStructuredEvents(
      jsonld({
        "@type": "Event",
        name: "Announcement fixture",
        datePublished: now,
      }),
      "https://www.arknights.global/news/synthetic-fixture",
      global,
      now,
    );
    expect(events[0].startAt).toBeUndefined();
    expect(events[0].scheduleState).toBe("announced");
  });
  it("rejects ambiguous local event dates atomically", () => {
    const data = structuredClone(structured);
    data.subject.startDate = "2026-11-01T16:00:00";
    expect(() =>
      parseStructuredEvents(
        jsonld(data),
        "https://www.arknights.global/news/synthetic-fixture",
        global,
        now,
      ),
    ).toThrow(/timezone/);
  });
  it("rejects missing publication evidence and malformed JSON-LD", () => {
    expect(() =>
      parseStructuredEvents(
        jsonld({ "@type": "Event", name: "Fixture" }),
        global.homepage,
        global,
        now,
      ),
    ).toThrow(/publication/);
    expect(() =>
      parseStructuredEvents(
        '<script type="application/ld+json">{broken</script>',
        global.homepage,
        global,
        now,
      ),
    ).toThrow(/JSON-LD/);
  });
  it("does not follow an external redirect or collect private URLs", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        }),
    );
    await expect(fetchText(global.homepage, global, fetchFn)).rejects.toThrow(
      /Redirect/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(
      fetchText("https://attacker.example/", global, fetchFn),
    ).rejects.toThrow(/origin/);
  });
  it("checks robots policy again before following redirects", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("", { status: 302, headers: { location: "/private" } }),
    );
    await expect(
      fetchText(
        global.homepage,
        global,
        fetchFn,
        (url: string) => !url.endsWith("/private"),
      ),
    ).rejects.toThrow(/robots/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("denies ambiguous robots files and follows actual disallow directives", () => {
    expect(() => robotsRules("<html>Error</html>", global)).toThrow(
      /ambiguous/,
    );
    const rules = robotsRules("User-agent: *\nDisallow: /private\n", global);
    expect(
      rules.isAllowed(
        "https://www.arknights.global/private",
        "RhodesPullCalendar/1.0",
      ),
    ).toBe(false);
  });
  it("does not fetch a homepage forbidden by robots", async () => {
    const fetchFn = vi.fn(
      async () => new Response("User-agent: *\nDisallow: /\n"),
    );
    const result = await collectSource(global, reviewed, {
      fetchFn,
      sleep: noSleep,
      now,
    });
    expect(result.success).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("does not fetch linked articles before terms review", async () => {
    const fetchFn = vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith("robots.txt")
            ? "User-agent: *\nAllow: /\n"
            : '<a href="/news/synthetic-fixture">News</a>',
        ),
    );
    const result = await collectSource(
      global,
      { termsReview: { reviewed: false } },
      { fetchFn, sleep: noSleep, now },
    );
    expect(result.success).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.warnings.join(" ")).toMatch(/terms/);
  });
  it("marks success only after a supported live source event was parsed", async () => {
    const fetchFn = vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith("robots.txt")
            ? "User-agent: *\nAllow: /\n"
            : url.endsWith("/news/synthetic-fixture")
              ? jsonld(structured)
              : '<a href="/news/synthetic-fixture">News</a>',
        ),
    );
    const result = await collectSource(global, reviewed, {
      fetchFn,
      sleep: noSleep,
      now,
    });
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
  });
  it("does not call HTTP 200 with unsupported markup a sync success", async () => {
    const fetchFn = vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith("robots.txt")
            ? "User-agent: *\nAllow: /\n"
            : '<a href="/news/synthetic-fixture">News</a>',
        ),
    );
    const result = await collectSource(global, reviewed, {
      fetchFn,
      sleep: noSleep,
      now,
    });
    expect(result.success).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/last valid/);
  });
});

describe("safe public catalog updates", () => {
  it("retains the last valid events and successful timestamp on source failure", () => {
    const old = catalog([event()]);
    old.sync.lastSuccessAt = "2026-10-01T10:00:00Z";
    const result = mergeResults(
      old,
      [],
      [
        {
          server: "Global",
          events: [],
          warnings: ["Global: Network failed"],
          success: false,
        },
      ],
      now,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].startAt).toBe(
      event().startAt.replace("Z", ".000Z"),
    );
    expect(result.sync.status).toBe("error");
    expect(result.sync.lastSuccessAt).toBe("2026-10-01T10:00:00.000Z");
  });
  it("rejects a new invalid batch while retaining previous records", () => {
    const bad = { ...event(), startAt: "2026-11-01" };
    const result = mergeResults(
      catalog([event()]),
      [],
      [{ server: "Global", events: [bad], warnings: [], success: true }],
      now,
    );
    expect(result.events).toHaveLength(1);
    expect(result.sync.status).toBe("error");
    expect(result.sync.warnings.join(" ")).toMatch(/rejected/);
  });
  it("rejects conflicting duplicate batches without erasing old events", () => {
    const other = event({ startAt: "2026-11-02T10:00:00Z" });
    const result = mergeResults(
      catalog([event()]),
      [],
      [{ server: "Global", events: [other], warnings: [], success: true }],
      now,
    );
    expect(result.events[0].startAt).toBe("2026-11-01T10:00:00.000Z");
    expect(result.sync.status).toBe("error");
  });
  it("deduplicates repeated source records", () => {
    const result = mergeResults(
      catalog(),
      [],
      [
        {
          server: "Global",
          events: [event(), event()],
          warnings: [],
          success: true,
        },
      ],
      now,
    );
    expect(result.events).toHaveLength(1);
    expect(result.sync.status).toBe("partial");
  });
  it("does not publish timestamp-only changes after an identical successful scan", () => {
    const result = mergeResults(
      catalog(),
      [],
      [{ server: "Global", events: [event()], warnings: [], success: true }],
      now,
    );
    const again = mergeResults(
      result,
      [],
      [
        {
          server: "Global",
          events: [event({ updatedAt: "2026-10-21T08:00:00Z" })],
          warnings: [],
          success: true,
        },
      ],
      "2026-10-21T08:00:00Z",
    );
    expect(again).toEqual(result);
  });
  it("does not collapse different events sharing a multi-event announcement URL", () => {
    const manual = event({
      name: "First fixture",
      origin: "manual",
      reviewed: true,
    });
    const next = event({
      id: "another-id",
      eventId: "another-event",
      name: "Second fixture",
      updatedAt: now,
    });
    const result = mergeResults(
      catalog([manual]),
      [],
      [{ server: "Global", events: [next], warnings: [], success: true }],
      now,
    );
    expect(result.events).toHaveLength(2);
  });
  it("manual imports require affirmative review and never claim live success", () => {
    expect(() =>
      validateManual({
        schemaVersion: 1,
        events: [event({ origin: "manual" })],
      }),
    ).toThrow(/reviewed/);
    const manual = validateManual({
      schemaVersion: 1,
      events: [event({ origin: "manual", reviewed: true })],
    });
    const result = importCatalog(catalog(), manual, now);
    expect(result.events).toHaveLength(1);
    expect(result.sync.lastSuccessAt).toBeNull();
    expect(result.sync.status).toBe("never");
  });
});

describe("RFC 9309 robots response handling", () => {
  const robotsResponse = (
    body: string,
    status = 200,
    contentType = "text/plain; charset=utf-8",
  ) => new Response(body, { status, headers: { "content-type": contentType } });
  it.each([404, 410])(
    "treats actual HTTP %i as unavailable while keeping terms independent",
    async (status) => {
      const fetchFn = vi.fn(async () =>
        robotsResponse("<html>not found</html>", status, "text/html"),
      );
      const resolution = await resolveRobots(global, fetchFn);
      expect(resolution.diagnostic).toMatchObject({
        httpStatus: status,
        code: "ROBOTS_NOT_FOUND",
        decision: "allow-no-file",
      });
      expect(resolution.rules.isAllowed(global.homepage, USER_AGENT)).toBe(
        true,
      );
      const result = await collectSource(
        global,
        { termsReview: { reviewed: false } },
        { fetchFn, sleep: noSleep, now },
      );
      expect(result.success).toBe(false);
      expect(result.events).toEqual([]);
      expect(
        result.diagnostics.some(
          (d: { code: string }) => d.code === "TERMS_UNREVIEWED",
        ),
      ).toBe(true);
      // One robots resolution above, plus the collector's robots request; no homepage/article requests.
      expect(fetchFn).toHaveBeenCalledTimes(2);
    },
  );
  it.each([401, 403, 429])(
    "conservatively denies actual HTTP %i instead of reclassifying as 404",
    async (status) => {
      const fetchFn = vi.fn(async () => robotsResponse("blocked", status));
      const resolution = await resolveRobots(global, fetchFn);
      expect(resolution.rules).toBeNull();
      expect(resolution.diagnostic).toMatchObject({
        code: "ROBOTS_ACCESS_DENIED",
        httpStatus: status,
        decision: "deny",
      });
      const result = await collectSource(global, reviewed, {
        fetchFn,
        sleep: noSleep,
        now,
      });
      expect(result.success).toBe(false);
      expect(result.warnings.join(" ")).toContain(`HTTP ${status}`);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    },
  );
  it.each([500, 502, 503])(
    "treats HTTP %i as unreachable and complete disallow",
    async (status) => {
      const result = await resolveRobots(global, async () =>
        robotsResponse("unavailable", status),
      );
      expect(result.rules).toBeNull();
      expect(result.diagnostic).toMatchObject({
        code: "ROBOTS_UNREACHABLE",
        httpStatus: status,
        decision: "deny",
      });
    },
  );
  it.each([
    [new DOMException("timeout", "TimeoutError"), "NETWORK_TIMEOUT"],
    [new TypeError("fetch failed"), "NETWORK_ERROR"],
    [
      Object.assign(new TypeError("fetch failed"), {
        cause: { message: "Proxy response (403) !== 200 when HTTP Tunneling" },
      }),
      "NETWORK_PROXY_DENIED",
    ],
    [
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "CERT_HAS_EXPIRED" },
      }),
      "NETWORK_TLS_ERROR",
    ],
  ])(
    "keeps network failure separate from origin status (%s)",
    async (error, code) => {
      const result = await resolveRobots(global, async () => {
        throw error;
      });
      expect(result.rules).toBeNull();
      expect(result.diagnostic).toMatchObject({ code, decision: "deny" });
      expect(result.diagnostic).not.toHaveProperty("httpStatus");
    },
  );
  it.each([
    "",
    "# only a comment\n",
    "Sitemap: https://www.arknights.global/sitemap.xml\n",
    "\uFEFFUser-agent: *\nAllow: /\n",
  ])(
    "accepts plain robots without restrictive groups or with BOM",
    async (text) => {
      const result = await resolveRobots(global, async () =>
        robotsResponse(text),
      );
      expect(result.rules.isAllowed(global.homepage, USER_AGENT)).toBe(true);
      expect(result.diagnostic.code).toBe("ROBOTS_RULES");
    },
  );
  it("ignores malformed lines but follows parseable disallow rules and no-match defaults", () => {
    const rules = robotsRules(
      "garbled line\nUser-agent: OtherCrawler\nDisallow: /\nUser-agent: *\nUnrecognized blah\nDisallow: /private\n",
      global,
    );
    expect(rules.isAllowed(`${global.homepage}private`, USER_AGENT)).toBe(
      false,
    );
    expect(rules.isAllowed(global.homepage, USER_AGENT)).toBe(true);
    const unmatched = robotsRules(
      "User-agent: OtherCrawler\nDisallow: /\n",
      global,
    );
    expect(unmatched.isAllowed(global.homepage, USER_AGENT)).toBe(true);
  });
  it.each([
    ["<!doctype html><html>SPA shell</html>", "text/html", "ROBOTS_HTML"],
    ["User-agent: *\nAllow: /", "text/html", "ROBOTS_CONTENT_TYPE"],
    ["{}", "application/json", "ROBOTS_CONTENT_TYPE"],
    ["User-agent: *", "text/plain; charset=gbk", "ROBOTS_ENCODING"],
  ])(
    "reports ambiguous successful responses using actual MIME metadata",
    async (body, type, code) => {
      const result = await resolveRobots(global, async () =>
        robotsResponse(body, 200, type),
      );
      expect(result.rules).toBeNull();
      expect(result.diagnostic).toMatchObject({
        code,
        httpStatus: 200,
        contentType: type,
        decision: "deny",
      });
    },
  );
  it("rejects invalid UTF-8 instead of silently replacing malformed bytes", async () => {
    const result = await resolveRobots(
      global,
      async () =>
        new Response(new Uint8Array([0xff, 0xfe, 0xff]), {
          headers: { "content-type": "text/plain" },
        }),
    );
    expect(result.rules).toBeNull();
    expect(result.diagnostic.code).toBe("INVALID_UTF8");
  });
  it("follows five robots redirects, applying final rules to the original authority", async () => {
    let calls = 0;
    const result = await resolveRobots(global, async () => {
      calls++;
      return calls <= 5
        ? new Response("", {
            status: 302,
            headers: {
              location:
                calls === 1
                  ? "https://arknights.global/robots-alias"
                  : `/robots-alias-${calls}`,
            },
          })
        : robotsResponse("User-agent: *\nDisallow: /private\n");
    });
    expect(calls).toBe(6);
    expect(
      result.rules.isAllowed(`${global.homepage}private`, USER_AGENT),
    ).toBe(false);
    expect(result.diagnostic.redirects).toHaveLength(5);
  });
  it("reports too many redirects and unapproved-authority redirects without fetching them", async () => {
    const loop = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "/robots-loop" },
        }),
    );
    expect((await resolveRobots(global, loop)).diagnostic.code).toBe(
      "REDIRECT_LIMIT",
    );
    expect(loop).toHaveBeenCalledTimes(6);
    const offsite = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://attacker.example/robots" },
        }),
    );
    expect((await resolveRobots(global, offsite)).diagnostic.code).toBe(
      "REDIRECT_REJECTED",
    );
    expect(offsite).toHaveBeenCalledTimes(1);
  });
  it("keeps diagnostic URLs free from credentials, bodies and query values", async () => {
    const result = await fetchText(
      `${global.homepage}?secret=fixture-do-not-log`,
      global,
      async () => robotsResponse("# public"),
    );
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("text/plain; charset=utf-8");
    const rejection = await resolveRobots(
      global,
      async () =>
        new Response("private response body", {
          status: 302,
          headers: {
            location: "https://attacker.example/path?token=fixture-do-not-log",
          },
        }),
    );
    expect(JSON.stringify(rejection.diagnostic)).not.toContain(
      "fixture-do-not-log",
    );
    expect(JSON.stringify(rejection.diagnostic)).not.toContain(
      "private response body",
    );
  });
  it.each([404, 403, 429, 500, 503])(
    "retains previous valid public events when HTTP %i yields no verified event",
    async (status) => {
      const previous = catalog([event()]);
      previous.sync.lastSuccessAt = "2026-10-01T10:00:00Z";
      const fetchFn = vi.fn(async (url: string) =>
        url.endsWith("robots.txt")
          ? robotsResponse("", status)
          : new Response('<a href="/news/synthetic-fixture">News</a>'),
      );
      const source = await collectSource(
        global,
        { termsReview: { reviewed: false } },
        { fetchFn, sleep: noSleep, now },
      );
      const result = mergeResults(previous, [], [source], now);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe(event().id);
      expect(result.sync.lastSuccessAt).toBe("2026-10-01T10:00:00.000Z");
      expect(result.sync.status).toBe("error");
    },
  );
  it("rejects bare homepage manual references, accepting real locator shapes without fetching", () => {
    expect(isAnnouncementUrl(global.homepage)).toBe(false);
    expect(isAnnouncementUrl(`${global.homepage}?utm_source=test`)).toBe(false);
    expect(isAnnouncementUrl(`${global.homepage}news/synthetic-fixture`)).toBe(
      true,
    );
    expect(
      isAnnouncementUrl(`${global.homepage}#/news/synthetic-fixture`),
    ).toBe(true);
    expect(
      isAnnouncementUrl(`${global.homepage}?article=synthetic-fixture`),
    ).toBe(true);
    const homepage = event({
      origin: "manual",
      reviewed: true,
      sources: [{ ...event().sources[0], url: global.homepage }],
    });
    expect(() =>
      validateManual({ schemaVersion: 1, events: [homepage] }),
    ).toThrow(/announcement URLs/);
  });
});

describe("all unreachable/ambiguous robots failures preserve validated history", () => {
  it.each([
    [
      "timeout",
      async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    ],
    [
      "network",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
    [
      "proxy",
      async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: { message: "CONNECT tunnel failed, response 403" },
        });
      },
    ],
    [
      "HTML fallback",
      async () =>
        new Response("<!doctype html><html>SPA</html>", {
          headers: { "content-type": "text/html" },
        }),
    ],
    [
      "wrong MIME",
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ],
    [
      "redirect rejection",
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://attacker.example/robots" },
        }),
    ],
  ])("keeps records after %s", async (_name, fetchFn) => {
    const old = catalog([event()]);
    old.sync.lastSuccessAt = "2026-10-01T10:00:00Z";
    const result = await collectSource(global, reviewed, {
      fetchFn,
      sleep: noSleep,
      now,
    });
    expect(result.events).toEqual([]);
    expect(result.success).toBe(false);
    const merged = mergeResults(old, [], [result], now);
    expect(merged.events[0].id).toBe(event().id);
    expect(merged.events[0].startAt).toBe("2026-11-01T10:00:00.000Z");
    expect(merged.sync.status).toBe("error");
    expect(merged.sync.lastSuccessAt).toBe("2026-10-01T10:00:00.000Z");
  });
});

describe("header receipt is distinct from a complete robots response", () => {
  it.each([
    [new TypeError("terminated"), "BODY_READ_ERROR"],
    [new DOMException("timed out", "TimeoutError"), "BODY_READ_TIMEOUT"],
  ])(
    "reports interrupted HTTP200 body without pretending no origin responded",
    async (error, code) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.error(error);
        },
      });
      const result = await resolveRobots(
        global,
        async () =>
          new Response(stream, { headers: { "content-type": "text/plain" } }),
      );
      expect(result.rules).toBeNull();
      expect(result.diagnostic).toMatchObject({
        code,
        httpStatus: 200,
        contentType: "text/plain",
        decision: "deny",
      });
      expect(result.warning).toMatch(/after HTTP 200/);
      expect(result.warning).not.toMatch(/no origin/);
    },
  );
});
