import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

type ChipProps = {
  readonly selected?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
};

export function Chip({ selected = false, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={selected}
      data-selected={selected || undefined}
      onClick={onClick}
    >
      {selected ? <Check aria-hidden="true" size={14} strokeWidth={2.5} /> : null}
      {children}
    </button>
  );
}

type FilterChipProps = {
  readonly children: ReactNode;
  /** Accessible name of the remove button, e.g. `식비 필터 해제`. */
  readonly removeLabel: string;
  readonly onRemove: () => void;
};

export function FilterChip({ children, removeLabel, onRemove }: FilterChipProps) {
  return (
    <span className="chip chip-filter" data-selected>
      <span>{children}</span>
      <button type="button" className="chip-remove" aria-label={removeLabel} onClick={onRemove}>
        <X aria-hidden="true" size={14} strokeWidth={2.5} />
      </button>
    </span>
  );
}
