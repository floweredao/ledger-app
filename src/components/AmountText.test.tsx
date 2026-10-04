import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { AmountText } from "./AmountText";

afterEach(cleanup);

function shown(node: HTMLElement) {
  return node.querySelector("[aria-hidden='true']")?.textContent;
}

describe("AmountText", () => {
  test("expense is minus-signed and labelled 지출", () => {
    const { container } = render(<AmountText type="expense" amount={4500} />);
    const el = container.firstElementChild as HTMLElement;
    expect(shown(el)).toBe("-4,500원");
    expect(el.textContent).toContain("지출 4,500원");
  });

  test("income is plus-signed and labelled 수입", () => {
    const { container } = render(<AmountText type="income" amount={1200000} />);
    const el = container.firstElementChild as HTMLElement;
    expect(shown(el)).toBe("+1,200,000원");
    expect(el.textContent).toContain("수입 1,200,000원");
  });

  test("refund is plus-signed and labelled 환불, not colour only", () => {
    const { container } = render(<AmountText type="expense" amount={3000} isRefund />);
    const el = container.firstElementChild as HTMLElement;
    expect(shown(el)).toBe("+3,000원");
    expect(el.textContent).toContain("환불 3,000원");
    expect(el.dataset.kind).toBe("refund");
  });

  test("transfer is unsigned and labelled 이체", () => {
    const { container } = render(<AmountText type="transfer" amount={50000} />);
    const el = container.firstElementChild as HTMLElement;
    expect(shown(el)).toBe("50,000원");
    expect(el.textContent).toContain("이체 50,000원");
  });

  test("uses tabular numerals", () => {
    const { container } = render(<AmountText type="income" amount={1} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("num");
  });
});
