import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import { setLocale } from "../../i18n";
import MonthlyView from "./MonthlyView";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  setLocale("ko");
  globalThis.fetch = originalFetch;
  clearMemoryCache();
});

test("ledger follows English system language without Korean UI copy", async () => {
  // Given an English system language and synthetic API data.
  setLocale("en");
  clearMemoryCache();
  history.replaceState(null, "", "/monthly?year=2026");
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) =>
      String(input).includes("stats/trend")
        ? new Response(JSON.stringify({ buckets: [] }), { headers: { "Content-Type": "application/json" } })
        : Response.json({ items: [], next_cursor: null }),
    { preconnect: originalFetch.preconnect },
  );
  // When the screen is rendered.
  render(<MonthlyView />);
  // Then its representative copy and all visible text follow English.
  expect(await screen.findByText("Jan")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
