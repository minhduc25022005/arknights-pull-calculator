import { describe, it, expect } from "vitest";
import { totalPulls, forecast, daysBetween } from "./calculator";
describe("resource calculations", () => {
  it("combines fractional currency before rounding and includes permits", () => {
    expect(totalPulls({ orundum: 500, prime: 1, tickets: 2 })).toBe(3);
  });
  it("can exclude premium currency", () => {
    expect(totalPulls({ orundum: 500, prime: 10, tickets: 2 }, false)).toBe(2);
  });
  it("only grants weekly income after a full week", () => {
    const r = { orundum: 0, prime: 0, tickets: 0 };
    expect(forecast(r, 6, 100, 1700, true)).toBe(1);
    expect(forecast(r, 7, 100, 1700, true)).toBe(4);
  });
  it("handles year boundaries and past banners", () => {
    expect(daysBetween("2026-12-31", "2027-01-02")).toBe(2);
    expect(daysBetween("2026-12-31", "2026-01-01")).toBe(0);
  });
  it("keeps current balance on banner day", () => {
    const r = { orundum: 1200, prime: 0, tickets: 3 };
    expect(forecast(r, 0, 100, 1700, true)).toBe(5);
  });
});
