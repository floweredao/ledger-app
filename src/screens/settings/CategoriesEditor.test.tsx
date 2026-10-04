import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import { indexedDB as testIndexedDB } from "fake-indexeddb";
import type { Category, CategoryNode } from "../../../shared/schema";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import CategoriesEditor from "./CategoriesEditor";

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const category = (id: string, name: string, overrides: Partial<Category> = {}): Category => ({
  id,
  name,
  type: "expense",
  parent_id: null,
  icon: "utensils",
  color: "cat-1",
  sort: 0,
  hidden: false,
  created_at: "2026-01-01T00:00:00+09:00",
  updated_at: "2026-01-01T00:00:00+09:00",
  ...overrides,
});
let rows: Category[];
let calls: { url: URL; method: string; body: Record<string, unknown> }[];
let conflict: boolean;
let fail: boolean;
let loading: boolean;
let releaseLoading: (() => void) | undefined;
let indexedDBDescriptor: PropertyDescriptor | undefined;

function tree(): CategoryNode[] {
  return rows
    .filter((c) => c.parent_id === null)
    .map((c) => ({
      ...c,
      children: rows.filter((child) => child.parent_id === c.id).sort((a, b) => a.sort - b.sort),
    }))
    .sort((a, b) => a.sort - b.sort);
}
beforeEach(async () => {
  cleanup();
  indexedDBDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: testIndexedDB });
  history.replaceState(null, "", "/settings/categories");
  localStorage.clear();
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  rows = [
    category("food", "식비"),
    category("dining", "외식", { parent_id: "food" }),
    category("transport", "교통", { sort: 1 }),
    category("salary", "급여", { type: "income" }),
  ];
  calls = [];
  conflict = false;
  fail = false;
  loading = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), location.origin);
    const method = init.method ?? "GET";
    const body: Record<string, unknown> = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method, body });
    if (loading)
      await new Promise<void>((resolve) => {
        releaseLoading = resolve;
      });
    if (fail) return json({ error: { code: "internal_error", message: "Server error" } }, 500);
    if (method === "GET") {
      const type = url.searchParams.get("type");
      return json({ items: tree().filter((c) => !type || c.type === type) });
    }
    if (url.pathname.endsWith("/reorder")) {
      const ids = body.ids as string[];
      for (const [sort, id] of ids.entries()) rows = rows.map((c) => (c.id === id ? { ...c, sort } : c));
      return json({ ok: true });
    }
    if (method === "POST") {
      const added = category("added", String(body.name), {
        type: body.type as Category["type"],
        parent_id: typeof body.parent_id === "string" ? body.parent_id : null,
        icon: String(body.icon),
        color: body.color === null ? null : String(body.color),
        sort: 2,
      });
      rows.push(added);
      return json(added, 201);
    }
    const id = url.pathname.split("/").at(-1);
    if (method === "PATCH") {
      rows = rows.map((c) => (c.id === id ? { ...c, ...body } : c));
      return json(rows.find((c) => c.id === id));
    }
    if (conflict && !url.searchParams.has("reassign_to"))
      return json({ error: { code: "in_use", message: "Category is referenced" } }, 409);
    rows = rows.filter((c) => c.id !== id);
    return json({ ok: true });
  }) as typeof fetch;
});
afterEach(async () => {
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
const mutations = () => calls.filter((c) => c.method !== "GET");
async function row(name: string) {
  const el = (await screen.findByText(name)).closest(".category-item");
  if (!(el instanceof HTMLElement)) throw new Error("Missing category row");
  return within(el);
}
async function edit(name = "식비") {
  fireEvent.click((await row(name)).getByRole("button", { name: `${name} 편집` }));
  return screen.getByRole("dialog");
}
async function save() {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
}

describe("CategoriesEditor", () => {
  test("displays loading state while fetching categories", () => {
    loading = true;
    render(<CategoriesEditor />);
    expect(screen.getByText("로딩 중...")).toBeTruthy();
  });
  test("displays actual root and child tree with indentation", async () => {
    render(<CategoriesEditor />);
    expect((await screen.findByText("식비")).closest(".level-0")).toBeTruthy();
    expect((await screen.findByText("외식")).closest(".level-1")).toBeTruthy();
    expect(await screen.findByText("교통")).toBeTruthy();
    expect(calls[0]?.url.searchParams.get("include_hidden")).toBe("true");
  });
  test("switches between expense and income trees", async () => {
    render(<CategoriesEditor />);
    await screen.findByText("식비");
    fireEvent.click(screen.getByRole("button", { name: "수입" }));
    expect(await screen.findByText("급여")).toBeTruthy();
    expect(screen.queryByText("식비")).toBeNull();
  });
  test("renames and edits icon and parent palette color", async () => {
    render(<CategoriesEditor />);
    await edit();
    fireEvent.change(screen.getByLabelText("분류 이름"), { target: { value: "밥값" } });
    fireEvent.click(screen.getByRole("button", { name: "아이콘 coffee" }));
    fireEvent.click(screen.getByRole("button", { name: "색상 8" }));
    await save();
    await screen.findByText("밥값");
    expect(mutations()[0]?.body).toEqual({ name: "밥값", icon: "coffee", color: "cat-8" });
  });
  test("empty name reports inline error without server mutation", async () => {
    render(<CategoriesEditor />);
    await edit();
    fireEvent.change(screen.getByLabelText("분류 이름"), { target: { value: "  " } });
    await save();
    expect(screen.getByLabelText("분류 이름").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("이름을 입력해 주세요")).toBeTruthy();
    expect(mutations()).toHaveLength(0);
  });
  test("composition Enter does not submit the editor", async () => {
    render(<CategoriesEditor />);
    await edit();
    fireEvent.keyDown(screen.getByLabelText("분류 이름"), { key: "Enter", isComposing: true });
    expect(mutations()).toHaveLength(0);
  });
  test("adds a parent with actual category input", async () => {
    render(<CategoriesEditor />);
    await screen.findByText("식비");
    fireEvent.click(screen.getByRole("button", { name: "분류 추가" }));
    fireEvent.change(screen.getByLabelText("분류 이름"), { target: { value: "쇼핑" } });
    await save();
    await screen.findByText("쇼핑");
    expect(mutations()[0]?.body).toEqual({ type: "expense", name: "쇼핑", icon: "tag", color: "cat-1" });
  });
  test("adds a child with matching parent and inherited color", async () => {
    render(<CategoriesEditor />);
    fireEvent.click((await row("식비")).getByRole("button", { name: "식비 하위 분류 추가" }));
    expect(screen.queryByRole("button", { name: "색상 8" })).toBeNull();
    fireEvent.change(screen.getByLabelText("분류 이름"), { target: { value: "샘플카페" } });
    await save();
    await screen.findByText("샘플카페");
    expect(mutations()[0]?.body).toEqual({
      type: "expense",
      parent_id: "food",
      name: "샘플카페",
      icon: "tag",
      color: null,
    });
  });
  test("reorders roots upward with only same-type siblings", async () => {
    render(<CategoriesEditor />);
    fireEvent.click((await row("교통")).getByRole("button", { name: "교통 위로" }));
    await screen.findByText("순서를 변경했어요");
    expect(mutations()[0]?.body).toEqual({ ids: ["transport", "food"] });
  });
  test("reorders children downward with only siblings", async () => {
    rows.push(category("snack", "간식", { parent_id: "food", sort: 1 }));
    render(<CategoriesEditor />);
    fireEvent.click((await row("외식")).getByRole("button", { name: "외식 아래로" }));
    await screen.findByText("순서를 변경했어요");
    expect(mutations()[0]?.body).toEqual({ ids: ["snack", "dining"] });
  });
  test("toggles hidden categories both ways and keeps them visible in settings", async () => {
    render(<CategoriesEditor />);
    fireEvent.click((await row("식비")).getByRole("checkbox", { name: "식비 숨김" }));
    await screen.findByText("분류를 숨겼어요");
    expect(mutations()[0]?.body).toEqual({ hidden: true });
    fireEvent.click((await row("식비")).getByRole("checkbox", { name: "식비 숨김" }));
    await screen.findByText("분류를 표시했어요");
    expect(mutations()[1]?.body).toEqual({ hidden: false });
  });
  test("safe delete requires confirmation", async () => {
    render(<CategoriesEditor />);
    fireEvent.click((await row("외식")).getByRole("button", { name: "외식 삭제" }));
    expect(mutations()).toHaveLength(0);
    const requestFetch = globalThis.fetch;
    const refreshGate = Promise.withResolvers<void>();
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") await refreshGate.promise;
        return requestFetch(input, init);
      },
      { preconnect: realFetch.preconnect },
    );
    const removed = waitForElementToBeRemoved(() => screen.queryByText("외식"));
    try {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
      await screen.findByText("분류를 삭제했어요");
      refreshGate.resolve();
      await removed;
      expect(screen.queryByText("외식") === null).toBe(true);
    } finally {
      refreshGate.resolve();
      await removed;
      globalThis.fetch = requestFetch;
    }
  });
  test("409 offers valid reassignment and sends reassign_to query", async () => {
    conflict = true;
    render(<CategoriesEditor />);
    fireEvent.click((await row("식비")).getByRole("button", { name: "식비 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
    const select = await screen.findByLabelText("다른 분류로 옮기기");
    expect(within(select).queryByRole("option", { name: "급여" })).toBeNull();
    expect(within(select).queryByRole("option", { name: "외식" })).toBeNull();
    fireEvent.change(select, { target: { value: "transport" } });
    fireEvent.click(screen.getByRole("button", { name: "옮기고 삭제" }));
    await screen.findByText("분류를 삭제했어요");
    expect(mutations()[1]?.url.searchParams.get("reassign_to")).toBe("transport");
  });
  test("error state retries the real fetch", async () => {
    fail = true;
    render(<CategoriesEditor />);
    await screen.findByText("서버 오류가 발생했어요");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("외식")).toBeTruthy();
  });
  test("empty tree still offers creation", async () => {
    rows = [];
    render(<CategoriesEditor />);
    expect(await screen.findByText("등록된 분류가 없어요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "분류 추가" })).toBeTruthy();
  });
});
