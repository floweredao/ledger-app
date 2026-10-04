import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { kstDate } from "../../shared/dates";
import { formatRange, type InclusiveRange, periodFor, shiftPeriod } from "../app/periods";
import { IconButton } from "./Button";
import { Field, Input } from "./Field";
import { SegmentedControl } from "./SegmentedControl";

export type PeriodKind = "week" | "month" | "year" | "custom";
export type PeriodValue = InclusiveRange & { readonly period: PeriodKind };

const OPTIONS = [
  { value: "week", label: "주" },
  { value: "month", label: "월" },
  { value: "year", label: "년" },
  { value: "custom", label: "기간" },
] as const;

type Props = {
  readonly value: PeriodValue;
  readonly onChange: (value: PeriodValue) => void;
  readonly monthStartDay?: number;
};

export function PeriodPicker({ value, onChange, monthStartDay = 1 }: Props) {
  const [draft, setDraft] = useState<InclusiveRange>({ from: value.from, to: value.to });
  const kind = value.period === "custom" ? null : value.period;
  const invalid = draft.from === "" || draft.to === "" || draft.from > draft.to;

  const choose = (period: PeriodKind) => {
    if (period === "custom") {
      setDraft({ from: value.from, to: value.to });
      onChange({ ...value, period });
      return;
    }
    onChange({ period, ...periodFor(period, value.period === "custom" ? kstDate() : value.from, monthStartDay) });
  };

  return (
    <div className="period-picker">
      <SegmentedControl label="기간 단위" options={OPTIONS} value={value.period} onChange={choose} />
      {kind === null ? (
        <div className="period-custom">
          <Field label="시작일">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
            )}
          </Field>
          <Field label="종료일" error={invalid ? "시작일은 종료일보다 늦을 수 없어요" : null}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            )}
          </Field>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={invalid}
            onClick={() => onChange({ period: "custom", ...draft })}
          >
            적용
          </button>
        </div>
      ) : (
        <div className="month-switcher">
          <IconButton
            label="이전 기간"
            icon={ChevronLeft}
            onClick={() => onChange({ period: kind, ...shiftPeriod(kind, value, -1, monthStartDay) })}
          />
          <div className="month-switcher-label num" aria-live="polite">
            {formatRange(value)}
          </div>
          <IconButton
            label="다음 기간"
            icon={ChevronRight}
            onClick={() => onChange({ period: kind, ...shiftPeriod(kind, value, 1, monthStartDay) })}
          />
        </div>
      )}
    </div>
  );
}
