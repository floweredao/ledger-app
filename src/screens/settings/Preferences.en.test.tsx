import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import "fake-indexeddb/auto";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import { setLocale } from "../../i18n";
import Preferences from "./Preferences";

const realFetch = globalThis.fetch;
const payload = { month_start_day: 1, owner_name: "", theme: "system", default_asset_id: null, ledger_view: "daily" };

afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = realFetch;
  setLocale("ko");
});

test("Preferences follows English system language without Korean UI copy", async () => {
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  history.replaceState(null, "", "/settings");
  setLocale("en");
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => Response.json(String(input).includes("assets") ? { items: [] } : payload),
    {
      preconnect: realFetch.preconnect,
    },
  );
  await act(async () => {
    render(<Preferences />);
  });
  expect(screen.getByText("Preferences", { exact: true })).toBeTruthy();
  expect(screen.getByLabelText("Month start day")).toBeTruthy();
  // The language picker names Korean in Korean (lang="ko"); every other string must be English.
  const copy = document.body.cloneNode(true) as HTMLElement;
  for (const endonym of copy.querySelectorAll('[lang="ko"]')) endonym.remove();
  expect(copy.textContent).not.toMatch(/[가-힣]/);
  expect(screen.getByLabelText("Language")).toBeTruthy();
});
