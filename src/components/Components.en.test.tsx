import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { setLocale } from "../i18n";
import { AmountText } from "./AmountText";
import { MonthSwitcher } from "./MonthSwitcher";
import { PeriodPicker } from "./PeriodPicker";
import { Skeleton } from "./Skeleton";

afterEach(() => {
  cleanup();
  setLocale("ko");
});

test("shared amount and period components render English", () => {
  setLocale("en");
  render(
    <>
      <AmountText type="expense" amount={4500} />
      <MonthSwitcher value="2026-10" onChange={() => {}} />
      <PeriodPicker value={{ period: "custom", from: "2026-10-01", to: "2026-10-31" }} onChange={() => {}} />
      <Skeleton />
    </>,
  );
  expect(screen.getByText("Expense ₩4,500")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous month" })).toBeTruthy();
  expect(screen.getByText("October 2026")).toBeTruthy();
  expect(screen.getByLabelText("Start date")).toBeTruthy();
  expect(screen.getByText("Loading")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[가-힣]/);
});
