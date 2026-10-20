import type { Entry, Resources } from "./calculator";
export interface PlannerData {
  resources: Resources;
  entries: Entry[];
  banner: string;
  target: number;
  daily: number;
  weekly: number;
  convert: boolean;
  name: string;
}
export const PLANNER_KEY = "rhodes-pulls-v1";
const balance = (x: Resources) =>
  x &&
  [x.orundum, x.prime, x.tickets].every(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
  );
export function loadPlanner(
  storage: Pick<Storage, "getItem">,
  defaults: PlannerData,
): PlannerData {
  try {
    const raw = JSON.parse(storage.getItem(PLANNER_KEY) || "null");
    if (!raw || !Array.isArray(raw.entries)) return defaults;
    const d = { ...defaults, ...raw };
    if (
      !balance(d.resources) ||
      !d.entries.every(
        (e: Entry) => balance(e) && typeof e.date === "string",
      ) ||
      ![d.target, d.daily, d.weekly].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
      ) ||
      typeof d.convert !== "boolean" ||
      typeof d.name !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d.banner)
    )
      return defaults;
    return d;
  } catch {
    return defaults;
  }
}
