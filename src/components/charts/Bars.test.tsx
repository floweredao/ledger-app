import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { StatsTrend } from "../../../shared/schema";
import { Bars } from "./Bars";

afterEach(cleanup);

const buckets: StatsTrend["buckets"] = Array.from({ length: 12 }, (_, index) => {
  const month = `2026-${String(index + 1).padStart(2, "0")}`;
  return {
    month,
    from: `${month}-01`,
    to: `${month}-28`,
    income: (index + 1) * 1000,
    expense: (index + 1) * 500,
    net: (index + 1) * 500,
  };
});

describe("Bars chart", () => {
  test("shows a tabular value when a month is focused", () => {
    render(<Bars buckets={buckets} type="expense" currentMonth="2026-12" />);
    expect(screen.getAllByRole("button")).toHaveLength(12);
    fireEvent.focus(screen.getByRole("button", { name: "2026년 3월 −1,500원" }));
    expect(screen.getByText("2026년 3월 · −1,500원")).toBeTruthy();
  });
});
