import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as toastModule from "../components/Toast";
import { setLocale } from "../i18n";
import { apiErrorMessage } from "./client";
import { flushOutbox, sendMutation } from "./outbox";
import { ApiError, markNetwork } from "./transport";

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  markNetwork(true);
  setLocale("ko");
});

test("outbox renders English rejection copy instead of raw server text", async () => {
  const toastIds: number[] = [];
  const originalToast = toastModule.toast;
  const toastSpy = spyOn(toastModule, "toast").mockImplementation((options) => {
    const id = originalToast(options);
    toastIds.push(id);
    return id;
  });
  try {
    setLocale("en");
    globalThis.fetch = Object.assign(
      async () => Response.json({ error: { code: "invalid_input", message: "테스트 오류" } }, { status: 400 }),
      { preconnect: realFetch.preconnect },
    );
    markNetwork(true);
    await flushOutbox();
    markNetwork(false);
    await sendMutation({
      id: "english-outbox-rejection",
      method: "POST",
      path: "transactions",
      body: { id: "019a0000-0000-7000-8000-000000000001", type: "expense", amount: 4500 },
    });
    render(<toastModule.ToastRegion />);
    markNetwork(true);
    await act(async () => {
      await flushOutbox();
    });
    expect(screen.getByText("Removed a record that could not sync: Check the values you entered.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[가-힣]/);
  } finally {
    cleanup();
    for (const id of toastIds) toastModule.dismissToast(id);
    toastSpy.mockRestore();
  }
});

test("English API error copy maps known and unknown server codes", () => {
  setLocale("en");
  expect(apiErrorMessage(new ApiError(404, "not_found", "테스트 오류"))).toBe("This record couldn't be found.");
  expect(apiErrorMessage(new ApiError(500, "unrecognized_code", "테스트 오류"))).toBe(
    "Couldn't complete the request. Try again.",
  );
});
