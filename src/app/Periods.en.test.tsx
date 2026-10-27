import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { setLocale } from "../i18n";
import { formatMonth, formatRange } from "./periods";

afterEach(() => {
  cleanup();
  setLocale("ko");
});

test("app period labels render English through the existing formatter exports", () => {
  setLocale("en");
  render(
    <section>
      <h1>{formatMonth("2026-10")}</h1>
      <p>{formatRange({ from: "2026-10-01", to: "2026-10-31" })}</p>
    </section>,
  );
  expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
  expect(screen.getByText(/Oct 1.*Oct 31/)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
