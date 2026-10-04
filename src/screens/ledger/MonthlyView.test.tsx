import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { StatsTrend } from "../../../shared/schema";
import { clearMemoryCache } from "../../api/hooks";
import { navigate, useRoute } from "../../router";
import MonthlyView from "./MonthlyView";

const year = "2026";

function RouteSignal() {
  const route = useRoute();
  return <output data-testid="route">{`${route.path}?${route.query.toString()}`}</output>;
}

afterEach(() => {
  cleanup();
  clearMemoryCache();
});

describe("MonthlyView", () => {
  test("shows all twelve months with income, expense and net totals", async () => {
    const trend: StatsTrend = {
      buckets: [
        { month: "2026-01", from: "2026-01-01", to: "2026-01-31", income: 150000, expense: 90000, net: 60000 },
        { month: "2026-03", from: "2026-03-01", to: "2026-03-31", income: 0, expense: 125000, net: -125000 },
        { month: "2026-12", from: "2026-12-01", to: "2026-12-31", income: 80000, expense: 80000, net: 0 },
      ],
    };
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(trend), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      navigate(`/monthly?year=${year}`, { replace: true });
      render(<MonthlyView />);
      expect(await screen.findByText("1월")).toBeTruthy();
      expect(screen.getByText("12월")).toBeTruthy();
      expect(screen.getByText("+150,000원")).toBeTruthy();
      expect(screen.getByText("-90,000원")).toBeTruthy();
      expect(screen.getByText("+60,000원")).toBeTruthy();
      const march = screen.getByRole("link", { name: /2026년 3월/ });
      expect(march.querySelector(".monthly-net")?.textContent).toBe("-125,000원");
      expect(screen.getAllByRole("link")).toHaveLength(12);
      const query = new URL(requestedUrl, "http://127.0.0.1").searchParams;
      expect(query.get("months")).toBe("12");
      expect(query.get("end")).toBe("2026-12");
      expect(query.get("basis")).toBe("calendar");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("month links open the selected calendar month", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () =>
        new Response(JSON.stringify({ buckets: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      navigate(`/monthly?year=${year}`, { replace: true });
      render(
        <>
          <MonthlyView />
          <RouteSignal />
        </>,
      );
      fireEvent.click(await screen.findByRole("link", { name: /2026년 3월/ }));
      expect(screen.getByTestId("route").textContent).toBe("/?month=2026-03");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
