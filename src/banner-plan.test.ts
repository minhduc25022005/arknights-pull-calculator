import { describe, expect, it } from "vitest";
import { planDates } from "./banner-plan";
import { forecast, daysBetween } from "./calculator";
import type { Banner } from "./banners";
const base: Banner = {
  id: "test",
  eventId: "test",
  name: "Synthetic fixture",
  server: "Global",
  category: "limited",
  operators: [],
  status: "unknown",
  scheduleState: "unknown",
  sources: [],
  origin: "prediction",
  updatedAt: "2026-10-20T00:00:00Z",
};
describe("calendar planning scenarios", () => {
  it("keeps all three estimated cases and computes independent pull totals", () => {
    const b = {
      ...base,
      status: "predicted",
      scheduleState: "estimated",
      estimate: {
        earliest: "2026-10-21T18:00:00Z",
        central: "2026-10-28T18:00:00Z",
        latest: "2026-11-04T18:00:00Z",
        sampleSize: 3,
        confidence: "low",
        explanation: "Synthetic test",
      },
    } as Banner;
    const dates = planDates(b, "Asia/Ho_Chi_Minh");
    expect(dates.map((d) => d.date)).toEqual([
      "2026-10-22",
      "2026-10-29",
      "2026-11-05",
    ]);
    const r = { orundum: 6000, prime: 0, tickets: 2 };
    expect(
      dates.map((d) =>
        forecast(r, daysBetween("2026-10-20", d.date), 100, 1700, true),
      ),
    ).toEqual([12, 16, 20]);
    expect(dates.every((d) => d.predicted)).toBe(true);
  });
  it("uses only official start after announcement and honors viewing zone", () => {
    const b = {
      ...base,
      startAt: "2026-10-21T18:00:00Z",
      status: "official",
      scheduleState: "scheduled",
    } as Banner;
    expect(planDates(b, "UTC")[0]).toMatchObject({
      date: "2026-10-21",
      predicted: false,
    });
    expect(planDates(b, "Asia/Ho_Chi_Minh")[0].date).toBe("2026-10-22");
  });
  it("does not invent a date for an undated or unavailable event", () => {
    expect(planDates(base, "UTC")).toEqual([]);
    expect(planDates(undefined, "UTC")).toEqual([]);
  });
});
