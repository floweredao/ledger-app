import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { clearCache } from "../api/cache";
import { clearMemoryCache } from "../api/hooks";
import { GETS } from "../features/entry/test-fixtures";
import { setLocale } from "../i18n";
import { AppShell } from "./AppShell";

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = realFetch;
  setLocale("ko");
});

test("shell follows English for navigation title and announcements", async () => {
  await clearCache();
  clearMemoryCache();
  history.replaceState(null, "", "/calendar?month=2026-10");
  setLocale("en");
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const path = String(input).replace("/api/v1/", "").split("?")[0] ?? "";
      return Response.json(GETS[path] ?? { items: [] });
    },
    { preconnect: realFetch.preconnect },
  );
  await act(async () =>
    render(
      <AppShell>
        <h1>Calendar</h1>
      </AppShell>,
    ),
  );
  const nav = screen.getByRole("navigation", { name: "Bottom navigation" });
  for (const name of ["Ledger", "Statistics", "Assets", "Settings"]) {
    expect(within(nav).getByRole("link", { name })).toBeTruthy();
  }
  expect(document.title).toBe("Calendar · Ledger");
  expect(screen.getByRole("status", { name: "Screen navigation" }).textContent).toBe("Calendar");
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});

test("the ledger home title is the app name once, not repeated", async () => {
  await clearCache();
  clearMemoryCache();
  history.replaceState(null, "", "/");
  setLocale("en");
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const path = String(input).replace("/api/v1/", "").split("?")[0] ?? "";
      return Response.json(GETS[path] ?? { items: [] });
    },
    { preconnect: realFetch.preconnect },
  );
  await act(async () =>
    render(
      <AppShell>
        <h1>Ledger</h1>
      </AppShell>,
    ),
  );
  expect(document.title).toBe("Ledger");
});
