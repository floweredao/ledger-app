import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearCache } from "../../api/cache";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork } from "../../api/transport";
import { openEntry } from "../../app/entry-bridge";
import { setLocale } from "../../i18n";
import EntryHost from "./EntryHost";
import { GETS } from "./test-fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  clearMemoryCache();
  globalThis.fetch = realFetch;
  setLocale("ko");
});

test("entry follows English while preserving database names", async () => {
  await clearCache();
  clearMemoryCache();
  markNetwork(true);
  setLocale("en");
  const paths = ["categories", "assets", "settings", "templates", "merchant-rules", "transactions"];
  const reads = new Map(paths.map((path) => [path, Promise.withResolvers<void>()]));
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const path = String(input).replace("/api/v1/", "").split("?")[0] ?? "";
      const response = Response.json(GETS[path] ?? { items: [] });
      const text = response.text.bind(response);
      response.text = async () => {
        const body = await text();
        reads.get(path)?.resolve();
        return body;
      };
      return response;
    },
    { preconnect: realFetch.preconnect },
  );
  render(<EntryHost />);
  act(() => openEntry({ date: "2026-10-03" }));
  await act(async () => {
    await Promise.all([...reads.values()].map((read) => read.promise));
  });
  expect(screen.getByRole("dialog", { name: "Add record" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save & next" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Amount(, |$)/ }).textContent).toBe("Enter amount");
  expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  expect(screen.getByLabelText("Date")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Category(, |$)/ }));
  expect(screen.getByRole("button", { name: "식비" })).toBeTruthy();
  const copy = document.body.textContent?.replace(/식비|교통|테스트통장|샘플카드|샘플카페 아메리카노/g, "");
  expect(copy).not.toMatch(/[가-힣]/);
});
