import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import { setLocale } from "../../i18n";
import { navigate } from "../../router";
import { BudgetEditor } from "./BudgetEditor";
import StatsScreen from "./StatsScreen";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = originalFetch;
  history.replaceState(null, "", "/");
  setLocale("ko");
});

test("statistics screen renders English for an empty period", async () => {
  setLocale("en");
  clearMemoryCache();
  markNetwork(true);
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const path = new URL(String(input), location.origin).pathname;
      const body = path.endsWith("/settings")
        ? { month_start_day: 1 }
        : path.endsWith("/stats/summary")
          ? { income: 0, expense: 0, net: 0, count: 0 }
          : path.endsWith("/stats/categories")
            ? { total: 0, rows: [] }
            : path.endsWith("/stats/trend")
              ? { buckets: [] }
              : path.endsWith("/categories")
                ? { items: [] }
                : { rows: [] };
      return Response.json(body);
    },
    { preconnect: originalFetch.preconnect },
  );
  navigate("/stats?period=custom&from=2026-10-01&to=2026-10-31", { replace: true });
  render(<StatsScreen />);
  expect(await screen.findByText("No records in this period")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Statistics" })).toBeTruthy();
  expect(screen.getByLabelText("Start date")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});

test("statistics panels render English with populated API fixtures", async () => {
  setLocale("en");
  clearMemoryCache();
  markNetwork(true);
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const path = new URL(String(input), location.origin).pathname;
      const body = path.endsWith("/settings")
        ? { month_start_day: 1 }
        : path.endsWith("/stats/summary")
          ? { income: 0, expense: 4500, net: -4500, count: 1 }
          : path.endsWith("/stats/categories")
            ? {
                total: 4500,
                rows: [{ category_id: null, name: "미분류", color: null, amount: 4500, children: [] }],
              }
            : path.endsWith("/stats/trend")
              ? { buckets: [{ month: "2026-10", income: 0, expense: 4500, net: -4500 }] }
              : path.endsWith("/stats/merchants")
                ? { rows: [{ merchant_key: "", merchant: "", amount: 4500, count: 1 }] }
                : path.endsWith("/categories")
                  ? { items: [] }
                  : { rows: [] };
      return Response.json(body);
    },
    { preconnect: originalFetch.preconnect },
  );
  navigate("/stats?period=month&from=2026-10-01&to=2026-10-31", { replace: true });
  render(<StatsScreen />);
  expect(await screen.findByRole("heading", { name: "By category" })).toBeTruthy();
  expect(screen.getByText("Total expenses")).toBeTruthy();
  expect(screen.getByText("Unnamed merchant")).toBeTruthy();
  expect(screen.getByText("Uncategorized")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});

test("budget editor renders English for a synthetic category", () => {
  setLocale("en");
  render(
    <BudgetEditor
      open
      onClose={() => {}}
      month="2026-10"
      categoryId="sample-category"
      categoryName="Sample category"
      amount={null}
      budgetId={null}
      budgetMonth={null}
      onSaved={() => {}}
      onDeleted={() => {}}
    />,
  );
  expect(screen.getByRole("dialog", { name: "Sample category budget" })).toBeTruthy();
  expect(screen.getByLabelText("Amount")).toBeTruthy();
  expect(screen.getByLabelText("Every month")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
