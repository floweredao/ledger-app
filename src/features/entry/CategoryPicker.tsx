import { useEffect, useRef } from "react";
import type { Category } from "../../../shared/schema";
import { CategoryIcon } from "../../components/CategoryIcon";
import { Chip } from "../../components/Chip";

type Props = {
  /** Visible categories of the current type, parents and children together. */
  readonly categories: readonly Category[];
  /** Category ids in most-recent-use order. */
  readonly recentIds: readonly string[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
};

function byRecent(recentIds: readonly string[]) {
  const rank = (category: Category) => {
    const index = recentIds.indexOf(category.id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return (a: Category, b: Category) => rank(a) - rank(b) || a.sort - b.sort;
}

export function CategoryPicker({ categories, recentIds, value, onChange }: Props) {
  const selected = categories.find((category) => category.id === value);
  const expandedId = selected?.parent_id ?? selected?.id ?? null;
  const parentRecent = recentIds.map((id) => categories.find((c) => c.id === id)?.parent_id ?? id);
  const parents = categories.filter((c) => c.parent_id === null).sort(byRecent(parentRecent));
  const expanded = parents.find((parent) => parent.id === expandedId);
  const children = categories.filter((c) => c.parent_id === expandedId).sort(byRecent(recentIds));
  const childRowRef = useRef<HTMLFieldSetElement>(null);
  const revealChildren = useRef(false);

  useEffect(() => {
    if (!revealChildren.current || expandedId === null) return;
    revealChildren.current = false;
    childRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [expandedId]);

  return (
    <fieldset className="entry-section entry-fieldset">
      <legend className="entry-label">분류</legend>
      <div className="category-grid">
        {parents.map((parent) => (
          <button
            key={parent.id}
            type="button"
            className="category-tile"
            aria-pressed={parent.id === value}
            data-expanded={(parent.id === expandedId && parent.id !== value) || undefined}
            onClick={() => {
              revealChildren.current = true;
              onChange(parent.id);
            }}
          >
            <CategoryIcon icon={parent.icon} color={parent.color} />
            <span className="category-tile-name">{parent.name}</span>
          </button>
        ))}
      </div>
      {expanded && children.length > 0 ? (
        <fieldset ref={childRowRef} className="category-children entry-fieldset">
          <legend className="entry-hint">{`${expanded.name} 세부 분류`}</legend>
          <div className="chip-row">
            {children.map((child) => (
              <Chip key={child.id} selected={child.id === value} onClick={() => onChange(child.id)}>
                {child.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}
    </fieldset>
  );
}
