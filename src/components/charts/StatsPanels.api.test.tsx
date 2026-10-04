import { expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { authed, makeTestApp } from "../../../tests/helpers";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import { StatsPanels } from "./StatsPanels";

test("parent comparisons include a sibling with spending only in the previous period", async () => {
  const app = makeTestApp();
  const realFetch = globalThis.fetch;
  try {
    await clearCache();
    clearMemoryCache();
    markNetwork(true);
    const request = await authed(app);
    const data = await (await request("/api/v1/categories?type=expense")).json();
    const food = data.items.find((item: { name: string }) => item.name === "식비");
    const cafe = food.children.find((item: { name: string }) => item.name === "카페");
    const meal = food.children.find((item: { name: string }) => item.name === "식사");
    for (const [category, amount, date] of [
      [cafe.id, 4500, "2026-09-03"],
      [meal.id, 1000, "2026-10-03"],
    ] as const) {
      const response = await request("/api/v1/transactions", {
        method: "POST",
        body: {
          type: "expense",
          amount,
          occurred_at: `${date}T12:00:00+09:00`,
          category_id: category,
          merchant: "테스트가게",
        },
      });
      expect(response.status).toBe(201);
    }
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://127.0.0.1");
        return request(url.pathname + url.search);
      },
      { preconnect: realFetch.preconnect },
    );
    render(<StatsPanels period="month" range={{ from: "2026-10-01", to: "2026-10-31" }} type="expense" />);
    const parent = await screen.findByRole("button", { name: /^식비,/ });
    expect(parent.getAttribute("aria-label")).toContain("−3,500원");
  } finally {
    cleanup();
    globalThis.fetch = realFetch;
    clearMemoryCache();
    await clearCache();
    app.cleanup();
  }
});
