import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Search, X } from "lucide-react";
import { clearCache } from "../api/cache";
import { clearMemoryCache, useApi } from "../api/hooks";
import { GETS, row } from "../features/entry/test-fixtures";
import { Link, navigate } from "../router";
import { AppShell } from "./AppShell";
import { IconButton } from "./Button";

const originalFetch = globalThis.fetch;
let newRecord = false;
beforeEach(async () => {
  history.replaceState(null, "", "/calendar?month=2026-10");
  clearMemoryCache();
  await clearCache();
  newRecord = false;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://127.0.0.1").pathname.replace("/api/v1/", "");
      const body =
        path === "transactions"
          ? {
              items: newRecord ? [row] : [],
              totals: {
                income: 0,
                expense: newRecord ? row.amount : 0,
                net: newRecord ? -row.amount : 0,
                count: newRecord ? 1 : 0,
              },
              next_cursor: null,
            }
          : (GETS[path] ?? { items: [] });
      return new Response(JSON.stringify(body));
    },
    { preconnect: originalFetch.preconnect },
  );
});
afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = originalFetch;
});

function TransactionCount() {
  const state = useApi<{ items: unknown[] }>("transactions");
  return <output>{state.data ? `거래 ${state.data.items.length}` : "불러오는 중"}</output>;
}

describe("AppShell navigation", () => {
  test("renders a tab bar and a sidebar with the five destinations in order", () => {
    render(<AppShell>본문</AppShell>);
    for (const name of ["하단 메뉴", "사이드 메뉴"]) {
      const nav = screen.getByRole("navigation", { name });
      expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
        "가계부",
        "통계",
        "예산",
        "자산",
        "더보기",
      ]);
    }
    expect(screen.getByRole("main").textContent).toBe("본문");
  });

  test("marks the ledger section current on a ledger sub-route, by aria-current", () => {
    render(<AppShell>본문</AppShell>);
    const tabs = screen.getByRole("navigation", { name: "하단 메뉴" });
    expect(within(tabs).getByRole("link", { name: "가계부" }).getAttribute("aria-current")).toBe("page");
    expect(within(tabs).getByRole("link", { name: "통계" }).getAttribute("aria-current")).toBeNull();
  });

  test("the add command is a button, never the current tab, and opens the entry host", () => {
    render(<AppShell>본문</AppShell>);
    const tabs = screen.getByRole("navigation", { name: "하단 메뉴" });
    expect(within(tabs).getAllByRole("link")).toHaveLength(5);
    expect(within(tabs).queryByRole("button") === null).toBe(true);
    const add = screen
      .getAllByRole("button", { name: "기록하기" })
      .find((button) => button.classList.contains("record-fab"));
    if (!add) throw new Error("Missing one-tap record command");
    expect(add.closest("nav")).toBeNull();
    expect(add.getAttribute("aria-current")).toBeNull();
    fireEvent.click(add);
    expect(screen.getByRole("dialog", { name: "기록하기" })).toBeTruthy();
  });

  test("section tabs restore the last URL and scroll, while active tabs and fresh links start over", () => {
    history.replaceState(null, "", "/calendar?month=2026-02&day=2026-02-17&q=a%20b");
    const scroll = spyOn(window, "scrollTo");
    const scrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    const height = Object.getOwnPropertyDescriptor(document.documentElement, "scrollHeight");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 412 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2400 });
    try {
      render(
        <AppShell>
          <h1>화면</h1>
          <Link to="/calendar?month=2026-01">새 달력</Link>
        </AppShell>,
      );
      const tabs = screen.getByRole("navigation", { name: "하단 메뉴" });
      fireEvent.click(within(tabs).getByRole("link", { name: "자산" }));
      Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
      fireEvent.click(within(tabs).getByRole("link", { name: "가계부" }));
      expect(location.pathname + location.search).toBe("/calendar?month=2026-02&day=2026-02-17&q=a%20b");
      expect(scroll).toHaveBeenLastCalledWith(0, 412);
      fireEvent.click(within(tabs).getByRole("link", { name: "가계부" }));
      expect(location.pathname + location.search).toBe("/");
      expect(scroll).toHaveBeenLastCalledWith(0, 0);
      fireEvent.click(screen.getByRole("link", { name: "새 달력" }));
      expect(location.search).toBe("?month=2026-01");
      expect(scroll).toHaveBeenLastCalledWith(0, 0);
    } finally {
      scroll.mockRestore();
      if (scrollY) Object.defineProperty(window, "scrollY", scrollY);
      else Reflect.deleteProperty(window, "scrollY");
      if (height) Object.defineProperty(document.documentElement, "scrollHeight", height);
      else Reflect.deleteProperty(document.documentElement, "scrollHeight");
    }
  });

  test("sidebar returns to the last settings sub-route instead of its root", () => {
    history.replaceState(null, "", "/settings/preferences");
    render(<AppShell>본문</AppShell>);
    const sidebar = screen.getByRole("navigation", { name: "사이드 메뉴" });
    fireEvent.click(within(sidebar).getByRole("link", { name: "통계" }));
    fireEvent.click(within(sidebar).getByRole("link", { name: "더보기" }));
    expect(location.pathname).toBe("/settings/preferences");
  });

  test("explicit route changes update title, announce once, and focus main without stealing filter focus", async () => {
    render(
      <AppShell>
        <input aria-label="필터" />
      </AppShell>,
    );
    const announcements = screen.getByRole("status", { name: "화면 이동 안내" });
    const changes: string[] = [];
    const observer = new MutationObserver(() => changes.push(announcements.textContent ?? ""));
    observer.observe(announcements, { subtree: true, childList: true, characterData: true });
    try {
      for (const [path, label] of [
        ["/stats", "통계"],
        ["/assets", "자산"],
        ["/settings", "설정"],
      ] as const) {
        const before = changes.length;
        await act(async () => navigate(path));
        expect(document.title).toContain(label);
        expect(announcements.textContent).toBe(label);
        expect(changes.length).toBe(before + 1);
        expect(document.activeElement === screen.getByRole("main")).toBe(true);
      }
      const input = screen.getByRole("textbox", { name: "필터" });
      input.focus();
      const before = changes.length;
      await act(async () => navigate("/settings?filter=1", { replace: true }));
      expect(document.activeElement).toBe(input);
      expect(changes.length).toBe(before);
    } finally {
      observer.disconnect();
    }
  });

  test("tabs, sidebar, search and close icons share one stroke width", () => {
    const { container } = render(
      <AppShell>
        <IconButton label="검색" icon={Search} />
        <IconButton label="닫기" icon={X} />
      </AppShell>,
    );
    const icons = [...container.querySelectorAll(".tabbar svg, .sidebar svg, .icon-btn svg")];
    expect(icons.length).toBeGreaterThan(8);
    expect(new Set(icons.map((icon) => icon.getAttribute("stroke-width")))).toEqual(new Set(["2"]));
  });

  test("clicking a tab navigates and moves the current marker", () => {
    render(<AppShell>본문</AppShell>);
    const tabs = screen.getByRole("navigation", { name: "하단 메뉴" });
    fireEvent.click(within(tabs).getByRole("link", { name: "자산" }));
    expect(location.pathname).toBe("/assets");
    expect(within(tabs).getByRole("link", { name: "자산" }).getAttribute("aria-current")).toBe("page");
  });

  test("returning to the visible app refreshes server-side transaction changes", async () => {
    render(
      <AppShell>
        <TransactionCount />
      </AppShell>,
    );
    await screen.findByText("거래 0");
    newRecord = true;
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByText("거래 1")).toBeTruthy();
  });
});
