import { useId } from "react";
import { Link } from "../router";

type Option<T extends string> = { readonly value: T; readonly label: string };

type SegmentedControlProps<T extends string> = {
  readonly label: string;
  readonly options: readonly Option<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
};

/** Value selection: native radios, so arrow keys and form semantics come for free. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="segment" data-selected={option.value === value || undefined}>
          <input
            className="sr-only"
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

type SegmentLink = { readonly label: string; readonly to: string; readonly current: boolean };

/** Screen navigation: links with aria-current, never radios. */
export function SegmentedLinks({ label, items }: { readonly label: string; readonly items: readonly SegmentLink[] }) {
  return (
    <div className="segmented" aria-label={label} role="toolbar">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="segment"
          data-selected={item.current || undefined}
          aria-current={item.current ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
