import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearCache, writeCache } from "../../api/cache";
import { OfflineBanner } from "../../components/OfflineBanner";
import { setLocale } from "../../i18n";

afterEach(async () => {
  cleanup();
  await clearCache();
  setLocale("ko");
});

test("offline status follows English and keeps the persisted save time", async () => {
  await clearCache();
  await writeCache("settings", { month_start_day: 1 });
  setLocale("en");
  const hydrated = new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector("time")) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Cache save time did not hydrate"));
    }, 2000);
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await act(async () => {
    render(<OfflineBanner />);
  });
  await hydrated;
  expect(screen.getByRole("status").textContent).toContain("You're offline. Showing saved data.");
  expect(screen.getByRole("status").textContent).toContain("Last saved from server:");
  expect(screen.getByRole("status").textContent).toContain("0 records waiting to sync");
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
