import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { addDays, daysInMonth, formatDisplayDate, kstDate } from "../../../shared/dates";
import { compactWon, formatSigned } from "../../../shared/money";
import type { StatsCalendar, TransactionList } from "../../../shared/schema";
import { paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { openEntry } from "../../app/entry-bridge";
import { formatMonth } from "../../app/periods";
import { originalNameLine } from "../../app/transaction-label";
import { AmountText } from "../../components/AmountText";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Badge, ListRow } from "../../components/ListRow";
import { Skeleton } from "../../components/Skeleton";
import { useSelectedMonth } from "../../router";
import "./calendar.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const KIND_LABEL = { expense: "지출", income: "수입", transfer: "이체", refund: "환불" } as const;

function firstDate(month: string): string {
  return `${month}-01`;
}

function dayLabel(date: string): string {
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) ?? [];
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${year}년 ${Number(month)}월 ${Number(day)}일 ${weekday}요일`;
}

function makeGrid(month: string): readonly string[] {
  const first = firstDate(month);
  const offset = new Date(`${first}T00:00:00Z`).getUTCDay();
  const count = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const rows = Math.ceil((offset + count) / 7);
  const start = addDays(first, -offset);
  return Array.from({ length: rows * 7 }, (_, index) => addDays(start, index));
}

function signedCompact(kind: "income" | "expense", amount: number): string {
  const sign = kind === "income" ? "+" : "-";
  return `${sign}${compactWon(amount)}`;
}

function DayTransactions({ date }: { readonly date: string }) {
  const transactions = useApi<TransactionList>(paths.transactions({ from: date, to: date, limit: 1000 }));
  if (transactions.data === undefined && transactions.loading) {
    return <Skeleton label="날짜별 거래 불러오는 중" />;
  }
  if (!transactions.data && transactions.error) {
    return (
      <EmptyState
        tone="error"
        title="거래를 불러오지 못했어요"
        action={
          <Button size="sm" onClick={transactions.reload}>
            다시 시도
          </Button>
        }
      />
    );
  }
  const rows = transactions.data?.items ?? [];
  if (rows.length === 0) return <p className="calendar-empty-day">이 날짜에 기록이 없어요</p>;
  return (
    <ul className="calendar-transactions">
      {rows.map((transaction) => {
        const foreignAmount =
          transaction.currency !== "KRW" && transaction.foreign_amount !== null
            ? `${transaction.type === "expense" && !transaction.is_refund ? "-" : transaction.type === "transfer" ? "" : "+"}${transaction.currency} ${transaction.foreign_amount.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}`
            : null;
        const kind = transaction.type === "expense" && transaction.is_refund ? "refund" : transaction.type;
        const subtitle = [
          transaction.merchant && transaction.memo ? transaction.memo : undefined,
          originalNameLine(transaction),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={transaction.id}>
            <ListRow
              title={
                transaction.merchant ||
                transaction.memo ||
                (transaction.type === "transfer" ? "이체" : "이름 없는 거래")
              }
              subtitle={subtitle || undefined}
              badges={
                <span className="calendar-badges">
                  <span className="calendar-kind" data-kind={kind}>
                    {KIND_LABEL[kind]}
                  </span>
                  {transaction.krw_status === "pending" ? <Badge tone="warning">원화 미확정</Badge> : null}
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
  const [month, setMonth] = useSelectedMonth();
  const currentDate = kstDate();
  const [selectedDate, setSelectedDate] = useState(() =>
    currentDate.startsWith(month) ? currentDate : firstDate(month),
  );
  const [keyboardFocusDate, setKeyboardFocusDate] = useState<string | null>(null);
  const calendar = useApi<StatsCalendar>(paths.statsCalendar(month));
  const gridDates = useMemo(() => makeGrid(month), [month]);
  const totalsByDate = useMemo(
    () => new Map((calendar.data?.days ?? []).map((day) => [day.date, day])),
    [calendar.data],
  );
  const isTodayInMonth = currentDate.startsWith(month);

  useEffect(() => {
    if (!selectedDate.startsWith(month)) {
      setSelectedDate(isTodayInMonth ? currentDate : firstDate(month));
    }
  }, [currentDate, isTodayInMonth, month, selectedDate]);

  useEffect(() => {
    if (!keyboardFocusDate || !gridDates.includes(keyboardFocusDate)) return;
    document.querySelector<HTMLButtonElement>(`[data-calendar-date="${keyboardFocusDate}"]`)?.focus();
    setKeyboardFocusDate(null);
  }, [gridDates, keyboardFocusDate]);

  const selectDate = (date: string) => {
    if (!date.startsWith(month)) setMonth(date.slice(0, 7));
    setSelectedDate(date);
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
    <section className="calendar-view" aria-label={`${formatMonth(month)} 달력`}>
      <div className="calendar-workspace">
        <div className="calendar-main">
          {calendar.data === undefined && calendar.loading ? (
            <Skeleton variant="block" label="달력 불러오는 중" />
          ) : calendar.data === undefined && calendar.error ? (
            <EmptyState
              tone="error"
              title="달력을 불러오지 못했어요"
              action={
                <Button size="sm" onClick={calendar.reload}>
                  다시 시도
                </Button>
              }
            />
          ) : (
            <>
              <div className="calendar-weekdays" aria-hidden="true">
                {WEEKDAYS.map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <fieldset className="calendar-grid">
                <legend className="sr-only">날짜 선택</legend>
                {gridDates.map((date) => {
                  const day = totalsByDate.get(date);
                  const inMonth = date.startsWith(month);
                  const today = date === currentDate;
                  const selected = date === selectedDate;
                  const accessibleLabel = [
                    dayLabel(date),
                    day && day.income > 0 ? `수입 ${formatSigned("income", day.income)}` : "",
                    day && day.expense > 0 ? `지출 ${formatSigned("expense", day.expense)}` : "",
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
                      onClick={() => selectDate(date)}
                      onKeyDown={(event) => onDayKeyDown(event, date)}
                    >
                      <span className="calendar-day-number num">{Number(date.slice(-2))}</span>
                      <span className="calendar-day-amount calendar-income num" aria-hidden="true">
                        {day && day.income > 0 ? (
                          <>
                            <span className="calendar-compact">{signedCompact("income", day.income)}</span>
                            <span className="calendar-full">{formatSigned("income", day.income)}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="calendar-day-amount calendar-expense num" aria-hidden="true">
                        {day && day.expense > 0 ? (
                          <>
                            <span className="calendar-compact">{signedCompact("expense", day.expense)}</span>
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
        <aside className="calendar-day-panel" aria-label={`${dayLabel(selectedDate)} 내역`}>
          <div className="calendar-day-heading">
            <div>
              <h2 className="section-title">{formatDisplayDate(selectedDate)}</h2>
              <p className="calendar-day-summary">{totalsByDate.get(selectedDate)?.count ?? 0}건의 기록</p>
            </div>
            <Button variant="primary" onClick={() => openEntry({ date: selectedDate })}>
              이 날짜에 기록
            </Button>
          </div>
          <DayTransactions date={selectedDate} />
        </aside>
      </div>
    </section>
  );
}
