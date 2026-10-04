import { addDays, formatDisplayDate, monthRange, type PeriodKind, periodRange } from "../../shared/dates";

/** API date filters are inclusive `YYYY-MM-DD` KST dates (AM-4); shared/dates ranges are half-open. */
export type InclusiveRange = { readonly from: string; readonly to: string };

export function calendarMonthFilter(month: string): InclusiveRange {
  const range = monthRange(month, 1);
  return { from: range.from, to: addDays(range.to, -1) };
}

export function calendarYearFilter(year: string): InclusiveRange {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function periodFor(kind: Exclude<PeriodKind, "day">, anchor: string, monthStartDay = 1): InclusiveRange {
  const range = periodRange(kind, anchor, monthStartDay);
  return { from: range.from, to: addDays(range.to, -1) };
}

export function shiftPeriod(
  kind: Exclude<PeriodKind, "day">,
  current: InclusiveRange,
  step: 1 | -1,
  monthStartDay = 1,
): InclusiveRange {
  const anchor = step === 1 ? addDays(current.to, 1) : addDays(current.from, -1);
  return periodFor(kind, anchor, monthStartDay);
}

export function formatMonth(month: string): string {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
}

export function formatRange(range: InclusiveRange): string {
  return `${formatDisplayDate(range.from)} – ${formatDisplayDate(range.to)}`;
}
