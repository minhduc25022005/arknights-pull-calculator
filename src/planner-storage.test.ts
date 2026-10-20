import { describe, expect, it } from "vitest";
import { loadPlanner, PLANNER_KEY, type PlannerData } from "./planner-storage";
const legacy: PlannerData = {
  resources: { orundum: 12345, prime: 42, tickets: 9 },
  entries: [{ date: "2026-10-19", orundum: 11000, prime: 40, tickets: 8 }],
  banner: "2026-12-20",
  target: 300,
  daily: 100,
  weekly: 1700,
  convert: false,
  name: "Saved banner",
};
describe("v1 planner compatibility", () => {
  it("retains every existing balance, history and setting without writing or migration", () => {
    const reads: string[] = [];
    const s = {
      getItem: (key: string) => {
        reads.push(key);
        return JSON.stringify(legacy);
      },
    };
    const defaults = {
      ...legacy,
      resources: { orundum: 0, prime: 0, tickets: 0 },
      entries: [],
    };
    expect(loadPlanner(s, defaults)).toEqual(legacy);
    expect(reads).toEqual([PLANNER_KEY]);
  });
  it("does not fail on blocked storage or malformed JSON", () => {
    expect(
      loadPlanner(
        {
          getItem: () => {
            throw Error("blocked");
          },
        },
        legacy,
      ),
    ).toBe(legacy);
    expect(loadPlanner({ getItem: () => "{invalid" }, legacy)).toBe(legacy);
  });
});
