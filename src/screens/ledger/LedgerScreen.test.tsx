import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import LedgerScreen from "./LedgerScreen";

const realFetch = globalThis.fetch;
const totals = { income: 0, expense: 0, net: 0, count: 0 };
let ledgerView = "daily";
let settingsRead: ReturnType<typeof Promise.withResolvers<void>>;
const json = (value: unknown) => new Response(JSON.stringify(value));

beforeEach(async () => {
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  ledgerView = "daily";
  settingsRead = Promise.withResolvers<void>();
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://127.0.0.1");
      const path = url.pathname.replace("/api/v1/", "");
      if (path === "settings") {
        const response = json({
          month_start_day: 1,
          owner_name: "",
          theme: "system",
          default_asset_id: null,
          ledger_view: ledgerView,
        });
        const text = response.text.bind(response);
        response.text = async () => {
          const value = await text();
          settingsRead.resolve();
          return value;
        };
        return response;
      }
      if (path === "transactions") return json({ items: [], totals, next_cursor: null });
      if (path === "stats/calendar")
        return json({
          month: url.searchParams.get("month"),
          range: { from: "2026-10-01", to: "2026-10-31" },
          days: [],
        });
      if (path === "stats/trend") return json({ buckets: [] });
      if (path.startsWith("stats/")) return json(totals);
      return json({ items: [] });
    },
    { preconnect: realFetch.preconnect },
  );
});
afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = realFetch;
  history.replaceState(null, "", "/");
});

describe("ledger start tab", () => {
  test("opening the ledger lands on the tab chosen in settings", async () => {
    ledgerView = "calendar";
    history.replaceState(null, "", "/");
    render(<LedgerScreen />);
    await waitFor(() => expect(location.pathname).toBe("/calendar"));
    expect(screen.getByRole("link", { name: "달력" }).getAttribute("aria-current")).toBe("page");
  });

  test("an explicit daily link stays on the daily tab", async () => {
    ledgerView = "monthly";
    history.replaceState(null, "", "/?month=2026-10");
    render(<LedgerScreen />);
    await act(async () => {
      await settingsRead.promise;
    });
    expect(location.pathname).toBe("/");
  });

  test("the default setting keeps the daily tab", async () => {
    history.replaceState(null, "", "/");
    render(<LedgerScreen />);
    await act(async () => {
      await settingsRead.promise;
    });
    expect(location.pathname).toBe("/");
  });
});
