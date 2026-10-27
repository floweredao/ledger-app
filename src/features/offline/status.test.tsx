import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import "fake-indexeddb/auto";
import { clearCache, writeCache } from "../../api/cache";
import { flushOutbox, sendMutation } from "../../api/outbox";
import { markNetwork } from "../../api/transport";
import { OfflineBanner } from "../../components/OfflineBanner";

afterEach(async () => {
  cleanup();
  await clearCache();
  markNetwork(true);
});

test("offline banner shows the persisted server time beside the real pending count", async () => {
  await clearCache();
  const savedAt = Date.parse("2026-10-01T01:02:03Z");
  const clock = spyOn(Date, "now").mockReturnValue(savedAt);
  const realFetch = globalThis.fetch;
  try {
    await writeCache("settings", { month_start_day: 1 });
    markNetwork(false);
    await sendMutation({ id: "offline-status-test", method: "POST", path: "transactions", body: {} });
    clock.mockReturnValue(savedAt + 86_400_000);
    const hydrated = new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector("time")) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Saved cache time did not hydrate"));
      }, 2000);
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await act(async () => {
      render(<OfflineBanner />);
    });
    await hydrated;
    const time = document.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-10-01T01:02:03.000Z");
    expect(screen.getByRole("status").textContent).toContain("동기화 대기 1건");
    expect(time?.textContent).toMatch(/2026.*10.*1.*10:02/);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-01T01:02:03.000Z");
  } finally {
    clock.mockRestore();
    globalThis.fetch = Object.assign(async () => Response.json({ ok: true }), { preconnect: realFetch.preconnect });
    markNetwork(true);
    await flushOutbox();
    globalThis.fetch = realFetch;
  }
});

test("while the persisted time is still loading the banner does not claim there is none", async () => {
  await writeCache("settings", { month_start_day: 1 });
  markNetwork(false);
  render(<OfflineBanner />);
  expect(screen.getByRole("status").textContent).not.toContain("시각 정보가 없어요");
  expect(await screen.findByText(/서버 자료 마지막 저장/)).toBeTruthy();
});
