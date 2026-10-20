import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { SOURCES } from "./banner-pipeline.mjs";
import {
  analyzeHtmlResponse,
  compareRobotsHomepage,
  auditSources,
  analyzeAnnouncementStructure,
} from "./audit-sources.mjs";

const global = SOURCES[0];
const now = "2026-10-20T09:30:00Z";
const noSleep = async () => {};
const shell =
  '<!doctype html><html><head><title>Arknights fixture</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
function page(text: string, options: Record<string, unknown> = {}) {
  return {
    text,
    url: global.homepage,
    status: 200,
    contentType: "text/html; charset=utf-8",
    redirects: [],
    ...options,
  };
}

describe("explicitly requested announcement audit", () => {
  it("rejects unofficial, private, credential or homepage inputs before network", async () => {
    for (const announcementUrl of [
      "https://127.0.0.1/news/1",
      "https://attacker.example/news/1",
      "https://token@www.arknights.global/news/1",
      "http://www.arknights.global/news/1",
      "https://www.arknights.global/",
    ]) {
      const fetchFn = vi.fn();
      await expect(
        auditSources({ fetchFn, announcementUrl, sleep: noSleep, now }),
      ).rejects.toThrow(/approved official origin/);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });
  it("reads one explicit article, preserves publication precision and never follows article links", async () => {
    // Synthetic response only; the requested URL was explicitly supplied by the user.
    const url = "https://www.arknights.global/news/4814";
    const article =
      '<html><title>Synthetic article structure fixture</title><script type="application/ld+json">' +
      JSON.stringify({
        "@type": "NewsArticle",
        datePublished: "2026-10-20",
        dateModified: "2026-10-20T09:00:00Z",
        headline: "must not become banner facts",
        token: "private-not-published",
      }) +
      '</script><meta property="article:published_time" content="2026-10-20T16:00:00+07:00"><a href="/news/not-requested">News</a><script src="/private-asset.js"></script></html>';
    const fetchFn = vi.fn(
      async (request: string) =>
        new Response(request === url ? article : shell, {
          headers: { "content-type": "text/html" },
        }),
    );
    const report = await auditSources({
      fetchFn,
      announcementUrl: url,
      sleep: noSleep,
      now,
    });
    expect(fetchFn.mock.calls.map(([request]) => request)).toEqual([
      ...SOURCES.flatMap((source) => [source.robotsUrl, source.homepage]),
      url,
    ]);
    expect(report.announcement).toMatchObject({
      server: "Global",
      explicitlyRequested: true,
      readOnly: true,
      eventFactsExtracted: false,
      permissionVerified: false,
    });
    expect(report.announcement.structure.schemaTypes).toEqual(["NewsArticle"]);
    expect(report.announcement.structure.publicationCandidates).toContainEqual({
      field: "jsonld.datePublished",
      value: "2026-10-20",
      precision: "date",
      timezoneExplicit: false,
      verifiedForEvent: false,
      usedAsEventStart: false,
    });
    expect(report.announcement.structure.publicationCandidates).toContainEqual({
      field: "jsonld.dateModified",
      value: "2026-10-20T09:00:00Z",
      precision: "time",
      timezoneExplicit: true,
      verifiedForEvent: false,
      usedAsEventStart: false,
    });
    expect(JSON.stringify(report)).not.toContain(
      "must not become banner facts",
    );
    expect(JSON.stringify(report)).not.toContain("private-not-published");
    expect(report.announcement.response.candidateLinks).toBeUndefined();
    expect(report.liveRecords).toBe(0);
  });
  it("does not manufacture publication metadata when an explicit article is blocked", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const report = await auditSources({
      fetchFn,
      announcementUrl: "https://www.arknights.global/news/4814",
      sleep: noSleep,
      now,
    });
    expect(report.announcement.response).toMatchObject({
      received: false,
      code: "NETWORK_ERROR",
    });
    expect(report.announcement.structure).toMatchObject({
      available: false,
      publicationCandidates: [],
      eventFactsExtracted: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });
  it("keeps malformed JSON-LD and ambiguous publication candidates out of verified data", () => {
    const response = page(
      '<html><script type="application/ld+json">{broken</script><script type="application/ld+json">' +
        JSON.stringify({
          "@type": "Event",
          datePublished: "not-a-date",
          dateModified: "2026-10-20",
        }) +
        "</script></html>",
    );
    const structure = analyzeAnnouncementStructure(response);
    expect(structure).toMatchObject({
      available: true,
      jsonLdDocuments: 2,
      invalidJsonLdDocuments: 1,
      schemaTypes: ["Event"],
      eventFactsExtracted: false,
    });
    expect(structure.publicationCandidates).toEqual([
      {
        field: "jsonld.dateModified",
        value: "2026-10-20",
        precision: "date",
        timezoneExplicit: false,
        verifiedForEvent: false,
        usedAsEventStart: false,
      },
    ]);
  });
});

describe("manual source audit evidence, not permission", () => {
  it("compares identical HTML fingerprints without treating them as valid robots", () => {
    const robots = analyzeHtmlResponse(
      page(shell, { url: global.robotsUrl }),
      global,
    );
    const home = analyzeHtmlResponse(page(shell), global);
    expect(robots.html).toMatchObject({
      title: "Arknights fixture",
      hasAppRoot: true,
      linkedScriptAssetCount: 1,
      challengeIndicators: [],
    });
    const comparison = compareRobotsHomepage(robots, home);
    expect(comparison).toMatchObject({
      classification: "matches-homepage",
      exactHomepageMatch: true,
      robotsTreatAsRules: false,
      permissionVerified: false,
    });
    expect(JSON.stringify(robots)).not.toContain('<div id="root">');
  });
  it("reports a whitespace-only match separately from an exact decoded text match", () => {
    const robots = analyzeHtmlResponse(
      page(shell.replace(/></g, ">\n  <")),
      global,
    );
    const home = analyzeHtmlResponse(page(shell), global);
    expect(compareRobotsHomepage(robots, home)).toMatchObject({
      classification: "matches-homepage",
      exactHomepageMatch: false,
      normalizedHomepageMatch: true,
    });
  });
  it("reports only concrete challenge marker codes and never solves or reveals a challenge", () => {
    const html =
      '<html><head><title>Just a moment</title></head><body><form id="challenge-form" action="/challenge?token=secret-test-token"><input name="secret" value="secret-body-value"></form><script>window._cf_chl_opt={nonce:"secret-nonce"};</script></body></html>';
    const robots = analyzeHtmlResponse(page(html), global);
    const comparison = compareRobotsHomepage(
      robots,
      analyzeHtmlResponse(page(shell), global),
    );
    expect(comparison.classification).toBe("challenge-markers");
    expect(robots.html.challengeIndicators).toContain(
      "cloudflare-challenge-markup",
    );
    expect(JSON.stringify({ robots, comparison })).not.toContain(
      "secret-test-token",
    );
    expect(JSON.stringify({ robots, comparison })).not.toContain(
      "secret-body-value",
    );
    expect(JSON.stringify({ robots, comparison })).not.toContain(
      "secret-nonce",
    );
    expect(comparison.permissionVerified).toBe(false);
  });
  it("keeps different HTML and empty responses unknown rather than asserting SPA/configuration", () => {
    const robots = analyzeHtmlResponse(
      page("<html><title>Other page</title></html>"),
      global,
    );
    expect(
      compareRobotsHomepage(robots, analyzeHtmlResponse(page(shell), global))
        .classification,
    ).toBe("unknown-html");
    const empty = analyzeHtmlResponse(page(""), global);
    expect(empty.bodyKind).toBe("empty");
    expect(compareRobotsHomepage(empty, empty).classification).toBe("not-html");
    expect(
      analyzeHtmlResponse(
        page("User-agent: *\nAllow: /", { contentType: "text/plain" }),
        global,
      ).html,
    ).toBeNull();
  });
  it("limits public titles and redacts token/query-like title values", () => {
    const result = analyzeHtmlResponse(
      page(
        "<html><title>Test token=private-token ?secret=private-query " +
          "x".repeat(180) +
          "</title></html>",
      ),
      global,
    );
    expect(result.html.title.length).toBeLessThanOrEqual(120);
    expect(result.html.title).not.toContain("private-token");
    expect(result.html.title).not.toContain("private-query");
  });
  it("discovers only links in the received homepage and makes no linked requests", async () => {
    const home = shell.replace(
      "</body>",
      `<a href="/news/fixture?article=private-query">News</a><a href="/#/news/fixture?token=private-query">News</a><a href="https://legal.example/terms?token=private-query">Terms</a><a href="https://127.0.0.1/terms">Terms</a><a href="https://user:password@legal.example/terms">Terms</a><a href="https://elsewhere.example/news">News</a><link rel="alternate" type="application/atom+xml" href="/feed.xml"><a href="/api/documented?token=private-query">Public API documentation</a></body>`,
    );
    const fetchFn = vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith("robots.txt") ? "User-agent: *\nAllow: /" : home,
          {
            headers: {
              "content-type": url.endsWith("robots.txt")
                ? "text/plain"
                : "text/html",
            },
          },
        ),
    );
    const report = await auditSources({ fetchFn, now, sleep: noSleep });
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual(
      SOURCES.flatMap((s) => [s.robotsUrl, s.homepage]),
    );
    const candidates = report.sources[0].homepage.candidateLinks;
    expect(candidates.map((c: { kind: string }) => c.kind)).toEqual(
      expect.arrayContaining(["terms", "news", "feed", "api"]),
    );
    expect(
      candidates.find((c: { url: string }) =>
        c.url.startsWith("https://legal.example"),
      ),
    ).toMatchObject({
      officialOrigin: false,
      verified: false,
      fetched: false,
      queryRedacted: true,
    });
    expect(report.sources[0].robots.candidateLinks).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("private-query");
    expect(JSON.stringify(candidates)).not.toContain("127.0.0.1");
    expect(JSON.stringify(candidates)).not.toContain("user:password");
    expect(JSON.stringify(candidates)).not.toContain("elsewhere.example");
    expect(report).toMatchObject({
      collectionEnabled: false,
      sourcePolicyChanged: false,
      permissionVerified: false,
      liveRecords: 0,
      liveSyncVerified: false,
    });
  });
  it("preserves actual HTTP404 metadata without reading error-page bodies as HTML", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith("robots.txt")
        ? new Response("<html>not-found-body-do-not-include</html>", {
            status: 404,
            headers: { "content-type": "text/html" },
          })
        : new Response(shell, { headers: { "content-type": "text/html" } }),
    );
    const report = await auditSources({ fetchFn, now, sleep: noSleep });
    expect(report.sources[0].robots).toMatchObject({
      received: true,
      httpStatus: 404,
      contentType: "text/html",
      bodyKind: "not-inspected-http-status",
      html: null,
    });
    expect(report.sources[0].comparison.classification).toBe("not-html");
    expect(JSON.stringify(report)).not.toContain(
      "not-found-body-do-not-include",
    );
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
  it("keeps proxy CONNECT403 separate from a missing origin robots response", async () => {
    const fetchFn = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { message: "Proxy response (403) !== 200 when HTTP Tunneling" },
      });
    });
    const report = await auditSources({ fetchFn, now, sleep: noSleep });
    expect(report.sources[0].robots).toMatchObject({
      received: false,
      code: "NETWORK_PROXY_DENIED",
      contentType: null,
      redirects: [],
      html: null,
    });
    expect(report.sources[0].robots.httpStatus).toBeUndefined();
    expect(report.sources[0].comparison.classification).toBe("unavailable");
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
  it("does not change source policy, curated records or the public catalog", async () => {
    const files = [
      "data/source-policy.json",
      "data/curated-banners.json",
      "public/data/banners.json",
    ];
    const before = await Promise.all(
      files.map((file) =>
        readFile(new URL(`../${file}`, import.meta.url), "utf8"),
      ),
    );
    const fetchFn = async (url: string) =>
      new Response(url.endsWith("robots.txt") ? "# empty rules" : shell, {
        headers: {
          "content-type": url.endsWith("robots.txt")
            ? "text/plain"
            : "text/html",
        },
      });
    await auditSources({ fetchFn, now, sleep: noSleep });
    expect(
      await Promise.all(
        files.map((file) =>
          readFile(new URL(`../${file}`, import.meta.url), "utf8"),
        ),
      ),
    ).toEqual(before);
  });
});
