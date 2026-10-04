import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { readCache } from "./cache";
import { api, download, paths, upload } from "./client";
import { clearMemoryCache, useApi } from "./hooks";
import { markNetwork, setCsrfToken } from "./transport";

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];
let respond: (url: string, init: RequestInit) => Response = () => new Response("{}");

beforeEach(() => {
  calls = [];
  clearMemoryCache();
  markNetwork(true);
  setCsrfToken("csrf-x");
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const header = (i: number, name: string) => new Headers(calls[i]?.init.headers).get(name);
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("transaction mutations", () => {
  test("each create gets a fresh UUIDv7 idempotency key and carries its own transaction id", async () => {
    respond = () => new Response("{}", { status: 201 });
    const input = { type: "expense", amount: 4500, occurred_at: "2026-10-04T09:00:00+09:00" } as const;
    await api.createTransaction(input);
    await api.createTransaction(input);
    const keys = [header(0, "Idempotency-Key"), header(1, "Idempotency-Key")];
    expect(keys[0]).toMatch(UUID_V7);
    expect(keys[1]).toMatch(UUID_V7);
    expect(keys[0]).not.toBe(keys[1]);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.id).toMatch(UUID_V7);
    expect(body.amount).toBe(4500);
    expect(calls[0]?.url).toBe("/api/v1/transactions");
    expect(header(0, "X-CSRF-Token")).toBe("csrf-x");
    expect(header(0, "Content-Type")).toBe("application/json");
    expect(calls[0]?.init.credentials).toBe("same-origin");
  });

  test("patch, delete and restore go through the outbox path with idempotency keys", async () => {
    respond = () => new Response("{}");
    await api.patchTransaction("t1", { memo: "샘플" });
    await api.deleteTransaction("t1");
    await api.restoreTransaction("t1");
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "PATCH /api/v1/transactions/t1",
      "DELETE /api/v1/transactions/t1",
      "POST /api/v1/transactions/t1/restore",
    ]);
    for (const i of [0, 1, 2]) expect(header(i, "Idempotency-Key")).toMatch(UUID_V7);
  });
});

describe("upload and download", () => {
  test("upload sends multipart with CSRF and no explicit Content-Type", async () => {
    respond = () => new Response("{}");
    const form = new FormData();
    form.set("file", new File(["a,b"], "sample.csv", { type: "text/csv" }));
    await upload("import/preview", form);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(form);
    expect(header(0, "Content-Type")).toBeNull();
    expect(header(0, "X-CSRF-Token")).toBe("csrf-x");
  });

  test("download saves through an anchor with the server filename when share is unavailable", async () => {
    respond = () =>
      new Response("a,b", {
        headers: { "Content-Disposition": 'attachment; filename="ledger-20261004.csv"', "Content-Type": "text/csv" },
      });
    const clicked: string[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const created = spyOn(URL, "createObjectURL").mockImplementation(() => "blob:test");
    await download(paths.exportFile({ format: "csv", from: "2026-10-01", to: "2026-10-31" }));
    expect(calls[0]?.url).toBe("/api/v1/export?format=csv&from=2026-10-01&to=2026-10-31");
    expect(clicked).toEqual(["ledger-20261004.csv"]);
    click.mockRestore();
    created.mockRestore();
  });
});

function Probe({ path }: { path: string }) {
  const state = useApi<{ count: number }>(path);
  return (
    <output data-testid="probe">
      {state.loading ? "loading" : ""}|{state.data?.count ?? "none"}|{state.offline ? "offline" : "online"}|
      {state.error ? "error" : ""}
    </output>
  );
}

describe("useApi cache plumbing", () => {
  test("a successful GET is written to the cache under its key, and a network failure falls back to it", async () => {
    const key = paths.statsSummary({ from: "2026-10-01", to: "2026-10-31" });
    expect(key).toBe("stats/summary?from=2026-10-01&to=2026-10-31");
    respond = () => new Response(JSON.stringify({ count: 7 }));
    const first = render(<Probe path={key} />);
    expect((await screen.findByText(/\|7\|online/)).textContent).toContain("7");
    expect(calls[0]?.url).toBe(`/api/v1/${key}`);
    expect(await readCache<{ count: number }>(key)).toEqual({ count: 7 });
    first.unmount();

    clearMemoryCache();
    respond = () => {
      throw new TypeError("Failed to fetch");
    };
    render(<Probe path={key} />);
    expect((await screen.findByText(/\|7\|offline/)).textContent).not.toContain("error");
  });

  test("a network failure with nothing cached is an error, not data", async () => {
    respond = () => {
      throw new TypeError("Failed to fetch");
    };
    render(<Probe path="stats/summary?from=1999-01-01&to=1999-01-31" />);
    expect(await screen.findByText(/none\|offline\|\s*error/)).toBeTruthy();
  });
});
