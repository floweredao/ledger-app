import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import { setLocale } from "../../i18n";
import MerchantRules from "./MerchantRules";
import RecurringEditor from "./RecurringEditor";
import SettingsScreen from "./SettingsScreen";
import TemplatesEditor from "./TemplatesEditor";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = originalFetch;
  setLocale("ko");
});

test("settings menu renders English", () => {
  setLocale("en");
  render(<SettingsScreen onLoggedOut={() => {}} />);
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(screen.getByText("Merchant rules")).toBeTruthy();
  expect(screen.getByText("Sign out")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});

for (const [Screen, title, empty] of [
  [MerchantRules, "Merchant rules", "No saved rules"],
  [RecurringEditor, "Recurring transactions", "No recurring rules"],
  [TemplatesEditor, "Templates", "No templates"],
] as const) {
  test(`${title} renders English with empty API fixtures`, async () => {
    setLocale("en");
    clearMemoryCache();
    markNetwork(true);
    globalThis.fetch = Object.assign(async () => Response.json({ items: [] }), {
      preconnect: originalFetch.preconnect,
    });
    render(<Screen />);
    expect(await screen.findByText(empty)).toBeTruthy();
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[가-힣]/);
  });
}
