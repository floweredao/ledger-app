import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import { indexedDB as testIndexedDB } from "fake-indexeddb";
import type { MerchantRule } from "../../../shared/schema";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import MerchantRules from "./MerchantRules";

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let rules: MerchantRule[];
let calls: URL[];
let fail: boolean;
let loading: boolean;
let releaseLoading: (() => void) | undefined;
let indexedDBDescriptor: PropertyDescriptor | undefined;
beforeEach(async () => {
  setSystemTime(new Date("2026-10-04T00:12:00Z"));
  cleanup();
  indexedDBDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: testIndexedDB });
  history.replaceState(null, "", "/settings/rules");
  localStorage.clear();
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  rules = [
    {
      merchant_key: "샘플카페",
      category_id: "food",
      category_name: "식비",
      type: "expense",
      updated_at: "2026-01-01T00:00:00+09:00",
    },
    {
      merchant_key: "샘플카페",
      category_id: "salary",
      category_name: "급여",
      type: "income",
      updated_at: "2026-01-02T00:00:00+09:00",
    },
    {
      merchant_key: "테스트교통",
      category_id: "transport",
      category_name: "교통",
      type: "expense",
      updated_at: "2026-01-03T00:00:00+09:00",
    },
  ];
  calls = [];
  fail = false;
  loading = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), location.origin);
    if (loading)
      await new Promise<void>((resolve) => {
        releaseLoading = resolve;
      });
    if (fail) return json({ error: { code: "internal_error", message: "Server error" } }, 500);
    if (init.method === "DELETE") {
      calls.push(url);
      const key = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      rules = rules.filter((r) => r.merchant_key !== key || r.type !== url.searchParams.get("type"));
      return json({ ok: true });
    }
    return json({ items: rules });
  }) as typeof fetch;
});
afterEach(async () => {
  setSystemTime();
  cleanup();
  loading = false;
  releaseLoading?.();
  releaseLoading = undefined;
  globalThis.fetch = realFetch;
  clearMemoryCache();
  await clearCache();
  if (indexedDBDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDBDescriptor);
  else Reflect.deleteProperty(globalThis, "indexedDB");
});
describe("MerchantRules", () => {
  test("displays loading state", () => {
    loading = true;
    render(<MerchantRules />);
    expect(screen.getByText("로딩 중...")).toBeTruthy();
  });
  test("displays merchant, category, type and date", async () => {
    render(<MerchantRules />);
    await screen.findByText("급여");
    expect(screen.getAllByText("샘플카페")).toHaveLength(2);
    const item = screen.getByText("급여").closest("li");
    if (!item) throw new Error("Missing rule");
    expect(within(item).getByText("수입")).toBeTruthy();
    expect(within(item).getByText("1월 2일 00:00")).toBeTruthy();
    expect(screen.getByText("교통")).toBeTruthy();
  });
  test("deletes only the selected merchant type and removes it from UI", async () => {
    render(<MerchantRules />);
    await screen.findByText("급여");
    const requestFetch = globalThis.fetch;
    const refreshGate = Promise.withResolvers<void>();
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") await refreshGate.promise;
        return requestFetch(input, init);
      },
      { preconnect: realFetch.preconnect },
    );
    const removed = waitForElementToBeRemoved(() => screen.queryByText("식비"));
    try {
      fireEvent.click(screen.getByRole("button", { name: "샘플카페 지출 규칙 삭제" }));
      await screen.findByText("규칙을 삭제했어요");
      refreshGate.resolve();
      await removed;
      expect(calls).toHaveLength(1);
      expect(decodeURIComponent(calls[0]?.pathname ?? "")).toBe("/api/v1/merchant-rules/샘플카페");
      expect(calls[0]?.searchParams.get("type")).toBe("expense");
      expect(screen.queryByText("식비") === null).toBe(true);
      expect(screen.getByText("급여")).toBeTruthy();
      expect(screen.getAllByText("샘플카페")).toHaveLength(1);
    } finally {
      refreshGate.resolve();
      await removed;
      globalThis.fetch = requestFetch;
    }
  });
  test("empty state shows helpful message", async () => {
    rules = [];
    render(<MerchantRules />);
    expect(await screen.findByText("저장된 규칙이 없어요")).toBeTruthy();
  });
  test("error state retries loading", async () => {
    fail = true;
    render(<MerchantRules />);
    await screen.findByText("서버 오류가 발생했어요");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("급여")).toBeTruthy();
  });
  test("failed deletion retains the rule and reports an error", async () => {
    render(<MerchantRules />);
    await screen.findByText("급여");
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "샘플카페 수입 규칙 삭제" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("급여")).toBeTruthy();
  });
});
