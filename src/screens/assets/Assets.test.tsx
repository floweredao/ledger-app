import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AssetInputSchema, AssetPatchSchema, type AssetSummary } from "../../../shared/schema";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import AssetDetail from "./AssetDetail";
import { AssetEditor } from "./AssetEditor";
import AssetsScreen from "./AssetsScreen";
import { CardStatement } from "./CardStatement";

const bank = {
  id: "bank",
  name: "테스트은행",
  kind: "bank" as const,
  group_name: "",
  opening_balance: 100000,
  opening_date: null,
  linked_asset_id: null,
  settlement_day: null,
  payment_day: null,
  performance_target: null,
  external_ref: null,
  sort: 0,
  hidden: false,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  balance: 100000,
  usage: null,
  cycle: null,
  payment_date: null,
  expected_payment: null,
  performance: null,
  reported_balance: null,
  reported_at: null,
  mismatch: null,
};
const card = {
  ...bank,
  id: "card",
  name: "샘플카드",
  kind: "credit_card" as const,
  linked_asset_id: bank.id,
  opening_balance: -50000,
  balance: -50000,
  usage: 12000,
  cycle: { from: "2026-09-10", to: "2026-10-09" },
  payment_date: "2026-10-25",
  expected_payment: 38000,
  performance: { target: 100000, achieved: 12000, pct: 12 },
};
const summary: AssetSummary = { assets: [bank, card], totals: { assets: 100000, debts: 50000, net_worth: 50000 } };
const realFetch = globalThis.fetch;
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function mockFetch(handler?: Handler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (handler) return handler(url, init);
    if (url.includes("summary")) return json(summary);
    if (url.includes("transactions")) return json({ items: [] });
    return json({ items: [bank, card] });
  }) as typeof fetch;
}
beforeEach(async () => {
  setSystemTime(new Date("2026-10-04T00:12:00Z"));
  await clearCache();
  localStorage.clear();
  clearMemoryCache();
  markNetwork(true);
  history.replaceState(null, "", "/assets/card");
});
afterEach(async () => {
  setSystemTime();
  cleanup();
  globalThis.fetch = realFetch;
  clearMemoryCache();
  await clearCache();
});

test("editor decodes items and preserves changes across focus", async () => {
  mockFetch();
  render(<AssetEditor open id="bank" onClose={() => {}} onSaved={() => {}} />);
  const name = await screen.findByDisplayValue("테스트은행");
  fireEvent.change(name, { target: { value: "수정은행" } });
  fireEvent.focus(screen.getByLabelText("그룹"));
  expect(screen.getByDisplayValue("수정은행")).toBeTruthy();
});
test("editor sends only changed editable patch fields", async () => {
  let body: unknown;
  mockFetch((url, init) => {
    if (init.method === "PATCH") {
      body = JSON.parse(String(init.body));
      return json(bank);
    }
    return json(url.includes("summary") ? summary : { items: [bank, card] });
  });
  render(<AssetEditor open id="bank" onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(await screen.findByDisplayValue("테스트은행"), { target: { value: "수정은행" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(body).toEqual({ name: "수정은행" }));
  expect(AssetPatchSchema.safeParse(body).success).toBe(true);
});
test.each(["2026-03-15", ""])("editor patches only opening_date to %s and preserves its draft", async (value) => {
  const dated = { ...bank, opening_date: "2026-03-01" };
  const saved = Promise.withResolvers<unknown>();
  mockFetch((_url, init) => {
    if (init.method === "PATCH") {
      saved.resolve(JSON.parse(String(init.body)));
      return json(dated);
    }
    return json({ items: [dated] });
  });
  const props = { open: true, id: "bank", onClose: () => {}, onSaved: () => {} };
  const view = render(<AssetEditor {...props} />);
  await screen.findByDisplayValue("테스트은행");
  const input = screen.getByLabelText("잔액 기준일 (선택)");
  expect(input.getAttribute("type")).toBe("date");
  fireEvent.change(input, { target: { value } });
  fireEvent.focus(screen.getByLabelText("그룹"));
  fireEvent(window, new Event("resize"));
  view.rerender(<AssetEditor {...props} />);
  expect(screen.getByLabelText("잔액 기준일 (선택)").getAttribute("value")).toBe(value);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await saved.promise).toEqual({ opening_date: value || null });
  });
});

test("creation includes a native opening date", async () => {
  const saved = Promise.withResolvers<unknown>();
  mockFetch((_url, init) => {
    if (init.method === "POST") {
      saved.resolve(JSON.parse(String(init.body)));
      return json(bank, 201);
    }
    return json({ items: [bank] });
  });
  render(<AssetEditor open id={null} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(await screen.findByLabelText("이름"), { target: { value: "샘플자산" } });
  fireEvent.change(screen.getByLabelText("잔액 기준일 (선택)"), { target: { value: "2026-03-15" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await saved.promise).toMatchObject({ opening_date: "2026-03-15" });
  });
});
test("creation sends validated input without server metadata", async () => {
  let body: unknown;
  mockFetch((_url, init) => {
    if (init.method === "POST") {
      body = JSON.parse(String(init.body));
      return json(bank, 201);
    }
    return json({ items: [bank, card] });
  });
  render(<AssetEditor open id={null} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(await screen.findByLabelText("이름"), { target: { value: "새은행" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(body).toBeDefined());
  expect(AssetInputSchema.safeParse(body).success).toBe(true);
});
test("card links offer only bank savings and reject missing link inline", async () => {
  let writes = 0;
  mockFetch((_url, init) => {
    if (init.method === "POST") writes++;
    return json({ items: [bank, card, { ...bank, id: "cash", name: "현금", kind: "cash" }] });
  });
  render(<AssetEditor open id={null} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(await screen.findByLabelText("이름"), { target: { value: "새카드" } });
  fireEvent.change(screen.getByLabelText("종류"), { target: { value: "credit_card" } });
  const link = screen.getByLabelText("연결된 계좌");
  expect(within(link).queryByRole("option", { name: "샘플카드" })).toBeNull();
  expect(within(link).queryByRole("option", { name: "현금" })).toBeNull();
  expect(within(link).getByRole("option", { name: "테스트은행" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(link.getAttribute("aria-invalid")).toBe("true");
  expect(writes).toBe(0);
});
test("card statement renders server cycle usage expected payment and performance", () => {
  render(<CardStatement asset={card} />);
  expect(screen.getByText("9월 10일 ~ 10월 9일")).toBeTruthy();
  expect(screen.getByText("10월 25일")).toBeTruthy();
  expect(screen.getByText("12,000원")).toBeTruthy();
  expect(screen.getByText("38,000원")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("12");
});
test("detail reports missing asset instead of loading forever", async () => {
  mockFetch();
  render(<AssetDetail id="missing" />);
  expect(await screen.findByText("자산을 찾을 수 없어요")).toBeTruthy();
});
test("detail reports HTTP failure and offers retry", async () => {
  mockFetch(() => json({ error: { code: "internal_error", message: "Failure" } }, 500));
  render(<AssetDetail id="card" />);
  expect(await screen.findByRole("button", { name: "다시 시도" })).toBeTruthy();
});
test("list supplies category icon and real detail link", async () => {
  mockFetch();
  render(<AssetsScreen />);
  expect((await screen.findByRole("link", { name: /샘플카드/ })).getAttribute("href")).toBe("/assets/card");
  expect(document.querySelector(".category-icon .lucide-credit-card")).toBeTruthy();
});
test("asset sync dates show KST time and previous-year date without raw ISO", async () => {
  mockFetch(() =>
    json({
      ...summary,
      assets: [
        { ...bank, reported_at: "2026-10-04T00:12:00Z", reported_balance: 100000 },
        { ...card, reported_at: "2025-03-01T15:00:00Z", reported_balance: -50000 },
      ],
    }),
  );
  render(<AssetsScreen />);
  expect(await screen.findByText("10월 4일 09:12 동기화")).toBeTruthy();
  expect(screen.getByText("2025년 3월 2일 동기화")).toBeTruthy();
  const bankRow = screen.getByRole("link", { name: /테스트은행/ });
  const cardRow = screen.getByRole("link", { name: /샘플카드/ });
  expect(bankRow.textContent?.match(/100,000원/g)).toHaveLength(1);
  expect(cardRow.textContent?.match(/-50,000원/g)).toHaveLength(1);
});
test("a different reported balance remains available for reconciliation", async () => {
  mockFetch(() =>
    json({
      ...summary,
      assets: [{ ...bank, reported_at: "2026-10-04T00:12:00Z", reported_balance: 90000, mismatch: 10000 }],
    }),
  );
  render(<AssetsScreen />);
  const row = await screen.findByRole("link", { name: /테스트은행/ });
  expect(row.textContent?.match(/100,000원/g)).toHaveLength(1);
  expect(row.textContent?.match(/90,000원/g)).toHaveLength(1);
  expect(screen.getByText("10,000원")).toBeTruthy();
});
test("payment requires confirmation then refreshes both balances", async () => {
  let paid = false;
  mockFetch((url, init) => {
    if (url.includes("card-payment")) {
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({});
      paid = true;
      return json({ id: "payment" }, 201);
    }
    if (url.includes("summary"))
      return json(
        paid
          ? {
              ...summary,
              assets: [
                { ...bank, balance: 62000 },
                { ...card, balance: -12000, expected_payment: 0 },
              ],
            }
          : summary,
      );
    return json({ items: [] });
  });
  render(<AssetDetail id="card" />);
  fireEvent.click(await screen.findByRole("button", { name: "카드 대금 결제" }));
  expect(paid).toBe(false);
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "결제" }));
  expect(await screen.findByText("62,000원")).toBeTruthy();
  expect(screen.getByText("-12,000원")).toBeTruthy();
});
test("referenced deletion offers hiding and hiding navigates to list", async () => {
  let hidden = false;
  mockFetch((url, init) => {
    if (init.method === "DELETE") return json({ error: { code: "in_use", message: "Referenced" } }, 409);
    if (init.method === "PATCH") {
      expect(JSON.parse(String(init.body))).toEqual({ hidden: true });
      hidden = true;
      return json({ ...card, hidden: true });
    }
    return json(url.includes("summary") ? summary : { items: [] });
  });
  render(<AssetDetail id="card" />);
  fireEvent.click(await screen.findByRole("button", { name: "삭제" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "삭제" }));
  fireEvent.click(await screen.findByRole("button", { name: "숨기기" }));
  await waitFor(() => expect(hidden).toBe(true));
  expect(location.pathname).toBe("/assets");
});
test("successful deletion returns to assets list", async () => {
  mockFetch((url, init) =>
    init.method === "DELETE" ? json({ ok: true }) : json(url.includes("summary") ? summary : { items: [] }),
  );
  render(<AssetDetail id="bank" />);
  fireEvent.click(await screen.findByRole("button", { name: "삭제" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "삭제" }));
  await waitFor(() => expect(location.pathname).toBe("/assets"));
});
test("asset transaction rows show the record's category with its parent", async () => {
  mockFetch((url) =>
    json(
      url.includes("summary")
        ? summary
        : url.includes("categories")
          ? {
              items: [
                {
                  id: "food",
                  name: "식비",
                  parent_id: null,
                  children: [{ id: "snack", name: "간식", parent_id: "food" }],
                },
                { id: "transport", name: "교통", parent_id: null, children: [] },
              ],
            }
          : {
              items: ["snack", "transport"].map((category_id) => ({
                id: `tx-${category_id}`,
                occurred_at: "2026-10-03T12:00:00+09:00",
                type: "expense",
                amount: 3000,
                category_id,
                merchant: `샘플-${category_id}`,
                memo: "",
                currency: "KRW",
                foreign_amount: null,
                krw_status: "exact",
                is_refund: false,
              })),
            },
    ),
  );
  render(<AssetDetail id="bank" />);
  const snack = await screen.findByRole("button", { name: /샘플-snack/ });
  await waitFor(() => expect(snack.querySelector(".list-row-subtitle")?.textContent).toBe("식비 › 간식"));
  const transport = screen.getByRole("button", { name: /샘플-transport/ });
  expect(transport.querySelector(".list-row-subtitle")?.textContent).toBe("교통");
});
test("transaction row opens entry with id instead of broken route", async () => {
  mockFetch((url) =>
    json(
      url.includes("summary")
        ? summary
        : {
            items: [
              {
                id: "tx",
                occurred_at: "2026-10-03T12:00:00+09:00",
                type: "expense",
                amount: 12000,
                merchant: "샘플카페",
                memo: "",
                currency: "KRW",
                foreign_amount: null,
                krw_status: "exact",
                is_refund: false,
              },
            ],
          },
    ),
  );
  const requests: unknown[] = [];
  const listener = (event: Event) => requests.push((event as CustomEvent).detail);
  window.addEventListener("ledger:open-entry", listener);
  try {
    render(<AssetDetail id="card" />);
    fireEvent.click(await screen.findByRole("button", { name: /샘플카페/ }));
    expect(requests).toEqual([{ id: "tx" }]);
    expect(location.pathname).toBe("/assets/card");
  } finally {
    window.removeEventListener("ledger:open-entry", listener);
  }
});

test("asset history exposes older pages with its asset filter intact", async () => {
  const paths: URL[] = [];
  mockFetch((url) => {
    if (url.includes("summary")) return json(summary);
    const parsed = new URL(url, location.origin);
    paths.push(parsed);
    const later = parsed.searchParams.has("cursor");
    return json({
      items: [
        {
          id: later ? "older" : "newer",
          type: "expense",
          amount: 12000,
          merchant: later ? "과거샘플카페" : "최근샘플카페",
          occurred_at: later ? "2026-10-02T12:00:00+09:00" : "2026-10-03T12:00:00+09:00",
          is_refund: false,
          currency: "KRW",
          foreign_amount: null,
          krw_status: "exact",
          memo: "",
        },
      ],
      totals: { income: 0, expense: 24000, net: -24000, count: 2 },
      next_cursor: later ? null : "older-page",
    });
  });
  render(<AssetDetail id="card" />);
  await screen.findByRole("button", { name: /최근샘플카페/ });
  fireEvent.click(await screen.findByRole("button", { name: "거래 더 보기" }));
  expect(await screen.findByRole("button", { name: /과거샘플카페/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /최근샘플카페/ })).toBeTruthy();
  expect(paths.find((url) => url.searchParams.has("cursor"))?.searchParams.get("asset_id")).toBe("card");
});

test("transaction rows distinguish spending income refunds and pending foreign amounts", async () => {
  const base = {
    occurred_at: "2026-10-03T12:00:00+09:00",
    type: "expense",
    amount: 12000,
    is_refund: false,
    currency: "KRW",
    foreign_amount: null,
    krw_status: "exact",
    memo: "",
  };
  mockFetch((url) =>
    json(
      url.includes("summary")
        ? summary
        : {
            items: [
              { ...base, id: "expense", merchant: "샘플지출" },
              { ...base, id: "income", merchant: "샘플수입", type: "income", amount: 20000 },
              { ...base, id: "refund", merchant: "샘플환불", is_refund: true, amount: 1000 },
              {
                ...base,
                id: "foreign",
                merchant: "샘플외화",
                amount: 0,
                currency: "USD",
                foreign_amount: 3.2,
                krw_status: "pending",
              },
            ],
          },
    ),
  );
  render(<AssetDetail id="card" />);
  expect(within(await screen.findByRole("button", { name: /샘플지출/ })).getByText("-12,000원")).toBeTruthy();
  expect(within(screen.getByRole("button", { name: /샘플수입/ })).getByText("+20,000원")).toBeTruthy();
  expect(within(screen.getByRole("button", { name: /샘플환불/ })).getByText("+1,000원")).toBeTruthy();
  expect(screen.getByRole("button", { name: /샘플외화.*-USD 3.2/ })).toBeTruthy();
  expect(screen.getByText("원화 미확정")).toBeTruthy();
});
