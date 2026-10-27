import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import { setLocale } from "../../i18n";
import LoginScreen from "./LoginScreen";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  setLocale("ko");
  globalThis.fetch = originalFetch;
  clearMemoryCache();
});

test("login follows English system language without Korean UI copy", async () => {
  // Given an English system language and synthetic API data.
  setLocale("en");
  clearMemoryCache();
  history.replaceState(null, "", "/login");
  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
      }),
    { preconnect: originalFetch.preconnect },
  );
  // When the screen is rendered.
  render(<LoginScreen offline={false} onLoggedIn={() => {}} />);
  // Then its representative copy and all visible text follow English.
  expect(await screen.findByText("Sign in")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
