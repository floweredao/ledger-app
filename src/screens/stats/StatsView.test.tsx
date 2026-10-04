import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  StatsAssets,
  StatsCategories,
  StatsCompare,
  StatsMerchants,
  StatsSummary,
  StatsTrend,
} from "../../../shared/schema";
import { clearMemoryCache } from "../../api/hooks";
import { navigate, useRoute } from "../../router";
import StatsView from "./StatsView";

const range = { from: "2026-10-01", to: "2026-10-31" };
const summary: StatsSummary = { income: 125000, expense: 57300, net: 67700, count: 5 };
const categories: StatsCategories = {
  total: 57300,
  rows: [
    {
      category_id: "category-food",
      name: "식비",
      icon: "utensils",
      color: "cat-3",
      amount: 42000,
      pct: 73.3,
      children: [
        {
          category_id: "category-dining",
          name: "외식",
          icon: "utensils",
          color: "cat-3",
          amount: 27000,
          pct: 47.1,
        },
      ],
    },
  ],
};
const compare: StatsCompare = {
  range,
  previous_range: { from: "2026-08-31", to: "2026-09-30" },
  rows: [{ category_id: "category-food", name: "식비", current: 42000, previous: 35000, delta: 7000, pct_change: 20 }],
};
const trend: StatsTrend = {
  buckets: [{ month: "2026-10", from: range.from, to: range.to, income: 125000, expense: 57300, net: 67700 }],
};
const merchants: StatsMerchants = {
  rows: [{ merchant: "샘플카페", merchant_key: "샘플카페", amount: 12000, count: 2 }],
};
const assets: StatsAssets = { rows: [{ asset_id: "asset-cash", name: "현금", income: 125000, expense: 57300 }] };

function RouteSignal() {
  const route = useRoute();
  return <output data-testid="route">{`${route.path}?${route.query.toString()}`}</output>;
}

function mockStats(empty = false, categoryData = categories) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://127.0.0.1");
      let payload: unknown = {};
      if (url.pathname.endsWith("/settings"))
        payload = { month_start_day: 1, owner_name: "", theme: "system", default_asset_id: null };
      else if (url.pathname.endsWith("/stats/summary"))
        payload = empty ? { income: 0, expense: 0, net: 0, count: 0 } : summary;
      else if (url.pathname.endsWith("/stats/categories")) payload = empty ? { total: 0, rows: [] } : categoryData;
      else if (url.pathname.endsWith("/stats/compare")) payload = compare;
      else if (url.pathname.endsWith("/stats/trend")) payload = trend;
      else if (url.pathname.endsWith("/stats/merchants")) payload = merchants;
      else if (url.pathname.endsWith("/stats/assets")) payload = assets;
      else if (url.pathname.endsWith("/categories")) {
        payload = { items: [{ id: "category-food", children: [{ id: "category-dining" }] }] };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  return () => {
    globalThis.fetch = originalFetch;
  };
}

afterEach(() => {
  cleanup();
  clearMemoryCache();
  history.replaceState(null, "", "/");
});

describe("StatsView", () => {
  test("starts at all categories and returns there when an uncategorized row exists", async () => {
    const restore = mockStats(false, {
      ...categories,
      rows: [
        ...categories.rows,
        { category_id: null, name: "미분류", icon: null, color: null, amount: 15300, pct: 26.7, children: [] },
      ],
    });
    try {
      navigate(`/stats?period=custom&from=${range.from}&to=${range.to}`, { replace: true });
      await act(async () => {
        render(<StatsView />);
      });
      expect(screen.getByRole("heading", { name: "분류별" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /미분류/ })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /식비/ }));
      expect(screen.getByRole("heading", { name: "식비 상세" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /외식.*64.3퍼센트/ })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /전체 분류/ }));
      expect(screen.getByRole("heading", { name: "분류별" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /미분류/ })).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("uncategorized selection searches only uncategorized transactions", async () => {
    const restore = mockStats(false, {
      total: 15300,
      rows: [{ category_id: null, name: "미분류", icon: null, color: null, amount: 15300, pct: 100, children: [] }],
    });
    try {
      navigate(`/stats?period=custom&from=${range.from}&to=${range.to}`, { replace: true });
      await act(async () => {
        render(<StatsView />);
      });
      fireEvent.click(screen.getByRole("button", { name: /미분류/ }));
      const query = new URLSearchParams(location.search);
      expect(location.pathname).toBe("/search");
      expect(query.get("category_id")).toBe("uncategorized");
      expect(query.get("type")).toBe("expense");
      expect(query.get("from")).toBe(range.from);
      expect(query.get("to")).toBe(range.to);
    } finally {
      restore();
    }
  });

  test("shows an explicit empty period without rendering NaN", async () => {
    const restore = mockStats(true);
    try {
      navigate(`/stats?period=custom&from=${range.from}&to=${range.to}`, { replace: true });
      render(<StatsView />);
      expect(await screen.findByText("이 기간에는 기록이 없어요")).toBeTruthy();
      expect(document.body.innerText).not.toContain("NaN");
    } finally {
      restore();
    }
  });

  test("rejects a custom range whose start follows its end", async () => {
    const restore = mockStats();
    try {
      navigate(`/stats?period=custom&from=${range.from}&to=${range.to}`, { replace: true });
      render(<StatsView />);
      fireEvent.change(await screen.findByLabelText("시작일"), { target: { value: "2026-11-01" } });
      fireEvent.click(screen.getByRole("button", { name: "기간 적용" }));
      expect(screen.getByRole("alert").textContent).toContain("시작일은 종료일보다 늦을 수 없어요");
      expect(document.body.innerText).not.toContain("NaN");
    } finally {
      restore();
    }
  });

  test("opens a category, then searches its child for the selected dates", async () => {
    const restore = mockStats();
    try {
      navigate(`/stats?period=custom&from=${range.from}&to=${range.to}`, { replace: true });
      render(
        <>
          <StatsView />
          <RouteSignal />
        </>,
      );
      fireEvent.click(await screen.findByRole("button", { name: /식비/ }));
      fireEvent.click(screen.getByRole("button", { name: /외식/ }));
      await waitFor(() => expect(screen.getByTestId("route").textContent).toContain("category_id=category-dining"));
      const route = screen.getByTestId("route").textContent;
      expect(route).toContain("/search?");
      expect(route).toContain("from=2026-10-01");
      expect(route).toContain("to=2026-10-31");
      expect(route).toContain("category_id=category-dining");
    } finally {
      restore();
    }
  });
});
