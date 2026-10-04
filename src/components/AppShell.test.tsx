import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { clearCache } from "../api/cache";
import { clearMemoryCache, useApi } from "../api/hooks";
import { GETS, row } from "../features/entry/test-fixtures";
import { AppShell } from "./AppShell";

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
  test("renders a tab bar and a sidebar with the four destinations", () => {
    render(<AppShell>본문</AppShell>);
    for (const name of ["하단 메뉴", "사이드 메뉴"]) {
      const nav = screen.getByRole("navigation", { name });
      for (const label of ["가계부", "통계", "자산", "설정"]) {
        expect(within(nav).getByRole("link", { name: label })).toBeTruthy();
      }
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
    const add = within(tabs).getByRole("button", { name: "기록하기" });
    expect(add.getAttribute("aria-current")).toBeNull();
    fireEvent.click(add);
    expect(screen.getByRole("dialog", { name: "기록하기" })).toBeTruthy();
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
