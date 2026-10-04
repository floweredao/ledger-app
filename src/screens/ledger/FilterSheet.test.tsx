import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import FilterSheet, { type SearchFilters } from "./FilterSheet";

afterEach(cleanup);

function FilterHarness({ onApply }: { readonly onApply: (filters: SearchFilters) => void }) {
  const [filters, setFilters] = useState<SearchFilters>({
    from: "",
    to: "",
    type: "",
    categoryIds: [],
    assetId: "",
    min: "",
    max: "",
    source: "",
    hidden: "exclude",
  });
  return (
    <FilterSheet
      open
      onClose={() => {}}
      filters={filters}
      onChange={setFilters}
      onApply={onApply}
      error=""
      categories={[]}
      assets={[]}
    />
  );
}

describe("FilterSheet", () => {
  test("applies hidden-only mode as the supported `only` query value", () => {
    let applied: SearchFilters | undefined;
    render(
      <FilterHarness
        onApply={(next) => {
          applied = next;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "숨김만" }));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(applied?.hidden).toBe("only");
  });
});
