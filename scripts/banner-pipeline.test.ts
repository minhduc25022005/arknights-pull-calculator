import { describe, it, expect, vi } from "vitest";
import {
  SOURCES,
  fetchText,
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
    expect(fetchFn).toHaveBeenCalledTimes(2);
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
