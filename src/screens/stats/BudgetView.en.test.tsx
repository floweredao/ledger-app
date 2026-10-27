import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import "fake-indexeddb/auto";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import { setLocale } from "../../i18n";
import BudgetView from "./BudgetView";

const realFetch = globalThis.fetch;
const payload = {
  month: "2026-10",
  range: { from: "2026-10-01", to: "2026-10-31" },
  total: { budget_id: null, budget_month: null, budget: null, spent: 0, remaining: null, pct: null, over: false },
  categories: [],
};

afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = realFetch;
  setLocale("ko");
});

test("BudgetView follows English system language without Korean UI copy", async () => {
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  history.replaceState(null, "", "/budget?month=2026-10");
  setLocale("en");
  globalThis.fetch = Object.assign(async () => Response.json(payload), {
    preconnect: realFetch.preconnect,
  });
  await act(async () => {
    render(<BudgetView />);
  });
  expect(screen.getByText("Budget overview", { exact: true })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Total budget" })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
