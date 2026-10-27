import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import { setLocale } from "../../i18n";
import AssetsScreen from "./AssetsScreen";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  setLocale("ko");
  globalThis.fetch = originalFetch;
  clearMemoryCache();
});

test("assets follows English system language without Korean UI copy", async () => {
  // Given an English system language and synthetic API data.
  setLocale("en");
  clearMemoryCache();
  history.replaceState(null, "", "/assets");
  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ assets: [], totals: { assets: 0, debts: 0, net_worth: 0 } }), {
        headers: { "Content-Type": "application/json" },
      }),
    { preconnect: originalFetch.preconnect },
  );
  // When the screen is rendered.
  render(<AssetsScreen />);
  // Then its representative copy and all visible text follow English.
  expect(await screen.findByText("No assets yet")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
