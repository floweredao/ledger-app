import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { calculateArcAngles, Donut } from "./Donut";

afterEach(cleanup);

describe("Donut chart", () => {
  test("legend percentage uses the displayed parent total rather than global share", () => {
    render(
      <Donut
        rows={[{ category_id: "dining", name: "테스트외식", icon: null, color: null, amount: 27000, pct: 47.1 }]}
        total={42000}
        type="expense"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "테스트외식, −27,000원, 64.3퍼센트" })).toBeTruthy();
  });

  test("positive category angles add up to one full circle", () => {
    const angles = calculateArcAngles([42000, 15300, 8700]);
    expect(Math.abs(angles.reduce((sum, angle) => sum + angle, 0) - 360)).toBeLessThanOrEqual(0.5);
  });

  test("zero data has an explicit empty message and no invalid number", () => {
    render(<Donut rows={[]} total={0} type="expense" onSelect={() => {}} />);
    expect(screen.getByText("표시할 분류가 없어요")).toBeTruthy();
    expect(document.body.innerText).not.toContain("NaN");
  });

  test("expense labels use a negative sign for outgoing money", () => {
    render(
      <Donut
        rows={[
          { category_id: "food", name: "식비", icon: null, color: "cat-3", amount: 42000, pct: 100, children: [] },
        ]}
        total={42000}
        type="expense"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "식비, −42,000원, 100.0퍼센트" })).toBeTruthy();
  });
});
