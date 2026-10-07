import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addDays, monthRange } from "../../../shared/dates";
import type { CategoryNode, Transaction, TransactionList } from "../../../shared/schema";
import { clearMemoryCache } from "../../api/hooks";
import { useEntryRequest } from "../../app/entry-bridge";
import { calendarMonthFilter } from "../../app/periods";
import { navigate } from "../../router";
import DailyList from "./DailyList";

const month = "2026-10";
const firstDate = monthRange(month).from;
const laterDate = addDays(firstDate, 1);

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
    type: "expense",
    occurred_at: `${firstDate}T12:00:00+09:00`,
    amount: 4200,
    is_refund: false,
    currency: "KRW",
    foreign_amount: null,
    krw_status: "exact",
    asset_id: "asset-1",
    to_asset_id: null,
    category_id: "category-food",
    merchant: "샘플카페",
    merchant_key: "샘플카페",
    memo: "점심",
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
    created_at: `${firstDate}T12:00:00+09:00`,
    updated_at: `${firstDate}T12:00:00+09:00`,
    ...overrides,
  };
}

const categories: { items: CategoryNode[] } = {
  items: [
    {
      id: "category-food",
      type: "expense",
      parent_id: null,
      name: "식비",
      icon: "utensils",
      color: "cat-3",
      sort: 1,
      hidden: false,
      created_at: `${firstDate}T00:00:00+09:00`,
      updated_at: `${firstDate}T00:00:00+09:00`,
      children: [],
    },
  ],
};

function list(items: Transaction[]): TransactionList {
  return {
    items,
    totals: { income: 0, expense: 0, net: 0, count: items.length },
    next_cursor: null,
  };
}

function consumedJson(payload: unknown, consumed?: () => void): Response {
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const text = response.text.bind(response);
  response.text = async () => {
    const body = await text();
    consumed?.();
    return body;
  };
  return response;
}

function EntrySignal() {
  const { request } = useEntryRequest();
  return request ? <output data-testid="entry-request">{request.id ?? request.date}</output> : null;
}

function touch(root: HTMLElement, type: "touchstart" | "touchmove" | "touchend", clientY?: number) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, type === "touchend" ? "changedTouches" : "touches", {
    value: clientY === undefined ? [] : [{ clientX: 100, clientY }],
  });
  root.dispatchEvent(event);
}

afterEach(() => {
  cleanup();
  clearMemoryCache();
});

describe("DailyList", () => {
  test("a renamed automatic record does not show an original-name line", async () => {
    const renamed = transaction({
      id: "renamed-1",
      source: "kakaobank_sms",
      merchant: "샘플 구독료",
      memo: "",
      source_detail: {
        kind: "체크카드결제",
        counterparty: "SAMPLE*TESTSHOP 851",
        account: "3333-00-0000000",
        amount: -8751,
        balance: 431249,
        currency: null,
        at: `${firstDate}T12:00:00+09:00`,
      },
    });
    const unchanged = transaction({
      id: "unchanged-1",
      source: "kakaobank_sms",
      merchant: "샘플가게",
      memo: "",
      source_detail: {
        kind: "체크카드결제",
        counterparty: "샘플가게(체크",
        account: "3333-00-0000000",
        amount: -8751,
        balance: 431249,
        currency: null,
        at: `${firstDate}T12:00:00+09:00`,
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) =>
        new Response(JSON.stringify(String(input).includes("categories") ? categories : list([renamed, unchanged])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      { preconnect: originalFetch.preconnect },
    );
    try {
      navigate(`/?month=${month}`, { replace: true });
      render(<DailyList />);
      const renamedRow = await screen.findByRole("button", { name: /샘플 구독료/ });
      expect(renamedRow.textContent).not.toContain("원래:");
      expect(renamedRow.textContent).not.toContain("SAMPLE*TESTSHOP 851");
      expect(screen.getByRole("button", { name: /샘플가게/ }).textContent).not.toContain("원래:");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("groups selected month by KST day and shows income and expense totals", async () => {
    const lunch = transaction();
    const refund = transaction({
      id: "refund-1",
      occurred_at: `${firstDate}T17:00:00+09:00`,
      amount: 1000,
      is_refund: true,
      merchant: "샘플 환불",
    });
    const income = transaction({
      id: "income-1",
      type: "income",
      amount: 12000,
      category_id: null,
      merchant: "급여",
    });
    const nextDay = transaction({ id: "next-day", occurred_at: `${laterDate}T00:15:00+09:00` });
    const requestedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const requestedUrl = String(input);
        requestedUrls.push(requestedUrl);
        const payload = requestedUrl.includes("categories") ? categories : list([lunch, refund, income, nextDay]);
        return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      navigate(`/?month=${month}`, { replace: true });
      render(<DailyList />);
      expect((await screen.findAllByText("샘플카페")).length).toBe(2);
      expect(screen.getByText("수입 +12,000원")).toBeTruthy();
      expect(screen.getByText("지출 -3,200원")).toBeTruthy();
      expect(screen.getByText("지출 -4,200원")).toBeTruthy();
      expect(screen.getByText("환불 1,000원")).toBeTruthy();
      expect(screen.getByRole("region", { name: "2일 금요일" })).toBeTruthy();
      const requestedUrl = requestedUrls.find((url) => url.includes("transactions")) ?? "";
      const query = new URL(requestedUrl, "http://127.0.0.1").searchParams;
      expect(query.get("from")).toBe(calendarMonthFilter(month).from);
      expect(query.get("to")).toBe(calendarMonthFilter(month).to);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("opens the selected transaction and exposes import and unresolved currency labels", async () => {
    const imported = transaction({
      id: "imported-1",
      source: "kakaobank_excel",
      currency: "USD",
      foreign_amount: 3.2,
      krw_status: "pending",
      merchant: "긴 샘플 상호 이름",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) =>
        new Response(JSON.stringify(String(input).includes("categories") ? categories : list([imported])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      navigate(`/?month=${month}`, { replace: true });
      render(
        <>
          <DailyList />
          <EntrySignal />
        </>,
      );
      const row = await screen.findByRole("button", { name: /긴 샘플 상호 이름/ });
      expect(screen.getByText("자동")).toBeTruthy();
      expect(screen.getByText("원화 미확정")).toBeTruthy();
      expect(screen.getByText(/USD 3\.2/)).toBeTruthy();
      fireEvent.click(row);
      expect((await screen.findByTestId("entry-request")).textContent).toBe("imported-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("empty month offers record creation and manual refresh runs sync before reload", async () => {
    const calls: string[] = [];
    const loaded = Promise.withResolvers<void>();
    const synced = Promise.withResolvers<void>();
    const reloaded = Promise.withResolvers<void>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        const payload = url.includes("sync/run")
          ? { inserted: 0, merged: 0, skipped: 0, hidden: 0, errors: [] }
          : url.includes("categories")
            ? categories
            : list([]);
        const signal = url.includes("sync/run")
          ? synced
          : url.includes("transactions")
            ? calls.some((call) => call.startsWith("POST"))
              ? reloaded
              : loaded
            : undefined;
        return consumedJson(payload, signal?.resolve);
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      navigate(`/?month=${month}`, { replace: true });
      render(
        <>
          <DailyList />
          <EntrySignal />
        </>,
      );
      await act(async () => {
        await loaded.promise;
      });
      expect(screen.getByText("이번 달 기록이 없어요")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "기록하기" }));
      await waitFor(() => expect(screen.getByTestId("entry-request").textContent).toBe(firstDate));

      fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));
      await act(async () => {
        await synced.promise;
      });
      await act(async () => {
        await reloaded.promise;
      });
      expect(calls.some((call) => call.startsWith("POST") && call.includes("sync/run"))).toBe(true);
      const syncIndex = calls.findIndex((call) => call.startsWith("POST"));
      expect(calls.slice(syncIndex + 1).some((call) => call.startsWith("GET") && call.includes("transactions"))).toBe(
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("pulling down from the top runs sync and refreshes the list", async () => {
    const calls: string[] = [];
    const loaded = Promise.withResolvers<void>();
    const synced = Promise.withResolvers<void>();
    const reloaded = Promise.withResolvers<void>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        const payload = url.includes("sync/run")
          ? { inserted: 0, merged: 0, skipped: 0, hidden: 0, errors: [] }
          : url.includes("categories")
            ? categories
            : list([]);
        const signal = url.includes("sync/run")
          ? synced
          : url.includes("transactions")
            ? calls.some((call) => call.startsWith("POST"))
              ? reloaded
              : loaded
            : undefined;
        return consumedJson(payload, signal?.resolve);
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      navigate(`/?month=${month}`, { replace: true });
      render(<DailyList />);
      await act(async () => {
        await loaded.promise;
      });
      const content = screen.getByText("이번 달 기록이 없어요");
      const root = content.closest(".daily-empty");
      if (!(root instanceof HTMLElement)) throw new Error("Daily refresh region missing");

      act(() => {
        touch(root, "touchstart", 20);
        touch(root, "touchmove", 110);
        touch(root, "touchend");
      });
      await act(async () => {
        await synced.promise;
      });
      await act(async () => {
        await reloaded.promise;
      });
      expect(calls.some((call) => call.startsWith("POST") && call.includes("sync/run"))).toBe(true);
      expect(calls.filter((call) => call.startsWith("GET") && call.includes("transactions")).length).toBeGreaterThan(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("a refund-only day displays returned money without a double minus", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(input).includes("categories") ? categories : list([transaction({ is_refund: true, amount: 1000 })]),
        ),
      ),
    { preconnect: originalFetch.preconnect },
  );
  try {
    navigate("/?month=2026-10", { replace: true });
    render(<DailyList />);
    expect(await screen.findByText("지출 +1,000원")).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("nested category and asset names are resolved from the real response shapes", async () => {
  const parent = categories.items[0];
  if (!parent) throw new Error("Category fixture missing");
  const tree = {
    items: [
      { ...parent, children: [{ ...parent, id: "child-cafe", parent_id: parent.id, name: "카페", icon: "coffee" }] },
    ],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("categories")
        ? tree
        : url.includes("assets")
          ? { items: [{ id: "asset-1", name: "테스트통장" }] }
          : list([transaction({ merchant: "", category_id: "child-cafe", memo: "" })]);
      return new Response(JSON.stringify(body));
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    navigate("/?month=2026-10", { replace: true });
    render(<DailyList />);
    expect(await screen.findByRole("button", { name: /카페.*테스트통장/ })).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("each record shows its category, with the parent in front of a child category", async () => {
  const parent = categories.items[0];
  if (!parent) throw new Error("Category fixture missing");
  const tree = {
    items: [{ ...parent, children: [{ ...parent, id: "child-snack", parent_id: parent.id, name: "간식" }] }],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("categories")
        ? tree
        : url.includes("assets")
          ? { items: [{ id: "asset-1", name: "테스트통장" }] }
          : list([
              transaction({ merchant: "샘플편의점", category_id: "child-snack", memo: "" }),
              transaction({ merchant: "샘플식당", category_id: parent.id, memo: "" }),
            ]);
      return new Response(JSON.stringify(body));
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    navigate("/?month=2026-10", { replace: true });
    render(<DailyList />);
    const snack = await screen.findByRole("button", { name: /샘플편의점/ });
    await waitFor(() =>
      expect(snack.querySelector(".list-row-subtitle")?.textContent).toBe("식비 › 간식 · 테스트통장"),
    );
    const meal = screen.getByRole("button", { name: /샘플식당/ });
    expect(meal.querySelector(".list-row-subtitle")?.textContent).toBe("식비 · 테스트통장");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a transfer without a merchant names the transfer and both assets instead of a missing category", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("categories")
        ? categories
        : url.includes("assets")
          ? {
              items: [
                { id: "asset-1", name: "테스트통장" },
                { id: "asset-2", name: "샘플보관금" },
              ],
            }
          : list([
              transaction({
                type: "transfer",
                asset_id: "asset-2",
                to_asset_id: "asset-1",
                category_id: null,
                merchant: "",
                memo: "",
                amount: 30000,
              }),
            ]);
      return new Response(JSON.stringify(body));
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    navigate("/?month=2026-10", { replace: true });
    render(<DailyList />);
    const row = await screen.findByRole("button", { name: /샘플보관금 → 테스트통장/ });
    expect(row.querySelector(".list-row-title")?.textContent).toBe("이체");
    expect(row.textContent).not.toContain("분류 없음");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
