import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { setLocale } from "../../i18n";
import { Bars } from "./Bars";
import { Donut } from "./Donut";

afterEach(() => {
  cleanup();
  setLocale("ko");
});

test("charts expose English summaries and localized amounts", () => {
  setLocale("en");
  render(
    <>
      <Bars
        buckets={[{ month: "2026-10", from: "2026-10-01", to: "2026-10-31", income: 0, expense: 4500, net: -4500 }]}
        type="expense"
        currentMonth="2026-10"
      />
      <Donut rows={[]} total={0} type="expense" onSelect={() => {}} />
    </>,
  );
  expect(screen.getByRole("img", { name: "12-month amount trend" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "October 2026 −₩4,500" })).toBeTruthy();
  expect(screen.getByText("No categories to show")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
