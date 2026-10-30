import { useEffect, useRef } from "react";
import type { Category } from "../../../shared/schema";
import { CategoryIcon } from "../../components/CategoryIcon";
import { Chip } from "../../components/Chip";
import { useMessages } from "../../i18n";
import { entryMessages } from "./messages";

type Props = {
  /** Visible categories of the current type, parents and children together. */
  readonly categories: readonly Category[];
  /** Category ids in most-recent-use order. */
  readonly recentIds: readonly string[];
  readonly value: string | null;
  /** `final` is true when the pick needs no further choice: a child, a parent without children, or a re-tapped parent. */
  readonly onChange: (id: string, final: boolean) => void;
};

function byRecent(recentIds: readonly string[]) {
  const rank = (category: Category) => {
    const index = recentIds.indexOf(category.id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return (a: Category, b: Category) => rank(a) - rank(b) || a.sort - b.sort;
}

/** The 분류 grid in the entry panel: parents as tiles, the selected parent's children as chips below. */
export function CategoryPicker({ categories, recentIds, value, onChange }: Props) {
  const t = useMessages(entryMessages);
  const selected = categories.find((category) => category.id === value);
  const expandedId = selected?.parent_id ?? selected?.id ?? null;
  const parentRecent = recentIds.map((id) => categories.find((c) => c.id === id)?.parent_id ?? id);
  const parents = categories.filter((c) => c.parent_id === null).sort(byRecent(parentRecent));
  const expanded = parents.find((parent) => parent.id === expandedId);
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id);
  const children = expandedId ? childrenOf(expandedId).sort(byRecent(recentIds)) : [];
  const childRowRef = useRef<HTMLFieldSetElement>(null);
  const revealChildren = useRef(false);

  useEffect(() => {
    if (!revealChildren.current || expandedId === null) return;
    revealChildren.current = false;
    childRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [expandedId]);

  return (
    <fieldset className="entry-fieldset entry-picker">
      <legend className="sr-only">{t.category}</legend>
      <div className="picker-grid">
        {parents.map((parent) => (
          <button
            key={parent.id}
            type="button"
            className="picker-tile"
            aria-pressed={parent.id === value}
            data-expanded={(parent.id === expandedId && parent.id !== value) || undefined}
            onClick={() => {
              revealChildren.current = true;
              onChange(parent.id, parent.id === value || childrenOf(parent.id).length === 0);
            }}
          >
            <CategoryIcon size="sm" icon={parent.icon} color={parent.color} />
            <span className="picker-tile-name">{parent.name}</span>
          </button>
        ))}
      </div>
      {expanded && children.length > 0 ? (
        <fieldset ref={childRowRef} className="category-children entry-fieldset">
          <legend className="entry-hint">{t.subcategories(expanded.name)}</legend>
          <div className="chip-row">
            {children.map((child) => (
              <Chip key={child.id} selected={child.id === value} onClick={() => onChange(child.id, true)}>
                {child.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}
    </fieldset>
  );
}
