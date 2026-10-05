import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { CategoryIcon } from "./CategoryIcon";

afterEach(cleanup);

describe("CategoryIcon", () => {
  test.each(["monitor", "bot"])("renders the selected %s glyph instead of the fallback", (icon) => {
    const { container } = render(<CategoryIcon icon={icon} color="cat-3" />);

    expect(container.querySelector(`svg.lucide-${icon}`)).not.toBeNull();
    expect(container.querySelector("svg.lucide-circle-question-mark")).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  test("retains the fallback and accessible label for an unknown icon", () => {
    const { container, getByRole } = render(
      <CategoryIcon icon="sample-unknown-icon" color="cat-3" label="샘플 분류" />,
    );

    expect(container.querySelector("svg.lucide-circle-question-mark")).not.toBeNull();
    expect(container.firstElementChild).toBe(getByRole("img", { name: "샘플 분류" }));
  });
});
