import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork, setCsrfToken } from "../../api/transport";
import { AppShell } from "../../components/AppShell";
import Preferences from "./Preferences";

const realFetch = globalThis.fetch;
let settings = { month_start_day: 1, owner_name: "", theme: "system", default_asset_id: null as string | null };
let writes: unknown[] = [];
let settingsRead: ReturnType<typeof Promise.withResolvers<void>>;
let assetsRead: ReturnType<typeof Promise.withResolvers<void>>;
let settingsWrite: ReturnType<typeof Promise.withResolvers<void>>;
const json = (value: unknown) => new Response(JSON.stringify(value));
beforeEach(async () => {
  clearMemoryCache();
  await clearCache();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  markNetwork(true);
  setCsrfToken("test-pref");
  settings = { month_start_day: 1, owner_name: "", theme: "system", default_asset_id: null };
  writes = [];
  settingsRead = Promise.withResolvers<void>();
  assetsRead = Promise.withResolvers<void>();
  settingsWrite = Promise.withResolvers<void>();
  const loaded = (value: unknown, signal: typeof settingsRead) => {
    const response = json(value);
    const text = response.text.bind(response);
    response.text = async () => {
      const value = await text();
      signal.resolve();
      return value;
    };
    return response;
  };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://127.0.0.1").pathname;
      if (path.endsWith("/settings")) {
        if (init?.method === "PATCH") {
          const patch = JSON.parse(String(init.body));
          writes.push(patch);
          settings = { ...settings, ...patch };
        }
        return loaded(settings, init?.method === "PATCH" ? settingsWrite : settingsRead);
      }
      if (path.endsWith("/assets"))
        return loaded({ items: [{ id: "asset-bank", name: "테스트통장", kind: "bank", hidden: false }] }, assetsRead);
      if (path.endsWith("/transactions"))
        return json({ items: [], totals: { income: 0, expense: 0, net: 0, count: 0 }, next_cursor: null });
      if (path.endsWith("/auth/session"))
        return json({ authenticated: true, csrf_token: "test-pref", expires_at: "2027-01-01" });
      return json({ items: [] });
    },
    { preconnect: realFetch.preconnect },
  );
});
afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = realFetch;
  document.documentElement.removeAttribute("data-theme");
});

describe("Preferences", () => {
  test("renders the screen title", () => {
    render(<Preferences />);
    expect(screen.getByText("환경 설정")).toBeTruthy();
  });
  test("shows loading state initially", () => {
    render(<Preferences />);
    expect(screen.getByText(/로드 중/i)).toBeTruthy();
  });
  test("component exports as default", () => {
    expect(typeof Preferences).toBe("function");
  });
  test("selects and persists a real default asset", async () => {
    render(<Preferences />);
    await act(async () => {
      await Promise.all([settingsRead.promise, assetsRead.promise]);
    });
    expect(screen.getByRole("option", { name: "테스트통장" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("기본 자산"), { target: { value: "asset-bank" } });
    fireEvent.change(screen.getByLabelText("월 시작일"), { target: { value: "25" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await settingsWrite.promise;
    });
    expect(screen.getByText("설정을 저장했어요")).toBeTruthy();
    expect(writes).toHaveLength(1);
    expect(settings).toMatchObject({ default_asset_id: "asset-bank", month_start_day: 25 });
  });
  test("a blank month start is rejected without writing settings", async () => {
    render(<Preferences />);
    await act(async () => {
      await Promise.all([settingsRead.promise, assetsRead.promise]);
    });
    fireEvent.change(screen.getByLabelText("월 시작일"), { target: { value: "" } });
    const form = screen.getByRole("button", { name: "저장" }).closest("form");
    if (!form) throw new Error("Settings form missing");
    fireEvent.submit(form);
    expect(await screen.findByText("1부터 28 사이의 숫자를 입력해요.")).toBeTruthy();
    expect(writes).toHaveLength(0);
  });
  test("the shell applies saved theme on another route and can return to system", async () => {
    settings.theme = "dark";
    const applied = waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
    render(<AppShell>홈 화면</AppShell>);
    await applied;
    expect(localStorage.getItem("ledger:theme")).toBe("dark");
    cleanup();
    clearMemoryCache();
    settings.theme = "system";
    const cleared = waitFor(() => expect(document.documentElement.hasAttribute("data-theme")).toBe(false));
    render(<AppShell>홈 화면</AppShell>);
    await cleared;
    expect(localStorage.getItem("ledger:theme")).toBeNull();
  });
});
