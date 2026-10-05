import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork, setCsrfToken } from "../../api/transport";
import { openEntry } from "../../app/entry-bridge";
import { ToastRegion } from "../../components/Toast";
import EntryHost from "./EntryHost";
import { GETS, listOf, row } from "./test-fixtures";

type Call = { readonly method: string; readonly url: string; readonly body: unknown };

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let reads: Map<string, ReturnType<typeof Promise.withResolvers<void>>>;
let mutation: ReturnType<typeof Promise.withResolvers<void>>;
const baseCategories = GETS.categories;

type Node = { readonly hidden: boolean; readonly children: readonly { readonly hidden: boolean }[] };
/** Mirrors GET /categories without include_hidden: hidden rows and the children of hidden parents drop out. */
function withoutHidden(body: unknown): unknown {
  const { items } = body as { items: readonly Node[] };
  return {
    items: items
      .filter((node) => !node.hidden)
      .map((node) => ({ ...node, children: node.children.filter((child) => !child.hidden) })),
  };
}

beforeEach(() => {
  calls = [];
  reads = new Map();
  mutation = Promise.withResolvers<void>();
  GETS.transactions = listOf(row);
  GETS["transactions/tx1"] = row;
  GETS.categories = baseCategories;
  clearMemoryCache();
  markNetwork(true);
  setCsrfToken("csrf-x");
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const path = url.replace("/api/v1/", "").split("?")[0] ?? "";
    if (method === "GET") {
      const body =
        path === "categories" && !url.includes("include_hidden=true") ? withoutHidden(GETS[path]) : GETS[path];
      const response =
        body === undefined
          ? new Response(JSON.stringify({ error: { code: "not_found", message: "" } }), { status: 404 })
          : new Response(JSON.stringify(body));
      const text = response.text.bind(response);
      response.text = async () => {
        const value = await text();
        reads.get(path)?.resolve();
        return value;
      };
      return response;
    }
    mutation.resolve();
    return new Response(JSON.stringify(row), { status: method === "POST" ? 201 : 200 });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const mutations = () => calls.filter((call) => call.method !== "GET");
const amountText = () => screen.getByLabelText("금액").textContent;
const press = (...keys: string[]) => {
  for (const key of keys) fireEvent.click(screen.getByRole("button", { name: key }));
};

async function open(request: Parameters<typeof openEntry>[0] = {}, ready = "식비") {
  const paths = ["categories", "assets", "settings", "templates", "merchant-rules", "transactions"];
  if (request.id) paths.push(`transactions/${request.id}`);
  for (const path of paths) reads.set(path, Promise.withResolvers<void>());
  render(
    <>
      <EntryHost />
      <ToastRegion />
    </>,
  );
  act(() => openEntry(request));
  await act(async () => {
    await Promise.all(paths.map((path) => reads.get(path)?.promise));
  });
  // Response consumption and the effects installing keyboard handlers have both finished.
  expect(screen.getByRole("button", { name: ready })).toBeTruthy();
}

describe("new entry", () => {
  test("reopening a cached form keeps focus inside for immediate keyboard entry", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog") === null).toBe(true));
    act(() => openEntry({}));
    await screen.findByRole("button", { name: "식비" });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "6" });
    expect(amountText()).toBe("6원");
  });

  test("the keypad builds 12,500 and backspace removes the last digit", async () => {
    await open();
    press("1", "2", "5", "00");
    expect(amountText()).toBe("12,500원");
    press("지우기");
    expect(amountText()).toBe("1,250원");
  });

  test("save posts the typed amount, chosen child category, default asset and requested date", async () => {
    await open({ date: "2026-10-04" });
    press("4", "5", "0", "0", "식비");
    fireEvent.click(await screen.findByRole("button", { name: "카페" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [post] = mutations();
    expect(post?.method).toBe("POST");
    expect(post?.url).toBe("/api/v1/transactions");
    expect(post?.body).toMatchObject({
      type: "expense",
      amount: 4500,
      category_id: "c-cafe",
      asset_id: "a-bank",
      merchant: "",
      memo: "",
      occurred_at: expect.stringMatching(/^2026-10-04T\d{2}:\d{2}:00\+09:00$/),
    });
  });

  test("keyboard digits and Enter save from the desktop keyboard", async () => {
    await open();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "3" });
    fireEvent.keyDown(dialog, { key: "0" });
    expect(amountText()).toBe("30원");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Enter" });
      await mutation.promise;
    });
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0]?.body).toMatchObject({ amount: 30 });
  });

  test("Enter on a just-clicked keypad key saves instead of typing the key again", async () => {
    await open();
    press("4", "0");
    const zero = screen.getByRole("button", { name: "0" });
    zero.focus();
    fireEvent.keyDown(zero, { key: "Enter" });
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.body).toMatchObject({ amount: 40 });
  });

  test("Enter while composing Korean in the merchant field does not save", async () => {
    await open();
    press("5");
    const merchant = screen.getByLabelText("내용");
    fireEvent.keyDown(merchant, { key: "Enter", isComposing: true });
    expect(mutations()).toHaveLength(0);
  });

  test("an empty amount shows the inline error and sends nothing", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("금액을 입력해 주세요")).toBeTruthy();
    expect(mutations()).toHaveLength(0);
  });

  test("a transfer without a distinct destination asset is rejected inline", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "이체" }));
    press("1", "0", "0", "0");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("받는 자산을 보내는 자산과 다르게 골라 주세요")).toBeTruthy();
    expect(mutations()).toHaveLength(0);
  });

  test("a favorite chip fills the form", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "샘플카페 아메리카노" }));
    expect(amountText()).toBe("4,500원");
    expect((screen.getByLabelText("내용") as HTMLInputElement).value).toBe("샘플카페");
    expect((await screen.findByRole("button", { name: "카페" })).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "샘플카드" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("a refund favorite remains a refund when saved from the entry sheet", async () => {
    const previous = GETS.templates;
    GETS.templates = {
      items: [
        {
          id: "refund-template",
          name: "샘플환불",
          payload: { type: "expense", amount: 1000, is_refund: true, merchant: "샘플환불", asset_id: "a-bank" },
          sort: 0,
          use_count: 0,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      ],
    };
    try {
      await open();
      fireEvent.click(await screen.findByRole("button", { name: "샘플환불" }));
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await waitFor(() => expect(mutations()).toHaveLength(1));
      expect(mutations()[0]?.body).toMatchObject({ type: "expense", amount: 1000, is_refund: true });
    } finally {
      GETS.templates = previous;
    }
  });

  test("a merchant with a learned rule pre-selects its category", async () => {
    await open();
    await screen.findByRole("button", { name: "샘플카페 아메리카노" });
    fireEvent.change(screen.getByLabelText("내용"), { target: { value: "샘플카페" } });
    expect((await screen.findByRole("button", { name: "카페" })).getAttribute("aria-pressed")).toBe("true");
  });

  test("즐겨찾기로 저장 posts a template built from the form", async () => {
    await open();
    press("4", "5", "0", "0");
    fireEvent.change(screen.getByLabelText("내용"), { target: { value: "샘플분식" } });
    fireEvent.click(screen.getByRole("button", { name: "즐겨찾기로 저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.url).toBe("/api/v1/templates");
    expect(mutations()[0]?.body).toMatchObject({
      name: "샘플분식",
      payload: { type: "expense", amount: 4500, merchant: "샘플분식", asset_id: "a-bank" },
    });
  });
});

describe("custody transfers", () => {
  const baseAssets = GETS.assets;
  const custody = {
    ...(baseAssets as { items: Record<string, unknown>[] }).items[0],
    id: "a-custody",
    name: "샘플보관금",
    kind: "other",
    sort: 3,
  };
  beforeEach(() => {
    GETS.assets = { items: [...(baseAssets as { items: unknown[] }).items, custody] };
  });
  afterEach(() => {
    GETS.assets = baseAssets;
  });
  const group = (name: string) => within(screen.getByRole("group", { name }));

  test("a new transfer can send from and receive into a custody asset", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "이체" }));
    press("5", "0", "0", "0");
    fireEvent.click(group("보내는 자산").getByRole("button", { name: "샘플보관금" }));
    fireEvent.click(group("받는 자산").getByRole("button", { name: "테스트통장" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({
      method: "POST",
      body: { type: "transfer", amount: 5000, asset_id: "a-custody", to_asset_id: "a-bank", category_id: null },
    });
  });

  test("one tap turns an imported expense into a transfer to the custody asset", async () => {
    await open({ id: "tx1" });
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    expect(group("이체로 바꾸기").queryByRole("button", { name: "테스트통장" })).toBeNull();
    fireEvent.click(group("이체로 바꾸기").getByRole("button", { name: "샘플보관금" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: "PATCH", url: "/api/v1/transactions/tx1" });
    expect(mutations()[0]?.body).toEqual({ type: "transfer", to_asset_id: "a-custody", category_id: null });
  });

  test("one tap turns an imported income into a transfer from the custody asset", async () => {
    GETS["transactions/tx1"] = { ...row, type: "income", category_id: "c-salary" };
    await open({ id: "tx1" }, "급여");
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    fireEvent.click(group("이체로 바꾸기").getByRole("button", { name: "샘플보관금" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.body).toEqual({
      type: "transfer",
      asset_id: "a-custody",
      to_asset_id: "a-bank",
      category_id: null,
    });
  });

  test("transfers and new entries do not offer a conversion", async () => {
    await open({ id: "tx1" });
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    fireEvent.click(screen.getByRole("radio", { name: "이체" }));
    expect(screen.queryByRole("group", { name: "이체로 바꾸기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    act(() => openEntry({}));
    await waitFor(() => expect(screen.getByRole("button", { name: "식비" })).toBeTruthy());
    expect(screen.queryByRole("group", { name: "이체로 바꾸기" })).toBeNull();
    expect(mutations()).toHaveLength(0);
  });
});

describe("edit entry", () => {
  test("edits an unresolved foreign record without inventing a won amount", async () => {
    GETS["transactions/tx1"] = { ...row, amount: 0, currency: "USD", foreign_amount: 3.2, krw_status: "pending" };
    await open({ id: "tx1" });
    fireEvent.change(screen.getByLabelText("메모"), { target: { value: "미확정 메모 보존" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: "PATCH", body: { memo: "미확정 메모 보존" } });
    expect(mutations()[0]?.body).not.toHaveProperty("amount");
  });

  test("loads an older record by ID even when it is not in the recent page", async () => {
    GETS["transactions/old"] = { ...row, id: "old", amount: 7800, occurred_at: "2025-01-01T12:00:00+09:00" };
    await open({ id: "old" });
    expect(amountText()).toBe("7,800원");
    expect(calls.some((call) => call.method === "GET" && call.url === "/api/v1/transactions/old")).toBe(true);
  });
  test("loads the row with its source badge and patches only the changed amount", async () => {
    await open({ id: "tx1" });
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    expect(screen.getByText("카카오뱅크 알림")).toBeTruthy();
    press("지우기");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.method).toBe("PATCH");
    expect(mutations()[0]?.url).toBe("/api/v1/transactions/tx1");
    expect(mutations()[0]?.body).toEqual({ amount: 1200 });
  });

  test("changing the category offers apply-to-past and sends it", async () => {
    await open({ id: "tx1" });
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    expect(screen.queryByLabelText("같은 가게 지난 거래에도 적용")).toBeNull();
    press("교통");
    fireEvent.click(screen.getByLabelText("같은 가게 지난 거래에도 적용"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.body).toEqual({ category_id: "c-transit", apply_to_past: true });
  });

  test("a type-only change clears the now-incompatible category in the same patch", async () => {
    await open({ id: "tx1" });
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    fireEvent.click(screen.getByRole("radio", { name: "수입" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.body).toEqual({ type: "income", category_id: null });
  });

  test("a type change with a newly picked category sends both together", async () => {
    await open({ id: "tx1" });
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    fireEvent.click(screen.getByRole("radio", { name: "수입" }));
    press("급여");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.body).toEqual({ type: "income", category_id: "c-salary" });
  });

  test("reopening a row loads its current server state, not the cached copy from the last open", async () => {
    await open({ id: "tx1" });
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    GETS.transactions = { ...listOf(row), items: [{ ...row, amount: 15000 }] };
    GETS["transactions/tx1"] = { ...row, amount: 15000 };
    act(() => openEntry({ id: "tx1" }));
    await waitFor(() => expect(amountText()).toBe("15,000원"));
  });

  test("delete closes with a toast whose 실행 취소 restores the row", async () => {
    await open({ id: "tx1" });
    await waitFor(() => expect(amountText()).toBe("12,000원"));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: "DELETE", url: "/api/v1/transactions/tx1" });
    expect(await screen.findByText("삭제했어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    await waitFor(() => expect(mutations()).toHaveLength(2));
    expect(mutations()[1]).toMatchObject({ method: "POST", url: "/api/v1/transactions/tx1/restore" });
  });
});

describe("hidden and child categories", () => {
  const stamp = "2026-10-01T09:00:00+09:00";
  const cat = (id: string, name: string, parent: string | null, hidden = false) => ({
    id,
    type: "expense",
    parent_id: parent,
    name,
    icon: "utensils",
    color: "cat-1",
    sort: 1,
    hidden,
    created_at: stamp,
    updated_at: stamp,
  });
  beforeEach(() => {
    GETS.categories = {
      items: [
        {
          ...cat("c-food", "식비", null),
          children: [cat("c-cafe", "카페", "c-food"), cat("c-snack", "숨긴간식", "c-food", true)],
        },
        { ...cat("c-gone", "숨긴분류", null, true), children: [cat("c-gone-sub", "숨긴하위", "c-gone")] },
        { ...cat("c-transit", "교통", null), children: [] },
      ],
    };
  });

  test("a new entry offers neither hidden categories nor the children of a hidden parent", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "숨긴분류" })).toBeNull();
    press("식비");
    expect(screen.getByRole("button", { name: "카페" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "숨긴간식" })).toBeNull();
    expect(screen.queryByRole("button", { name: "숨긴하위" })).toBeNull();
  });

  test("editing a record on a hidden child keeps showing and keeping its category", async () => {
    GETS["transactions/tx1"] = { ...row, category_id: "c-snack" };
    await open({ id: "tx1" });
    expect(screen.getByRole("button", { name: "숨긴간식" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "숨긴분류" })).toBeNull();
    fireEvent.change(screen.getByLabelText("메모"), { target: { value: "메모만 수정" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.body).toEqual({ memo: "메모만 수정" });
  });

  test("editing a record under a hidden parent shows that parent and its chosen child only", async () => {
    GETS["transactions/tx1"] = { ...row, category_id: "c-gone-sub" };
    await open({ id: "tx1" });
    expect(screen.getByRole("button", { name: "숨긴분류" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "숨긴하위" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "숨긴간식" })).toBeNull();
  });

  test("a child category picked while editing is saved as the child id", async () => {
    await open({ id: "tx1" });
    press("카페");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]?.body).toEqual({ category_id: "c-cafe" });
  });
});
