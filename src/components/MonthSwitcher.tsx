import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths } from "../../shared/dates";
import { formatMonth } from "../app/periods";
import { useMessages } from "../i18n";
import { IconButton } from "./Button";
import { componentMessages } from "./ui-messages";

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** `month` takes `YYYY-MM`, `year` takes `YYYY`. */
  readonly unit?: "month" | "year";
  /** Actual date range shown under the label when it differs from the calendar month. */
  readonly rangeLabel?: string;
};

export function MonthSwitcher({ value, onChange, unit = "month", rangeLabel }: Props) {
  const m = useMessages(componentMessages);
  const step = (delta: 1 | -1) => onChange(unit === "month" ? addMonths(value, delta) : String(Number(value) + delta));
  return (
    <div className="month-switcher">
      <IconButton
        label={unit === "month" ? m.previousMonth : m.previousYear}
        icon={ChevronLeft}
        onClick={() => step(-1)}
      />
      <div className="month-switcher-label" aria-live="polite">
        <span className="num">{unit === "month" ? formatMonth(value) : m.yearLabel(value)}</span>
        {rangeLabel ? <span className="month-switcher-range num">{rangeLabel}</span> : null}
      </div>
      <IconButton label={unit === "month" ? m.nextMonth : m.nextYear} icon={ChevronRight} onClick={() => step(1)} />
    </div>
  );
}
