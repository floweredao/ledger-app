import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      if (url.includes("/categories")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "category-food",
                type: "expense",
                parent_id: null,
                name: "샘플식비",
                icon: "utensils",
                color: "cat-3",
                sort: 1,
                hidden: false,
                created_at: "2026-10-01T00:00:00+09:00",
                updated_at: "2026-10-01T00:00:00+09:00",
                children: [],
              },
            ],
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
  test("shows each day record's category, with the parent in front of a child category", async () => {
    const base = transactions[0] ?? {};
    transactions = [
      { ...base, merchant: "샘플편의점", category_id: "category-snack" },
      { ...base, id: "transaction-2", merchant: "샘플식당", category_id: "category-food", memo: "점심" },
      { ...base, id: "transaction-3", type: "transfer", merchant: "샘플이체", amount: 30000 },
    ];
    const baseFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        if (!String(input).includes("/categories")) return baseFetch(input);
        const food = {
          id: "category-food",
          type: "expense",
          parent_id: null,
          name: "샘플식비",
          icon: "utensils",
          color: "cat-3",
          sort: 1,
          hidden: false,
          created_at: "2026-10-01T00:00:00+09:00",
          updated_at: "2026-10-01T00:00:00+09:00",
        };
        return Response.json({
          items: [
            { ...food, children: [{ ...food, id: "category-snack", parent_id: "category-food", name: "샘플간식" }] },
          ],
        });
      },
      { preconnect: realFetch.preconnect },
    );
    render(<CalendarView />);
    fireEvent.click(await screen.findByRole("button", { name: /2026년 10월 4일/ }));
    const subtitle = async (name: RegExp) =>
      (await screen.findByRole("button", { name })).querySelector(".list-row-subtitle")?.textContent;
    await waitFor(async () => expect(await subtitle(/샘플편의점/)).toBe("지출샘플식비 › 샘플간식"));
    expect(await subtitle(/샘플식당/)).toBe("지출샘플식비 · 점심");
    expect(await subtitle(/샘플이체/)).toBe("이체");
  });

  test("labels each day record as expense, income, transfer or refund without repeating the original imported name", async () => {
    const base = transactions[0] ?? {};
    transactions = [
      {
        ...base,
        merchant: "샘플 구독료",
        category_id: "category-food",
        source: "kakaobank_sms",
        source_detail: {
          kind: "체크카드결제",
          counterparty: "SAMPLE*TESTSHOP 851",
          account: "3333-00-0000000",
          amount: -8751,
          balance: 431249,
          currency: null,
          at: "2026-10-04T15:20:00+09:00",
        },
      },
      { ...base, id: "transaction-2", type: "transfer", merchant: "샘플 통장에서 이체", amount: 30000 },
      { ...base, id: "transaction-3", type: "income", merchant: "샘플용돈", amount: 50000 },
      { ...base, id: "transaction-4", merchant: "샘플환불", is_refund: true, amount: 1000 },
    ];
    render(<CalendarView />);
    fireEvent.click(await screen.findByRole("button", { name: /2026년 10월 4일/ }));
    const row = async (name: RegExp) => within(await screen.findByRole("button", { name }));
    expect((await row(/샘플 구독료/)).getByText("지출")).toBeTruthy();
    expect((await row(/샘플 구독료/)).queryByText(/원래:/)).toBeNull();
    expect((await row(/샘플 통장에서 이체/)).getByText("이체")).toBeTruthy();
    expect((await row(/샘플용돈/)).getByText("수입")).toBeTruthy();
    expect((await row(/샘플환불/)).getByText("환불")).toBeTruthy();
    expect((await row(/샘플환불/)).queryByText("지출")).toBeNull();
  });

  test("shows each day record's category icon, with the transfer and uncategorized fallbacks", async () => {
    const base = transactions[0] ?? {};
    transactions = [
      { ...base, category_id: "category-food", merchant: "샘플식당" },
      { ...base, id: "transaction-2", type: "transfer", merchant: "", amount: 30000 },
      { ...base, id: "transaction-3", merchant: "샘플가게" },
    ];
    render(<CalendarView />);
    fireEvent.click(await screen.findByRole("button", { name: /2026년 10월 4일/ }));
    const icon = async (name: RegExp) => {
      const row = await screen.findByRole("button", { name });
      await waitFor(() => expect(row.querySelector(".category-icon")).toBeTruthy());
      return row.querySelector<HTMLElement>(".category-icon");
    };
    await waitFor(async () => expect((await icon(/샘플식당/))?.style.backgroundColor).toBe("var(--cat-3)"));
    expect((await icon(/샘플식당/))?.querySelector(".lucide-utensils")).toBeTruthy();
    expect((await icon(/^이체/))?.querySelector(".lucide-arrow-left-right")).toBeTruthy();
    expect((await icon(/샘플가게/))?.style.backgroundColor).toBe("var(--cat-12)");
  });

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

  test("tapping the already selected day scrolls its record list into view, a new selection does not", async () => {
    const calls: { element: Element; options: unknown }[] = [];
    const originalScroll = Element.prototype.scrollIntoView;
    const originalMatchMedia = window.matchMedia;
    let reduced = false;
    Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      calls.push({ element: this, options });
    };
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion: reduce") && reduced,
        media: query,
      }) as MediaQueryList) as typeof window.matchMedia;
    const setWidth = (value: number) => Object.defineProperty(window, "innerWidth", { value, configurable: true });
    const width = window.innerWidth;
    try {
      setWidth(390);
      render(<CalendarView />);
      const day = await screen.findByRole("button", { name: /2026년 10월 5일/ });
      fireEvent.click(day);
      expect(calls).toEqual([]);

      fireEvent.click(day);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.element.getAttribute("aria-label")).toBe("2026년 10월 5일 월요일 내역");
      expect(calls[0]?.options).toEqual({ behavior: "smooth", block: "start" });

      reduced = true;
      fireEvent.click(day);
      expect(calls[1]?.options).toEqual({ behavior: "auto", block: "start" });

      reduced = false;
      setWidth(1440);
      fireEvent.click(day);
      expect(calls[2]?.options).toEqual({ behavior: "smooth", block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = originalScroll;
      window.matchMedia = originalMatchMedia;
      setWidth(width);
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

  test("keeps the selected day in the URL so a tab round trip restores it", async () => {
    const first = render(<CalendarView />);
    fireEvent.click(await screen.findByRole("button", { name: /2026년 10월 5일/ }));
    expect(new URLSearchParams(location.search).get("day")).toBe("2026-10-05");
    first.unmount();

    render(<CalendarView />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /2026년 10월 5일/ }).getAttribute("aria-pressed")).toBe("true"),
    );
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

  test("keeps compact day totals within a four-glyph budget at >= 12px and keeps full amounts in labels and the day detail", async () => {
    const budget: readonly (readonly [string, number, string])[] = [
      ["2026-10-06", 9_994_999, "-999만"],
      ["2026-10-07", 9_995_000, "-1천만"],
      ["2026-10-08", 94_999_999, "-9천만"],
      ["2026-10-09", 95_000_000, "-1억"],
      ["2026-10-10", 994_999_999, "-9.9억"],
      ["2026-10-11", 995_000_000, "-10억"],
      ["2026-10-12", 99_949_999_999, "-999억"],
      ["2026-10-13", 99_950_000_000, "-1천억"],
      ["2026-10-14", 950_000_000_000, "-1조"],
    ];
    calendarDays = [
      { date: "2026-10-04", income: 12345678, expense: 99994000, count: 2 },
      { date: "2026-10-05", income: 0, expense: 123456789, count: 1 },
      ...budget.map(([date, expense]) => ({ date, income: 0, expense, count: 1 })),
    ];
    const base = transactions[0] ?? {};
    transactions = [
      { ...base, id: "tx-inc", type: "income", merchant: "샘플급여", amount: 12345678 },
      { ...base, id: "tx-exp", type: "expense", merchant: "테스트마트", amount: 99994000 },
    ];
    render(<CalendarView />);

    const oct4 = await screen.findByRole("button", {
      name: "2026년 10월 4일 일요일, 수입 +12,345,678원, 지출 -99,994,000원",
    });
    const compacts = Array.from(oct4.querySelectorAll(".calendar-compact")).map((el) => el.textContent);
    expect(compacts).toEqual(["+1천만", "-1억"]);

    const oct5 = await screen.findByRole("button", {
      name: "2026년 10월 5일 월요일, 지출 -123,456,789원",
    });
    expect(oct5.querySelector(".calendar-expense .calendar-compact")?.textContent).toBe("-1.2억");
    for (const [date, , compact] of budget) {
      const cell = document.querySelector(`[data-calendar-date="${date}"] .calendar-expense .calendar-compact`);
      expect(cell?.textContent).toBe(compact);
    }

    const css = await Bun.file(new URL("./calendar.css", import.meta.url)).text();
    const compactRule = /\.calendar-compact\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(compactRule).toContain("max(12px,");

    fireEvent.click(oct4);
    expect(await screen.findByRole("button", { name: /샘플급여.*12,345,678원/ })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /테스트마트.*99,994,000원/ })).toBeTruthy();
  });

  test("styles out-of-month days without opacity and keeps >= 4.5:1 contrast on light #ffffff and dark #161a21 surfaces", async () => {
    const tokensCss = await Bun.file(new URL("../../styles/tokens.css", import.meta.url)).text();
    const calendarCss = await Bun.file(new URL("./calendar.css", import.meta.url)).text();

    const outsideRule = /\.calendar-day\[data-outside-month="true"\]\s*\{([^}]*)\}/.exec(calendarCss)?.[1] ?? "";
    expect(outsideRule).not.toMatch(/\bopacity\s*:/);
    expect(outsideRule).toContain("var(--text-outside)");
    expect(calendarCss).toMatch(
      /\.calendar-day\[data-outside-month="true"\]\s+\.calendar-day-amount\s*\{[^}]*display:\s*none/,
    );

    const rootBlock = /:root\s*\{([^}]*)\}/.exec(tokensCss)?.[1] ?? "";
    const mediaDarkBlock = /:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/.exec(tokensCss)?.[1] ?? "";
    const attrDarkBlock = /\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(tokensCss)?.[1] ?? "";
    const normalizeDecls = (block: string) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
    expect(normalizeDecls(mediaDarkBlock)).toBe(normalizeDecls(attrDarkBlock));

    // Token values may alias another token (`--text-outside: var(--text-3)`); resolve them like the cascade would.
    const declarations = (block: string) =>
      new Map(
        Array.from(block.matchAll(/(--[\w-]+):\s*([^;]+);/g), (match) => [match[1] ?? "", (match[2] ?? "").trim()]),
      );
    const resolveToken = (name: string, scopes: readonly ReadonlyMap<string, string>[]): string => {
      const value = scopes.map((scope) => scope.get(name)).find((candidate) => candidate !== undefined);
      if (value === undefined) throw new Error(`${name} is not declared`);
      const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      return alias ? resolveToken(alias, scopes) : value;
    };
    const root = declarations(rootBlock);
    const dark = declarations(attrDarkBlock);
    const lightOutsideHex = resolveToken("--text-outside", [root]);
    const darkOutsideHex = resolveToken("--text-outside", [dark, root]);
    expect(lightOutsideHex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(darkOutsideHex).toMatch(/^#[0-9a-f]{6}$/i);

    const toLinear = (channel: number) => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16);
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    };
    const contrastRatio = (fg: string, bg: string) => {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    expect(resolveToken("--surface", [root])).toBe("#ffffff");
    expect(resolveToken("--surface", [dark, root])).toBe("#161a21");
    expect(contrastRatio(lightOutsideHex, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkOutsideHex, "#161a21")).toBeGreaterThanOrEqual(4.5);
    // tokens.css promises every text token clears 4.5:1 on --bg, --surface and --surface-2 in its theme.
    for (const surface of ["--bg", "--surface-2"]) {
      expect(contrastRatio(lightOutsideHex, resolveToken(surface, [root]))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(darkOutsideHex, resolveToken(surface, [dark, root]))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
