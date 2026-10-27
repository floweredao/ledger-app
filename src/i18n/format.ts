import { formatDisplayDate as formatKoDisplayDate, kstDate, toKstIso } from "../../shared/dates";
import * as money from "../../shared/money";
import type { TransactionType } from "../../shared/schema";
import { getLocale, INTL_TAG } from ".";

/** Locale-bound formatters: every user-visible number, amount and date goes through these. */

export const formatWon = (amount: number) => money.formatWon(amount, getLocale());
export const formatSigned = (type: TransactionType, amount: number, isRefund = false) =>
  money.formatSigned(type, amount, isRefund, getLocale());
export const compactWon = (amount: number) => money.compactWon(amount, getLocale());

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  value.toLocaleString(INTL_TAG[getLocale()], options);

const utc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
};
const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(INTL_TAG[getLocale()], { ...options, timeZone: "UTC" });

/** `YYYY-MM`: Korean `2026년 10월`, English `October 2026`. */
export const formatMonth = (month: string) =>
  fmt({ year: "numeric", month: "long" }).format(utc(`${month.slice(0, 7)}-01`));
/** `YYYY-MM`: Korean `10월`, English `Oct`. */
export const formatMonthShort = (month: string) => fmt({ month: "short" }).format(utc(`${month.slice(0, 7)}-01`));
/** `YYYY-MM-DD`: Korean `2026년 10월 22일 목요일`, English `Thursday, October 22, 2026`. */
export const formatFullDate = (date: string) =>
  fmt({ year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(utc(date));
/** `YYYY-MM-DD`: Korean `목요일`, English `Thursday`. */
export const formatWeekday = (date: string, width: "long" | "short" | "narrow" = "long") =>
  fmt({ weekday: width }).format(utc(date));

/** KST date or instant; older years and date-only values do not display a time (same rules as shared/dates). */
export function formatDisplayDate(value: string, now: Date = new Date()): string {
  if (getLocale() === "ko") return formatKoDisplayDate(value, now);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const kst = dateOnly ? value : toKstIso(new Date(value));
  const currentYear = kst.slice(0, 4) === kstDate(now).slice(0, 4);
  const date = fmt(
    currentYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" },
  ).format(utc(kst.slice(0, 10)));
  return currentYear && !dateOnly ? `${date} ${kst.slice(11, 16)}` : date;
}
