import { type CSSProperties, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { addDays, daysInMonth, kstDate } from "../../../shared/dates";
import type { CategoryNode, StatsCalendar, TransactionList } from "../../../shared/schema";
import { paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { openEntry } from "../../app/entry-bridge";
import { formatMonth } from "../../app/periods";
import { rowCategoryLabel, TRANSFER_ICON } from "../../app/transaction-label";
import { AmountText } from "../../components/AmountText";
import { Button } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Badge, ListRow } from "../../components/ListRow";
import { Skeleton } from "../../components/Skeleton";
import { getLocale, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import {
  compactWon,
  formatDisplayDate,
  formatFullDate,
  formatNumber,
  formatSigned,
  formatWeekday,
} from "../../i18n/format";
import { useSelectedDate, useSelectedMonth } from "../../router";
import { calendarMessages } from "./calendar-messages";
import "./calendar.css";

/** 2026-10-04 is a Sunday; the grid starts on Sunday. */
const WEEK = Array.from({ length: 7 }, (_, index) => addDays("2026-10-04", index));

function firstDate(month: string): string {
  return `${month}-01`;
}

const dayLabel = formatFullDate;

function makeGrid(month: string): readonly string[] {
  const first = firstDate(month);
  const offset = new Date(`${first}T00:00:00Z`).getUTCDay();
  const count = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const rows = Math.ceil((offset + count) / 7);
  const start = addDays(first, -offset);
  return Array.from({ length: rows * 7 }, (_, index) => addDays(start, index));
}

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

/**
 * A phone-width day cell fits a sign, four narrow glyphs and one unit at 12px, so a total rounds to that budget:
 * 9,999 · 1.2만 · 999만 · 1천만–9천만 · 1억–9.9억 · 10억–999억 · 1천억–9천억 · 1조–9.9조. The full amount stays in the
 * cell's accessible name and in the selected-day detail.
 */
/** English keeps the same budget: 9,999 · 12K · 999K · 1.2M · 123M · 1.2B · 123B · 1.2T. */
function calendarCompactEn(abs: number): string {
  if (abs < 10_000) return compactWon(abs);
  if (abs < 999_500) return `${Math.round(abs / 1e3)}K`;
  if (abs < 9_950_000) return `${oneDecimal(abs / 1e6)}M`;
  if (abs < 999_500_000) return `${Math.round(abs / 1e6)}M`;
  if (abs < 9_950_000_000) return `${oneDecimal(abs / 1e9)}B`;
  if (abs < 999_500_000_000) return `${Math.round(abs / 1e9)}B`;
  return `${oneDecimal(abs / 1e12)}T`;
}

function calendarCompact(abs: number): string {
  if (getLocale() === "en") return calendarCompactEn(abs);
  if (abs < 9_995_000) return compactWon(abs);
  if (abs < 95_000_000) return `${Math.round(abs / 1e7)}천만`;
  if (abs < 995_000_000) return `${oneDecimal(abs / 1e8)}억`;
  if (abs < 99_950_000_000) return `${Math.round(abs / 1e8)}억`;
  if (abs < 950_000_000_000) return `${Math.round(abs / 1e11)}천억`;
  return `${oneDecimal(abs / 1e12)}조`;
}

function signedCompact(kind: "income" | "expense", amount: number): string {
  return `${kind === "income" ? "+" : "-"}${calendarCompact(Math.abs(amount))}`;
}

/** Approximate width in em (tabular digits, narrow separators, wide 만/억) so CSS can fit the amount on one line. */
function amountFit(text: string): CSSProperties {
  let em = 0;
  for (const char of text) em += char === "," || char === "." ? 0.28 : /\d|[+-]/.test(char) ? 0.56 : 0.9;
  return { "--amount-em": em.toFixed(2) } as CSSProperties;
}

function DayTransactions({ date }: { readonly date: string }) {
  const transactions = useApi<TransactionList>(paths.transactions({ from: date, to: date, limit: 1000 }));
  const categories = useApi<{ readonly items: readonly CategoryNode[] }>(paths.categories({ include_hidden: true }));
  const m = useMessages(calendarMessages);
  const c = useMessages(common);
  const categoryMap = new Map(
    (categories.data?.items ?? [])
      .flatMap((category) => [category, ...(category.children ?? [])])
      .map((category) => [category.id, category]),
  );
  if (transactions.data === undefined && transactions.loading) {
    return <Skeleton label={m.dayLoading} />;
  }
  if (!transactions.data && transactions.error) {
    return (
      <EmptyState
        tone="error"
        title={m.dayLoadFailed}
        action={
          <Button size="sm" onClick={transactions.reload}>
            {c.retry}
          </Button>
        }
      />
    );
  }
  const rows = transactions.data?.items ?? [];
  if (rows.length === 0) return <p className="calendar-empty-day">{m.emptyDay}</p>;
  return (
    <ul className="calendar-transactions">
      {rows.map((transaction) => {
        const foreignAmount =
          transaction.currency !== "KRW" && transaction.foreign_amount !== null
            ? `${transaction.type === "expense" && !transaction.is_refund ? "-" : transaction.type === "transfer" ? "" : "+"}${transaction.currency} ${formatNumber(transaction.foreign_amount, { maximumFractionDigits: 4 })}`
            : null;
        const kind = transaction.type === "expense" && transaction.is_refund ? "refund" : transaction.type;
        const category = transaction.category_id ? categoryMap.get(transaction.category_id) : undefined;
        const title =
          transaction.merchant || transaction.memo || (transaction.type === "transfer" ? c.transfer : m.unnamed);
        const subtitle = [
          rowCategoryLabel(transaction.category_id, (id) => categoryMap.get(id), title),
          transaction.merchant && transaction.memo ? transaction.memo : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={transaction.id}>
            <ListRow
              leading={
                <CategoryIcon
                  icon={category?.icon ?? (transaction.type === "transfer" ? TRANSFER_ICON : undefined)}
                  color={category?.color}
                />
              }
              title={title}
              subtitle={subtitle || undefined}
              badges={
                <span className="calendar-badges">
                  <span className="calendar-kind" data-kind={kind}>
                    {c[kind]}
                  </span>
                  {transaction.krw_status === "pending" ? <Badge tone="warning">{m.krwPending}</Badge> : null}
                </span>
              }
              trailing={
                <span className="calendar-row-amount">
                  {transaction.krw_status === "pending" && transaction.amount === 0 && foreignAmount ? (
                    <span className="num">{foreignAmount}</span>
                  ) : (
                    <>
                      <AmountText
                        type={transaction.type}
                        amount={transaction.amount}
                        isRefund={transaction.is_refund}
                        size="sm"
                      />
                      {foreignAmount ? <small className="num">{foreignAmount}</small> : null}
                    </>
                  )}
                </span>
              }
              onClick={() => openEntry({ id: transaction.id })}
            />
          </li>
        );
      })}
    </ul>
  );
}

export default function CalendarView() {
  const m = useMessages(calendarMessages);
  const c = useMessages(common);
  const [month] = useSelectedMonth();
  const currentDate = kstDate();
  const [selectedDate, setSelectedDate] = useSelectedDate();
  const [keyboardFocusDate, setKeyboardFocusDate] = useState<string | null>(null);
  const dayPanelRef = useRef<HTMLElement>(null);
  const calendar = useApi<StatsCalendar>(paths.statsCalendar(month));
  const gridDates = useMemo(() => makeGrid(month), [month]);
  const totalsByDate = useMemo(
    () => new Map((calendar.data?.days ?? []).map((day) => [day.date, day])),
    [calendar.data],
  );

  useEffect(() => {
    if (!keyboardFocusDate || !gridDates.includes(keyboardFocusDate)) return;
    document.querySelector<HTMLButtonElement>(`[data-calendar-date="${keyboardFocusDate}"]`)?.focus();
    setKeyboardFocusDate(null);
  }, [gridDates, keyboardFocusDate]);

  const selectDate = setSelectedDate;

  /** Tapping the already selected day jumps to its records; html scroll-padding keeps the heading clear of the top bar. */
  const revealDayPanel = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dayPanelRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: window.innerWidth < 900 ? "start" : "nearest",
    });
  };

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    if (window.innerWidth < 900) return;
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const verticalDelta = event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : 0;
    if (delta === 0 && verticalDelta === 0) return;
    event.preventDefault();
    const nextDate = addDays(date, delta + verticalDelta);
    selectDate(nextDate);
    setKeyboardFocusDate(nextDate);
  };

  return (
    <section className="calendar-view" aria-label={m.calendarLabel(formatMonth(month))}>
      <div className="calendar-workspace">
        <div className="calendar-main">
          {calendar.data === undefined && calendar.loading ? (
            <Skeleton variant="block" label={m.calendarLoading} />
          ) : calendar.data === undefined && calendar.error ? (
            <EmptyState
              tone="error"
              title={m.calendarLoadFailed}
              action={
                <Button size="sm" onClick={calendar.reload}>
                  {c.retry}
                </Button>
              }
            />
          ) : (
            <>
              <div className="calendar-weekdays" aria-hidden="true">
                {WEEK.map((date) => (
                  <span key={date}>{formatWeekday(date, "short")}</span>
                ))}
              </div>
              <fieldset className="calendar-grid">
                <legend className="sr-only">{m.pickDate}</legend>
                {gridDates.map((date) => {
                  const day = totalsByDate.get(date);
                  const inMonth = date.startsWith(month);
                  const today = date === currentDate;
                  const selected = date === selectedDate;
                  const accessibleLabel = [
                    dayLabel(date),
                    day && day.income > 0 ? `${c.income} ${formatSigned("income", day.income)}` : "",
                    day && day.expense > 0 ? `${c.expense} ${formatSigned("expense", day.expense)}` : "",
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <button
                      key={date}
                      type="button"
                      className="calendar-day"
                      data-calendar-date={date}
                      data-outside-month={!inMonth || undefined}
                      data-today={today || undefined}
                      aria-label={accessibleLabel}
                      aria-pressed={selected}
                      onClick={() => (selected ? revealDayPanel() : selectDate(date))}
                      onKeyDown={(event) => onDayKeyDown(event, date)}
                    >
                      <span className="calendar-day-number num">{Number(date.slice(-2))}</span>
                      <span className="calendar-day-amount calendar-income num" aria-hidden="true">
                        {day && day.income > 0 ? (
                          <>
                            <span className="calendar-compact" style={amountFit(signedCompact("income", day.income))}>
                              {signedCompact("income", day.income)}
                            </span>
                            <span className="calendar-full">{formatSigned("income", day.income)}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="calendar-day-amount calendar-expense num" aria-hidden="true">
                        {day && day.expense > 0 ? (
                          <>
                            <span className="calendar-compact" style={amountFit(signedCompact("expense", day.expense))}>
                              {signedCompact("expense", day.expense)}
                            </span>
                            <span className="calendar-full">{formatSigned("expense", day.expense)}</span>
                          </>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </fieldset>
            </>
          )}
        </div>
        <aside ref={dayPanelRef} className="calendar-day-panel" aria-label={m.dayRecords(dayLabel(selectedDate))}>
          <div className="calendar-day-heading">
            <div>
              <h2 className="section-title">{formatDisplayDate(selectedDate)}</h2>
              <p className="calendar-day-summary">{m.recordCount(totalsByDate.get(selectedDate)?.count ?? 0)}</p>
            </div>
            <Button onClick={() => openEntry({ date: selectedDate })}>{m.addOnDate}</Button>
          </div>
          <DayTransactions date={selectedDate} />
        </aside>
      </div>
    </section>
  );
}
