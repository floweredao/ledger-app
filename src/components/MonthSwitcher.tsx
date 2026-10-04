import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths } from "../../shared/dates";
import { formatMonth } from "../app/periods";
import { IconButton } from "./Button";

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** `month` takes `YYYY-MM`, `year` takes `YYYY`. */
  readonly unit?: "month" | "year";
  /** Actual date range shown under the label when it differs from the calendar month. */
  readonly rangeLabel?: string;
};

export function MonthSwitcher({ value, onChange, unit = "month", rangeLabel }: Props) {
  const step = (delta: 1 | -1) => onChange(unit === "month" ? addMonths(value, delta) : String(Number(value) + delta));
  const noun = unit === "month" ? "달" : "해";
  return (
    <div className="month-switcher">
      <IconButton label={`이전 ${noun}`} icon={ChevronLeft} onClick={() => step(-1)} />
      <div className="month-switcher-label" aria-live="polite">
        <span className="num">{unit === "month" ? formatMonth(value) : `${value}년`}</span>
        {rangeLabel ? <span className="month-switcher-range num">{rangeLabel}</span> : null}
      </div>
      <IconButton label={`다음 ${noun}`} icon={ChevronRight} onClick={() => step(1)} />
    </div>
  );
}
