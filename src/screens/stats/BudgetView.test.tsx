import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import BudgetView from "./BudgetView";

const realFetch = globalThis.fetch;

const status = {
  month: "2026-10",
  range: { from: "2026-10-01", to: "2026-10-31" },
  total: {
    budget_id: "budget-total-default",
    budget_month: "",
    budget: 100_000,
    spent: 120_000,
    remaining: -20_000,
    pct: 120,
    over: true,
  },
  categories: [
    {
      category_id: "food",
      budget_id: "budget-food-default",
      budget_month: "",
      name: "식비",
      icon: "utensils",
      color: "cat-2",
      budget: 40_000,
      spent: 50_000,
      remaining: -10_000,
      pct: 125,
      over: true,
    },
    {
      category_id: "transport",
      budget_id: null,
      budget_month: null,
      name: "교통",
      icon: "bus",
      color: "cat-8",
      budget: null,
      spent: 20_000,
      remaining: null,
      pct: null,
      over: false,
    },
  ],
};

beforeEach(() => {
  history.replaceState(null, "", "/budget?month=2026-10");
  clearMemoryCache();
  globalThis.fetch = Object.assign(
    async (..._args: Parameters<typeof fetch>) =>
      new Response(JSON.stringify(status), { headers: { "Content-Type": "application/json" } }),
    { preconnect: realFetch.preconnect },
  );
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("BudgetView", () => {
  test("shows the over-budget amount in text and lists unbudgeted spending", async () => {
    render(<BudgetView />);

    expect(await screen.findByText("20,000원 초과했어요")).toBeTruthy();
    expect(screen.getByText("교통")).toBeTruthy();
    expect(screen.getByRole("button", { name: /교통.*예산 추가/ })).toBeTruthy();
  });

  test("sorts category rows by budget usage percentage", async () => {
    render(<BudgetView />);

    await screen.findByText("식비");
    const names = screen.getAllByTestId("budget-category-name").map((node) => node.textContent);
    expect(names).toEqual(["식비", "교통"]);
  });
});
