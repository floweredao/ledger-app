import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import "fake-indexeddb/auto";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import { setLocale } from "../../i18n";
import DataScreen from "./DataScreen";

const realFetch = globalThis.fetch;
const payload = { last_run_at: null, last_result: null, last_error: null, next_run_at: null };

afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = realFetch;
  setLocale("ko");
});

test("DataScreen follows English system language without Korean UI copy", async () => {
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  history.replaceState(null, "", "/settings");
  setLocale("en");
  globalThis.fetch = Object.assign(async () => Response.json(payload), {
    preconnect: realFetch.preconnect,
  });
  await act(async () => {
    render(<DataScreen />);
  });
  expect(screen.getByText("Data", { exact: true })).toBeTruthy();
  expect(screen.getAllByText("Export").length).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
