import { expect, test } from "bun:test";
import { formatDisplayDate } from "./dates";

const now = new Date("2026-10-04T00:12:00Z");

test("display timestamps convert UTC to KST with compact current-year time", () => {
  expect(formatDisplayDate("2026-10-04T00:12:00Z", now)).toBe("10월 4일 09:12");
  expect(formatDisplayDate("2026-10-03T23:12:59Z", now)).toBe("10월 4일 08:12");
});

test("display year comparison uses the KST year on both sides of midnight", () => {
  const boundary = new Date("2025-12-31T15:00:00Z");
  expect(formatDisplayDate("2025-12-31T15:00:00Z", boundary)).toBe("1월 1일 00:00");
  expect(formatDisplayDate("2025-12-31T14:59:00Z", boundary)).toBe("2025년 12월 31일");
  expect(formatDisplayDate("2025-03-01T15:00:00Z", now)).toBe("2025년 3월 2일");
});

test("date-only values retain their calendar date without invented time", () => {
  expect(formatDisplayDate("2026-10-04", now)).toBe("10월 4일");
  expect(formatDisplayDate("2025-03-02", now)).toBe("2025년 3월 2일");
});
