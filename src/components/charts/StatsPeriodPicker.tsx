import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { PeriodKind } from "../../../shared/dates";
import { kstDate } from "../../../shared/dates";
import { RangeQuerySchema } from "../../../shared/schema";
import { formatRange, type InclusiveRange, periodFor, shiftPeriod } from "../../app/periods";
import { messages, useMessages } from "../../i18n";
import { navigate } from "../../router";
import { Button, IconButton } from "../Button";
import { SegmentedControl } from "../SegmentedControl";
import { chartMessages } from "./messages";

const periods = () =>
  [
    { value: "week", label: messages(chartMessages).week },
    { value: "month", label: messages(chartMessages).month },
    { value: "year", label: messages(chartMessages).year },
    { value: "custom", label: messages(chartMessages).custom },
  ] as const;
export type StatsPeriod = Exclude<PeriodKind, "day"> | "custom";
export type StatsType = "expense" | "income";

export function parseStatsPeriod(value: string | null): StatsPeriod {
  return periods().find((period) => period.value === value)?.value ?? "month";
}

export function parseStatsType(value: string | null): StatsType {
  return value === "income" ? "income" : "expense";
}

export function statsRange(
  period: StatsPeriod,
  from: string | null,
  to: string | null,
  monthStartDay: number,
): InclusiveRange {
  const parsedRange = RangeQuerySchema.safeParse({ from, to });
  if (parsedRange.success && parsedRange.data.from <= parsedRange.data.to) return parsedRange.data;
  const fallbackPeriod = period === "custom" ? "month" : period;
  return periodFor(fallbackPeriod, kstDate(), monthStartDay);
}

function updateRoute(period: StatsPeriod, range: InclusiveRange, type: StatsType): void {
  const query = new URLSearchParams({ period, from: range.from, to: range.to, type });
  navigate(`/stats?${query.toString()}`, { replace: true });
}

type Props = {
  readonly period: StatsPeriod;
  readonly range: InclusiveRange;
  readonly type: StatsType;
  readonly monthStartDay: number;
};

export function StatsPeriodPicker({ period, range, type, monthStartDay }: Props) {
  const m = useMessages(chartMessages);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [error, setError] = useState("");

  useEffect(() => {
    setFrom(range.from);
    setTo(range.to);
    setError("");
  }, [range.from, range.to]);

  const changePeriod = (next: StatsPeriod) => {
    const today = kstDate();
    const anchor = today >= range.from && today <= range.to ? today : range.from;
    const nextRange = next === "custom" ? range : periodFor(next, anchor, monthStartDay);
    updateRoute(next, nextRange, type);
  };
  const step = (direction: -1 | 1) => {
    if (period === "custom") return;
    updateRoute(period, shiftPeriod(period, range, direction, monthStartDay), type);
  };
  const applyRange = () => {
    if (!from || !to) {
      setError(m.enterDates);
      return;
    }
    if (from > to) {
      setError(m.invalidRange);
      return;
    }
    updateRoute("custom", { from, to }, type);
  };

  return (
    <section className="stats-period" aria-label={m.statisticsPeriod}>
      <SegmentedControl label={m.statisticsPeriod} options={periods()} value={period} onChange={changePeriod} />
      {period === "custom" ? (
        <div className="stats-custom-range">
          <label className="stats-date-field">
            <span>{m.startDate}</span>
            <input
              aria-label={m.startDate}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <span aria-hidden="true">–</span>
          <label className="stats-date-field">
            <span>{m.endDate}</span>
            <input aria-label={m.endDate} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <Button variant="secondary" size="sm" onClick={applyRange}>
            {m.applyRange}
          </Button>
          {error ? (
            <p className="stats-period-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="stats-period-nav">
          <IconButton label={m.previousPeriod} icon={ChevronLeft} onClick={() => step(-1)} />
          <p className="stats-period-range num" aria-live="polite">
            {formatRange(range)}
          </p>
          <IconButton label={m.nextPeriod} icon={ChevronRight} onClick={() => step(1)} />
        </div>
      )}
    </section>
  );
}
