/** All ledger dates are Korea Standard Time (UTC+9, no DST). Dates are `YYYY-MM-DD`, months `YYYY-MM`. */
export const KST_OFFSET = "+09:00";
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DateRange = { readonly from: string; readonly to: string };
export type PeriodKind = "day" | "week" | "month" | "year";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function parts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value);
  if (!match) throw new RangeError(`Invalid date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3] ?? "1") };
}

export function toKstIso(instant: Date = new Date()): string {
  const shifted = new Date(instant.getTime() + KST_MS).toISOString();
  return `${shifted.slice(0, 19)}${KST_OFFSET}`;
}

export const nowKst = (): string => toKstIso(new Date());

export function kstDate(instant: Date | string = new Date()): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return toKstIso(date).slice(0, 10);
}

export const kstMonth = (instant: Date | string = new Date()): string => kstDate(instant).slice(0, 7);

/** Human-readable KST date; older years and date-only values do not display a time. */
export function formatDisplayDate(value: string, now: Date = new Date()): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const kst = dateOnly ? value : toKstIso(new Date(value));
  const { year, month, day } = parts(kst);
  const currentYear = year === Number(kstDate(now).slice(0, 4));
  const date = `${currentYear ? "" : `${year}년 `}${month}월 ${day}일`;
  return currentYear && !dateOnly ? `${date} ${kst.slice(11, 16)}` : date;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths(month: string, count: number): string {
  const { year, month: m } = parts(month);
  const index = year * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function addDays(date: string, count: number): string {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day) + count * DAY_MS).toISOString().slice(0, 10);
}

function startOf(month: string, startDay: number): string {
  const { year, month: m } = parts(month);
  return `${month.slice(0, 7)}-${pad(Math.min(startDay, daysInMonth(year, m)))}`;
}

/** The accounting month [from, to): `monthRange("2026-10", 25)` = 2026-10-25 .. 2026-11-25 (exclusive). */
export function monthRange(month: string, startDay = 1): DateRange {
  return { from: startOf(month, startDay), to: startOf(addMonths(month, 1), startDay) };
}

/** The half-open range of `kind` containing `anchor` (`YYYY-MM-DD`); weeks start on Sunday. */
export function periodRange(kind: PeriodKind, anchor: string, startDay = 1): DateRange {
  switch (kind) {
    case "day":
      return { from: anchor, to: addDays(anchor, 1) };
    case "week": {
      const { year, month, day } = parts(anchor);
      const from = addDays(anchor, -new Date(Date.UTC(year, month - 1, day)).getUTCDay());
      return { from, to: addDays(from, 7) };
    }
    case "month": {
      const month = anchor.slice(0, 7);
      const current = monthRange(month, startDay);
      if (anchor < current.from) return monthRange(addMonths(month, -1), startDay);
      return current;
    }
    case "year": {
      const year = anchor.slice(0, 4);
      return { from: `${year}-01-01`, to: `${Number(year) + 1}-01-01` };
    }
    default: {
      const unreachable: never = kind;
      throw new RangeError(`Unknown period: ${String(unreachable)}`);
    }
  }
}
