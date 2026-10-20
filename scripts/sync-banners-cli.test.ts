import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const initial = {
  schemaVersion: 1,
  events: [],
  sync: {
    lastAttemptAt: null,
    lastSuccessAt: null,
    status: "never",
    warnings: [],
  },
};
const fixture = {
  id: "manual-cli-fixture",
  eventId: "manual-cli-fixture",
  name: "Synthetic manual test fixture",
  server: "CN",
  category: "event",
  operators: [],
  status: "official",
  scheduleState: "announced",
  sources: [
    {
      url: "https://ak.hypergryph.com/news/synthetic-test-fixture",
      name: "Synthetic test source",
      publishedAt: "2026-10-01T08:00:00+08:00",
      server: "CN",
      confirmedFields: ["event"],
      kind: "official",
    },
  ],
  updatedAt: "2026-10-01T08:00:00Z",
  origin: "manual",
  reviewed: true,
};
function reviewedPacket(events = [fixture]) {
  return {
    schemaVersion: 1,
    events,
    review: {
      reviewer: "synthetic-cli-reviewer",
      reviewedAt: "2026-10-01T08:00:00Z",
      evidence: events.flatMap((event) =>
        ["event", "publishedAt"].map((field) => ({
          bannerId: event.id,
          server: event.server,
          sourceUrl: event.sources[0].url,
          field,
          quote: `Synthetic CLI evidence for ${field}; not a real announcement.`,
        })),
      ),
    },
  };
}
async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "rhodes-job-test-"));
  temporary.push(root);
  for (const dir of ["scripts", "src", "data", "public/data"])
    await mkdir(path.join(root, dir), { recursive: true });
  for (const file of [
    "scripts/sync-banners.mjs",
    "scripts/banner-pipeline.mjs",
    "scripts/manual-review.mjs",
    "src/banners.ts",
    "src/announcement-url.ts",
  ])
    await copyFile(path.join(repository, file), path.join(root, file));
  await symlink(
    path.join(repository, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await writeFile(
    path.join(root, "data/curated-banners.json"),
    JSON.stringify({ schemaVersion: 1, events: [] }),
  );
  await writeFile(
    path.join(root, "public/data/banners.json"),
    JSON.stringify(initial),
  );
  await writeFile(
    path.join(root, "data/source-policy.json"),
    JSON.stringify({
      schemaVersion: 1,
      sources: {
        Global: { termsReview: { reviewed: false } },
        CN: { termsReview: { reviewed: false } },
      },
    }),
  );
  return root;
}
function runImport(root: string) {
  return spawnSync(
    process.execPath,
    [
      "--use-env-proxy",
      "scripts/sync-banners.mjs",
      "--import",
      "incoming.json",
    ],
    { cwd: root, encoding: "utf8" },
  );
}
describe("manual CLI safety in an isolated checkout", () => {
  it("rejects a new legacy-shaped nonempty import without evidence, preserving both files", async () => {
    const root = await workspace();
    const files = [
      path.join(root, "data/curated-banners.json"),
      path.join(root, "public/data/banners.json"),
    ];
    const before = await Promise.all(
      files.map((file) => readFile(file, "utf8")),
    );
    await writeFile(
      path.join(root, "incoming.json"),
      JSON.stringify({ schemaVersion: 1, events: [fixture] }),
    );
    const result = runImport(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/review manifest/);
    expect(
      await Promise.all(files.map((file) => readFile(file, "utf8"))),
    ).toEqual(before);
  });
  it("rejects wrong-source incoming quotes without changing existing data", async () => {
    const root = await workspace();
    const value = reviewedPacket();
    value.review.evidence[0].sourceUrl =
      "https://ak.hypergryph.com/news/unrelated-synthetic-fixture";
    await writeFile(path.join(root, "incoming.json"), JSON.stringify(value));
    const file = path.join(root, "public/data/banners.json"),
      before = await readFile(file, "utf8");
    const result = runImport(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/original official source/);
    expect(await readFile(file, "utf8")).toBe(before);
  });
  it("preserves legacy curated events, earlier reviews and unrelated curated metadata", async () => {
    const root = await workspace();
    const legacy = {
      ...fixture,
      id: "legacy-event",
      eventId: "legacy-event",
      name: "Legacy synthetic event",
    };
    const prior = reviewedPacket([legacy]).review;
    await writeFile(
      path.join(root, "data/curated-banners.json"),
      JSON.stringify({
        schemaVersion: 1,
        events: [legacy],
        reviews: [prior],
        maintainerNotes: { keep: "existing note" },
      }),
    );
    await writeFile(
      path.join(root, "incoming.json"),
      JSON.stringify(reviewedPacket()),
    );
    const result = runImport(root);
    expect(result.status, result.stderr).toBe(0);
    const stored = JSON.parse(
      await readFile(path.join(root, "data/curated-banners.json"), "utf8"),
    );
    expect(stored.events.map((e: { id: string }) => e.id).sort()).toEqual(
      [fixture.id, legacy.id].sort(),
    );
    expect(stored.reviews).toHaveLength(2);
    expect(stored.maintainerNotes).toEqual({ keep: "existing note" });
    expect(stored.reviews[0].evidence[0].bannerId).toBe(legacy.id);
  });
  it("keeps default diagnostics from rewriting curated legacy records or existing review metadata", async () => {
    const root = await workspace();
    const file = path.join(root, "data/curated-banners.json");
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        events: [fixture],
        reviews: [reviewedPacket().review],
        note: "preserved",
      }),
    );
    const before = await readFile(file, "utf8");
    await writeFile(
      path.join(root, "mock-fetch.mjs"),
      "globalThis.fetch=async()=>new Response('unavailable',{status:503});",
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "./mock-fetch.mjs",
        "scripts/sync-banners.mjs",
        "--diagnose",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(2);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("checks a reviewed file and its original source without changing either data file", async () => {
    const root = await workspace();
    await writeFile(
      path.join(root, "incoming.json"),
      JSON.stringify(reviewedPacket()),
    );
    const files = [
      path.join(root, "data/curated-banners.json"),
      path.join(root, "public/data/banners.json"),
    ];
    const before = await Promise.all(
      files.map((file) => readFile(file, "utf8")),
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/sync-banners.mjs", "--check", "incoming.json"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: "reviewed-manual-check",
      records: 1,
      written: false,
      changed: false,
      liveSyncVerified: false,
    });
    expect(JSON.parse(result.stdout).sourceLinks[0].url).toBe(
      fixture.sources[0].url,
    );
    expect(
      await Promise.all(files.map((file) => readFile(file, "utf8"))),
    ).toEqual(before);
  });
  it("diagnoses HTTP status and content type without overwriting public data or claiming live sync", async () => {
    const root = await workspace();
    const files = [
      path.join(root, "data/curated-banners.json"),
      path.join(root, "public/data/banners.json"),
    ];
    const before = await Promise.all(
      files.map((file) => readFile(file, "utf8")),
    );
    await writeFile(
      path.join(root, "mock-fetch.mjs"),
      `globalThis.fetch=async function(url){return String(url).includes('hypergryph')?new Response('not found',{status:404,headers:{'content-type':'text/plain'}}):new Response('<html>synthetic SPA fallback</html>',{headers:{'content-type':'text/html'}})};`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "./mock-fetch.mjs",
        "scripts/sync-banners.mjs",
        "--diagnose",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      mode: "source-diagnostics",
      written: false,
      changed: false,
      liveRecords: 0,
      status: "error",
    });
    expect(
      report.sources
        .find((s: { server: string }) => s.server === "CN")
        .diagnostics.some((d: { httpStatus: number }) => d.httpStatus === 404),
    ).toBe(true);
    expect(
      report.sources
        .find((s: { server: string }) => s.server === "Global")
        .diagnostics.some((d: { contentType?: string }) =>
          d.contentType?.includes("text/html"),
        ),
    ).toBe(true);
    expect(result.stdout).not.toContain("synthetic SPA fallback");
    expect(
      await Promise.all(files.map((file) => readFile(file, "utf8"))),
    ).toEqual(before);
  });
  it("imports reviewed data to curated and public files without claiming live sync", async () => {
    const root = await workspace();
    await writeFile(
      path.join(root, "incoming.json"),
      JSON.stringify(reviewedPacket()),
    );
    const result = runImport(root);
    expect(result.status, result.stderr).toBe(0);
    const curated = JSON.parse(
      await readFile(path.join(root, "data/curated-banners.json"), "utf8"),
    );
    const catalog = JSON.parse(
      await readFile(path.join(root, "public/data/banners.json"), "utf8"),
    );
    expect(curated.events).toHaveLength(1);
    expect(curated.reviews).toHaveLength(1);
    expect(curated.reviews[0].reviewer).toBe("synthetic-cli-reviewer");
    expect(
      curated.reviews[0].evidence.map((e: { field: string }) => e.field),
    ).toEqual(["event", "publishedAt"]);
    expect(
      catalog.events.some((e: { id: string }) => e.id === fixture.id),
    ).toBe(true);
    expect(catalog.sync.lastSuccessAt).toBeNull();
    expect(JSON.parse(result.stdout).liveSyncVerified).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verification: "human-attested",
      reviewMethod: "reviewer-transcription",
      sourceFetched: false,
    });
  });
  it("is repeatable when the same reviewed file is imported twice", async () => {
    const root = await workspace();
    await writeFile(
      path.join(root, "incoming.json"),
      JSON.stringify(reviewedPacket()),
    );
    expect(runImport(root).status).toBe(0);
    const first = await readFile(
      path.join(root, "public/data/banners.json"),
      "utf8",
    );
    const firstCurated = await readFile(
      path.join(root, "data/curated-banners.json"),
      "utf8",
    );
    const result = runImport(root);
    expect(result.status, result.stderr).toBe(0);
    expect(
      await readFile(path.join(root, "public/data/banners.json"), "utf8"),
    ).toBe(first);
    expect(
      await readFile(path.join(root, "data/curated-banners.json"), "utf8"),
    ).toBe(firstCurated);
    expect(JSON.parse(result.stdout).changed).toBe(false);
  });
  it("leaves unreadable existing public data untouched", async () => {
    const root = await workspace(),
      output = path.join(root, "public/data/banners.json");
    await writeFile(output, "{corrupt-history");
    await writeFile(
      path.join(root, "incoming.json"),
      JSON.stringify({ schemaVersion: 1, events: [] }),
    );
    const before = await readFile(
      path.join(root, "data/curated-banners.json"),
      "utf8",
    );
    expect(runImport(root).status).toBe(1);
    expect(await readFile(output, "utf8")).toBe("{corrupt-history");
    expect(
      await readFile(path.join(root, "data/curated-banners.json"), "utf8"),
    ).toBe(before);
  });
  it("rejects unreviewed imports without touching curated or public data", async () => {
    const root = await workspace(),
      output = path.join(root, "public/data/banners.json");
    await writeFile(
      path.join(root, "incoming.json"),
      JSON.stringify({
        schemaVersion: 1,
        events: [{ ...fixture, reviewed: false }],
      }),
    );
    const before = await readFile(output, "utf8");
    const result = runImport(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/reviewed/);
    expect(await readFile(output, "utf8")).toBe(before);
  });
});
