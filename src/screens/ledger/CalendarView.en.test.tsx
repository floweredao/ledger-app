import { afterEach, expect, setSystemTime, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import { setLocale } from "../../i18n";
import CalendarView from "./CalendarView";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  setLocale("ko");
  setSystemTime();
  globalThis.fetch = originalFetch;
  clearMemoryCache();
});

test("calendar follows English system language with English dates and amounts", async () => {
  setSystemTime(new Date("2026-10-04T00:00:00Z"));
  setLocale("en");
  clearMemoryCache();
  history.replaceState(null, "", "/calendar?month=2026-10");
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("stats/calendar")
        ? {
            days: [
              { date: "2026-10-04", income: 0, expense: 3_500_000, count: 1 },
              { date: "2026-10-05", income: 99_994_000, expense: 123_456_789, count: 2 },
            ],
          }
        : { items: [], next_cursor: null };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  render(<CalendarView />);
  const day = await screen.findByRole("button", { name: /Sunday, October 4, 2026, Expense -₩3,500,000/ });
  expect(day.textContent).toContain("-3.5M");
  // Same four-glyph budget as Korean: a 12px phone cell has no room for "-123.5M".
  const busy = screen.getByRole("button", { name: /October 5, 2026/ });
  const compact = [...busy.querySelectorAll(".calendar-compact")].map((el) => el.textContent);
  expect(compact).toEqual(["+100M", "-123M"]);
  expect(await screen.findByText("No records on this day")).toBeTruthy();
  expect(screen.getByText("Sun")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
