import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork, setCsrfToken } from "../../api/transport";
import CalendarView from "./CalendarView";

const realFetch = globalThis.fetch;
let requests: string[] = [];
let calendarDays: readonly { date: string; income: number; expense: number; count: number }[] = [];
let transactions: readonly Record<string, unknown>[] = [];

beforeEach(() => {
  setSystemTime(new Date("2026-10-04T00:00:00Z"));
  history.replaceState(null, "", "/calendar?month=2026-10");
  requests = [];
  calendarDays = [
    { date: "2026-10-04", income: 125000, expense: 4800, count: 2 },
    { date: "2026-10-05", income: 0, expense: 12500, count: 1 },
  ];
  transactions = [
    {
      id: "transaction-1",
      type: "expense",
      occurred_at: "2026-10-04T12:30:00+09:00",
      amount: 4800,
      is_refund: false,
      currency: "KRW",
      foreign_amount: null,
      krw_status: "exact",
      asset_id: null,
      to_asset_id: null,
      category_id: null,
      merchant: "샘플카페",
      merchant_key: "샘플카페",
      memo: "",
      source: "manual",
      source_key: null,
      src_account: null,
      src_amount: null,
      src_at: null,
      hidden: false,
      hidden_reason: null,
      user_locked: [],
      recurring_rule_id: null,
      deleted_at: null,
      created_at: "2026-10-04T12:30:00+09:00",
      updated_at: "2026-10-04T12:30:00+09:00",
    },
  ];
  clearMemoryCache();
  markNetwork(true);
  setCsrfToken("csrf-test");
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/stats/calendar?")) {
        return new Response(
          JSON.stringify({
            month: "2026-10",
            range: { from: "2026-10-01", to: "2026-11-01" },
            days: calendarDays,
          }),
        );
      }
      if (url.includes("/transactions?")) {
        return new Response(
          JSON.stringify({
            items: transactions,
            totals: { income: 0, expense: 4800, net: -4800, count: transactions.length },
            next_cursor: null,
          }),
        );
      }
      return new Response(JSON.stringify({ error: { code: "not_found", message: "" } }), { status: 404 });
    },
    { preconnect: realFetch.preconnect },
  );
});

afterEach(() => {
  setSystemTime();
  cleanup();
  globalThis.fetch = realFetch;
  setCsrfToken(null);
});

describe("CalendarView", () => {
  test("selected day heading uses the shared compact date format", async () => {
    render(<CalendarView />);
    fireEvent.click(await screen.findByRole("button", { name: /2026년 10월 4일/ }));
    expect(screen.getByRole("heading", { name: "10월 4일" })).toBeTruthy();
  });

  test("keeps unresolved foreign amounts visible instead of zero won", async () => {
    transactions = [{ ...transactions[0], amount: 0, currency: "USD", foreign_amount: 3.2, krw_status: "pending" }];
    render(<CalendarView />);
    fireEvent.click(await screen.findByRole("button", { name: /2026년 10월 4일/ }));
    expect(await screen.findByText("-USD 3.2")).toBeTruthy();
    expect(screen.getByText("원화 미확정")).toBeTruthy();
  });

  test("opens the selected transaction for editing", async () => {
    const entries: unknown[] = [];
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) entries.push(event.detail);
    };
    window.addEventListener("ledger:open-entry", listener);
    try {
      render(<CalendarView />);
      fireEvent.click(await screen.findByRole("button", { name: /2026년 10월 4일/ }));
      fireEvent.click(await screen.findByRole("button", { name: /샘플카페.*4,800원/ }));
      expect(entries).toEqual([{ id: "transaction-1" }]);
    } finally {
      window.removeEventListener("ledger:open-entry", listener);
    }
  });

  test("lays out October 2026 from Sunday and renders daily totals", async () => {
    render(<CalendarView />);

    const firstDay = await screen.findByRole("button", { name: /2026년 10월 1일/ });
    const firstDayIndex = Array.from(firstDay.parentElement?.querySelectorAll("button") ?? []).findIndex((day) =>
      day.isSameNode(firstDay),
    );
    expect(firstDayIndex).toBe(4);
    expect(screen.getByText("+13만")).toBeTruthy();
    expect(screen.getByText("-4,800")).toBeTruthy();
    expect(requests).toContain("/api/v1/stats/calendar?month=2026-10");
  });

  test("selecting a day loads its transactions and add action carries its date", async () => {
    const requestsForEntry: string[] = [];
    const listener = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (typeof detail !== "object" || detail === null || !("date" in detail) || typeof detail.date !== "string")
        return;
      requestsForEntry.push(detail.date);
    };
    window.addEventListener("ledger:open-entry", listener);
    render(<CalendarView />);

    fireEvent.click(await screen.findByRole("button", { name: /2026년 10월 4일/ }));

    expect(await screen.findByText("샘플카페")).toBeTruthy();
    expect(requests).toContain("/api/v1/transactions?from=2026-10-04&to=2026-10-04&limit=1000");
    fireEvent.click(screen.getByRole("button", { name: "이 날짜에 기록" }));
    expect(requestsForEntry).toEqual(["2026-10-04"]);
    window.removeEventListener("ledger:open-entry", listener);
  });

  test("an empty month keeps the calendar and shows an empty-day message", async () => {
    calendarDays = [];
    transactions = [];
    render(<CalendarView />);

    expect(await screen.findByRole("button", { name: /2026년 10월 1일/ })).toBeTruthy();
    expect(await screen.findByText("이 날짜에 기록이 없어요")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("desktop arrow keys move the selected date by one day", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    render(<CalendarView />);
    const selected = await screen.findByRole("button", { name: /2026년 10월 4일/ });
    selected.focus();
    fireEvent.keyDown(selected, { key: "ArrowRight" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /2026년 10월 5일/ }).getAttribute("aria-pressed")).toBe("true"),
    );
  });
});
