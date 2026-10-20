#!/usr/bin/env node
import { readFile, mkdir, rename, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateCatalog } from "../src/banners.ts";
import {
  SOURCES,
  collectSource,
  validateManual,
  mergeResults,
  importCatalog,
} from "./banner-pipeline.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "public/data/banners.json");
const curatedPath = path.join(root, "data/curated-banners.json");
async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
async function atomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const serialized = JSON.stringify(value, null, 2) + "\n";
  try {
    if ((await readFile(file, "utf8")) === serialized) return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, serialized, { flag: "wx" });
  await rename(temp, file);
  return true;
}
async function commitImport(manual, catalog) {
  // Stage both validated files before touching either destination. On a detected
  // second-rename failure restore the first file; a process crash is retry-safe.
  const originals = await Promise.all([
    readFile(curatedPath, "utf8"),
    readFile(output, "utf8"),
  ]);
  const staged = [
    `${curatedPath}.${process.pid}.import.tmp`,
    `${output}.${process.pid}.import.tmp`,
  ];
  const values = [{ schemaVersion: 1, events: manual }, catalog];
  try {
    for (let i = 0; i < 2; i++)
      await writeFile(staged[i], JSON.stringify(values[i], null, 2) + "\n", {
        flag: "wx",
      });
    await rename(staged[0], curatedPath);
    try {
      await rename(staged[1], output);
    } catch (error) {
      await atomic(curatedPath, JSON.parse(originals[0]));
      throw error;
    }
  } finally {
    for (const file of staged)
      await unlink(file).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
  return originals[1] !== JSON.stringify(catalog, null, 2) + "\n";
}
async function main() {
  const args = process.argv.slice(2),
    now = new Date().toISOString();
  const diagnose = args.length === 1 && args[0] === "--diagnose";
  const check = args.length === 2 && args[0] === "--check";
  const importing = args.length === 2 && args[0] === "--import";
  if (args.length && !diagnose && !check && !importing)
    throw new Error(
      "Usage: npm run banners:sync | npm run banners:diagnose | npm run banners:check -- <reviewed-file.json> | npm run banners:import -- <reviewed-file.json>",
    );
  // An invalid existing file is a hard error: never replace unreadable historical data.
  const previous = validateCatalog(await json(output));
  const curated = validateManual(await json(curatedPath));
  if (importing || check) {
    const incoming = validateManual(
      await json(path.resolve(process.cwd(), args[1])),
    );
    const manual = validateManual({
      schemaVersion: 1,
      events: [...curated, ...incoming],
    });
    const catalog = importCatalog(previous, manual, now);
    const changed = check ? false : await commitImport(manual, catalog);
    console.log(
      JSON.stringify(
        {
          mode: check ? "reviewed-manual-check" : "reviewed-manual-import",
          records: incoming.length,
          total: catalog.events.length,
          changed,
          written: !check,
          sourceLinks: incoming.flatMap((event) =>
            event.sources.map((source) => ({
              server: source.server,
              url: source.url,
              confirmedFields: source.confirmedFields,
            })),
          ),
          liveSyncVerified: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  const policy = await json(path.join(root, "data/source-policy.json"));
  if (policy.schemaVersion !== 1)
    throw new Error("Unsupported source policy version");
  const results = [];
  for (const source of SOURCES)
    results.push(
      await collectSource(source, policy.sources?.[source.server], { now }),
    );
  const report = {};
  const catalog = mergeResults(previous, curated, results, now, report);
  const changed = diagnose ? false : await atomic(output, catalog);
  const liveRecords = report.acceptedRecords;
  console.log(
    JSON.stringify(
      {
        mode: diagnose ? "source-diagnostics" : "live-sync",
        attemptedAt: now,
        changed,
        written: !diagnose,
        total: catalog.events.length,
        liveRecords,
        status: catalog.sync.status,
        warnings: catalog.sync.warnings,
        sources: results.map((result) => ({
          server: result.server,
          success: result.success,
          records: result.events.length,
          diagnostics: result.diagnostics ?? [],
        })),
      },
      null,
      2,
    ),
  );
  // Preserve/report public diagnostics even when the job itself must visibly fail.
  if (!liveRecords) process.exitCode = 2;
}
main().catch((error) => {
  console.error(`Banner job failed: ${error.message}`);
  process.exitCode = 1;
});
