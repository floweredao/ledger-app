import { describe, expect, test } from "bun:test";
import { calendarMonthFilter, calendarYearFilter, periodFor, shiftPeriod } from "./periods";

describe("inclusive KST date filters", () => {
  test("calendar month ends on its last day, inclusive", () => {
    expect(calendarMonthFilter("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(calendarMonthFilter("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(calendarMonthFilter("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  test("calendar year covers Jan 1 to Dec 31", () => {
    expect(calendarYearFilter("2026")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  test("accounting month with a start day is inclusive of the day before the next start", () => {
    expect(periodFor("month", "2026-10-04", 25)).toEqual({ from: "2026-09-25", to: "2026-10-24" });
    expect(periodFor("week", "2026-10-01")).toEqual({ from: "2026-09-27", to: "2026-10-03" });
  });

  test("shifting a period moves to the adjacent one", () => {
    const oct = periodFor("month", "2026-10-15");
    expect(shiftPeriod("month", oct, 1)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(shiftPeriod("month", oct, -1)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});
