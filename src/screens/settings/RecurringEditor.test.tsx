import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RecurringRule, TemplatePayload } from "../../../shared/schema";
import { clearCache, writeCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import RecurringEditor from "./RecurringEditor";

const realFetch = globalThis.fetch;
const payload: TemplatePayload = {
  type: "expense",
  amount: 10000,
  asset_id: "asset-1",
  to_asset_id: null,
  category_id: "cat-1",
  merchant: "테스트마트",
  memo: "정기 구입",
  is_refund: false,
};
const rule: RecurringRule = {
  id: "rule-1",
  template: { ...payload, type: "expense" },
  freq: "monthly",
  interval: 1,
  start_date: "2024-01-31",
  end_date: null,
  last_materialized_date: "2024-02-29",
  active: true,
  created_at: "",
  updated_at: "",
};
let rules = [rule];
let calls: { method: string; url: string; body: unknown }[] = [];
let fail = false;
let offline = false;
let hold = false;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  setSystemTime(new Date("2026-10-04T00:00:00Z"));
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  rules = [rule];
  calls = [];
  fail = false;
  offline = false;
  hold = false;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const body: unknown = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, url, body });
      if (hold) return new Promise<Response>(() => {});
      if (offline) throw new TypeError("offline");
      if (fail) return json({ error: { code: "invalid_input", message: "저장 실패" } }, 400);
      if (url.endsWith("/assets"))
        return json({
          items: [
            { id: "asset-1", name: "테스트통장" },
            { id: "asset-2", name: "테스트저축" },
          ],
        });
      if (url.endsWith("/categories"))
        return json({ items: [{ id: "cat-1", name: "식비", type: "expense", children: [] }] });
      if (url.endsWith("/recurring/run"))
        return json({ created: calls.filter((call) => call.url.endsWith("/run")).length === 1 ? 1 : 0 });
      if (method === "DELETE") {
        rules = [];
        return json({ ok: true });
      }
      return json(method === "GET" ? { items: rules } : rule);
    },
    { preconnect: realFetch.preconnect },
  );
});
afterEach(async () => {
  setSystemTime();
  cleanup();
  globalThis.fetch = realFetch;
  clearMemoryCache();
  await clearCache();
});

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
  });
};
async function openAdd() {
  await screen.findByText("반복 거래");
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await screen.findByLabelText("빈도");
  await screen.findByRole("option", { name: "테스트통장" });
}

describe("RecurringEditor real transport", () => {
  test("placeholder and loading status retain the screen heading", () => {
    hold = true;
    render(<RecurringEditor />);
    expect(screen.getByText("반복 거래")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });
  test("lists complete rule and anchored month-end next occurrence", async () => {
    render(<RecurringEditor />);
    expect(await screen.findByText("테스트마트")).toBeTruthy();
    expect(screen.getByText("다음: 2024년 3월 31일")).toBeTruthy();
  });
  test("opens add form and sends full weekly payload", async () => {
    render(<RecurringEditor />);
    await openAdd();
    change("거래 유형", "income");
    change("자산", "asset-1");
    change("금액", "5000");
    change("가맹점", "샘플수입");
    change("메모", "테스트 메모");
    change("빈도", "weekly");
    change("간격", "2");
    change("시작일", "2026-10-04");
    change("종료일 (선택)", "2026-12-31");
    await save();
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/recurring"))?.body).toEqual({
      template: {
        type: "income",
        amount: 5000,
        asset_id: "asset-1",
        category_id: null,
        to_asset_id: null,
        merchant: "샘플수입",
        memo: "테스트 메모",
        is_refund: false,
      },
      freq: "weekly",
      interval: 2,
      start_date: "2026-10-04",
      end_date: "2026-12-31",
      active: true,
    });
  });
  test("edits existing values and deactivates while clearing end date", async () => {
    rules = [{ ...rule, end_date: "2026-12-31" }];
    render(<RecurringEditor />);
    await screen.findByText("테스트마트");
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    expect(screen.getByLabelText<HTMLInputElement>("금액").value).toBe("10000");
    expect(screen.getByLabelText<HTMLInputElement>("시작일").value).toBe("2024-01-31");
    change("활성", "false");
    change("종료일 (선택)", "");
    await save();
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      template: payload,
      freq: "monthly",
      interval: 1,
      start_date: "2024-01-31",
      end_date: null,
      active: false,
    });
  });
  test("confirms deletion and removes the rule", async () => {
    render(<RecurringEditor />);
    await screen.findByText("테스트마트");
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "삭제" }));
    });
    expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/rule-1"))).toBe(true);
    expect(await screen.findByText("반복 규칙이 없어요")).toBeTruthy();
  });
  test("materializes now and displays repeated zero result", async () => {
    render(<RecurringEditor />);
    await screen.findByText("테스트마트");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "지금 반영" }));
    });
    expect(screen.getByText("1건 반영했어요")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "지금 반영" }));
    });
    expect(screen.getByText("0건 반영했어요")).toBeTruthy();
  });
  test("load error has retry and mutation error preserves form", async () => {
    fail = true;
    render(<RecurringEditor />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("테스트마트");
    await openAdd();
    fail = true;
    await save();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("저장 실패");
  });
  test("offline shows cached rules and disables writes", async () => {
    await writeCache("recurring", { items: [rule] });
    offline = true;
    render(<RecurringEditor />);
    expect(await screen.findByText(/오프라인/)).toBeTruthy();
    expect(await screen.findByText("테스트마트")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "지금 반영" }).disabled).toBe(true);
  });
  test("empty state provides first add action", async () => {
    rules = [];
    render(<RecurringEditor />);
    expect(await screen.findByText("반복 규칙이 없어요")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "첫 번째 규칙 추가" }));
    });
    expect(screen.getByLabelText("빈도")).toBeTruthy();
  });
  test("rejects zero fractional and excessive interval rather than silently coercing", async () => {
    render(<RecurringEditor />);
    await openAdd();
    for (const interval of ["0", "1.5", "367"]) {
      change("간격", interval);
      await save();
      expect(screen.getByLabelText("간격").getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(screen.getByLabelText("간격"));
    }
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
  test("rejects missing transfer destination and reversed end date", async () => {
    render(<RecurringEditor />);
    await openAdd();
    change("거래 유형", "transfer");
    await save();
    expect(screen.getByLabelText("받는 자산").getAttribute("aria-invalid")).toBe("true");
    change("받는 자산", "asset-2");
    change("시작일", "2026-10-04");
    change("종료일 (선택)", "2026-10-03");
    await save();
    expect(screen.getByLabelText("종료일 (선택)").getAttribute("aria-invalid")).toBe("true");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
  test("first date, leap year, interval and exhausted end are deterministic", async () => {
    rules = [
      { ...rule, id: "first", template: { ...payload, merchant: "첫 발생" }, last_materialized_date: null },
      {
        ...rule,
        id: "leap",
        template: { ...payload, merchant: "윤년" },
        freq: "yearly",
        start_date: "2024-02-29",
        last_materialized_date: "2027-02-28",
      },
      {
        ...rule,
        id: "interval",
        template: { ...payload, merchant: "두 달" },
        interval: 2,
        last_materialized_date: "2024-03-31",
      },
      { ...rule, id: "ended", template: { ...payload, merchant: "종료" }, end_date: "2024-02-29" },
    ];
    render(<RecurringEditor />);
    await screen.findByText("첫 발생");
    expect(screen.getByText("다음: 2024년 1월 31일")).toBeTruthy();
    expect(screen.getByText("다음: 2028년 2월 29일")).toBeTruthy();
    expect(screen.getByText("다음: 2024년 5월 31일")).toBeTruthy();
    expect(screen.getByText("다음: 종료")).toBeTruthy();
  });
});
