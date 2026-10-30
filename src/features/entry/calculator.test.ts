import { describe, expect, test } from "bun:test";
import { evaluateExpression, hasOperator, pressCalcKey } from "./form";

const typed = (keys: readonly Parameters<typeof pressCalcKey>[1][]) => keys.reduce(pressCalcKey, "");

describe("amount calculator", () => {
  test("8000+3500 evaluates to 11500", () => {
    const expression = typed(["8", "0", "0", "0", "+", "3", "5", "00"]);
    expect(expression).toBe("8000+3500");
    expect(evaluateExpression(expression)).toEqual({ ok: true, value: 11500 });
  });

  test("12000×3 evaluates to 36000 and × binds tighter than +", () => {
    expect(evaluateExpression("12000×3")).toEqual({ ok: true, value: 36000 });
    expect(evaluateExpression("1000+2000×3")).toEqual({ ok: true, value: 7000 });
    expect(evaluateExpression("10000−2500÷2")).toEqual({ ok: true, value: 8750 });
  });

  test("division rounds to whole won", () => {
    expect(evaluateExpression("10000÷3")).toEqual({ ok: true, value: 3333 });
  });

  test("division by zero is an error, not a number", () => {
    expect(evaluateExpression("5000÷0")).toEqual({ ok: false, reason: "divide_by_zero" });
  });

  test("a result at or below zero or above the maximum is rejected", () => {
    expect(evaluateExpression("1000−1000")).toEqual({ ok: false, reason: "not_positive" });
    expect(evaluateExpression("999999999999×10")).toEqual({ ok: false, reason: "too_large" });
  });

  test("a trailing operator is ignored and a repeated operator replaces the last one", () => {
    expect(typed(["5", "+", "×", "2"])).toBe("5×2");
    expect(evaluateExpression("5000+")).toEqual({ ok: true, value: 5000 });
    expect(typed(["+"])).toBe("");
  });

  test("backspace and clear edit the expression", () => {
    expect(typed(["1", "2", "+", "backspace", "backspace"])).toBe("1");
    expect(typed(["1", "2", "clear"])).toBe("");
    expect(hasOperator("12+3")).toBe(true);
    expect(hasOperator("123")).toBe(false);
  });

  test("leading zeros collapse inside each number", () => {
    expect(typed(["0", "0", "5", "+", "0", "7"])).toBe("5+7");
  });
});
