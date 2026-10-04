import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Template } from "../../../shared/schema";
import { clearCache, writeCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import TemplatesEditor from "./TemplatesEditor";

const realFetch = globalThis.fetch;
const template: Template = {
  id: "tmpl-1",
  name: "샘플카페",
  payload: {
    type: "expense",
    amount: 5000,
    asset_id: "asset-1",
    to_asset_id: null,
    category_id: "cat-1",
    merchant: "샘플카페",
    memo: "테스트 메모",
    is_refund: false,
  },
  sort: 0,
  use_count: 5,
  created_at: "",
  updated_at: "",
};
let templates: Template[] = [];
let calls: { method: string; url: string; body: unknown }[] = [];
let fail = false;
let offline = false;
let hold = false;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(async () => {
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  templates = [template];
  calls = [];
  fail = false;
  offline = false;
  hold = false;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input),
        method = init.method ?? "GET";
      const body: unknown = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
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
      if (url.endsWith("/use")) {
        templates = templates.map((item) => ({ ...item, use_count: item.use_count + 1 }));
        return json({ id: "tx-1" });
      }
      if (method === "DELETE") {
        templates = [];
        return json({ ok: true });
      }
      if (
        method === "PATCH" &&
        typeof body === "object" &&
        body !== null &&
        "sort" in body &&
        typeof body.sort === "number"
      ) {
        const sort = body.sort;
        templates = templates
          .map((item) => (url.endsWith(`/${item.id}`) ? { ...item, sort } : item))
          .sort((a, b) => a.sort - b.sort);
      }
      return json(method === "GET" ? { items: templates } : template);
    },
    { preconnect: realFetch.preconnect },
  );
});
afterEach(async () => {
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
  await screen.findByText("자주 쓰는 내역");
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await screen.findByLabelText("이름");
  await screen.findByRole("option", { name: "테스트통장" });
}
describe("TemplatesEditor real transport", () => {
  test("selects a child category from the actual nested category contract", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (String(input).endsWith("/categories"))
          return json({
            items: [
              {
                id: "cat-1",
                name: "식비",
                type: "expense",
                children: [{ id: "child-1", name: "외식", type: "expense" }],
              },
            ],
          });
        return previousFetch(input, init);
      },
      { preconnect: realFetch.preconnect },
    );
    render(<TemplatesEditor />);
    await openAdd();
    expect(await screen.findByRole("option", { name: "식비 / 외식" })).toBeTruthy();
    change("이름", "테스트 외식");
    change("분류", "child-1");
    await save();
    const call = calls.find((call) => call.method === "POST");
    expect(call?.body).toMatchObject({ payload: { category_id: "child-1" } });
  });
  test("placeholder and loading status retain screen heading", () => {
    hold = true;
    render(<TemplatesEditor />);
    expect(screen.getByText("자주 쓰는 내역")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });
  test("lists templates and exact use counts", async () => {
    render(<TemplatesEditor />);
    expect(await screen.findByText("샘플카페")).toBeTruthy();
    expect(screen.getByText("5,000원 · 사용됨 5회")).toBeTruthy();
  });
  test("opens add form and creates full transfer payload", async () => {
    render(<TemplatesEditor />);
    await openAdd();
    change("이름", "테스트 이체");
    change("거래 유형", "transfer");
    change("금액", "12000");
    change("자산", "asset-1");
    change("받는 자산", "asset-2");
    change("가맹점", "테스트이체");
    change("메모", "저축");
    await save();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "테스트 이체",
      sort: 1,
      payload: {
        type: "transfer",
        amount: 12000,
        asset_id: "asset-1",
        to_asset_id: "asset-2",
        category_id: null,
        merchant: "테스트이체",
        memo: "저축",
        is_refund: false,
      },
    });
  });
  test("editing hydrates all saved fields and preserves payload", async () => {
    render(<TemplatesEditor />);
    await screen.findByText("샘플카페");
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    expect(screen.getByLabelText<HTMLInputElement>("이름").value).toBe("샘플카페");
    expect(screen.getByLabelText<HTMLInputElement>("메모").value).toBe("테스트 메모");
    change("이름", "샘플카페 수정");
    await save();
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      name: "샘플카페 수정",
      payload: template.payload,
    });
  });
  test("confirm deletion removes template", async () => {
    render(<TemplatesEditor />);
    await screen.findByText("샘플카페");
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "삭제" }));
    });
    expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/tmpl-1"))).toBe(true);
    expect(await screen.findByText("템플릿이 없어요")).toBeTruthy();
  });
  test("reorder controls send distinct integers and retain requested order despite ties", async () => {
    templates = [template, { ...template, id: "tmpl-2", name: "테스트점심", sort: 0 }];
    render(<TemplatesEditor />);
    await screen.findByText("테스트점심");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "아래로" }));
    });
    expect(calls.filter((call) => call.method === "PATCH").map((call) => ({ url: call.url, body: call.body }))).toEqual(
      [
        { url: "/api/v1/templates/tmpl-2", body: { sort: 0 } },
        { url: "/api/v1/templates/tmpl-1", body: { sort: 1 } },
      ],
    );
    expect(screen.getAllByTestId("template-row").map((row) => row.getAttribute("data-id"))).toEqual([
      "tmpl-2",
      "tmpl-1",
    ]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "위로" }));
    });
    expect(screen.getAllByTestId("template-row").map((row) => row.getAttribute("data-id"))).toEqual([
      "tmpl-1",
      "tmpl-2",
    ]);
  });
  test("use creates transaction and refreshes count", async () => {
    render(<TemplatesEditor />);
    await screen.findByText("샘플카페");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "기록하기" }));
    });
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/tmpl-1/use"))).toBe(true);
    expect(await screen.findByText("5,000원 · 사용됨 6회")).toBeTruthy();
  });
  test("load error supports retry and rejected save preserves draft", async () => {
    fail = true;
    render(<TemplatesEditor />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("샘플카페");
    await openAdd();
    change("이름", "테스트");
    fail = true;
    await save();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("저장 실패");
  });
  test("offline retains cached data and disables edits", async () => {
    await writeCache("templates", { items: [template] });
    offline = true;
    render(<TemplatesEditor />);
    expect(await screen.findByText(/오프라인/)).toBeTruthy();
    expect(screen.getByText("샘플카페")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "편집" }).disabled).toBe(true);
  });
  test("empty state opens first template editor", async () => {
    templates = [];
    render(<TemplatesEditor />);
    expect(await screen.findByText("템플릿이 없어요")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "첫 번째 템플릿 추가" }));
    });
    expect(screen.getByLabelText("이름")).toBeTruthy();
  });
  test("rejects blank name and missing or identical transfer destination", async () => {
    render(<TemplatesEditor />);
    await openAdd();
    await save();
    expect(screen.getByLabelText("이름").getAttribute("aria-invalid")).toBe("true");
    change("이름", "테스트");
    change("거래 유형", "transfer");
    await save();
    expect(screen.getByLabelText("받는 자산").getAttribute("aria-invalid")).toBe("true");
    change("자산", "asset-1");
    change("받는 자산", "asset-1");
    await save();
    expect(screen.getByLabelText("받는 자산").getAttribute("aria-invalid")).toBe("true");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
});
