import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App";
import { clearCache, readCache, readLastAuth, writeCache, writeLastAuth } from "./api/cache";
import { clearMemoryCache } from "./api/hooks";
import { flushOutbox, sendMutation } from "./api/outbox";
import { markNetwork, setCsrfToken } from "./api/transport";
import { reconnectOutbox } from "./features/offline/runtime";
import { storedRequest } from "./features/offline/storage";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function mockFetch(handler: Handler) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const signedOut = { authenticated: false, csrf_token: null, expires_at: null };
const signedIn = { authenticated: true, csrf_token: "csrf-1", expires_at: "2026-11-03T00:00:00+09:00" };
const summary = { income: 0, expense: 0, net: 0, count: 0 };
function dataResponse(url: string): Response {
  const path = new URL(url, "http://127.0.0.1").pathname;
  if (path.endsWith("/transactions")) return json({ items: [], totals: summary, next_cursor: null });
  if (path.endsWith("/settings")) {
    return json({ month_start_day: 1, owner_name: "", theme: "system", default_asset_id: null });
  }
  if (path.endsWith("/assets/summary")) return json({ assets: [], totals: { assets: 0, debts: 0, net_worth: 0 } });
  if (["/categories", "/assets", "/templates", "/merchant-rules"].some((suffix) => path.endsWith(suffix))) {
    return json({ items: [] });
  }
  return json(summary);
}

beforeEach(async () => {
  setCsrfToken("csrf-test-reset");
  history.replaceState(null, "", "/");
  localStorage.clear();
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
});
afterEach(async () => {
  cleanup();
  setCsrfToken("csrf-test-reset");
  markNetwork(true);
  mockFetch(dataResponse);
  await flushOutbox();
  globalThis.fetch = realFetch;
});

describe("App auth gate", () => {
  test("successful logout hides private UI, clears auth/cache and preserves unsent writes without replay", async () => {
    // Given: the full App and real durable queue, with a session endpoint that can auto-login.
    history.replaceState(null, "", "/settings");
    const lateMetadata = Promise.withResolvers<Response>();
    mockFetch((url, init) => {
      if (url.endsWith("/categories")) return lateMetadata.promise;
      return url.endsWith("auth/session") ? json(init.method === "DELETE" ? signedOut : signedIn) : dataResponse(url);
    });
    await act(async () => {
      render(<App />);
    });
    await flushOutbox();
    await writeCache("logout-private", { merchant: "테스트마트" });
    act(() => markNetwork(false));
    const request = { id: "logout-unsent", method: "POST", path: "transactions", body: { amount: 100 } } as const;
    await act(async () => {
      await sendMutation(request);
    });
    const queued = await storedRequest("outbox", "readonly", (store) => store.getAll());
    act(() => markNetwork(true));

    // When
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "로그아웃" }));
    });

    // Then
    expect(screen.queryByRole("navigation", { name: "하단 메뉴" })).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("접근 토큰")).toBeTruthy();
    expect(readLastAuth()).toBe(false);
    expect(await readCache("logout-private")).toBeUndefined();
    await act(async () => {
      lateMetadata.resolve(dataResponse("/categories"));
    });
    expect(await readCache("categories")).toBeUndefined();
    expect(new Headers(calls.find((call) => call.init.method === "DELETE")?.init.headers).get("X-CSRF-Token")).toBe(
      "csrf-1",
    );
    const afterLogout = calls.length;
    await reconnectOutbox();
    await flushOutbox();
    expect(calls).toHaveLength(afterLogout);
    expect(await storedRequest("outbox", "readonly", (store) => store.getAll())).toEqual(queued);
    cleanup();
    mockFetch(() => {
      throw new TypeError("Offline reopen");
    });
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByLabelText("접근 토큰")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "하단 메뉴" })).toBeNull();
  });

  test.each(["rejected", "offline"])(
    "logout %s keeps private UI and reports failure with retry available",
    async (failure) => {
      // Given
      history.replaceState(null, "", "/settings");
      mockFetch((url, init) => {
        if (url.endsWith("auth/session") && init.method === "DELETE") {
          if (failure === "offline") throw new TypeError("Offline");
          return json({ error: { code: "csrf", message: "CSRF token required" } }, 403);
        }
        return url.endsWith("auth/session") ? json(signedIn) : dataResponse(url);
      });
      await act(async () => {
        render(<App />);
      });
      await writeCache("logout-private", { merchant: "테스트마트" });
      // When
      fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
      await act(async () => {
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "로그아웃" }));
      });
      // Then
      expect(screen.getByRole("navigation", { name: "하단 메뉴" })).toBeTruthy();
      expect(screen.queryByLabelText("접근 토큰")).toBeNull();
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "로그아웃" }).hasAttribute("disabled"),
      ).toBe(false);
      expect(readLastAuth()).toBe(true);
      expect(await readCache<unknown>("logout-private")).toEqual({ merchant: "테스트마트" });
    },
  );

  test("unauthenticated shows the login screen and requests no data", async () => {
    mockFetch(() => json(signedOut));
    render(<App />);
    expect(await screen.findByLabelText("접근 토큰")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "하단 메뉴" })).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/auth/session"]);
  });

  test("authenticated shows the shell", async () => {
    mockFetch((url) => (url.endsWith("auth/session") ? json(signedIn) : dataResponse(url)));
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "하단 메뉴" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "가계부" })).toBeTruthy();
  });

  test("logging in posts the token and then uses the snake_case csrf_token on mutations", async () => {
    let loggedIn = false;
    mockFetch((url, init) => {
      if (url.endsWith("auth/session") && init.method === "POST") {
        loggedIn = true;
        return json(signedIn);
      }
      if (url.endsWith("auth/session")) return json(loggedIn ? signedIn : signedOut);
      return dataResponse(url);
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText("접근 토큰"), { target: { value: "synthetic-token" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("navigation", { name: "하단 메뉴" })).toBeTruthy();
    const post = calls.find((c) => c.init.method === "POST");
    expect(JSON.parse(String(post?.init.body))).toEqual({ token: "synthetic-token" });

    const { api } = await import("./api/client");
    await api.patchSettings({ month_start_day: 1 });
    const patch = calls.find((c) => c.init.method === "PATCH");
    expect(new Headers(patch?.init.headers).get("X-CSRF-Token")).toBe("csrf-1");
  });

  test("a wrong token shows an inline error and stays on login", async () => {
    mockFetch((_url, init) =>
      init.method === "POST"
        ? json({ error: { code: "unauthenticated", message: "Invalid token" } }, 401)
        : json(signedOut),
    );
    render(<App />);
    fireEvent.change(await screen.findByLabelText("접근 토큰"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByText("토큰이 맞지 않아요")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "하단 메뉴" })).toBeNull();
  });

  test("a network failure with a remembered session opens the shell offline, not the login screen", async () => {
    writeLastAuth(true);
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "하단 메뉴" })).toBeTruthy();
    expect(screen.getByText(/오프라인/)).toBeTruthy();
    expect(screen.queryByLabelText("접근 토큰")).toBeNull();
  });

  test("a network failure without a remembered session shows login with an offline note", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    render(<App />);
    expect(await screen.findByLabelText("접근 토큰")).toBeTruthy();
    expect(screen.getByText(/오프라인/)).toBeTruthy();
  });

  test("a 401 from a data request returns to the login screen", async () => {
    mockFetch((url) =>
      url.endsWith("auth/session")
        ? json(signedIn)
        : json({ error: { code: "unauthenticated", message: "Session required" } }, 401),
    );
    render(<App />);
    expect(await screen.findByLabelText("접근 토큰")).toBeTruthy();
  });
});
